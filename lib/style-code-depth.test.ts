import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canonicalStyleCode, styleCodeFromText } from "./style-codes";
import { sizedSearches, tierComparable } from "./ebay-search";
import { createEbayProvider } from "./marketplace-providers/ebay";
import { identificationReducer, emptyIdentificationState as initialIdentificationState } from "./identification-workflow";
import { emptyMatchDetails, type Comparable, type ProductQuery } from "./marketplaces";
import { MatchDetailsFields } from "../components/match-details-fields";

const now = Date.parse("2026-11-17T18:00:00Z");
const stamp = new Date(now).toISOString();
const identification = { brand: "Nike", productName: "Nike Dunk Low sneaker", category: "sneaker", model: "Dunk Low", colorway: "black and white", visibleCondition: "appears new", identifyingInformation: null, confidence: "high" as const, uncertainties: [], additionalEvidence: [] };
const base: ProductQuery = { identification, details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: "new", packaging: "original" } };
const coded: ProductQuery = { ...base, details: { ...base.details, productIdentifier: "DD1391-100", productIdentifierVerified: true } };
let n = 0;
const listing = (title: string, o: Partial<Comparable> = {}): Comparable => ({
  id: `v1|${++n}|0`, title, price: 70, currency: "USD", status: "asking", condition: "New with box", conditionId: "1000", url: `https://www.ebay.com/itm/${n}`,
  observedAt: stamp, shipping: null, seller: "s" + n, categories: [], matchReasons: [], warnings: [], aspects: { source: "ebay-size-filter", size: "10", sizeSystem: "US", department: "Men" }, ...o,
});

test("style codes are normalized, and only a single legible code is read from the photo", () => {
  assert.equal(canonicalStyleCode("dd1391 100"), "DD1391-100");
  assert.equal(canonicalStyleCode(" DD1391-100 "), "DD1391-100");
  assert.equal(canonicalStyleCode("DD1391100"), "DD1391-100");
  assert.equal(canonicalStyleCode("DD1391"), null);
  assert.equal(canonicalStyleCode("GY1234"), null);
  assert.equal(styleCodeFromText("Box label: DD1391-100, size 10"), "DD1391-100");
  assert.equal(styleCodeFromText("DD1391-100 or DD1503-101"), null);
  assert.equal(styleCodeFromText("DD1391"), null);
  assert.equal(styleCodeFromText(null), null);
});

test("a code read from the photo is suggested for sneakers but needs the seller's confirmation", () => {
  const state = identificationReducer(initialIdentificationState, { type: "identified", identification: { ...identification, identifyingInformation: "Tongue tag reads DD1391-100" } } as never);
  assert.equal(state.details.productIdentifier, "DD1391-100");
  assert.equal(state.details.productIdentifierVerified, false);
  const notShoe = identificationReducer(initialIdentificationState, { type: "identified", identification: { ...identification, productName: "Sony headphones", category: "electronics", model: "WH-1000XM5", identifyingInformation: "DD1391-100" } } as never);
  assert.equal(notShoe.details.productIdentifier, "");
});

test("sneaker details show the style code next to size and condition", () => {
  const html = renderToStaticMarkup(createElement(MatchDetailsFields, { value: { ...base.details, productIdentifier: "DD1391-100", productIdentifierVerified: false }, identification, onChange() {}, part: "essential" }));
  assert.match(html, /Style code/);
  assert.match(html, /We read this from your photo/);
  assert.match(html, /This matches the code on my box or tag/);
  const typed = renderToStaticMarkup(createElement(MatchDetailsFields, { value: coded.details, identification, onChange() {}, part: "essential" }));
  assert.doesNotMatch(typed, /This matches the code/);
  const invalid = renderToStaticMarkup(createElement(MatchDetailsFields, { value: { ...base.details, productIdentifier: "DD139" }, identification, onChange() {}, part: "essential" }));
  assert.match(invalid, /look like DD1391-100/);
  assert.match(invalid, /aria-invalid="true"/);
  // Not duplicated under "More details" for sneakers.
  const more = renderToStaticMarkup(createElement(MatchDetailsFields, { value: coded.details, identification, onChange() {}, part: "more" }));
  assert.doesNotMatch(more, /Style code/);
});

