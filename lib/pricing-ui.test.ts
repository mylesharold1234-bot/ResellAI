import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { browserRows, filterRows, listingCounts, listingSize, reasonLabel, type BrowserEvidence } from "./comparable-browser";
import { listingImage, normalizeEbaySearch } from "./marketplace-providers/ebay";
import { createListingDraft } from "./listing/draft";
import { emptyMatchDetails, type Comparable, type MarketplaceResult } from "./marketplaces";
import { ComparableBrowser } from "../components/comparable-browser";
import { MarketplaceProfit } from "../components/marketplace-intelligence";

test("listing size reads only what the title states", () => {
  assert.deepEqual(listingSize("Nike Dunk Low Retro Black/White Men’s Sneaker US 10 DD1391-100"), { kind: "single", label: "Size 10", value: "10" });
  assert.equal(listingSize("Size 10M/11.5W - Nike Dunk Low Retro Panda").value, "10");
  assert.equal(listingSize("Nike Dunk Low Panda DD1391-100 us9").value, "9");
  assert.equal(listingSize("Nike Dunk Low Men's 10.5 Panda").value, "10.5");
  assert.equal(listingSize("Nike Dunk Low Black White Panda").kind, "unknown");
  assert.equal(listingSize("Nike Dunk Low Black White Panda").label, "Size not stated");
  // Style codes and years are not sizes.
  assert.equal(listingSize("Nike Dunk Low DD1391-100 2021").kind, "unknown");
  assert.equal(listingSize("Nike Dunk Low Panda Men's Sizes 4/4.5/5").kind, "multi");
  assert.equal(listingSize("Nike Dunk Low size 7-10").kind, "multi");
  // Two different numbers: don't pick one.
  assert.equal(listingSize("NEW Nike Dunk Low Women’s 12 Men’s 10.5 Panda").label, "Size unclear");
});

test("reason labels are plain language, with a neutral fallback", () => {
  assert.equal(reasonLabel("packaging_unverified_or_mismatch"), "Box not mentioned in the title");
  assert.equal(reasonLabel("variation_price_unverified"), "Several sizes, one price");
  assert.equal(reasonLabel("sizing_group_unverified"), "Men's or women's sizing not stated");
  assert.equal(reasonLabel("something_new"), "Not a close enough match");
});

const now = "2026-11-15T17:00:00.000Z";
const row = (id: string, o: Partial<Comparable> = {}): Comparable => ({
  id, title: `Nike Dunk Low Panda ${id}`, price: 60, currency: "USD", status: "asking", condition: "New with box", conditionId: "1000",
  url: `https://www.ebay.com/itm/${id}`, observedAt: now, shipping: null, seller: "s" + id, categories: [], matchReasons: [], warnings: [], matchTier: "close", priceEligible: false, ...o,
});
const result = (comparables: Comparable[], rows: { id: string; title: string; stage: string; reason: string }[] = []): MarketplaceResult => ({
  provider: "ebay", status: "available", environment: "production", query: "q", comparables, retrievedAt: now, expiresAt: "2026-11-16T05:00:00.000Z", cached: false,
  examined: 300, excluded: 7, invalid: 126, warnings: [],
  diagnostics: { normalized: 174, accepted: comparables.length, exclusions: {}, rows },
  retrievalDiagnostics: { uniqueListings: 174, duplicateRows: 126, duplicateRate: 0.42, pricingCandidates: 0, cohortCount: 0, bottleneck: "matching", latencyMs: 1, requests: 3 },
});

test("counts never call matched-but-unusable listings 'found'", () => {
  const r = result([row("1"), row("2")]);
  assert.equal(listingCounts(r, { eligibleCount: 0, suggestedListingPrice: null }).label, "174 checked · none usable for a price");
  assert.equal(listingCounts(r, { eligibleCount: 5, suggestedListingPrice: 70 }).label, "174 checked · 5 used for the price");
  // A blocked sample (stats but no price) is not "used for the price".
  assert.equal(listingCounts(r, { eligibleCount: 4, suggestedListingPrice: null }).used, 0);
});

