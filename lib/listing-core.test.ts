import { test } from "node:test";
import assert from "node:assert/strict";
import { tierComparable } from "./ebay-search";
import { emptyMatchDetails, type Comparable, type MarketplaceResult, type MatchDetails, type ProductQuery } from "./marketplaces";
import type { Identification } from "./identification";
import { recommend } from "./valuation";
import { listingCategory, attributeRules } from "./listing/categories";
import { createListingDraft, editAttribute, confirmAttribute } from "./listing/draft";
import { auditText, listingFacts } from "./listing/claims";
import { buildTitle, buildDescription, buildConditionDescription } from "./listing/template";
import { assessListing } from "./listing/readiness";
import { summarizeEvidence, conditionFit, listingProceeds, quantile } from "./listing/pricing";
import { applyGenerated, editText, parseDraft } from "./listing/apply";
import { exportListing } from "./listing/export";
import type { ListingDraft } from "./listing/types";

const now = "2026-11-13T12:00:00.000Z";
const ident = (o: Partial<Identification> = {}): Identification => ({
  brand: "Nike",
  productName: "Nike Dunk Low",
  category: "Sneakers",
  model: "Dunk Low",
  colorway: "White and black",
  visibleCondition: "Lightly worn with toe-box creasing",
  identifyingInformation: null,
  confidence: "medium",
  uncertainties: [],
  additionalEvidence: [],
  ...o,
});
const details = (o: Partial<MatchDetails> = {}): MatchDetails => ({ ...emptyMatchDetails, ...o });
const sources = { brand: "image-visible", productName: "image-visible", model: "ai-inferred", colorway: "image-visible", category: "ai-inferred" } as const;
const draftFor = (i = ident(), d = details(), ebay: Parameters<typeof createListingDraft>[0]["ebay"] = null) =>
  createListingDraft({ id: "d1", now, identification: i, details: d, sources: { ...sources }, photos: [{ id: "p1", name: "shoe.jpg" }], ebay, mercari: null });

/** Make a draft publishable except for the aspect under test. */
function complete(draft: ListingDraft): ListingDraft {
  let d = draft;
  for (const a of d.attributes) if (a.required && a.source === "missing") d = editAttribute(d, a.key, a.key === "size" ? "10" : a.key === "department" ? "Men" : "Value");
  for (const a of d.attributes) if (a.source === "ai-inferred") d = confirmAttribute(d, a.key);
  d = { ...d, condition: { ...d.condition, grade: d.condition.grade || "used", description: "Pre-owned.", noKnownDefects: true, confirmed: true }, includedItems: { value: "Item only", source: "user-confirmed", confirmed: true } };
  d = applyGenerated(d, { source: "template", title: buildTitle(d), description: buildDescription(d), warnings: [] }, ["title", "description"]);
  return {
    ...d,
    pricing: { ...d.pricing, price: 80, priceSource: "manual", priceProvider: null },
    shipping: { weightLb: "3", weightOz: "", length: "14", width: "10", height: "5", service: "USPS Ground Advantage", handlingDays: "1", whoPays: "buyer", confirmed: true },
  };
}

// Real comparables through the existing matcher and pricing engine (no duplicated pricing logic).
const listing = (title: string, price: number, n: number, conditionId = "3000"): Comparable => ({
  id: String(n), title, price, currency: "USD", status: "asking", condition: conditionId === "1000" ? "New" : "Used", conditionId,
  url: "https://www.ebay.com/itm/" + n, observedAt: now, shipping: 0, seller: "seller-" + n, categories: ["Video Game Consoles"], matchReasons: [], warnings: [],
});
const ps5: ProductQuery = {
  identification: ident({ brand: "Sony", model: "PlayStation 5", productName: "PlayStation 5 Console", category: "Electronics", colorway: null, visibleCondition: "Used, light scratches" }),
  details: details({ condition: "used", variant: "Disc" }),
};
function evidence(prices: number[], expiresAt = new Date(Date.parse(now) + 3_600_000).toISOString()) {
  const comparables = prices.map((p, n) => tierComparable(listing("Sony PlayStation 5 Disc Console", p, n), ps5).item!);
  const result: MarketplaceResult = { provider: "ebay", status: "available", environment: "production", query: "ps5", comparables, retrievedAt: now, expiresAt, cached: false, examined: prices.length, excluded: 0, invalid: 0, warnings: [] };
  return { result, recommendation: recommend(result, ps5, undefined, Date.parse(now)) };
}

