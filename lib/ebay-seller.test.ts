import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { emptyMatchDetails } from "./marketplaces";
import { createListingDraft, confirmAttribute, editAttribute } from "./listing/draft";
import { applyGenerated } from "./listing/apply";
import { buildTitle, buildDescription } from "./listing/template";
import { assessListing } from "./listing/readiness";
import type { ListingDraft } from "./listing/types";
import { readSellerConfig, missingSellerSettings, type SellerConfig } from "./ebay-seller/config";
import { authorizeUrl, exchangeCode } from "./ebay-seller/oauth";
import { createSellerStore, decrypt, encrypt } from "./ebay-seller/store";
import { buildAspects, buildInventoryItem, buildOffer, ebayCondition, ebayPublishIssues, skuForDraft, descriptionHtml } from "./ebay-seller/payload";
import { createSellerHandlers, SESSION_COOKIE, STATE_COOKIE } from "./ebay-seller/handlers";

// All eBay responses below are simulated. No live eBay API is contacted by these tests.
const key = randomBytes(32);
const config = (o: Partial<SellerConfig> = {}): SellerConfig => ({
  clientId: "client-id",
  clientSecret: "client-secret",
  ruName: "Test-RuName",
  environment: "sandbox",
  tokenKey: key,
  publishingEnabled: true,
  dataDir: mkdtempSync(join(tmpdir(), "resellai-seller-")),
  ...o,
});
const NOW = Date.parse("2026-11-13T12:00:00Z");

function readyDraft(): ListingDraft {
  let d = createListingDraft({
    id: "11111111-2222-3333-4444-555555555555",
    now: "2026-11-13T12:00:00.000Z",
    identification: { brand: "Nike", productName: "Nike Dunk Low", category: "Sneakers", model: "Dunk Low", colorway: "White and black", visibleCondition: "Worn", identifyingInformation: null, confidence: "medium", uncertainties: [], additionalEvidence: [] },
    details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: "used" },
    sources: { brand: "image-visible", productName: "image-visible", model: "ai-inferred", colorway: "image-visible" },
    photos: [{ id: "p1", name: "a.jpg" }],
    ebay: null,
    mercari: null,
  });
  d = confirmAttribute(d, "model");
  d = editAttribute(d, "styleCode", "DD1391-100");
  d = { ...d, condition: { ...d.condition, description: "Pre-owned. Light creasing.", defects: "Light toe creasing", confirmed: true } };
  d = applyGenerated(d, { source: "template", title: buildTitle(d), description: buildDescription(d), warnings: [] }, ["title", "description"]);
  return {
    ...d,
    pricing: { ...d.pricing, price: 85, priceSource: "manual" },
    shipping: { weightLb: "3", weightOz: "4", length: "14", width: "10", height: "5", service: "", handlingDays: "1", whoPays: "buyer", confirmed: true },
    ebay: { ...d.ebay, categoryId: "15709", imageUrls: ["https://i.example.com/a.jpg"], fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1", merchantLocationKey: "home" },
  };
}

