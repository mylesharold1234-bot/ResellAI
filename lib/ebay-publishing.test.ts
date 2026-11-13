import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { emptyMatchDetails } from "./marketplaces";
import { createListingDraft, confirmAttribute, editAttribute } from "./listing/draft";
import { applyGenerated } from "./listing/apply";
import { buildTitle, buildDescription } from "./listing/template";
import { assessListing } from "./listing/readiness";
import type { ListingDraft } from "./listing/types";
import { readSellerConfig, sellerScopes, type SellerConfig } from "./ebay-seller/config";
import { createSellerStore } from "./ebay-seller/store";
import { buildAspects, buildInventoryItem, compatibleConditions, ebayCondition, ebayPublishIssues, listingImageUrls, photosNeedingUpload, suggestedConditionId, EBAY_DESCRIPTION_LIMIT } from "./ebay-seller/payload";
import { locationBody, parseLocationInput, parsePolicyInput, policyBody } from "./ebay-seller/policies";
import { createSellerHandlers, SESSION_COOKIE } from "./ebay-seller/handlers";
import { fakeEbay } from "./test-support/fake-ebay";

// All eBay traffic here is simulated by fakeEbay (shapes from eBay's OpenAPI contracts). No live calls.
const key = randomBytes(32);
const NOW = Date.parse("2026-11-13T12:00:00Z");
const session = "b".repeat(64);
const PNG = readFileSync(join(process.cwd(), "tests/fixtures/upload-check.png"));
const config = (o: Partial<SellerConfig> = {}): SellerConfig => ({ clientId: "id", clientSecret: "secret", ruName: "Ru", environment: "sandbox", tokenKey: key, publishingEnabled: true, dataDir: mkdtempSync(join(tmpdir(), "resellai-pub-")), ...o });

async function setup(fakeOptions: Parameters<typeof fakeEbay>[0] = {}, c = config()) {
  const fake = fakeEbay(fakeOptions);
  const store = createSellerStore(c.dataDir, key);
  await store.saveTokens(session, { accessToken: "user-access", accessExpiresAt: NOW + 3_600_000, refreshToken: "r", refreshExpiresAt: NOW + 86_400_000, environment: c.environment, connectedAt: "x" });
  return { h: createSellerHandlers({ config: c, fetcher: fake.fetcher, now: () => NOW, store }), fake };
}
const headers = (o: { origin?: string | null; cookie?: string } = {}) => ({ ...(o.origin === null ? {} : { origin: o.origin ?? "http://localhost:3001" }), cookie: o.cookie ?? `${SESSION_COOKIE}=${session}` });
const postJson = (path: string, body: unknown, o: { origin?: string | null; cookie?: string } = {}) =>
  new Request(`http://localhost:3001${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers(o) }, body: JSON.stringify(body) });
const get = (path: string) => new Request(`http://localhost:3001${path}`, { headers: headers() });
function upload(bytes: Uint8Array, type = "image/png", o: { origin?: string | null; cookie?: string } = {}) {
  const form = new FormData();
  form.append("image", new File([new Uint8Array(bytes)], "shoe.png", { type }));
  return new Request("http://localhost:3001/api/ebay/seller/images", { method: "POST", headers: headers(o), body: form });
}

function draft(o: { grade?: ListingDraft["condition"]["grade"]; packaging?: ListingDraft["condition"]["packaging"] } = {}): ListingDraft {
  let d = createListingDraft({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    now: "2026-11-13T12:00:00.000Z",
    identification: { brand: "Nike", productName: "Nike Dunk Low", category: "Sneakers", model: "Dunk Low", colorway: "White and black", visibleCondition: "Worn", identifyingInformation: null, confidence: "medium", uncertainties: [], additionalEvidence: [] },
    details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: o.grade ?? "used", packaging: o.packaging ?? "" },
    sources: { brand: "image-visible", productName: "image-visible", model: "ai-inferred", colorway: "image-visible" },
    photos: [{ id: "p1", name: "a.png" }, { id: "p2", name: "b.png" }],
    ebay: null,
    mercari: null,
  });
  d = confirmAttribute(confirmAttribute(d, "model"), "productType");
  d = { ...d, condition: { ...d.condition, description: "Light creasing.", noKnownDefects: true, confirmed: true } };
  d = applyGenerated(d, { source: "template", title: buildTitle(d), description: buildDescription(d), warnings: [] }, ["title", "description"]);
  return {
    ...d,
    pricing: { ...d.pricing, price: 74.5, priceSource: "evidence", priceProvider: "ebay" },
    shipping: { weightLb: "3", weightOz: "", length: "14", width: "10", height: "5", service: "", handlingDays: "1", whoPays: "buyer", confirmed: true },
    ebay: {
      ...d.ebay,
      categoryId: "15709",
      categoryName: "Clothing, Shoes & Accessories › Men › Men's Shoes › Athletic Shoes",
      fulfillmentPolicyId: "F1",
      paymentPolicyId: "P1",
      returnPolicyId: "R1",
      merchantLocationKey: "home",
      hostedImages: { p1: { url: "https://i.ebayimg.com/images/g/IMG1/s-l1600.jpg", expiresAt: "2026-12-13T00:00:00.000Z", environment: "sandbox", uploadedAt: "x" } },
    },
  };
}