test("categories map onto listing profiles with category-specific required specifics", () => {
  assert.equal(listingCategory(ident()), "footwear");
  assert.equal(listingCategory(ident({ productName: "Patagonia Better Sweater Jacket", category: "Apparel", model: null })), "clothing");
  assert.equal(listingCategory(ps5.identification), "electronics");
  assert.equal(listingCategory(ident({ productName: "LEGO Star Wars set", category: "Collectible toys", model: "75192" })), "collectible");
  assert.equal(listingCategory(ident({ productName: "Ceramic table lamp", category: "Home decor", brand: null, model: null })), "household");
  const required = (c: Parameters<typeof attributeRules>[0], i?: Identification) => attributeRules(c, i).filter((r) => r.required).map((r) => r.key);
  assert.deepEqual(required("footwear"), ["productType", "brand", "model", "size", "department", "color"]);
  assert.ok(required("electronics", ident({ productName: "Apple iPhone 13" })).includes("carrierLock"));
  assert.ok(required("electronics", ident({ productName: "Apple iPhone 13" })).includes("storage"));
  assert.ok(!required("electronics", ps5.identification).includes("carrierLock"));
  assert.ok(required("household").includes("dimensions"));
});

test("draft reuses confirmed identification and records provenance; nothing is invented", () => {
  const d = draftFor(ident(), details({ size: "10", sizeSystem: "US Men" }));
  const a = Object.fromEntries(d.attributes.map((x) => [x.key, x]));
  assert.equal(a.brand.source, "identified");
  assert.equal(a.model.source, "ai-inferred");
  assert.equal(a.model.confirmed, false);
  assert.equal(a.size.value, "10");
  assert.equal(a.size.source, "user-confirmed");
  assert.equal(a.department.value, "Men");
  assert.equal(a.styleCode.source, "missing");
  assert.equal(a.material.source, "missing");
  assert.equal(d.condition.grade, "used");
  assert.equal(d.condition.gradeSource, "ai-inferred");
  assert.equal(d.condition.defects, "");
  assert.equal(d.pricing.price, null, "no evidence, no price");
  assert.equal(d.title.value, "", "drafts start without generated text");
});

test("verified identifiers are user-confirmed; transcribed but unverified ones stay identified", () => {
  const verified = draftFor(ident(), details({ productIdentifier: "DD1391-100", productIdentifierVerified: true }));
  assert.equal(verified.attributes.find((x) => x.key === "styleCode")?.source, "user-confirmed");
  const read = draftFor(ident({ identifyingInformation: "DD1391-100" }), details(), null);
  assert.equal(read.attributes.find((x) => x.key === "styleCode")?.source, "ai-inferred");
});

test("readiness blocks on missing and AI-inferred required details, then clears", () => {
  const d = draftFor();
  const r = assessListing(d);
  assert.equal(r.publishable, false);
  const ids = r.blockers.map((b) => b.id);
  for (const id of ["attr-size", "attr-department", "attr-model", "condition-defects", "condition-confirmed", "title", "description", "price", "shipping"]) assert.ok(ids.includes(id), id);
  const done = complete(d);
  assert.deepEqual(assessListing(done).blockers, []);
  assert.equal(assessListing(done).publishable, true);
  // Facebook local pickup does not need package details.
  const local = { ...done, marketplace: "facebook" as const, shipping: { ...done.shipping, weightLb: "", whoPays: "local-pickup" as const, confirmed: false } };
  assert.equal(assessListing(local).publishable, true);
});

test("electronics require functional status, carrier lock (phones) and included items", () => {
  const phone = draftFor(ident({ brand: "Apple", productName: "Apple iPhone 13", model: "iPhone 13", category: "Cell phones", colorway: "Blue", visibleCondition: "Used" }));
  const ids = assessListing(phone).blockers.map((b) => b.id);
  for (const id of ["attr-functionalStatus", "attr-carrierLock", "attr-storage", "included"]) assert.ok(ids.includes(id), id);
});