/** A fake eBay Sell API that records calls and can be told to fail a step. */
function fakeEbay(options: { failPublishOnce?: boolean; existingPublished?: boolean } = {}) {
  const calls: { method: string; path: string; body?: unknown; auth?: string }[] = [];
  let offers: { offerId: string; status: string; listing?: { listingId: string } }[] = options.existingPublished ? [{ offerId: "O-1", status: "PUBLISHED", listing: { listingId: "L-1" } }] : [];
  let failPublish = !!options.failPublishOnce;
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method || "GET";
    const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    calls.push({ method, path: u.pathname + u.search, body, auth: (init?.headers as Record<string, string>)?.Authorization });
    if (u.pathname === "/identity/v1/oauth2/token") {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "authorization_code" && p.get("code") === "good-code")
        return Response.json({ access_token: "user-access", expires_in: 7200, refresh_token: "user-refresh", refresh_token_expires_in: 47304000, token_type: "User Access Token" });
      if (p.get("grant_type") === "refresh_token") return Response.json({ access_token: "user-access-2", expires_in: 7200 });
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (u.pathname.startsWith("/sell/inventory/v1/inventory_item/")) return new Response(null, { status: 204 });
    if (u.pathname === "/sell/inventory/v1/offer" && method === "GET") return offers.length ? Response.json({ offers }) : Response.json({ errors: [{ errorId: 25713, message: "This Offer is not available." }] }, { status: 404 });
    if (u.pathname === "/sell/inventory/v1/offer" && method === "POST") {
      offers = [{ offerId: "O-9", status: "UNPUBLISHED" }];
      return Response.json({ offerId: "O-9" }, { status: 201 });
    }
    if (/^\/sell\/inventory\/v1\/offer\/[^/]+$/.test(u.pathname) && method === "PUT") return new Response(null, { status: 204 });
    if (u.pathname.endsWith("/publish")) {
      if (failPublish) {
        failPublish = false;
        return Response.json({ errors: [{ errorId: 25002, message: "A user error has occurred.", longMessage: "Item specific Brand is missing." }] }, { status: 400 });
      }
      offers = offers.map((o) => ({ ...o, status: "PUBLISHED", listing: { listingId: "L-77" } }));
      return Response.json({ listingId: "L-77" });
    }
    if (u.pathname.startsWith("/sell/account/v1/fulfillment_policy")) return Response.json({ fulfillmentPolicies: [{ fulfillmentPolicyId: "F1", name: "Ground" }] });
    if (u.pathname.startsWith("/sell/account/v1/payment_policy")) return Response.json({ paymentPolicies: [{ paymentPolicyId: "P1", name: "Managed" }] });
    if (u.pathname.startsWith("/sell/account/v1/return_policy")) return Response.json({ returnPolicies: [{ returnPolicyId: "R1", name: "30 days" }] });
    if (u.pathname === "/sell/inventory/v1/location") return Response.json({ locations: [{ merchantLocationKey: "home", name: "Home" }] });
    if (u.pathname.endsWith("/get_item_aspects_for_category"))
      return Response.json({ aspects: [{ localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true } }, { localizedAspectName: "Style", aspectConstraint: { aspectRequired: true } }, { localizedAspectName: "Width", aspectConstraint: { aspectRequired: false } }] });
    return Response.json({ errors: [{ message: "unexpected " + u.pathname }] }, { status: 500 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const session = "a".repeat(64);
const post = (path: string, body: unknown, o: { origin?: string | null; cookie?: string } = {}) =>
  new Request(`http://localhost:3001${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(o.origin === null ? {} : { origin: o.origin ?? "http://localhost:3001" }), cookie: o.cookie ?? `${SESSION_COOKIE}=${session}` },
    body: JSON.stringify(body),
  });

async function connected(c = config(), fake = fakeEbay()) {
  const store = createSellerStore(c.dataDir, key);
  await store.saveTokens(session, { accessToken: "user-access", accessExpiresAt: NOW + 3_600_000, refreshToken: "user-refresh", refreshExpiresAt: NOW + 86_400_000, environment: c.environment, connectedAt: new Date(NOW).toISOString() });
  return { handlers: createSellerHandlers({ config: c, fetcher: fake.fetcher, now: () => NOW, store }), store, fake, c };
}

test("configuration reports missing settings by name only", () => {
  const c = readSellerConfig({ EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "y", EBAY_SELLER_TOKEN_KEY: "short" });
  assert.deepEqual(missingSellerSettings(c), ["EBAY_SELLER_RUNAME", "EBAY_SELLER_TOKEN_KEY (32 random bytes, hex or base64)"]);
  assert.equal(c.publishingEnabled, false);
  assert.equal(c.environment, "sandbox");
  assert.ok(readSellerConfig({ EBAY_SELLER_TOKEN_KEY: randomBytes(32).toString("hex") }).tokenKey);
});

test("authorization URL uses the RuName, seller scopes and state", () => {
  const u = new URL(authorizeUrl(config(), "st4te"));
  assert.equal(u.origin, "https://auth.sandbox.ebay.com");
  assert.equal(u.searchParams.get("redirect_uri"), "Test-RuName");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("state"), "st4te");
  assert.match(u.searchParams.get("scope")!, /sell\.inventory/);
  assert.equal(new URL(authorizeUrl(config({ environment: "production" }), "s")).origin, "https://auth.ebay.com");
});

test("tokens are encrypted at rest and unreadable with another key", async () => {
  const c = config();
  const tokens = await exchangeCode(c, "good-code", fakeEbay().fetcher, NOW);
  assert.equal(tokens.refreshToken, "user-refresh");
  const store = createSellerStore(c.dataDir, key);
  await store.saveTokens(session, tokens);
  const file = readFileSync(join(c.dataDir, "tokens", readdirSync(join(c.dataDir, "tokens"))[0]), "utf8");
  assert.ok(!file.includes("user-access") && !file.includes("user-refresh"), "no plaintext tokens on disk");
  assert.deepEqual(await store.getTokens(session), tokens);
  assert.equal(await createSellerStore(c.dataDir, randomBytes(32)).getTokens(session), null);
  assert.throws(() => decrypt(randomBytes(32), encrypt(key, "secret")));
});

test("OAuth connect sets httpOnly cookies; callback rejects a forged state and stores tokens on success", async () => {
  const c = config();
  const fake = fakeEbay();
  const h = createSellerHandlers({ config: c, fetcher: fake.fetcher, now: () => NOW });
  const res = await h.connect(new Request("http://localhost:3001/api/ebay/seller/connect?return=/listings/abc-123"));
  assert.equal(res.status, 303);
  const set = res.headers.getSetCookie();
  assert.ok(set.every((x) => /HttpOnly/.test(x) && /SameSite=Lax/.test(x)));
  const state = decodeURIComponent(set.find((x) => x.startsWith(STATE_COOKIE))!.split(";")[0].split("=")[1]).split("|")[0];
  const sess = set.find((x) => x.startsWith(SESSION_COOKIE))!.split(";")[0].split("=")[1];
  const jar = `${STATE_COOKIE}=${encodeURIComponent(state + "|/listings/abc-123")}; ${SESSION_COOKIE}=${sess}`;
  const forged = await h.callback(new Request(`http://localhost:3001/api/ebay/seller/callback?code=good-code&state=evil`, { headers: { cookie: jar } }));
  assert.match(forged.headers.get("location")!, /ebay=state-mismatch/);
  const ok = await h.callback(new Request(`http://localhost:3001/api/ebay/seller/callback?code=good-code&state=${state}`, { headers: { cookie: jar } }));
  assert.match(ok.headers.get("location")!, /\/listings\/abc-123\?ebay=connected/);
  const status = await (await h.status(new Request("http://localhost:3001/api/ebay/seller/status", { headers: { cookie: `${SESSION_COOKIE}=${sess}` } }))).json();
  assert.equal(status.connected, true);
  assert.ok(!JSON.stringify(status).includes("user-access"), "status never exposes tokens");
  const evilReturn = await h.connect(new Request("http://localhost:3001/api/ebay/seller/connect?return=https://evil.example"));
  assert.ok(decodeURIComponent(evilReturn.headers.getSetCookie()[0]).includes("|/listings;"), "open redirects are not possible");
});

test("expiring access tokens are refreshed server-side", async () => {
  const c = config();
  const fake = fakeEbay();
  const store = createSellerStore(c.dataDir, key);
  await store.saveTokens(session, { accessToken: "old", accessExpiresAt: NOW + 60_000, refreshToken: "user-refresh", refreshExpiresAt: NOW + 86_400_000, environment: "sandbox", connectedAt: "x" });
  const h = createSellerHandlers({ config: c, fetcher: fake.fetcher, now: () => NOW, store });
  await h.setup(new Request("http://localhost:3001/api/ebay/seller/setup", { headers: { cookie: `${SESSION_COOKIE}=${session}` } }));
  assert.equal((await store.getTokens(session))?.accessToken, "user-access-2");
  assert.ok(fake.calls.some((x) => x.path.startsWith("/sell/account") && x.auth === "Bearer user-access-2"));
});

test("payloads map condition, aspects, package and offer fields from confirmed data only", () => {
  const d = readyDraft();
  assert.equal(ebayCondition(d), "USED_EXCELLENT");
  assert.equal(ebayCondition({ ...d, condition: { ...d.condition, grade: "new", packaging: "none" } }), "NEW_OTHER");
  const item = buildInventoryItem(d);
  assert.equal(item.product.aspects.Brand[0], "Nike");
  assert.equal(item.product.aspects["US Shoe Size"][0], "10");
  assert.equal(item.product.aspects["Style Code"][0], "DD1391-100");
  assert.equal(item.packageWeightAndSize?.weight.value, 3.25);
  assert.equal(item.conditionDescription, "Pre-owned. Light creasing.");
  assert.ok(item.product.title.length <= 80);
  const unconfirmed = createListingDraft({ ...{ id: "x", now: "n", identification: d.identification, details: d.details, sources: { model: "ai-inferred" }, photos: [], ebay: null, mercari: null } });
  assert.ok(!buildAspects(unconfirmed).Model, "unconfirmed AI-inferred model is not sent to eBay");
  const offer = buildOffer(d);
  assert.equal(offer.sku, skuForDraft(d.id));
  assert.ok(offer.sku.length <= 50);
  assert.deepEqual(offer.pricingSummary, { price: { value: "85.00", currency: "USD" } });
  assert.equal(offer.marketplaceId, "EBAY_US");
  assert.equal(descriptionHtml("a <b>\n\nc"), "<p>a &lt;b&gt;</p><p>c</p>");
  assert.deepEqual(ebayPublishIssues(d, assessListing(d, "ebay")), []);
  const missing = ebayPublishIssues({ ...d, ebay: { ...d.ebay, imageUrls: ["http://x"], categoryId: "" } }, assessListing(d, "ebay"), ["Brand", "Style"]);
  assert.ok(missing.some((x) => /category/.test(x)));
  assert.ok(missing.some((x) => /https/.test(x)));
  assert.ok(missing.some((x) => /Style/.test(x)));
});

test("publishing requires same-origin, configuration, the enable flag, a connection and explicit confirmation", async () => {
  const d = readyDraft();
  const { handlers } = await connected();
  assert.equal((await handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }, { origin: null }))).status, 403);
  assert.equal((await handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await handlers.publish(post("/api/ebay/seller/publish", { draft: d }))).status, 400);
  assert.equal((await handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }, { cookie: "" }))).status, 401);
  const off = await connected(config({ publishingEnabled: false }));
  assert.equal((await off.handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }))).status, 503);
  const unconfigured = createSellerHandlers({ config: config({ ruName: "" }), fetcher: fakeEbay().fetcher });
  const r = await unconfigured.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }));
  assert.equal(r.status, 503);
  assert.deepEqual((await r.json()).missing, ["EBAY_SELLER_RUNAME"]);
  const notReady = await handlers.publish(post("/api/ebay/seller/publish", { draft: { ...d, title: { ...d.title, value: "" } }, confirm: true }));
  assert.equal(notReady.status, 422);
});

