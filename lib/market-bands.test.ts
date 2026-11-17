import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listingAge, listedAgoLabel, reliableDate } from "./listing-age";
import { tierComparable } from "./ebay-search";
import { scoreComparable } from "./comparable-quality";
import { recommend } from "./valuation";
import { createEbayProvider, normalizeEbaySearch } from "./marketplace-providers/ebay";
import { normalizeMercari } from "./marketplace-providers/mercari";
import { emptyMatchDetails, type Comparable, type MarketplaceResult, type ProductQuery } from "./marketplaces";
import { PricingPanel } from "../components/pricing-panel";

const observedAt = "2026-11-17T17:12:00.000Z";
const now = Date.parse(observedAt);
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const identification = { brand: "Nike", productName: "Nike Dunk Low sneaker", category: "sneaker", model: "Dunk Low", colorway: "black and white", visibleCondition: "appears new", identifyingInformation: null, confidence: "high" as const, uncertainties: [], additionalEvidence: [] };
const coded: ProductQuery = { identification, details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: "new", packaging: "original", productIdentifier: "DD1391-100", productIdentifierVerified: true } };

let n = 0;
const listing = (price: number, listedAt: string | undefined, o: Partial<Comparable> = {}): Comparable => ({
  id: `v1|${++n}|0`, title: `Nike Dunk Low Retro Panda Black White DD1391-100 Men's US 10 #${n}`, price, currency: "USD", status: "asking", condition: "New with box", conditionId: "1000",
  url: `https://www.ebay.com/itm/${n}`, observedAt, shipping: null, seller: "seller" + n, categories: [], matchReasons: [], warnings: [],
  aspects: { source: "ebay-size-filter", size: "10", sizeSystem: "US", department: "Men" },
  ...(listedAt ? { listedAt, listedAtSource: "ebay-original-listing" as const } : {}), ...o,
});
const priced = (rows: Comparable[], q = coded) => {
  const comparables = rows.flatMap((r) => { const m = tierComparable(r, q); return m.item ? [{ ...m.item, quality: scoreComparable(m.item) }] : []; });
  const result: MarketplaceResult = { provider: "ebay", status: "available", environment: "production", query: "q", comparables, retrievedAt: observedAt, expiresAt: new Date(now + 3600e3).toISOString(), cached: false, examined: rows.length, excluded: 0, invalid: 0, warnings: [] };
  return recommend(result, q, undefined, now);
};
const panel = (rec: ReturnType<typeof recommend>) => renderToStaticMarkup(createElement(PricingPanel, { recommendation: rec, expired: false, details: { size: "10", condition: "new", packaging: "original", productIdentifier: "DD1391-100", productIdentifierVerified: true } }));

test("listing age: only a reliable original date can make a listing recent", () => {
  const at = (listedAt: string | undefined, listedAtSource?: Comparable["listedAtSource"]) => listingAge({ listedAt, listedAtSource, observedAt });
  assert.deepEqual(at(undefined), { kind: "unknown", reason: "no date" });
  assert.deepEqual(at("not a date"), { kind: "unknown", reason: "unreliable date" });
  assert.deepEqual(at(daysAgo(-3)), { kind: "unknown", reason: "unreliable date" }, "a future date");
  assert.deepEqual(at("1990-01-01T00:00:00Z"), { kind: "unknown", reason: "unreliable date" }, "before eBay existed");
  assert.deepEqual(at(daysAgo(10), "ebay-original-listing"), { kind: "recent", days: 10 });
  assert.deepEqual(at(daysAgo(365), "ebay-original-listing"), { kind: "recent", days: 365 });
  assert.deepEqual(at(daysAgo(366), "ebay-original-listing"), { kind: "older", days: 366 });
  // A relisted copy's date is a lower bound: it can prove "older", never "recent".
  assert.deepEqual(at(daysAgo(20), "ebay-current-listing"), { kind: "unknown", reason: "relist date only" });
  assert.deepEqual(at(daysAgo(500), "ebay-current-listing"), { kind: "older", days: 500 });
  assert.equal(at(daysAgo(20), "mercari-created").kind, "recent");
  assert.equal(listedAgoLabel(at(daysAgo(3), "ebay-original-listing")), "Listed 3 days ago");
  assert.equal(listedAgoLabel(at(daysAgo(1200), "ebay-original-listing")), "Listed 3 years ago");
  assert.equal(listedAgoLabel(at(daysAgo(600), "ebay-original-listing")), "Listed over a year ago");
  assert.equal(listedAgoLabel(at(daysAgo(200), "ebay-original-listing")), "Listed 7 months ago");
  assert.equal(listedAgoLabel(at(undefined)), "Listing date unknown");
  assert.equal(reliableDate(12345, observedAt), null);
});