test("claim audit catches invented authenticity, size, condition, packaging, specs and contact info", () => {
  const facts = listingFacts(complete(draftFor(ident(), details({ size: "10", sizeSystem: "US Men" }))));
  const codes = (t: string) => auditText(t, facts).map((x) => x.code);
  assert.deepEqual(codes("Nike Dunk Low Men's Size 10 Pre-Owned"), []);
  assert.ok(codes("100% Authentic Nike Dunk").includes("authenticity"));
  assert.ok(codes("Nike Dunk Low Size 11").includes("size-mismatch"));
  assert.ok(codes("Brand new, never worn").includes("condition-contradiction"));
  assert.ok(codes("Comes with original box").includes("packaging"));
  assert.ok(codes("Style DD1391-100").includes("identifier-unsupported"));
  assert.ok(codes("256 GB tested and working").includes("spec-unsupported"));
  assert.ok(codes("Fully functional").includes("functional-claim"));
  assert.ok(!codes("Untested").includes("functional-claim"));
  assert.ok(codes("Text me at 555-123-4567").includes("off-platform"));
  assert.ok(codes("Includes original receipt").includes("accessory-unlisted"));
});

test("templates use only confirmed facts, fit marketplace limits and pass the audit", () => {
  const d = complete(draftFor(ident(), details({ size: "10", sizeSystem: "US Men", condition: "used" })));
  assert.equal(buildTitle(d), "Nike Dunk Low Men's Size 10 White and black Pre-Owned".replace(" Men's Size 10 White and black", " White and black Men's Size 10"));
  const long = complete(draftFor(ident({ model: "Dunk Low Retro Premium Special Edition Collaboration", colorway: "White black university red sail grey" }), details({ size: "10", sizeSystem: "US Men", variant: "Special Edition Collaboration 2024 Release Pack" })));
  assert.ok(buildTitle(long).length <= 80);
  assert.ok(buildTitle(long).includes("Size 10"), "size outranks color when space is short");
  assert.ok(buildTitle(long, "facebook").length <= 100);
  const facts = listingFacts(d);
  assert.deepEqual(auditText(buildTitle(d), facts), []);
  assert.deepEqual(auditText(buildDescription(d), facts), []);
  assert.match(buildConditionDescription({ ...d, condition: { ...d.condition, defects: "Small scuff on left toe", noKnownDefects: false } }), /Flaws noted by the seller: Small scuff on left toe\./);
  assert.ok(buildDescription({ ...d, marketplace: "mercari" }, "mercari").length <= 1000);
  assert.ok(!/authentic/i.test(buildDescription(d)));
});

test("pricing evidence comes from the existing engine; quartiles only with five or more asks", () => {
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);
  const five = summarizeEvidence("ebay", evidence([90, 95, 100, 105, 110]));
  assert.equal(five.status, "supported");
  assert.equal(five.conditionCohort, "used");
  assert.equal(five.quickSale, 95);
  assert.equal(five.patient, 105);
  assert.ok(five.suggested !== null);
  const three = summarizeEvidence("ebay", evidence([90, 100, 110]));
  assert.equal(three.status, "supported");
  assert.equal(three.quickSale, null);
  const thin = summarizeEvidence("ebay", evidence([100]));
  assert.equal(thin.status, "insufficient");
  assert.equal(thin.suggested, null);
  assert.equal(summarizeEvidence("mercari", null).status, "unavailable");
  const sandbox = evidence([90, 95, 100, 105, 110]);
  assert.equal(summarizeEvidence("ebay", { ...sandbox, result: { ...sandbox.result, environment: "sandbox" } }).status, "unavailable");
});

