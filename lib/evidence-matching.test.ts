import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tierComparable, sizedSearch } from "./ebay-search";
import { matchMercari } from "./mercari-matching";
import { recommend } from "./valuation";
import { scoreComparable } from "./comparable-quality";
import { footwearCohort } from "./footwear-compatibility";
import { styleCodesIn, styleGroup } from "./style-codes";
import { createEbayProvider, ebayAspects } from "./marketplace-providers/ebay";
import { mercariAspects, normalizeMercari } from "./marketplace-providers/mercari";
import { emptyMatchDetails, type Comparable, type ListingAspects, type MarketplaceResult, type ProductQuery } from "./marketplaces";

const now = Date.parse("2026-11-15T18:00:00Z");
const stamp = new Date(now).toISOString();
const query: ProductQuery = {
  identification: { brand: "Nike", productName: "Nike Dunk Low sneaker", category: "sneaker", model: "Dunk Low", colorway: "black and white", visibleCondition: "appears new", identifyingInformation: null, confidence: "high", uncertainties: [], additionalEvidence: [] },
  details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: "new", packaging: "original" },
};
let n = 0;
const listing = (title: string, o: Partial<Comparable> = {}): Comparable => ({
  id: "v1|" + ++n + "|0", title, price: 65, currency: "USD", status: "asking", condition: "New with box", conditionId: "1000",
  url: "https://www.ebay.com/itm/" + n, observedAt: stamp, shipping: null, seller: "seller" + n, categories: ["Athletic Shoes"], matchReasons: [], warnings: [], ...o,
});
const tier = (c: Comparable, q = query) => tierComparable(c, q);
const sized = (o: Partial<ListingAspects> = {}): ListingAspects => ({ source: "ebay-size-filter", size: "10", sizeSystem: "US", department: "Men", ...o });

test("eBay's own 'New with box' condition is box evidence; 'New without box' and Mercari 'New' are not", () => {
  const title = "Nike Dunk Low Retro Black/White Men’s Lace-Up Low Top Sneaker US 10 DD1391-100";
  const withBox = tier(listing(title));
  assert.equal(withBox.item?.priceEligible, true, withBox.reason);
  assert.ok(withBox.item!.matchReasons.includes("Original box stated in eBay's condition (New with box)"));
  assert.equal(tier(listing(title, { condition: "New without box", conditionId: "1500" })).reason, "packaging_unverified_or_mismatch");
  // Mercari's "New" maps to the same condition id but says nothing about a box.
  assert.equal(tier(listing(title, { condition: "New" })).reason, "packaging_unverified_or_mismatch");
  // A title that says "no box" still contradicts the request.
  assert.equal(tier(listing(title + " no box")).reason, "packaging_unverified_or_mismatch");
  // And the reverse request: "New without box" is evidence for a no-box item.
  const noBox = { ...query, details: { ...query.details, packaging: "none" as const } };
  assert.equal(tier(listing(title, { condition: "New without box", conditionId: "1500" }), noBox).item?.priceEligible, true);
  assert.equal(tier(listing(title), noBox).reason, "packaging_unverified_or_mismatch");
});

test("men's sizing: 10M notation and men's style codes count; unknown or conflicting sizes never do", () => {
  assert.equal(tier(listing("Size 10M/11.5W - Nike Dunk Low Retro White Black Panda DD1391-100 Brand New")).item?.priceEligible, true);
  assert.equal(tier(listing("Nike Dunk Low Retro White Black Panda 10M")).item?.priceEligible, true);
  // Men's style code establishes the group; "US 10" establishes the size and system.
  assert.equal(tier(listing("Nike Dunk Low Retro White Black US 10 DD1391-100")).item?.priceEligible, true);
  // A bare "Size 10" with no men's evidence is still unverified (could be a women's 10).
  assert.equal(tier(listing("Nike Dunk Low Retro - White/Black-White - Size 10")).reason, "sizing_group_unverified");
  // A men's code without "US" or M notation doesn't establish the size system.
  assert.equal(tier(listing("Nike Dunk Low Retro Black White Size 10 DD1391-100")).reason, "sizing_system_unverified");
  // Women's and GS style codes contradict a men's request even when the title says "men".
  assert.equal(tier(listing("Nike Dunk Low Black White Men's US 10 DD1503-101")).reason, "sizing_group_mismatch");
  assert.equal(tier(listing("Nike Dunk Low Black White US 10 CW1590-100")).reason, "youth_sizing_group_unconfirmed");
  assert.equal(tier(listing("Nike Dunk Low Retro White Black Panda 11.5M")).reason, "size_mismatch");
  assert.equal(tier(listing("Nike Dunk Low Retro Black White Panda")).reason, "size_unverified");
  assert.deepEqual(styleCodesIn("dd1391 100 / DD1503-101 and CW1590"), ["DD1391-100", "DD1503-101", "CW1590"]);
  assert.equal(styleGroup("DJ6188-101", "dunk low"), null);
  assert.equal(styleGroup("DD1391-100 DD1503-101", "dunk low"), null);
});