test("marketplaces' own listing dates are recorded: eBay's original date first, Mercari's creation date", () => {
  const row = (extra: Record<string, unknown>) => ({ itemId: "v1|1|0", title: "Nike Dunk Low", price: { value: "70.00", currency: "USD" }, condition: "New with box", conditionId: "1000", itemWebUrl: "https://www.ebay.com/itm/1", buyingOptions: ["FIXED_PRICE"], seller: { username: "s" }, ...extra });
  const one = (extra: Record<string, unknown>) => normalizeEbaySearch({ total: 1, itemSummaries: [row(extra)] }, "production", observedAt).items[0];
  const relisted = one({ itemOriginDate: "2023-08-12T09:39:30.000Z", itemCreationDate: "2024-10-18T02:00:22.000Z" });
  assert.equal(relisted.listedAt, "2023-08-12T09:39:30.000Z");
  assert.equal(relisted.listedAtSource, "ebay-original-listing");
  const currentOnly = one({ itemCreationDate: "2026-09-17T18:31:08.000Z" });
  assert.equal(currentOnly.listedAtSource, "ebay-current-listing");
  assert.equal(listingAge(currentOnly).kind, "unknown");
  assert.equal(one({ itemOriginDate: "2099-01-01T00:00:00Z" }).listedAt, undefined);
  const [m] = normalizeMercari({ success: true, country: "US", items: [{ id: "m1", name: "Nike Dunk Low Panda", price: 80, currency: "USD", status: "on_sale", url: "https://www.mercari.com/us/item/m1/", condition: "New", created_at: "2026-09-06T17:23:03.000Z" }] }, observedAt).items;
  assert.equal(m.listedAt, "2026-09-06T17:23:03.000Z");
  assert.equal(m.listedAtSource, "mercari-created");
});

type Row = { id: string; title: string; price: number; condition: string | null; conditionId: string | null; seller: string | null; group?: boolean; listedAt?: string };
const fixture = JSON.parse(readFileSync(new URL("./test-support/ebay-dd1391-100-size10-2026-11-17.json", import.meta.url), "utf8")) as { pages: Row[][]; reportedTotal: number };
const fromFixture = (keepDates = true): Comparable[] => fixture.pages.flat().map((r) => ({
  id: r.id, title: r.title, price: r.price, currency: "USD" as const, status: "asking" as const, condition: r.condition ?? "Not specified", conditionId: r.conditionId ?? "", url: "https://www.ebay.com/itm/" + r.id.slice(1), observedAt, shipping: null, seller: r.seller, categories: [], matchReasons: [],
  ...(r.group ? { itemGroupId: r.id.slice(1), warnings: ["Variation selection unverified; excluded from pricing statistics"] } : { warnings: [], aspects: { source: "ebay-size-filter" as const, size: "10", sizeSystem: "US", department: "Men" } }),
  ...(keepDates && r.listedAt ? { listedAt: r.listedAt, listedAtSource: "ebay-original-listing" as const } : {}),
}));