test("a confirmed style code is matched in the title or eBay's item specifics, and settles the colorway", () => {
  assert.equal(tierComparable(listing("Nike Dunk Low Retro Black White DD1391-100 Men's US 10"), coded).item?.priceEligible, true);
  // "Panda" with no color words passes once the code is confirmed ...
  const panda = tierComparable(listing("Nike Dunk Low Retro Panda DD1391-100 Fashion Shoes"), coded);
  assert.equal(panda.item?.priceEligible, true, panda.reason);
  assert.ok(panda.item!.matchReasons.includes("Colorway established by the confirmed style code"));
  // ... but not without it.
  assert.equal(tierComparable(listing("Nike Dunk Low Retro Panda DD1391-100 Fashion Shoes"), base).reason, "colorway_mismatch");
  // A title naming a different color is still rejected, code or not.
  assert.equal(tierComparable(listing("Nike Dunk Low Retro DD1391-100 University Red"), coded).item?.priceEligible ?? false, false);
  // No code in the title: eBay's own Style Code item specific confirms it.
  assert.equal(tierComparable(listing("Nike Dunk Low Retro Panda Men's Shoes"), coded).reason, "identifier_mismatch");
  const fromSpecifics = tierComparable(listing("Nike Dunk Low Retro Panda Men's Shoes", { aspects: { source: "ebay-item-details", size: "10", sizeSystem: "US", department: "Men", styleCode: "DD1391-100" } }), coded);
  assert.equal(fromSpecifics.item?.priceEligible, true, fromSpecifics.reason);
  assert.ok(fromSpecifics.item!.matchReasons.includes("Style code confirmed in eBay item specifics"));
  assert.equal(tierComparable(listing("Nike Dunk Low Retro Panda Men's Shoes", { aspects: { source: "ebay-item-details", size: "10", sizeSystem: "US", department: "Men", styleCode: "DD1391-600" } }), coded).reason, "identifier_mismatch");
});

test("size-filtered eBay searches: two pages of 200 by style code, otherwise one page of 200", () => {
  const withCode = sizedSearches(coded);
  assert.deepEqual(withCode.map((s) => [s.stage, s.query, s.limit, s.offset, s.aspectFilter]), [["S1", "DD1391-100", 200, 0, "categoryId:15709,US Shoe Size:{10}"], ["S2", "DD1391-100", 200, 200, "categoryId:15709,US Shoe Size:{10}"]]);
  assert.deepEqual(sizedSearches(base).map((s) => [s.stage, s.query, s.limit, s.offset]), [["S", "nike dunk low black white", 200, 0]]);
  // An unconfirmed code isn't searched on.
  assert.equal(sizedSearches({ ...coded, details: { ...coded.details, productIdentifierVerified: false } })[0].styleCode, null);
});

test("eBay depth: style-code pages, skipped title searches, stock-checked variations and item-specific confirmation", async () => {
  const urls: URL[] = [];
  const summary = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ itemId: `v1|${id}|0`, title, price: { value: "70.00", currency: "USD" }, condition: "New with box", conditionId: "1000", itemWebUrl: `https://www.ebay.com/itm/${id}`, buyingOptions: ["FIXED_PRICE"], seller: { username: "u" + id }, ...extra });
  const page1 = Array.from({ length: 200 }, (_, i) => summary(String(100000 + i), `Nike Dunk Low Retro Panda Black White DD1391-100 Men's US 10 #${i}`));
  page1[0] = summary("300001", "Nike Dunk Low Retro Panda DD1391-100 Men's Sizes", { itemGroupHref: "https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group?item_group_id=300001", itemGroupType: "SELLER_DEFINED_VARIATIONS" });
  page1[1] = summary("300002", "Nike Dunk Low Retro Panda Men's Shoes");
  page1[2] = summary("300003", "Nike Dunk Low Retro Black White DD1391-600 Men's US 10");
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "t", expires_in: 7200 });
    urls.push(url);
    if (url.pathname.endsWith("item_summary/search")) {
      if (url.searchParams.get("q") !== "DD1391-100") throw new Error("title searches should be skipped");
      return Response.json(url.searchParams.get("offset") === "200" ? { total: 230, itemSummaries: page1.slice(3, 33).map((s, i) => ({ ...s, itemId: `v1|${400000 + i}|0` })) } : { total: 230, itemSummaries: page1 });
    }
    if (url.pathname.endsWith("get_items_by_item_group"))
      return Response.json({ items: [
        { ...summary("300001", "Nike Dunk Low Retro Panda DD1391-100 Men's Sizes"), itemId: "v1|300001|10", price: { value: "69.97", currency: "USD" }, localizedAspects: [{ name: "US Shoe Size", value: "10" }], estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK" }] },
        { ...summary("300001", "Nike Dunk Low Retro Panda DD1391-100 Men's Sizes"), itemId: "v1|300001|11", localizedAspects: [{ name: "US Shoe Size", value: "10" }], estimatedAvailabilities: [{ estimatedAvailabilityStatus: "OUT_OF_STOCK" }] },
      ] });
    if (url.pathname.includes("/item/v1"))
      return Response.json({ localizedAspects: [{ name: "US Shoe Size", value: "10" }, { name: "Department", value: "Men" }, { name: "Style Code", value: "DD1391-100" }] });
    throw new Error("unexpected " + url);
  };
  const provider = createEbayProvider({ clientId: "id", clientSecret: "secret", environment: "production", productionApproved: true, fetcher, now: () => now });
  const result = await provider.search(coded);
  assert.equal(result.status, "available");
  assert.deepEqual(result.searchDiagnostics!.attempts.map((a) => [a.stage, a.limit, a.returned]), [["S1", 200, 200], ["S2", 200, 30]]);
  assert.ok(result.warnings.some((w) => /Title searches skipped/.test(w)));
  const e = result.searchDiagnostics!.enrichment!;
  assert.equal(e.groupsChecked, 1);
  assert.equal(e.variationsFound, 1);
  assert.equal(e.variationsOutOfStock, 1);
  assert.equal(e.detailsChecked, 1);
  assert.equal(e.detailsWithStyleCode, 1);
  assert.equal(result.comparables.find((c) => c.id === "v1|300001|10")?.price, 69.97);
  assert.ok(!result.comparables.some((c) => c.id === "v1|300001|11"));
  assert.equal(result.comparables.find((c) => c.id === "v1|300002|0")?.priceEligible, true);
  // A different code is never looked up.
  assert.ok(!urls.some((u) => u.pathname.includes(encodeURIComponent("v1|300003|0"))));
  assert.equal(result.comparables.find((c) => c.id === "v1|300003|0")?.priceEligible, false);
  // Page 2 is skipped when page 1 isn't full.
  const small: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "t", expires_in: 7200 });
    if (url.searchParams.get("offset")) throw new Error("page 2 should be skipped");
    return Response.json({ total: 3, itemSummaries: page1.slice(3, 6) });
  };
  const few = await createEbayProvider({ clientId: "id", clientSecret: "secret", environment: "production", productionApproved: true, fetcher: small, now: () => now }).search(coded);
  assert.equal(few.searchDiagnostics!.attempts[0].stage, "S1");
  assert.ok(!few.searchDiagnostics!.attempts.some((a) => a.stage === "S2"));
});