test("seller sign-in requests the scopes needed to list, upload photos and create policies", () => {
  assert.ok(sellerScopes.includes("https://api.ebay.com/oauth/api_scope/sell.inventory"));
  assert.ok(sellerScopes.includes("https://api.ebay.com/oauth/api_scope/sell.account"));
});

test("endpoint overrides only apply outside production, and plain http only for localhost", () => {
  const sandbox = readSellerConfig({ EBAY_ENVIRONMENT: "sandbox", EBAY_SELLER_API_BASE: "http://localhost:4010", EBAY_MEDIA_API_BASE: "http://evil.example" });
  assert.equal(sandbox.endpoints?.api, "http://localhost:4010");
  assert.equal(sandbox.endpoints?.media, "https://apim.sandbox.ebay.com", "non-local http ignored");
  assert.equal(sandbox.endpoints?.overridden, true);
  const prod = readSellerConfig({ EBAY_ENVIRONMENT: "production", EBAY_SELLER_API_BASE: "http://localhost:4010" });
  assert.equal(prod.endpoints?.api, "https://api.ebay.com");
  assert.equal(prod.endpoints?.media, "https://apim.ebay.com");
  assert.equal(prod.endpoints?.overridden, false);
});

test("photos upload to eBay Picture Services through the Media API and return an eBay-hosted URL", async () => {
  const { h, fake } = await setup();
  const res = await h.uploadImage(upload(PNG));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.url, /^https:\/\/i\.ebayimg\.com\//);
  assert.equal(body.expiresAt, "2026-12-13T00:00:00.000Z");
  const create = fake.calls.find((c) => c.path === "/commerce/media/v1_beta/image/create_image_from_file")!;
  assert.equal(create.host, "apim.sandbox.ebay.com");
  assert.equal(create.method, "POST");
  assert.ok(create.body instanceof FormData && (create.body as FormData).get("image") instanceof File, "multipart field named image");
  assert.equal(create.auth, "Bearer user-access");
  assert.ok(fake.calls.some((c) => c.path === "/commerce/media/v1_beta/image/IMG1" && c.method === "GET"), "image read back via getImage");
  assert.ok(!JSON.stringify(body).includes("user-access"));
});

test("photo uploads are guarded: origin, connection, enable flag, file type, size, and eBay errors", async () => {
  const { h } = await setup();
  assert.equal((await h.uploadImage(upload(PNG, "image/png", { origin: null }))).status, 403);
  assert.equal((await h.uploadImage(upload(PNG, "image/png", { cookie: "" }))).status, 401);
  assert.equal((await h.uploadImage(upload(new TextEncoder().encode("not an image"), "image/png"))).status, 400);
  assert.equal((await h.uploadImage(upload(PNG, "image/gif"))).status, 400);
  const big = new Request("http://localhost:3001/api/ebay/seller/images", { method: "POST", headers: { ...headers(), "content-type": "multipart/form-data; boundary=x", "content-length": String(12 * 1024 * 1024) }, body: "x" });
  assert.equal((await h.uploadImage(big)).status, 413);
  const off = await setup({}, config({ publishingEnabled: false }));
  assert.equal((await off.h.uploadImage(upload(PNG))).status, 503);
  const failing = await setup({ failImage: true });
  const r = await failing.h.uploadImage(upload(PNG));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /too small/);
});

test("eBay-hosted photos feed the listing; expired or other-environment uploads are redone", () => {
  const d = draft();
  assert.deepEqual(listingImageUrls(d, NOW), ["https://i.ebayimg.com/images/g/IMG1/s-l1600.jpg"]);
  assert.deepEqual(photosNeedingUpload(d, "sandbox", NOW).map((p) => p.id), ["p2"]);
  assert.deepEqual(photosNeedingUpload(d, "production", NOW).map((p) => p.id), ["p1", "p2"], "sandbox images aren't reused in production");
  assert.deepEqual(listingImageUrls(d, Date.parse("2027-01-01")), [], "expired unused images are dropped");
  const unselected = { ...d, photos: d.photos.map((p) => ({ ...p, selected: p.id === "p1" })) };
  assert.deepEqual(photosNeedingUpload(unselected, "sandbox", NOW), []);
  assert.deepEqual(buildInventoryItem(d, undefined, NOW).product.imageUrls, ["https://i.ebayimg.com/images/g/IMG1/s-l1600.jpg"]);
});