test("Dunk Low Panda benchmark: recent reference band, older listings apart, official price still withheld", () => {
  const rec = priced(fromFixture());
  // The existing safeguard is unchanged: no single recommended price.
  assert.equal(rec.suggestedListingPrice, null);
  assert.ok(rec.blockers.some((b) => /vary too widely/.test(b)));
  const b = rec.marketBands!;
  assert.equal(b.windowDays, 365);
  // Recent: first listed within a year. The engine's outlier filter, applied to these alone, leaves out
  // 4 extreme recent asks.
  assert.deepEqual(b.recent, { count: 38, sellers: 37, outliers: 4, sufficient: true, p25: 70, median: 79.99, p75: 90.18, min: 54.99, max: 120 });
  // Older: up for over a year (mostly 3–4 years), shown separately and never mixed into the recent band.
  assert.deepEqual(b.older, { count: 48, sellers: 48, outliers: 1, sufficient: true, p25: 88.74, median: 116.99, p75: 134.97, min: 59.99, max: 249.97 });
  assert.deepEqual(b.undated, { count: 0, sellers: 0 });
  const html = panel(rec);
  assert.match(html, /Reference only/);
  assert.match(html, /Asking prices, not sale prices/);
  assert.match(html, /Recent listings/);
  assert.match(html, /Lower quarter[\s\S]*\$70[\s\S]*Median[\s\S]*\$80[\s\S]*Upper quarter[\s\S]*\$90/);
  assert.match(html, /38 listings from 37 sellers · 4 extreme asks left out/);
  assert.match(html, /Older listings[\s\S]*up for over a year, shown separately/);
  assert.match(html, /Middle half ask \$89–\$135 · median \$117/);
  assert.match(html, /aren(&#x27;|')t sale prices or a guide to how fast it will sell/);
  assert.doesNotMatch(html, /Price found|Estimate|Suggested/);
});

test("missing dates are never recent: an undated sample gets no recent band", () => {
  const rec = priced(fromFixture(false));
  assert.equal(rec.marketBands!.recent, null);
  assert.equal(rec.marketBands!.older, null);
  assert.ok(rec.marketBands!.undated.count >= 80);
  const html = panel(rec);
  // Without dated bands the existing undated spread is shown instead.
  assert.doesNotMatch(html, /Recent listings/);
  assert.match(html, /Not a recommendation/);
});

test("small samples get no quartiles, and an extreme recent ask is left out of the band", () => {
  const few = priced(Array.from({ length: 6 }, (_, i) => listing(70 + i * 3, daysAgo(20 + i))));
  assert.deepEqual(few.marketBands!.recent, { count: 6, sellers: 6, outliers: 0, sufficient: false });
  // With an official price and no older listings, there is nothing extra to show.
  assert.doesNotMatch(panel(few), /Recent listings/);
  // With older listings present, a thin recent sample is stated, not summarized.
  const thin = priced([...Array.from({ length: 6 }, (_, i) => listing(70 + i * 3, daysAgo(20 + i))), ...Array.from({ length: 8 }, (_, i) => listing(150 + i * 10, daysAgo(800 + i)))]);
  assert.equal(thin.marketBands!.recent!.sufficient, false);
  assert.match(panel(thin), /isn(&#x27;|')t enough for a reference band \(it needs 8 from 5 sellers\)/);
  // Eight from the same seller isn't enough sellers either.
  const oneSeller = priced(Array.from({ length: 9 }, (_, i) => listing(70 + i, daysAgo(10), { seller: "same" })));
  assert.equal(oneSeller.marketBands!.recent!.sufficient, false);
  const withOutlier = priced([...Array.from({ length: 10 }, (_, i) => listing(70 + i * 2, daysAgo(30 + i))), listing(450, daysAgo(12))]);
  const r = withOutlier.marketBands!.recent!;
  assert.equal(r.sufficient, true);
  assert.equal(r.outliers, 1);
  assert.equal(r.sufficient && r.max, 88);
});

test("bands only use the verified variant: other sizing groups, editions and colorways stay out", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => listing(78 + i, daysAgo(40 + i))),
    // Women's Panda (DD1503-101), GS (CW1590-100), the SE edition and SB Dunks: recent and cheaper or dearer.
    ...Array.from({ length: 4 }, (_, i) => listing(55 + i, daysAgo(5), { title: `Nike Dunk Low Black White DD1503-101 Women's US 10 #${i}` })),
    ...Array.from({ length: 4 }, (_, i) => listing(50 + i, daysAgo(5), { title: `Nike Dunk Low Black White CW1590-100 US 10 #${i}` })),
    ...Array.from({ length: 4 }, (_, i) => listing(120 + i, daysAgo(5), { title: `Nike Dunk Low Retro SE White Black IB2990-100 Men's US 10 #${i}` })),
    ...Array.from({ length: 4 }, (_, i) => listing(140 + i, daysAgo(5), { title: `Nike SB Dunk Low Pro White Black HF3704-100 Men's US 10 #${i}` })),
  ];
  const b = priced(rows).marketBands!;
  assert.equal(b.recent!.count, 10);
  assert.equal(b.recent!.sufficient && b.recent!.min, 78);
  assert.equal(b.recent!.sufficient && b.recent!.max, 87);
  // A different sneaker gets its own band from its own verified listings.
  const jordan: ProductQuery = { identification: { ...identification, productName: "Air Jordan 1 Mid", model: "Air Jordan 1 Mid", brand: "Jordan" }, details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: "new", packaging: "original" } };
  const aj = priced(Array.from({ length: 9 }, (_, i) => listing(110 + i * 2, daysAgo(60 + i), { title: `Nike Air Jordan 1 Mid Black White Men's US 10 with box #${i}` })), jordan).marketBands!;
  assert.equal(aj.recent!.count, 9);
  assert.equal(aj.recent!.sufficient && aj.recent!.median, 118);
});

test("a verified size variation keeps the listing's original date", async () => {
  const id = "v1|700001|526696519887";
  const summary = (itemId: string, extra: Record<string, unknown> = {}) => ({ itemId, title: "Nike Dunk Low Retro Panda Black White DD1391-100 Men's Sizes", price: { value: "69.97", currency: "USD" }, condition: "New with box", conditionId: "1000", itemWebUrl: "https://www.ebay.com/itm/700001", buyingOptions: ["FIXED_PRICE"], seller: { username: "u" }, ...extra });
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "t", expires_in: 7200 });
    if (url.pathname.endsWith("item_summary/search")) return Response.json({ total: 1, itemSummaries: [summary(id, { itemOriginDate: "2022-11-01T00:00:00.000Z", itemCreationDate: "2026-09-17T18:31:08.000Z", itemGroupHref: "https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group?item_group_id=700001", itemGroupType: "SELLER_DEFINED_VARIATIONS" })] });
    if (url.pathname.endsWith("get_items_by_item_group"))
      return Response.json({ items: [{ ...summary(id), itemCreationDate: "2026-09-17T18:31:08.000Z", localizedAspects: [{ name: "US Shoe Size", value: "10" }], estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK" }] }] });
    return new Response("not found", { status: 404 });
  };
  const result = await createEbayProvider({ clientId: "id", clientSecret: "secret", environment: "production", productionApproved: true, fetcher, now: () => now }).search(coded);
  const row = result.comparables.find((c) => c.id === id)!;
  assert.equal(row.priceEligible, true);
  assert.equal(row.listedAt, "2022-11-01T00:00:00.000Z");
  assert.equal(row.listedAtSource, "ebay-original-listing");
  assert.equal(listingAge(row).kind, "older");
});