test("eBay item specifics decide size and group; disagreements and multi-size listings are excluded", () => {
  const title = "Nike Dunk Low Retro Black White Panda DD1391-100";
  assert.equal(tier(listing(title, { aspects: sized() })).item?.priceEligible, true);
  assert.ok(tier(listing(title, { aspects: sized() })).item!.matchReasons.includes("Size and sizing group stated in eBay item specifics"));
  assert.equal(tier(listing(title, { aspects: sized({ size: "10.5" }) })).reason, "size_mismatch");
  assert.equal(tier(listing(title + " Size 10.5", { aspects: sized() })).reason, "size_evidence_conflict");
  assert.equal(tier(listing("Nike Dunk Low Black White DD1503-101", { aspects: sized() })).reason, "sizing_group_mismatch");
  assert.equal(tier(listing("Nike Dunk Low Black White", { aspects: sized({ department: "Women" }) })).reason, "sizing_group_mismatch");
  assert.equal(tier(listing(title, { aspects: sized({ sizeSystem: undefined }) })).reason, "sizing_system_unverified");
  // Multi-size listings: one advertised price for several sizes is never a size-10 price ...
  assert.equal(tier(listing("Nike Dunk Low Panda Black White Men's Sizes 4/4.5/5 DD1391-100")).reason, "variation_price_unverified");
  assert.equal(tier(listing(title + " Men's US 10", { warnings: ["Variation selection unverified; excluded from pricing statistics"] })).reason, "variation_price_unverified");
  // ... unless eBay states this variation's own size (and its own price comes with it).
  const variation = tier(listing("Nike Dunk Low Retro Panda Black White Men's Sneakers Sz 7-11 DD1391-100 NEW", { aspects: { source: "ebay-item-group", size: "10", sizeSystem: "US", department: "Men" } }));
  assert.equal(variation.item?.priceEligible, true, variation.reason);
  const otherSize = tier(listing("Nike Dunk Low Retro Panda Black White Men's Sneakers DD1391-100", { aspects: { source: "ebay-item-group", size: "9", sizeSystem: "US", department: "Men" } }));
  assert.equal(otherSize.reason, "size_mismatch");
});

test("SB Dunks, named colorways and Nike By You pairs are not the requested release", () => {
  assert.equal(tier(listing("Nike Dunk Low Pro SB Black White Gum. SIZE 10 - HF3704-003", { aspects: sized() })).reason, "distinct_edition_unconfirmed");
  assert.equal(tier(listing("Nike Dunk Low Size 10 Mens White Bright Cactus Black", { aspects: sized() })).reason, "conflicting_colorway");
  assert.equal(tier(listing("Men's Nike Dunk Low Retro Size 10 Sneakers - White Black Denim Turquoise", { aspects: sized() })).reason, "conflicting_colorway");
  assert.equal(tier(listing("NIKE iD Dunk Low Black White Shoes (FJ2253 901) Men's Size 10", { aspects: sized() })).item, null);
  assert.equal(tier(listing("Nike By You Dunk Low Black White Men's US 10", { aspects: sized() })).item, null);
});

test("a known style code groups 'Dunk Low' with 'Dunk Low Retro'; unknown codes don't", () => {
  assert.equal(footwearCohort(listing("Nike Dunk Low Panda Black/White DD1391-100 us9"), query), "low/retro");
  assert.equal(footwearCohort(listing("Nike Dunk Low Retro Black White"), query), "low/retro");
  assert.equal(footwearCohort(listing("Nike Dunk Low Black White"), query), "low/unspecified");
  assert.equal(footwearCohort(listing("Nike Dunk Low Black White DJ6188-101"), query), "low/unspecified");
});