test("evidence price is used only when its condition cohort matches the listing condition", () => {
  const ev = evidence([90, 95, 100, 105, 110]);
  const used = draftFor(ps5.identification, ps5.details, ev);
  assert.equal(used.pricing.priceSource, "evidence");
  assert.equal(used.pricing.price, summarizeEvidence("ebay", ev).suggested);
  const asNew = draftFor(ps5.identification, details({ condition: "new", variant: "Disc" }), ev);
  assert.equal(asNew.pricing.price, null, "used-cohort evidence never prices a new listing");
  assert.equal(conditionFit(summarizeEvidence("ebay", ev), "new"), "mismatch");
  const switched = { ...complete(used), condition: { ...complete(used).condition, grade: "new" as const } };
  const r = assessListing({ ...switched, pricing: { ...switched.pricing, price: 100, priceSource: "evidence", priceProvider: "ebay" } });
  assert.ok(r.blockers.some((b) => b.id === "price-condition"));
});

test("proceeds reuse eBay sneaker fees, flag the $150 threshold and compute profit", () => {
  const d = complete(draftFor(ident(), details({ size: "10", sizeSystem: "US Men" })));
  const r = listingProceeds({ ...d.pricing, price: 140, feeMode: "ebay-athletic-sneakers", purchaseCost: "60", sellerShipping: "12" }, "footwear", "ebay");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.fee, 19.44);
  assert.equal(r.proceeds, 108.56);
  assert.equal(r.profit, 48.56);
  assert.equal(r.roi, 80.93);
  assert.match(r.tip || "", /\$150\.00/);
  const custom = listingProceeds({ ...d.pricing, price: 100, feeMode: "custom", feePercent: "10", fixedFee: "0.50", buyerShipping: "5", sellerShipping: "8", purchaseCost: "" }, "footwear", "mercari");
  assert.ok(custom.ok);
  if (custom.ok) {
    assert.equal(custom.fee, 11);
    assert.equal(custom.proceeds, 86);
    assert.equal(custom.profit, null);
  }
  const noFee = listingProceeds({ ...d.pricing, price: 100, feeMode: "custom", feePercent: "" }, "footwear", "mercari");
  assert.equal(noFee.ok, false, "no fee rate is assumed");
  assert.equal(listingProceeds({ ...d.pricing, price: 100, feeMode: "ebay-athletic-sneakers" }, "clothing", "ebay").ok, false);
  assert.equal(listingProceeds({ ...d.pricing, price: null }, "footwear", "ebay").ok, false);
});

test("regeneration changes only requested fields and preserves seller edits", () => {
  let d = complete(draftFor(ident(), details({ size: "10", sizeSystem: "US Men" })));
  d = editText(d, "title", "My own title Size 10");
  const gen = { source: "ai" as const, title: "AI title", description: "AI description", condition: "AI condition", recommendations: ["tip"], warnings: [] };
  const full = applyGenerated(d, gen, ["title", "description", "condition", "recommendations"]);
  assert.equal(full.title.value, "My own title Size 10", "full generation keeps user edits");
  assert.equal(full.description.value, "AI description");
  assert.equal(full.condition.confirmed, false, "new condition text needs reconfirmation");
  const one = applyGenerated(d, gen, ["title"], { overwriteUserEdits: true });
  assert.equal(one.title.value, "AI title");
  assert.equal(one.description.value, d.description.value, "other fields untouched");
  const flagged = editText(d, "title", "Authentic Nike Dunk Size 11");
  assert.equal(flagged.title.warnings.length, 2);
  const r = assessListing(flagged);
  assert.ok(r.warnings.some((w) => w.id.startsWith("title-")), "seller's own claims are warnings, not blockers");
});

test("drafts round-trip through storage validation; exports respect marketplace and provenance", () => {
  const d = complete(draftFor(ident(), details({ size: "10", sizeSystem: "US Men" })));
  assert.deepEqual(parseDraft(JSON.parse(JSON.stringify(d))), d);
  assert.throws(() => parseDraft({ id: "x" }));
  const unconfirmed = draftFor(ident(), details({ size: "10", sizeSystem: "US Men" }));
  assert.ok(!exportListing(unconfirmed).specifics.some(([k]) => k === "Model"), "unconfirmed AI-inferred specifics are not exported");
  const e = exportListing(d, "mercari");
  assert.match(e.text, /^TITLE \(\d+\/80\)/);
  assert.match(e.condition, /Pre-owned/);
  assert.ok(e.specifics.some(([k, v]) => k === "Size" && v === "10"));
});