test("a size-filtered search returns the matching variation's own id; the size check replaces that row instead of skipping it", async () => {
  // Seen live on 2026-11-17: the search returned v1|227526212328|526696519887, which is exactly the in-stock
  // size-10 variation of that multi-size listing. Treating it as already seen left every such listing unverified.
  const variationId = "v1|500001|526696519887";
  const summary = (itemId: string, extra: Record<string, unknown> = {}) => ({ itemId, title: "Nike Dunk Low Black White Panda Lace Up Athletic Sneakers DD1391-100 Men's Sizes", price: { value: "69.97", currency: "USD" }, condition: "New with box", conditionId: "1000", itemWebUrl: "https://www.ebay.com/itm/500001", buyingOptions: ["FIXED_PRICE"], seller: { username: "u500001" }, ...extra });
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "t", expires_in: 7200 });
    if (url.pathname.endsWith("item_summary/search"))
      return Response.json({ total: 1, itemSummaries: [summary(variationId, { itemGroupHref: "https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group?item_group_id=500001", itemGroupType: "SELLER_DEFINED_VARIATIONS" })] });
    if (url.pathname.endsWith("get_items_by_item_group"))
      return Response.json({ items: [
        { ...summary("v1|500001|526696519886"), localizedAspects: [{ name: "US Shoe Size", value: "9.5" }], estimatedAvailabilities: [{ estimatedAvailabilityStatus: "OUT_OF_STOCK" }] },
        { ...summary(variationId), itemWebUrl: "https://www.ebay.com/itm/500001?var=526696519887", localizedAspects: [{ name: "US Shoe Size", value: "10" }, { name: "Style Code", value: "DD1391-100" }], estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK" }] },
      ] });
    return new Response("not found", { status: 404 });
  };
  const result = await createEbayProvider({ clientId: "id", clientSecret: "secret", environment: "production", productionApproved: true, fetcher, now: () => now }).search(coded);
  const rows = result.comparables.filter((c) => c.id === variationId);
  assert.equal(rows.length, 1, "replaced, not duplicated");
  assert.equal(rows[0].priceEligible, true);
  assert.equal(rows[0].itemGroupId, undefined);
  assert.equal(rows[0].aspects?.source, "ebay-item-group");
  assert.equal(result.searchDiagnostics!.enrichment!.variationsFound, 1);
  assert.match(result.diagnostics!.rows.find((r) => r.id === variationId)!.stage, /eBay size variation/);
});