type FixtureRow = { id: string; title: string; price: number; condition: string; conditionId: string; seller: string | null; variation?: boolean; aspects?: ListingAspects };
const fixture = (name: string) => JSON.parse(readFileSync(new URL("./test-support/" + name, import.meta.url), "utf8")) as { query: ProductQuery; rows: FixtureRow[] };
const replay = (name: string) => {
  const f = fixture(name);
  const comparables = f.rows.flatMap((r) => {
    const source = listing(r.title, { id: r.id, price: r.price, condition: r.condition, conditionId: r.conditionId, seller: r.seller, ...(r.aspects ? { aspects: r.aspects } : {}), warnings: r.variation ? ["Variation selection unverified; excluded from pricing statistics"] : [] });
    const m = tierComparable(source, f.query);
    return m.item ? [{ ...m.item, quality: scoreComparable(m.item) }] : [];
  });
  const result: MarketplaceResult = { provider: "ebay", status: "available", environment: "production", query: "q", comparables, retrievedAt: stamp, expiresAt: "2026-11-16T05:00:00.000Z", cached: false, examined: comparables.length, excluded: 0, invalid: 0, warnings: [] };
  return { rec: recommend(result, f.query, undefined, now), comparables };
};

test("saved title-only eBay snapshot: 2 exact size-10 listings (no price); a men's-only broader reference", () => {
  const { rec, comparables } = replay("ebay-dunk-low-panda-10-titles-2026-11-15.json");
  // Thresholds unchanged: two verified size-10 listings are not enough for a price.
  assert.equal(rec.suggestedListingPrice, null);
  assert.equal(rec.eligibleCount, 2);
  assert.deepEqual(comparables.filter((c) => rec.eligibleIds.includes(c.id)).map((c) => c.price), [65, 65]);
  const ref = rec.marketReference!;
  assert.equal(ref.kind, "broader-market-asking-reference");
  assert.equal(ref.median, 60);
  assert.equal(ref.count, 16);
  const titles = comparables.filter((c) => ref.listingIds.includes(c.id)).map((c) => c.title);
  for (const t of titles) assert.doesNotMatch(t, /women|wmns|\bGS\b|DD1503|CW1590|NIKE iD|by you|\bSB\b|sizes/i, t);
});

test("live size-filtered eBay search: a defensible size-10 price from verified listings", () => {
  const { rec, comparables } = replay("ebay-dunk-low-panda-10-sized-2026-11-15.json");
  assert.equal(rec.suggestedListingPrice, 70);
  assert.equal(rec.eligibleCount, 14);
  assert.equal(rec.pricingDiagnostics.sellerCount, 14);
  assert.equal(rec.variantCohort, "low/retro");
  assert.ok(rec.pricingDiagnostics.spread! <= 2);
  const used = comparables.filter((c) => rec.eligibleIds.includes(c.id));
  for (const c of used) {
    assert.equal(c.aspects?.size, "10");
    assert.equal(c.conditionId, "1000");
    assert.doesNotMatch(c.title, /\bSB\b|women|cactus|turquoise|sizes/i);
  }
  assert.equal(rec.marketReference, null);
});

test("size-filtered search parameters and structured aspect parsing", () => {
  assert.deepEqual(sizedSearch(query), { stage: "S", query: "nike dunk low black white", categoryId: "15709", aspectFilter: "categoryId:15709,US Shoe Size:{10}", department: "Men", size: "10", conditionIds: "1000|1500|1750" });
  assert.equal(sizedSearch({ ...query, details: { ...query.details, sizeSystem: "US Women", size: "8.5" } })?.aspectFilter, "categoryId:95672,US Shoe Size:{8.5}");
  assert.equal(sizedSearch({ ...query, details: { ...query.details, sizeSystem: "EU" } }), null);
  assert.equal(sizedSearch({ ...query, details: { ...query.details, size: "M" } }), null);
  assert.deepEqual(ebayAspects([{ name: "US Shoe Size", value: "10" }, { name: "Department", value: "Men" }, { name: "Style Code", value: "DD1391-100" }], "ebay-item-details"), { source: "ebay-item-details", size: "10", sizeSystem: "US", department: "Men", styleCode: "DD1391-100" });
  assert.equal(ebayAspects([{ name: "US Shoe Size", value: "10 M" }], "ebay-item-details")?.size, "10");
  assert.equal(ebayAspects([{ name: "US Shoe Size", value: "10-11" }], "ebay-item-details"), null);
  assert.deepEqual(mercariAspects({ size: "10 (43)", categories: [{ name: "Men" }] }), { source: "mercari-listing", size: "10", sizeSystem: "US", department: "Men" });
  assert.deepEqual(mercariAspects({ size: "5.5 (38.5) and below", categories: [{ name: "Women" }] }), { source: "mercari-listing", department: "Women" });
  assert.equal(mercariAspects({ size: "3T" }), null);
});

