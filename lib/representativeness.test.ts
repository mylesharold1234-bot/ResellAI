import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tierComparable } from "./ebay-search";
import { scoreComparable } from "./comparable-quality";
import { recommend, sampleCoverage } from "./valuation";
import { createEbayProvider, ebayBudgetFromEnv } from "./marketplace-providers/ebay";
import { emptyMatchDetails, type Comparable, type MarketplaceResult, type ProductQuery } from "./marketplaces";
import { PricingPanel } from "../components/pricing-panel";

/**
 * Regression tests from the 2026-11-17 coverage investigation (Nike Dunk Low Panda DD1391-100, US Men's 10,
 * new with box). eBay listed about 522 such pairs; the app had been pricing from the first 100 in Best Match
 * order, which leaned cheap ($70), while the fuller verified sample asks $55–$189+.
 */
const now = Date.parse("2026-11-17T18:00:00Z");
const stamp = new Date(now).toISOString();
const identification = { brand: "Nike", productName: "Nike Dunk Low sneaker", category: "sneaker", model: "Dunk Low", colorway: "black and white", visibleCondition: "appears new or gently used with no visible wear", identifyingInformation: null, confidence: "high" as const, uncertainties: [], additionalEvidence: [] };
const asAppKnew: ProductQuery = { identification, details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: "new", packaging: "original" } };
const withCode: ProductQuery = { ...asAppKnew, details: { ...asAppKnew.details, productIdentifier: "DD1391-100", productIdentifierVerified: true } };

type Row = { id: string; title: string; price: number; condition: string | null; conditionId: string | null; seller: string | null; group?: boolean };
type Fixture = { query: string; reportedTotal: number; pages: Row[][] };
const load = (name: string) => JSON.parse(readFileSync(new URL("./test-support/" + name, import.meta.url), "utf8")) as Fixture;
const toListing = (r: Row): Comparable => ({
  id: r.id, title: r.title, price: r.price, currency: "USD", status: "asking", condition: r.condition ?? "Not specified", conditionId: r.conditionId ?? "",
  url: "https://www.ebay.com/itm/" + r.id.slice(1), observedAt: stamp, shipping: null, seller: r.seller, categories: [], matchReasons: [],
  // These came from eBay's size-filtered search; multi-size listings still need their own variation's size.
  ...(r.group ? { itemGroupId: r.id.slice(1), warnings: ["Variation selection unverified; excluded from pricing statistics"] } : { warnings: [], aspects: { source: "ebay-size-filter" as const, size: "10", sizeSystem: "US", department: "Men" } }),
});
function replay(fixture: Fixture, q: ProductQuery, pages = fixture.pages.length): MarketplaceResult {
  const rows = fixture.pages.slice(0, pages).flat();
  const comparables = rows.flatMap((r) => { const m = tierComparable(toListing(r), q); return m.item ? [{ ...m.item, quality: scoreComparable(m.item) }] : []; });
  const read = fixture.pages.slice(0, pages).reduce((n, p) => n + p.length, 0);
  return {
    provider: "ebay", status: "available", environment: "production", query: fixture.query, comparables, retrievedAt: stamp, expiresAt: new Date(now + 3600e3).toISOString(), cached: false, examined: read, excluded: 0, invalid: 0, warnings: [],
    searchDiagnostics: { cacheKey: "fixture", attempts: fixture.pages.slice(0, pages).map((p, i) => ({ stage: "S" + (i + 1), query: fixture.query, filter: "", limit: 200, returned: p.length })), exact: 0, close: 0, related: 0,
      coverage: { reportedTotal: fixture.reportedTotal, read, exhausted: read >= fixture.reportedTotal, query: fixture.query } },
  };
}
const panel = (rec: ReturnType<typeof recommend>) => renderToStaticMarkup(createElement(PricingPanel, { recommendation: rec, expired: false, details: { size: "10", condition: "new", packaging: "original" } }));

