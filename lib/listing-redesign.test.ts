// Regression coverage for the simplified listing experience: confirmed details are reused, generated text
// can't go stale, only genuine requirements block publishing, and returning sellers reuse their eBay settings.
// All eBay and OpenAI responses are simulated; nothing here contacts a live service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Identification } from "./identification";
import { emptyMatchDetails, type MatchDetails } from "./marketplaces";
import { applyGenerated, editText, refreshPlan } from "./listing/apply";
import { createListingDraft, editAttribute, upgradeDraft } from "./listing/draft";
import { createListingGenerateHandler, listingPromptFacts, templateListing } from "./listing/generate-server";
import { assessListing } from "./listing/readiness";
import { parseSizeText, readSize } from "./listing/sizing";
import { buildDescription, buildTitle, factsKey, staleFields } from "./listing/template";
import type { ListingDraft } from "./listing/types";
import { buildAspects, buildInventoryItem, ebayPublishIssues, ebayRequirements } from "./ebay-seller/payload";
import { choosePolicies } from "./ebay-seller/preferences";
import { createSellerHandlers, SESSION_COOKIE } from "./ebay-seller/handlers";
import { createSellerStore } from "./ebay-seller/store";
import type { SellerConfig } from "./ebay-seller/config";
import { fakeEbay } from "./test-support/fake-ebay";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const dunk: Identification = {
  brand: "Nike",
  productName: "Nike Dunk Low",
  category: "Sneakers",
  model: "Dunk Low",
  colorway: "Black / White",
  visibleCondition: "New, appears unworn",
  identifyingInformation: null,
  confidence: "high",
  uncertainties: [],
  additionalEvidence: [],
};
const sources = { brand: "image-visible", productName: "image-visible", model: "ai-inferred", colorway: "image-visible", category: "ai-inferred" } as const;
const make = (d: Partial<MatchDetails> = {}, i: Partial<Identification> = {}) =>
  createListingDraft({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", now: new Date(NOW).toISOString(), identification: { ...dunk, ...i }, details: { ...emptyMatchDetails, ...d }, sources: { ...sources }, photos: [{ id: "p1", name: "dunk.jpg" }], ebay: null, mercari: null });
const attr = (d: ListingDraft, k: string) => d.attributes.find((a) => a.key === k)!;
/** What the editor does on open: write the listing from the confirmed facts. */
const written = (d: ListingDraft) => applyGenerated(d, templateListing(d, d.marketplace), ["title", "description", "condition", "recommendations"]);

// ── Reusing confirmed details ─────────────────────────────────────────────────────────────

test("size typed as \"Men's 10\" fills both size and department; nothing is asked twice", () => {
  for (const size of ["Men's 10", "M10", "10 M", "US Men 10", "mens size 10"]) {
    const d = make({ size, condition: "new", packaging: "original" });
    assert.equal(attr(d, "size").value, "10", size);
    assert.equal(attr(d, "department").value, "Men", size);
    assert.equal(attr(d, "size").source, "user-confirmed");
    assert.equal(attr(d, "department").source, "user-confirmed");
  }
  assert.deepEqual(parseSizeText("W 8.5"), { size: "8.5", department: "Women" });
  assert.deepEqual(parseSizeText("GS 6Y"), { size: "6", department: "Youth" });
  assert.deepEqual(parseSizeText("Dunk Low"), { size: "", department: "" }, "no size is read from words that aren't a size");
  // Stated only in the seller's notes: used, marked as coming from identification, never as AI.
  const notes = make({ additionalDetails: "Men's size 10, worn once" });
  assert.equal(attr(notes, "size").value, "10");
  assert.equal(attr(notes, "size").source, "identified");
  // A sizing system wins over anything inferred from the name.
  assert.equal(readSize({ ...emptyMatchDetails, size: "8", sizeSystem: "US Women" }, "Nike Dunk Low Men's").department.value, "Women");
  // Department named only in the product name stays an AI-level inference that must be checked.
  const named = make({ size: "8" }, { productName: "Nike Women's Dunk Low" });
  assert.equal(attr(named, "department").source, "ai-inferred");
  assert.ok(assessListing(named).blockers.some((b) => b.id === "attr-department"), "an inferred department is confirmed, not silently trusted");
});

test("a confirmed Nike Dunk Low Men's 10, new with box, only needs a price", () => {
  const d = written(make({ size: "Men's 10", condition: "new", packaging: "original" }));
  const r = assessListing(d);
  assert.deepEqual(r.blockers.map((b) => b.id), ["price"], "brand, model, size, department, color and condition are all reused");
  assert.equal(d.condition.confirmed, true, "the condition chosen at identification counts as confirmed");
  assert.equal(attr(d, "model").confirmedVia, "identification");
  const priced = { ...d, pricing: { ...d.pricing, price: 110, priceSource: "manual" as const } };
  assert.equal(assessListing(priced).publishable, true);
  assert.match(d.title.value, /^Nike Dunk Low Black \/ White Men's Size 10 New with Box$/);
  // Every corresponding eBay item specific is filled from the same facts.
  const aspects = buildAspects(d, [
    { name: "Brand", required: true, recommended: true, mode: "FREE_TEXT", values: [], multiple: false, maxLength: 65 },
    { name: "Model", required: false, recommended: true, mode: "FREE_TEXT", values: [], multiple: false, maxLength: 65 },
    { name: "US Shoe Size", required: true, recommended: true, mode: "SELECTION_ONLY", values: ["9.5", "10", "10.5"], multiple: false, maxLength: null },
    { name: "Department", required: true, recommended: true, mode: "SELECTION_ONLY", values: ["Men", "Women", "Unisex Adult"], multiple: false, maxLength: null },
    { name: "Color", required: false, recommended: true, mode: "FREE_TEXT", values: [], multiple: false, maxLength: 65 },
    { name: "Type", required: false, recommended: true, mode: "FREE_TEXT", values: [], multiple: false, maxLength: 65 },
  ]);
  assert.deepEqual(aspects, { Brand: ["Nike"], Model: ["Dunk Low"], "US Shoe Size": ["10"], Department: ["Men"], Color: ["Black / White"] });
  assert.ok(!("Type" in aspects), "the product name is never sent as eBay's Type");
});

test("older saved drafts are upgraded without touching anything the seller entered", () => {
  const fresh = make({ size: "Men's 10", condition: "new" });
  // Simulate a draft saved by the previous version: size field text wasn't parsed and model needed reconfirming.
  const old: ListingDraft = {
    ...fresh,
    attributes: fresh.attributes.map((a) =>
      a.key === "department" ? { ...a, value: "", source: "missing" as const, confirmed: false } : a.key === "model" ? { ...a, confirmed: false, confirmedVia: undefined } : a.key === "color" ? { ...a, value: "Panda", source: "user-confirmed" as const, confirmed: true } : a,
    ),
  };
  const up = upgradeDraft(old);
  assert.equal(attr(up, "department").value, "Men");
  assert.equal(attr(up, "model").confirmed, true);
  assert.equal(attr(up, "color").value, "Panda", "seller-entered values are preserved");
  assert.equal(upgradeDraft(up), up, "an up-to-date draft is returned unchanged");
});

// ── Stale AI descriptions ─────────────────────────────────────────────────────────────────

test("generated text records its facts; a later correction marks it stale and it refreshes automatically", () => {
  let d = written(make({ size: "Men's 10", condition: "new", packaging: "original" }));
  assert.deepEqual(staleFields(d), []);
  assert.match(d.description.value, /Size: US Men's 10/);
  d = editAttribute(d, "size", "10.5");
  assert.deepEqual(staleFields(d), ["title", "description"], "condition note doesn't depend on size");
  assert.deepEqual(refreshPlan(d), { automatic: ["title", "description"], needsApproval: [] });
  const refreshed = applyGenerated(d, templateListing(d, "ebay"), ["title", "description"]);
  assert.match(refreshed.description.value, /Size: US Men's 10\.5/);
  assert.ok(!/US Men's 10\n/.test(refreshed.description.value), "the old size is gone");
  assert.deepEqual(staleFields(refreshed), []);
});

test("manual edits are never overwritten automatically; the seller decides", () => {
  let d = written(make({ size: "Men's 10", condition: "new", packaging: "original" }));
  d = editText(d, "description", "My own words about these Dunks, size 10.");
  d = editAttribute(d, "size", "11");
  assert.deepEqual(refreshPlan(d), { automatic: ["title"], needsApproval: ["description"] });
  const keep = applyGenerated(d, templateListing(d, "ebay"), ["title", "description"]);
  assert.equal(keep.description.value, "My own words about these Dunks, size 10.", "a normal refresh keeps the seller's text");
  const replaced = applyGenerated(d, templateListing(d, "ebay"), ["description"], { overwriteUserEdits: true });
  assert.match(replaced.description.value, /Size: US Men's 11/, "only an explicit request replaces it");
  // The generation records the facts of the draft that was sent, so edits made mid-request are caught.
  const sent = d;
  const changedMeanwhile = editAttribute(d, "color", "Grey Fog");
  const applied = applyGenerated(changedMeanwhile, templateListing(sent, "ebay"), ["title"], { writtenFrom: sent });
  assert.ok(staleFields(applied).includes("title"));
  assert.notEqual(factsKey(applied, "title"), applied.generatedFrom?.title);
});

test("the AI sees only current facts, never old text or a list of what's missing", async () => {
  let d = written(make({ size: "Men's 10", condition: "new", packaging: "original" }));
  d = editAttribute(d, "size", "9");
  let sent: { input: string; model: string } | null = null;
  const fetcher = (async (_u: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    const out = {
      title: "Nike Dunk Low Black / White Men's Size 9 New with Box",
      description: "Classic Nike Dunk Low sneakers in the black-and-white colorway.\n\nBrand: Nike\nModel: Dunk Low\nSize: US Men's 9\nStyle code: not specified\nCondition: New with box\n\nIncludes the sneakers shown in the photos.",
      conditionDescription: "New with box.",
      tips: [],
    };
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out) }] }] });
  }) as unknown as typeof fetch;
  const req = new Request("http://localhost:3001/api/listings/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: d, fields: ["description"] }) });
  const { listing } = await (await createListingGenerateHandler({ apiKey: "k", fetcher })(req)).json();
  const s = sent as unknown as { input: string; model: string };
  assert.equal(s.model, "gpt-4.1", "listing copy uses the full-size writing model by default");
  const input = JSON.parse(s.input);
  assert.equal(input.missingDetails, undefined);
  assert.equal(input.avoidRepeating, undefined, "earlier text (which may hold old details) is never sent back");
  assert.ok(!s.input.includes("US Men's 10"), "the previous size isn't in the prompt");
  assert.ok(input.facts.some((f: { name: string; value: string }) => f.name === "Size" && f.value === "US Men's 9"));
  assert.ok(!/not specified/i.test(listing.description), "placeholder lines are removed before the seller sees them");
  assert.match(listing.description, /Size: US Men's 9/);
  assert.deepEqual(listingPromptFacts(d, "ebay").condition, { summary: "New with Box", packaging: "original box/packaging included" });
});

test("the template description reads naturally and never mentions missing details", () => {
  const d = written(make({ size: "Men's 10", condition: "new", packaging: "original" }));
  const text = buildDescription(d);
  assert.equal(
    text,
    "Nike Dunk Low sneakers in the Black / White colorway. The low-top silhouette pairs easily with everyday casual outfits.\n\nBrand: Nike\nModel: Dunk Low\nColor: Black / White\nSize: US Men's 10\nCondition: New with Box\n\nIncludes the sneakers shown in the photos. Please review the images to see the exact pair you'll receive.",
  );
  assert.ok(!/missing|not specified|style code/i.test(text));
  assert.equal(buildTitle(d).length <= 80, true);
});

// ── Required vs optional ─────────────────────────────────────────────────────────────────

test("only genuine requirements block; everything else is optional or automatic", () => {
  const fresh = make({ size: "Men's 10", condition: "used" });
  const ids = assessListing(written(fresh)).blockers.map((b) => b.id);
  assert.deepEqual(ids.sort(), ["condition-defects", "price"], "a used item needs flaws disclosed and a price; nothing else");
  const noFlaws = { ...written(fresh), condition: { ...written(fresh).condition, noKnownDefects: true }, pricing: { ...fresh.pricing, price: 70, priceSource: "manual" as const } };
  assert.equal(assessListing(noFlaws).publishable, true);
  const r = assessListing(noFlaws);
  assert.ok(!r.blockers.some((b) => /shipping|condition-description|condition-confirmed/.test(b.id)), "package details, a hand-written condition note and a separate confirmation tick are not required");
  // New without packaging info: a suggestion, not a blocker.
  const newNoBox = written(make({ size: "Men's 10", condition: "new" }));
  assert.ok(assessListing(newNoBox).suggestions.some((s) => s.id === "condition-packaging"));
  assert.ok(!assessListing(newNoBox).blockers.some((s) => s.id.startsWith("condition")));
  // An optional AI guess is a suggestion and stays out of the listing until checked.
  const guess = { ...newNoBox, attributes: newNoBox.attributes.map((a) => (a.key === "material" ? { ...a, value: "Leather", source: "ai-inferred" as const, confirmed: false } : a)) };
  assert.ok(assessListing(guess).suggestions.some((s) => s.id === "attr-material"));
  assert.ok(!buildDescription(guess).includes("Leather"));
  // Mercari: package weight is a suggestion (prepaid labels), never a blocker.
  const merc = assessListing({ ...newNoBox, marketplace: "mercari" }, "mercari");
  assert.ok(merc.suggestions.some((s) => s.id === "shipping-weight"));
  // Every blocker explains itself and carries an inline fix.
  for (const b of assessListing(written(make())).blockers) assert.ok(b.why && b.fix, b.id);
});

test("eBay requirements are specific, explained and fixable inline; package size only for calculated postage", () => {
  const d = { ...written(make({ size: "Men's 10", condition: "new", packaging: "original" })), marketplace: "ebay" as const };
  const issues = ebayRequirements(d, { aspects: [{ name: "Type", required: true, recommended: true, mode: "SELECTION_ONLY", values: ["Athletic", "Casual"], multiple: false, maxLength: null }] }, { photosPending: true });
  assert.deepEqual(issues.map((i) => i.fix), ["ebay-category", "ebay-policies", "ebay-location", "ebay-aspect:Type"]);
  assert.ok(issues.every((i) => i.severity === "blocker" && i.basis === "marketplace" && i.why));
  assert.ok(!issues.some((i) => i.fix === "package"), "a flat-rate/free policy doesn't need package size");
  assert.ok(ebayRequirements(d, {}, { calculatedShipping: true }).some((i) => i.fix === "package"));
  // Package size is only sent when the seller entered it, never as zeros.
  assert.equal(buildInventoryItem(d).packageWeightAndSize, undefined);
  const weighed = { ...d, shipping: { ...d.shipping, weightLb: "2" } };
  assert.deepEqual(buildInventoryItem(weighed).packageWeightAndSize, { weight: { value: 2, unit: "POUND" } });
});

// ── Returning sellers ─────────────────────────────────────────────────────────────────────

test("returning sellers reuse their saved policies; with several and no preference they choose", () => {
  const account = {
    policies: { fulfillment: [{ id: "F1" }, { id: "F2" }], payment: [{ id: "P1" }], return: [{ id: "R1" }, { id: "R2" }] },
    locations: [{ key: "home" }, { key: "studio" }],
  };
  assert.deepEqual(choosePolicies({}, account, {}), { fulfillmentPolicyId: "", paymentPolicyId: "P1", returnPolicyId: "", merchantLocationKey: "" }, "no guessing between several");
  const prefs = { fulfillmentPolicyId: "F2", returnPolicyId: "R1", merchantLocationKey: "studio", paymentPolicyId: "P1" };
  assert.deepEqual(choosePolicies({}, account, prefs), { fulfillmentPolicyId: "F2", paymentPolicyId: "P1", returnPolicyId: "R1", merchantLocationKey: "studio" });
  assert.equal(choosePolicies({ fulfillmentPolicyId: "F1" }, account, prefs).fulfillmentPolicyId, "F1", "this draft's own choice wins");
  assert.equal(choosePolicies({}, account, { fulfillmentPolicyId: "F-deleted" }).fulfillmentPolicyId, "", "a preference for a policy that no longer exists is ignored");
});

// ── Publishing ────────────────────────────────────────────────────────────────────────────

const key = randomBytes(32);
const session = "b".repeat(64);
const config = (): SellerConfig => ({ clientId: "id", clientSecret: "secret", ruName: "Ru", environment: "sandbox", tokenKey: key, publishingEnabled: true, dataDir: mkdtempSync(join(tmpdir(), "resellai-redesign-")) });
async function connected(fetcher = fakeEbay().fetcher) {
  const c = config();
  const store = createSellerStore(c.dataDir, key);
  await store.saveTokens(session, { accessToken: "user-access", accessExpiresAt: NOW + 3_600_000, refreshToken: "r", refreshExpiresAt: NOW + 86_400_000, environment: "sandbox", connectedAt: new Date(NOW).toISOString() });
  return createSellerHandlers({ config: c, fetcher, now: () => NOW, store });
}
const publishReq = (draft: ListingDraft) =>
  new Request("http://localhost:3001/api/ebay/seller/publish", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3001", cookie: `${SESSION_COOKIE}=${session}` }, body: JSON.stringify({ draft, confirm: true }) });
const ebayReady = (o: Partial<ListingDraft["ebay"]> = {}): ListingDraft => {
  const d = written(make({ size: "Men's 10", condition: "new", packaging: "original" }));
  return { ...d, pricing: { ...d.pricing, price: 110, priceSource: "manual" }, ebay: { ...d.ebay, categoryId: "15709", conditionId: "1000", imageUrls: ["https://i.example.com/a.jpg"], fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1", merchantLocationKey: "home", ...o } };
};

test("the server still blocks publication when a genuine requirement is missing", async () => {
  const h = await connected();
  const noPrice = ebayReady();
  noPrice.pricing = { ...noPrice.pricing, price: null, priceSource: null };
  const r = await h.publish(publishReq(noPrice));
  assert.equal(r.status, 422);
  assert.ok((await r.json()).issues.some((i: string) => /price/i.test(i)));
  const noPolicy = await h.publish(publishReq(ebayReady({ returnPolicyId: "" })));
  assert.equal(noPolicy.status, 422);
  // A calculated-postage policy makes package size a real eBay requirement, checked on the server too.
  const fake = fakeEbay();
  const calculated = (async (url: string | URL, init?: RequestInit) =>
    new URL(String(url)).pathname === "/sell/account/v1/fulfillment_policy/F1" ? Response.json({ fulfillmentPolicyId: "F1", shippingOptions: [{ optionType: "DOMESTIC", costType: "CALCULATED" }] }) : fake.fetcher(url, init)) as typeof fetch;
  const h2 = await connected(calculated);
  const r2 = await h2.publish(publishReq(ebayReady()));
  assert.equal(r2.status, 422);
  assert.ok((await r2.json()).issues.some((i: string) => /weight and box dimensions/.test(i)));
  assert.ok(!fake.calls.some((c) => c.path.endsWith("/publish")), "nothing reached eBay's publish call");
});

test("Sandbox publishing still works end to end with the simplified draft (no package details needed)", async () => {
  const fake = fakeEbay();
  const h = await connected(fake.fetcher);
  const d = ebayReady();
  assert.deepEqual(ebayPublishIssues(d, assessListing(d, "ebay", NOW), {}, { now: NOW }), []);
  const res = await h.publish(publishReq(d));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.record.status, "published");
  assert.equal(body.environment, "sandbox");
  const put = fake.calls.find((c) => c.method === "PUT" && c.path.startsWith("/sell/inventory/v1/inventory_item/"));
  const item = put?.body as { product: { aspects: Record<string, string[]> }; packageWeightAndSize?: unknown; condition: string };
  assert.equal(item.condition, "NEW");
  assert.equal(item.packageWeightAndSize, undefined);
  assert.deepEqual(item.product.aspects["US Shoe Size"], ["10"]);
  assert.deepEqual(item.product.aspects.Department, ["Men"]);
  assert.ok(fake.calls.every((c) => !c.host.includes("api.ebay.com")), "only the simulated sandbox host was called");
});

test("a used item the seller says has no known flaws isn't blocked by its own condition note", async () => {
  const { auditText, listingFacts } = await import("./listing/claims");
  const { buildConditionDescription } = await import("./listing/template");
  const base = written(make({ size: "Men's 10", condition: "used" }));
  const d = { ...base, condition: { ...base.condition, noKnownDefects: true } };
  const facts = listingFacts(d);
  assert.deepEqual(auditText(buildConditionDescription(d), facts), [], "the template's own wording passes the audit");
  assert.deepEqual(auditText("Pre-owned. No flaws known to the seller.", facts), [], "a hedged statement is accurate");
  assert.ok(auditText("Pre-owned and flawless.", facts).some((x) => x.code === "condition-overstated"), "absolute claims are still caught");
  assert.ok(auditText("No signs of wear at all.", facts).some((x) => x.code === "condition-overstated"));
  const withFlaws = listingFacts({ ...d, condition: { ...d.condition, noKnownDefects: false, defects: "Scuff on heel" } });
  assert.ok(auditText("No flaws known to the seller.", withFlaws).some((x) => x.code === "condition-overstated"), "contradicting listed flaws is caught");
  const regenerated = applyGenerated(d, templateListing(d, "ebay"), ["condition"]);
  assert.ok(!assessListing(regenerated).blockers.some((b) => b.id.startsWith("condition-text")));
});