test("browser explains each listing's use from the engine's own decisions", () => {
  const r = result(
    [
      row("a", { priceEligible: true, quality: { score: 80, signals: [] }, image: "https://i.ebayimg.com/images/g/a/s-l225.jpg" }),
      row("b", { warnings: ["Attribute uncertainty: condition_mismatch; not an exact comparable"], condition: "Pre-owned - Good", conditionId: "3000" }),
      row("c", { warnings: ["Variation selection unverified; excluded from pricing statistics"] }),
      row("d", { matchTier: "related", title: "Nike Dunk Low GS Panda Size 6Y" }),
      row("e", { title: "Nike Dunk Low Panda Men's Size 10" }),
    ],
    [{ id: "d", title: "", stage: "related (pricing excluded)", reason: "youth_sizing_group_unconfirmed" }, { id: "e", title: "", stage: "close (pricing excluded)", reason: "packaging_unverified_or_mismatch" }],
  );
  const noPrice: BrowserEvidence = { provider: "ebay", result: r, recommendation: { eligibleCount: 0, eligibleIds: [], outlierIds: [], suggestedListingPrice: null, marketReference: { listingIds: ["a"] } } };
  const rows = browserRows([noPrice]);
  const by = Object.fromEntries(rows.map((x) => [x.id, x]));
  assert.equal(rows[0].id, "a");
  assert.equal(by.a.use, "reference");
  assert.equal(by.a.image, "https://i.ebayimg.com/images/g/a/s-l225.jpg");
  assert.equal(by.b.why, "Different condition");
  assert.equal(by.c.why, "Several sizes, one price");
  assert.equal(by.d.why, "Kids' sizing");
  assert.equal(by.e.why, "Box not mentioned in the title");
  assert.equal(by.e.size.value, "10");
  // Eligible ids only count as "used for the price" when a price was actually recommended.
  const blocked = browserRows([{ ...noPrice, recommendation: { ...noPrice.recommendation, eligibleIds: ["a"], marketReference: null } }]);
  assert.equal(blocked.find((x) => x.id === "a")!.use, "not-used");
  const priced = browserRows([{ ...noPrice, recommendation: { eligibleCount: 1, eligibleIds: ["a"], outlierIds: ["b"], suggestedListingPrice: 60, marketReference: null } }]);
  assert.equal(priced.find((x) => x.id === "a")!.use, "price");
  assert.equal(priced.find((x) => x.id === "b")!.why, "Unusually high or low price");

  assert.deepEqual(filterRows(rows, { marketplace: "all", show: "all", yourSize: true }, "10").map((x) => x.id), ["e"]);
  assert.deepEqual(filterRows(rows, { marketplace: "mercari", show: "all", yourSize: false }).length, 0);
  assert.deepEqual(filterRows(rows, { marketplace: "all", show: "used", yourSize: false }).map((x) => x.id), ["a"]);

  const html = renderToStaticMarkup(createElement(ComparableBrowser, { sources: [noPrice], size: "10" }));
  assert.match(html, /Used for the broader reference/);
  // With nothing used at all, the browser opens on the closest matches and says why each was set aside.
  const closeOnly = { ...r, comparables: r.comparables.map((c) => (c.id === "e" ? { ...c, quality: { score: 70, signals: [] } } : c)) };
  const unused = renderToStaticMarkup(createElement(ComparableBrowser, { sources: [{ ...noPrice, result: closeOnly, recommendation: { ...noPrice.recommendation, marketReference: null } }], size: "10" }));
  assert.match(unused, /Not used: Box not mentioned in the title/);
  assert.match(unused, /<option value="close" selected="">/);
  assert.match(html, /Only size 10 in the title/);
  assert.match(html, /not sold prices/);
  assert.match(unused, /href="https:\/\/www.ebay.com\/itm\/e"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
});

test("eBay listing photos come only from eBay's image host and never affect matching fields", () => {
  assert.equal(listingImage({ image: { imageUrl: "https://i.ebayimg.com/images/g/x/s-l225.jpg" } }), "https://i.ebayimg.com/images/g/x/s-l225.jpg");
  assert.equal(listingImage({ image: { imageUrl: "http://i.ebayimg.com/x.jpg" }, thumbnailImages: [{ imageUrl: "https://i.ebayimg.com/t.jpg" }] }), "https://i.ebayimg.com/t.jpg");
  assert.equal(listingImage({ image: { imageUrl: "https://evil.example/x.jpg" } }), null);
  assert.equal(listingImage({ image: { imageUrl: "https://i.ebayimg.com.evil.example/x.jpg" } }), null);
  assert.equal(listingImage({}), null);
  const body = { total: 1, itemSummaries: [{ itemId: "v1|1|0", title: "Nike Dunk Low", price: { value: "60.00", currency: "USD" }, condition: "New with box", conditionId: "1000", itemWebUrl: "https://www.ebay.com/itm/1", buyingOptions: ["FIXED_PRICE"], seller: { username: "s" }, image: { imageUrl: "https://i.ebayimg.com/images/g/1/s-l225.jpg" } }] };
  const [item] = normalizeEbaySearch(body, "production", now).items;
  assert.equal(item.image, "https://i.ebayimg.com/images/g/1/s-l225.jpg");
  const { image: _image, ...withoutImage } = item;
  const [plain] = normalizeEbaySearch({ ...body, itemSummaries: [{ ...body.itemSummaries[0], image: undefined }] }, "production", now).items;
  assert.deepEqual(withoutImage, plain);
});

test("the seller's own price works without a recommendation and is marked as theirs", () => {
  const identification = { brand: "Nike", model: "Dunk Low", productName: "Nike Dunk Low", category: "sneakers", colorway: "black and white", visibleCondition: null, identifyingInformation: null, confidence: "high" as const, uncertainties: [], additionalEvidence: [] };
  const base = { id: "d", now, identification, details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men" as const, condition: "new" as const }, sources: {}, photos: [], ebay: null, mercari: null };
  const manual = createListingDraft({ ...base, manualPrice: 64.999 });
  assert.equal(manual.pricing.price, 65);
  assert.equal(manual.pricing.priceSource, "manual");
  assert.equal(manual.pricing.priceProvider, null);
  for (const bad of [null, 0, -5, Number.NaN]) assert.equal(createListingDraft({ ...base, manualPrice: bad }).pricing.price, null);

  const profit = renderToStaticMarkup(createElement(MarketplaceProfit, { ebay: null, mercari: null, now: Date.parse(now), manualPrice: 65 }));
  assert.doesNotMatch(profit, /Enter your price above/);
  const none = renderToStaticMarkup(createElement(MarketplaceProfit, { ebay: null, mercari: null, now: Date.parse(now) }));
  assert.match(none, /Enter your price above to estimate profit/);
});