test("generic query, first 200 of about 3,580: the $70 is labeled an estimate from a partial Best Match sample", () => {
  const rec = recommend(replay(load("ebay-dunk-low-bw-size10-2026-11-17.json"), asAppKnew), asAppKnew, undefined, now);
  // Thresholds are unchanged, so the tight cheap-leaning cluster still yields a number ...
  assert.equal(rec.suggestedListingPrice, 70);
  // ... but never as a confident whole-market price.
  assert.equal(rec.sampleCoverage?.partial, true);
  assert.equal(rec.provisional, true);
  assert.ok(rec.reasons.some((r) => /Partial sample: the first 200 of about 3580 results in eBay Best Match order/.test(r)));
  const html = panel(rec);
  assert.match(html, /Estimate/);
  assert.doesNotMatch(html, /Price found/);
  assert.match(html, /we checked the first 200 of about 3,580 eBay results, in eBay(&#x27;|')s Best Match order, not the whole market/);
  assert.match(html, /Add the style code from the box or tag/);
});

test("style-code page 1 without the code: no $70 from a small 'unspecified' subgroup when the main group is dispersed", () => {
  const rec = recommend(replay(load("ebay-dd1391-100-size10-2026-11-17.json"), asAppKnew, 1), asAppKnew, undefined, now);
  // Before the fix this returned $70 from 8 listings whose titles don't say "Retro".
  assert.equal(rec.suggestedListingPrice, null);
  assert.ok(rec.blockers.some((b) => /vary too widely/.test(b)));
  assert.ok(rec.pricingDiagnostics.blockedCohorts.some((b) => b.cohort === "new|low/unspecified" && b.becauseOf === "new|low/retro"));
  assert.equal(rec.variantCohort, "low/retro");
});

test("style code confirmed, two pages (400 of 522): the verified market is dispersed, so the spread is shown, not a price", () => {
  const fixture = load("ebay-dd1391-100-size10-2026-11-17.json");
  const result = replay(fixture, withCode);
  const coverage = sampleCoverage(result);
  assert.equal(coverage.partial, false, "77% of what eBay reports is a representative sample");
  const rec = recommend(result, withCode, undefined, now);
  assert.equal(rec.suggestedListingPrice, null);
  assert.ok(rec.blockers.some((b) => /vary too widely/.test(b)));
  // 88 verified asks from 86 sellers, $55–$189 after 3 extreme outliers: too wide for one fair price.
  assert.deepEqual(rec.askingDistribution, { count: 88, sellers: 86, min: 54.99, p25: 78, median: 92.62, p75: 121.12, max: 188.99, outliers: 3 });
  // Every listing in the evidence is a confirmed DD1391-100, size 10, new with box.
  const used = new Set(rec.pricingDiagnostics.prices.length ? rec.eligibleIds : []);
  for (const c of result.comparables.filter((x) => used.has(x.id))) {
    assert.match(c.title, /DD1391[- ]?100/i);
    assert.equal(c.conditionId, "1000");
  }
  const html = panel(rec);
  assert.match(html, /Not a recommendation/);
  assert.match(html, /Middle half asks \$\d+–\$\d+/);
  assert.match(html, /verified listings/);
  assert.doesNotMatch(html, /Price found|Estimate/);
  assert.doesNotMatch(html, /class="market-price">\$/);
});

test("the original Nov 15 $70 (a full first page of 100) is an estimate, not a confident price", () => {
  const { query, rows } = JSON.parse(readFileSync(new URL("./test-support/ebay-dunk-low-panda-10-sized-2026-11-15.json", import.meta.url), "utf8")) as { query: ProductQuery; rows: (Row & { aspects?: Comparable["aspects"]; variation?: boolean })[] };
  const comparables = rows.flatMap((r) => {
    const source: Comparable = { ...toListing({ ...r, group: r.variation }), ...(r.aspects ? { aspects: r.aspects } : {}) };
    const m = tierComparable(source, query);
    return m.item ? [{ ...m.item, quality: scoreComparable(m.item) }] : [];
  });
  // Saved before totals were recorded: one full page of 100 is all that's known.
  const result: MarketplaceResult = { provider: "ebay", status: "available", environment: "production", query: "nike dunk low black white", comparables, retrievedAt: stamp, expiresAt: new Date(now + 3600e3).toISOString(), cached: false, examined: 100, excluded: 0, invalid: 0, warnings: [],
    searchDiagnostics: { cacheKey: "nov15", attempts: [{ stage: "S", query: "nike dunk low black white", filter: "", limit: 100, returned: 100 }], exact: 0, close: 0, related: 0 } };
  const rec = recommend(result, query, undefined, now);
  assert.equal(rec.suggestedListingPrice, 70);
  assert.equal(rec.sampleCoverage?.partial, true);
  const html = panel(rec);
  assert.match(html, /Estimate/);
  assert.doesNotMatch(html, /Price found/);
});

test("the eBay request budget is configurable and clamped", async () => {
  assert.deepEqual(ebayBudgetFromEnv({}), { pages: 2, variationChecks: 10, detailChecks: 10, hourlyRequests: 100 });
  assert.deepEqual(ebayBudgetFromEnv({ EBAY_STYLE_CODE_PAGES: "5", EBAY_VARIATION_CHECKS: "-3", EBAY_DETAIL_CHECKS: "abc", EBAY_HOURLY_REQUEST_LIMIT: "500" }), { pages: 2, variationChecks: 0, detailChecks: 10, hourlyRequests: 500 });
  const urls: URL[] = [];
  const summary = (id: number, extra: Record<string, unknown> = {}) => ({ itemId: `v1|${id}|0`, title: `Nike Dunk Low Retro Panda Black White DD1391-100 Men's US 10 #${id}`, price: { value: String(60 + (id % 40)), currency: "USD" }, condition: "New with box", conditionId: "1000", itemWebUrl: `https://www.ebay.com/itm/${id}`, buyingOptions: ["FIXED_PRICE"], seller: { username: "u" + id }, ...extra });
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "t", expires_in: 7200 });
    urls.push(url);
    if (url.pathname.endsWith("item_summary/search")) return Response.json({ total: 522, itemSummaries: Array.from({ length: 200 }, (_, i) => summary(1000 + i + Number(url.searchParams.get("offset") || 0), i < 5 ? { itemGroupHref: `https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group?item_group_id=${900000 + i}`, itemGroupType: "SELLER_DEFINED_VARIATIONS" } : {})) });
    return Response.json({ items: [] });
  };
  const provider = createEbayProvider({ clientId: "id", clientSecret: "secret", environment: "production", productionApproved: true, fetcher, now: () => now, budget: { pages: 1, variationChecks: 2, detailChecks: 0 } });
  const result = await provider.search(withCode);
  assert.deepEqual(result.searchDiagnostics!.attempts.map((a) => a.stage), ["S1"]);
  assert.equal(urls.filter((u) => u.pathname.endsWith("get_items_by_item_group")).length, 2);
  assert.equal(urls.filter((u) => /\/item\/v1/.test(u.pathname)).length, 0);
  assert.deepEqual(result.searchDiagnostics!.coverage, { reportedTotal: 522, read: 200, exhausted: false, query: "DD1391-100" });
  assert.equal(sampleCoverage(result).partial, true);
});