test("conditions follow eBay's ID table and the category's allowed list", () => {
  const allowed = [{ id: "1000", name: "New with box" }, { id: "1500", name: "New without box" }, { id: "3000", name: "Pre-owned" }];
  assert.equal(suggestedConditionId(draft(), allowed), "3000");
  assert.equal(ebayCondition(draft()), "USED_EXCELLENT");
  assert.equal(suggestedConditionId(draft({ grade: "new", packaging: "none" }), allowed), "1500");
  assert.equal(suggestedConditionId(draft({ grade: "new", packaging: "original" }), allowed), "1000");
  assert.equal(suggestedConditionId(draft({ grade: "refurbished" }), allowed), null, "no allowed refurbished condition");
  assert.deepEqual(compatibleConditions(draft(), allowed).map((c) => c.id), ["3000"]);
  const d = { ...draft({ grade: "new", packaging: "none" }), ebay: { ...draft().ebay, conditionId: "1500" } };
  assert.equal(ebayCondition(d), "NEW_OTHER");
  assert.equal(buildInventoryItem(d).conditionDescription, undefined, "eBay ignores condition notes for new conditions");
  assert.equal(buildInventoryItem(draft()).conditionDescription, "Light creasing.");
  const wrong = { ...draft(), ebay: { ...draft().ebay, conditionId: "2500" } };
  assert.ok(ebayPublishIssues(wrong, assessListing(wrong, "ebay", NOW), { conditions: allowed }, { now: NOW }).some((i) => /doesn't accept the chosen condition/.test(i)));
});

test("item specifics land under the category's aspect names and respect selection-only values", () => {
  const aspects = [
    { name: "Brand", required: true, recommended: true, mode: "FREE_TEXT", values: [], multiple: false, maxLength: 65 },
    { name: "US Shoe Size", required: true, recommended: true, mode: "FREE_TEXT", values: [], multiple: false, maxLength: null },
    { name: "Department", required: false, recommended: true, mode: "SELECTION_ONLY", values: ["Men", "Women"], multiple: false, maxLength: null },
    { name: "Colour", required: false, recommended: true, mode: "FREE_TEXT", values: [], multiple: false, maxLength: null },
  ];
  const a = buildAspects(draft(), aspects);
  assert.deepEqual(a.Brand, ["Nike"]);
  assert.deepEqual(a["US Shoe Size"], ["10"]);
  assert.deepEqual(a.Department, ["Men"]);
  assert.deepEqual(a.Colour, ["White and black"], "synonym matched to the category's spelling");
  assert.equal(a["Style Code"], undefined, "no invented aspects");
  const youth = editAttribute(draft(), "department", "Kids");
  assert.equal(buildAspects(youth, aspects).Department, undefined, "values not on eBay's list are left for the seller to pick");
});

test("descriptions use eBay-allowed markup and respect the 4,000-character limit", () => {
  const d = draft();
  assert.ok(!/<p>/.test(buildInventoryItem(d).product.description));
  const long = { ...d, description: { ...d.description, value: "Detail line.\n".repeat(400) } };
  assert.ok(ebayPublishIssues(long, assessListing(long, "ebay", NOW), {}, { now: NOW }).some((i) => i.includes(EBAY_DESCRIPTION_LIMIT.toLocaleString())));
});

test("setup returns category rules and domestic shipping services from eBay", async () => {
  const { h, fake } = await setup();
  const cats = await (await h.setup(get("/api/ebay/seller/setup?q=nike%20dunk"))).json();
  assert.equal(cats.categories[0].id, "15709");
  assert.match(cats.categories[0].path, /Athletic Shoes$/);
  assert.ok(fake.calls.some((c) => c.path.startsWith("/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US")), "tree ID looked up, not hard-coded");
  const rules = await (await h.setup(get("/api/ebay/seller/setup?categoryId=15709"))).json();
  assert.equal(rules.conditionRequired, true);
  assert.ok(fake.calls.some((c) => c.path === "/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=categoryIds%3A%7B15709%7D"));
  const services = await (await h.setup(get("/api/ebay/seller/setup?shippingServices=1"))).json();
  assert.deepEqual(services.shippingServices.map((s: { code: string }) => s.code), ["USPSGroundAdvantage"]);
});

test("business policies are created only from explicit seller choices", async () => {
  assert.throws(() => parsePolicyInput({ type: "return" }));
  assert.throws(() => parsePolicyInput({ type: "fulfillment", handlingDays: 1, serviceCode: "USPSGroundAdvantage", freeShipping: false }));
  assert.deepEqual(policyBody(parsePolicyInput({ type: "return", returnsAccepted: true, days: 30, payer: "BUYER" })), {
    name: "ResellAI 30-day returns (buyer pays)", marketplaceId: "EBAY_US", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    returnsAccepted: true, returnPeriod: { value: 30, unit: "DAY" }, returnShippingCostPayer: "BUYER", refundMethod: "MONEY_BACK",
  });
  const ship = policyBody(parsePolicyInput({ type: "fulfillment", handlingDays: 1, serviceCode: "USPSGroundAdvantage", freeShipping: false, cost: 12 })) as Record<string, unknown>;
  assert.deepEqual(ship.handlingTime, { value: 1, unit: "DAY" });
  assert.deepEqual(ship.shippingOptions, [{ optionType: "DOMESTIC", costType: "FLAT_RATE", shippingServices: [{ sortOrder: 1, shippingServiceCode: "USPSGroundAdvantage", freeShipping: false, shippingCost: { value: "12.00", currency: "USD" } }] }]);
  const { h, fake } = await setup({ noPolicies: true });
  assert.equal((await h.createPolicy(postJson("/api/ebay/seller/policies", { type: "payment" }))).status, 400, "needs confirm");
  assert.equal((await h.createPolicy(postJson("/api/ebay/seller/policies", { type: "payment", confirm: true }, { origin: null }))).status, 403);
  const made = await (await h.createPolicy(postJson("/api/ebay/seller/policies", { type: "fulfillment", handlingDays: 1, serviceCode: "USPSGroundAdvantage", freeShipping: true, confirm: true }))).json();
  assert.equal(made.id, "F-new");
  assert.ok(fake.calls.some((c) => c.method === "POST" && c.path === "/sell/account/v1/fulfillment_policy/"));
  assert.equal((await (await h.createPolicy(postJson("/api/ebay/seller/policies", { type: "payment", confirm: true }))).json()).id, "P-new");
});

test("a ship-from location is created from city, state and ZIP only", async () => {
  assert.throws(() => parseLocationInput({ city: "Austin", stateOrProvince: "Texas", postalCode: "78701" }));
  assert.throws(() => parseLocationInput({ city: "Austin", stateOrProvince: "TX", postalCode: "7870" }));
  assert.deepEqual(locationBody(parseLocationInput({ city: "Austin", stateOrProvince: "tx", postalCode: "78701" })), {
    name: "Ships from", location: { address: { city: "Austin", stateOrProvince: "TX", postalCode: "78701", country: "US" } }, locationTypes: ["WAREHOUSE"], merchantLocationStatus: "ENABLED",
  });
  const { h, fake } = await setup({ noPolicies: true });
  const r = await (await h.createLocation(postJson("/api/ebay/seller/location", { city: "Austin", stateOrProvince: "TX", postalCode: "78701", confirm: true }))).json();
  assert.match(r.key, /^resellai-[0-9a-f]{12}$/);
  assert.ok(r.key.length <= 36, "merchantLocationKey max length 36");
  assert.ok(fake.calls.some((c) => c.method === "POST" && c.path === `/sell/inventory/v1/location/${r.key}`));
});

test("publishing re-checks eBay's category rules on the server and sends eBay-hosted photos", async () => {
  const strict = await setup({ requiredAspects: ["Brand", "US Shoe Size", "Style"] });
  const missing = await strict.h.publish(postJson("/api/ebay/seller/publish", { draft: draft(), confirm: true }));
  assert.equal(missing.status, 422);
  assert.match(JSON.stringify(await missing.json()), /Style/);
  const filled = { ...draft(), ebay: { ...draft().ebay, extraAspects: { Style: "Sneaker" } } };
  const ok = await strict.h.publish(postJson("/api/ebay/seller/publish", { draft: filled, confirm: true }));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.url, "https://sandbox.ebay.com/itm/L-77");
  const put = strict.fake.calls.find((c) => c.path.startsWith("/sell/inventory/v1/inventory_item/"))!;
  const item = put.body as { product: { imageUrls: string[]; aspects: Record<string, string[]> }; condition: string };
  assert.deepEqual(item.product.imageUrls, ["https://i.ebayimg.com/images/g/IMG1/s-l1600.jpg"]);
  assert.deepEqual(item.product.aspects.Style, ["Sneaker"]);
  assert.equal(item.condition, "USED_EXCELLENT");
});

test("listing status reports the live listing and its URL", async () => {
  const before = await setup();
  const none = await (await before.h.listing(get("/api/ebay/seller/listing?draftId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"))).json();
  assert.equal(none.listingId, null);
  const live = await setup({ existingPublished: true });
  const s = await (await live.h.listing(get("/api/ebay/seller/listing?draftId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"))).json();
  assert.equal(s.listingId, "L-1");
  assert.equal(s.listingStatus, "ACTIVE");
  assert.equal(s.url, "https://sandbox.ebay.com/itm/L-1");
  assert.equal((await live.h.listing(get("/api/ebay/seller/listing?draftId=../../x"))).status, 400);
});