test("Mercari's own size and category are used, and a title that disagrees is excluded", () => {
  const row = (name: string, size: string, category = "Men") => ({ id: "m" + ++n, name, price: 80, currency: "USD", status: "on_sale", url: `https://www.mercari.com/us/item/m${n}/`, condition: "New", seller_id: "x" + n, size, categories: [{ name: category }, { name: "Shoes" }] });
  const { items } = normalizeMercari({ success: true, country: "US", items: [
    row("Nike Dunk Low Retro Panda White/Black DD1391-100 Men's Size 10 New in Box", "10 (43)"),
    row("Nike Dunk Low Retro Panda Black White Men’s Size 10 DD1391-100 New in Box", "10.5 (43.5)"),
    row("Nike Dunk Low Panda black white new in box", "10 (40.5)", "Women"),
  ] }, stamp);
  const [ok, conflict, women] = items.map((i) => matchMercari(i, query));
  assert.equal(ok.item?.priceEligible, true, ok.reason);
  assert.equal(conflict.reason, "size_mismatch");
  assert.equal(women.reason, "sizing_group_mismatch");
});

test("eBay enrichment checks per-size variations and item specifics within a fixed budget", async () => {
  const urls: string[] = [];
  const summary = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ itemId: `v1|${id}|0`, title, price: { value: "65.00", currency: "USD" }, condition: "New with box", conditionId: "1000", itemWebUrl: `https://www.ebay.com/itm/${id}`, buyingOptions: ["FIXED_PRICE"], seller: { username: "u" + id }, ...extra });
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "t", expires_in: 7200 });
    urls.push(url);
    if (url.includes("aspect_filter")) return Response.json({ total: 0, itemSummaries: [] });
    if (url.includes("item_summary/search"))
      return Response.json({ itemSummaries: [
        summary("100001", "Nike Dunk Low Retro Panda Black White Men's DD1391-100", { itemGroupHref: "https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group?item_group_id=100001", itemGroupType: "SELLER_DEFINED_VARIATIONS" }),
        summary("200002", "Nike Dunk Low Retro Black White Panda DD1391-100 New"),
      ] });
    if (url.includes("get_items_by_item_group"))
      return Response.json({ items: [
        { ...summary("100001", "Nike Dunk Low Retro Panda Black White Men's DD1391-100"), itemId: "v1|100001|9", itemWebUrl: "https://www.ebay.com/itm/100001?var=9", price: { value: "62.99", currency: "USD" }, localizedAspects: [{ name: "US Shoe Size", value: "10" }, { name: "Department", value: "Men" }] },
        { ...summary("100001", "Nike Dunk Low Retro Panda Black White Men's DD1391-100"), itemId: "v1|100001|8", itemWebUrl: "https://www.ebay.com/itm/100001?var=8", localizedAspects: [{ name: "US Shoe Size", value: "9" }] },
      ] });
    if (url.includes("/buy/browse/v1/item/v1"))
      return Response.json({ localizedAspects: [{ name: "US Shoe Size", value: "10" }, { name: "Department", value: "Men" }, { name: "Style Code", value: "DD1391-100" }] });
    throw new Error("unexpected " + url);
  };
  const provider = createEbayProvider({ clientId: "id", clientSecret: "secret", environment: "production", productionApproved: true, fetcher, now: () => now });
  const result = await provider.search(query);
  assert.equal(result.status, "available");
  assert.deepEqual({ ...result.searchDiagnostics!.enrichment, skipped: undefined }, { groupsChecked: 1, variationsFound: 1, detailsChecked: 1, detailsWithSize: 1, skipped: undefined });
  const variation = result.comparables.find((c) => c.id === "v1|100001|9")!;
  assert.equal(variation.price, 62.99);
  assert.equal(variation.priceEligible, true);
  assert.ok(!result.comparables.some((c) => c.id === "v1|100001|8"));
  const detailed = result.comparables.find((c) => c.id === "v1|200002|0")!;
  assert.equal(detailed.aspects?.source, "ebay-item-details");
  assert.equal(detailed.priceEligible, true);
  // Group summary stays excluded (one price for several sizes); thresholds unchanged, so 2 listings give no price.
  assert.equal(result.comparables.find((c) => c.id === "v1|100001|0")?.priceEligible, false);
  assert.equal(recommend(result, query, undefined, now).suggestedListingPrice, null);
  assert.ok(urls.every((u) => u.startsWith("https://api.ebay.com/buy/browse/v1/")));
  assert.equal(urls.filter((u) => u.includes("/item/")).length, 2);
});