test("publish creates item, offer and listing once; repeat requests never duplicate", async () => {
  const d = readyDraft();
  const { handlers, fake } = await connected();
  const first = await (await handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }))).json();
  assert.equal(first.record.status, "published");
  assert.equal(first.record.listingId, "L-77");
  assert.equal(first.alreadyPublished, false);
  const put = fake.calls.find((c) => c.path.startsWith("/sell/inventory/v1/inventory_item/"))!;
  assert.equal(put.method, "PUT");
  assert.equal((put.body as { condition: string }).condition, "USED_EXCELLENT");
  const second = await (await handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }))).json();
  assert.equal(second.alreadyPublished, true);
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/publish")).length, 1, "publishOffer called exactly once");
  assert.equal(fake.calls.filter((c) => c.method === "POST" && c.path === "/sell/inventory/v1/offer").length, 1);
});

test("concurrent publishes for the same listing are rejected", async () => {
  const d = readyDraft();
  const { handlers } = await connected();
  const [a, b] = await Promise.all([handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true })), handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test("a failed publish is recoverable: retry reuses the same offer", async () => {
  const d = readyDraft();
  const { handlers, fake } = await connected(config(), fakeEbay({ failPublishOnce: true }));
  const failed = await handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }));
  assert.equal(failed.status, 502);
  const body = await failed.json();
  assert.match(body.error, /Item specific Brand is missing/);
  assert.equal(body.record.status, "failed");
  assert.equal(body.record.offerId, "O-9");
  const retry = await (await handlers.publish(post("/api/ebay/seller/publish", { draft: d, confirm: true }))).json();
  assert.equal(retry.record.status, "published");
  assert.equal(fake.calls.filter((c) => c.method === "POST" && c.path === "/sell/inventory/v1/offer").length, 1, "no second offer");
  assert.ok(fake.calls.some((c) => c.method === "PUT" && c.path === "/sell/inventory/v1/offer/O-9"), "existing offer updated");
});

test("an SKU already live on eBay is reported, not re-published", async () => {
  const { handlers, fake } = await connected(config(), fakeEbay({ existingPublished: true }));
  const r = await (await handlers.publish(post("/api/ebay/seller/publish", { draft: readyDraft(), confirm: true }))).json();
  assert.equal(r.alreadyPublished, true);
  assert.equal(r.record.listingId, "L-1");
  assert.ok(!fake.calls.some((c) => c.path.endsWith("/publish")));
});

test("setup returns policies, locations and required aspects without exposing tokens", async () => {
  const { handlers } = await connected();
  const req = (q = "") => new Request(`http://localhost:3001/api/ebay/seller/setup${q}`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } });
  const setup = await (await handlers.setup(req())).json();
  assert.equal(setup.policies.fulfillment[0].id, "F1");
  assert.equal(setup.locations[0].key, "home");
  assert.deepEqual((await (await handlers.setup(req("?categoryId=15709"))).json()).requiredAspects, ["Brand", "Style"]);
  assert.equal((await handlers.setup(new Request("http://localhost:3001/api/ebay/seller/setup"))).status, 401);
});
