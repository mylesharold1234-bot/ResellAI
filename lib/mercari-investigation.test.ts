// Regression coverage for the Nike Dunk Low Mercari "Price unavailable" investigation (2026-11-14 snapshot).
// Titles and prices below are copied from that saved snapshot. No API calls are made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyMatchDetails, type Comparable, type ProductQuery } from "./marketplaces";
import { matchMercari, multipleSizesListed } from "./mercari-matching";
import { explainPricing } from "./pricing-explanation";

const query: ProductQuery = {
  identification: { brand: "Nike", productName: "Nike Dunk Low Sneakers", category: "Sneakers", model: "Dunk Low", colorway: "Black and White", visibleCondition: "New or very lightly worn", identifyingInformation: null, confidence: "high", uncertainties: [], additionalEvidence: [] },
  details: { ...emptyMatchDetails },
};
const listing = (id: string, title: string, price: number): Comparable => ({
  id, title, price, currency: "USD", status: "asking", condition: "New", conditionId: "1", url: "https://www.mercari.com/us/item/" + id, observedAt: "2026-11-14T17:27:49.893Z",
  shipping: 0, seller: "s-" + id, categories: ["Shoes"], matchReasons: [], warnings: [],
});

test("a Nike Dunk Low Pro SB is not priced as a regular Dunk Low", () => {
  const sb = matchMercari(listing("m1", "(0300) Nike Dunk Low Pro SB Black White Gum - Size 11M/12.5W (HF3704-003)", 139.99), query);
  assert.equal(sb.item?.matchTier, "related");
  assert.equal(sb.item?.priceEligible, false);
  const regular = matchMercari(listing("m2", "Nike Dunk Low Retro Black White Panda", 68.64), query);
  assert.notEqual(regular.item?.matchTier, "related", "a regular Dunk Low still matches");
  const wantsSb = matchMercari(listing("m3", "Nike SB Dunk Low Pro Black White Gum", 120), { ...query, identification: { ...query.identification, model: "SB Dunk Low Pro", productName: "Nike SB Dunk Low" } });
  assert.notEqual(wantsSb.reason, "distinct_edition_unconfirmed", "searching for an SB Dunk keeps SB listings");
});

test("a listing offering several sizes can't price one pair", () => {
  assert.equal(multipleSizesListed("Nike Dunk Low Retro White Black 'Panda' DD1391-100 Men's Sizes 4/4.5/5/5.5 New"), true);
  assert.equal(multipleSizesListed("Nike Dunk Low size 7-10 available"), true);
  assert.equal(multipleSizesListed("(0300) Nike Dunk Low Pro SB - Size 11M/12.5W"), false, "a men/women size conversion is one pair");
  assert.equal(multipleSizesListed("NEW Nike Dunk Low Retro 'Black/White Panda' DD1391-100 (Men’s Size 10.5)"), false);
  const multi = matchMercari(listing("m4", "Nike Dunk Low Retro White Black 'Panda' DD1391-100 Men's Sizes 4/4.5/5/5.5 New", 57), query);
  assert.equal(multi.item?.priceEligible, false);
});

test("Mercari price failures are explained plainly, without inventing a price", () => {
  const spread = explainPricing("Mercari", {
    suggestedListingPrice: null,
    blockers: ["The comparable prices vary too widely. Confirm the exact variant and condition to narrow the results."],
    statistics: { count: 7, median: 68.64, lowest: 36.12, highest: 122 },
  });
  assert.equal(spread.state, "unavailable");
  assert.equal(spread.headline, "Prices vary too much to recommend one.");
  assert.equal(spread.detail, "Similar Mercari listings range from $36 to $122, because they mix different sizes and conditions.");
  assert.equal(spread.suggestion, "Add the size and condition for a tighter estimate.");
  const sized = explainPricing("Mercari", { suggestedListingPrice: null, blockers: ["At least three eligible listings are needed. Confirm the model, variant and condition, then refresh comparisons."], statistics: null }, { size: "10", condition: "new" });
  assert.equal(sized.headline, "Not enough Mercari listings in size 10 to price this confidently.");
  assert.equal(sized.detail, "None of the Mercari listings found match your size and condition. A price needs at least 3.");
  const one = explainPricing("Mercari", { suggestedListingPrice: null, blockers: ["At least three eligible listings are needed. Confirm the model, variant and condition, then refresh comparisons."], statistics: { count: 1, median: 80.75, lowest: 80.75, highest: 80.75 }, eligibleCount: 1 }, { size: "10", condition: "new", packaging: "original" });
  assert.equal(one.detail, "Only 1 Mercari listing matches your size, condition and box. A price needs at least 3.");
  assert.match(one.suggestion || "", /Mercari listings by match/);
  assert.equal(explainPricing("eBay", { suggestedListingPrice: 65, blockers: [], statistics: { count: 9, median: 65, lowest: 55, highest: 77 }, eligibleCount: 9 }).state, "priced");
  assert.equal(explainPricing("eBay", null, undefined, { expired: true }).headline, "These prices are out of date.");
  for (const e of [spread, sized]) assert.ok(!/cohort|MAD|spread|eligible|safeguard/i.test(JSON.stringify(e)), "no developer jargon");
});

test("the real 2026-11-14 Dunk Low Mercari search: no price from a small subgroup when the main group is dispersed", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { pricingEngine } = await import("./pricing-engine");
  const fixture = JSON.parse(readFileSync(join(process.cwd(), "lib/test-support/mercari-dunk-low-2026-11-14.json"), "utf8"));
  const q: ProductQuery = { identification: fixture.identification, details: { ...emptyMatchDetails } };
  const matched = fixture.listings
    .map((l: { title: string; price: number; condition: string; conditionId: string; shipping: number | null }, i: number) =>
      matchMercari({ ...listing("f" + i, l.title, l.price), condition: l.condition, conditionId: l.conditionId, shipping: l.shipping }, q).item,
    )
    .filter(Boolean) as Comparable[];
  const result = { provider: "mercari" as const, status: "available" as const, environment: "production" as const, query: fixture.query, comparables: matched, retrievedAt: fixture.retrievedAt, expiresAt: fixture.expiresAt, cached: false, examined: 100, excluded: 3, invalid: 0, warnings: [] };
  const rec = pricingEngine(result, q, undefined, Date.parse(fixture.retrievedAt) + 60_000);
  // The earlier $79.31 came from 5 "New" listings whose titles don't say "Retro", standing in for the larger
  // "New Retro" group of the same shoe that asks $36-$122. That split isn't independent product evidence,
  // so no single price is given; the dispersed group's asking prices are shown instead (2026-11-17 fix).
  assert.equal(rec.suggestedListingPrice, null);
  assert.ok(rec.blockers.some((b) => /vary too widely/.test(b)));
  assert.deepEqual(rec.pricingDiagnostics.blockedCohorts, [{ cohort: "new|low/unspecified", becauseOf: "new|low/retro" }]);
  assert.ok(rec.reasons.some((r) => r.includes("Not priced from the smaller new · low/unspecified group")));
  assert.deepEqual(rec.askingDistribution, { count: 6, sellers: 6, min: 36.12, p25: 55.41, median: 73.32, p75: 90.75, max: 122, outliers: 0 });
  assert.ok(!rec.pricingDiagnostics.prices.includes(139.99), "the SB Dunk is not in the evidence");
  assert.ok(!rec.pricingDiagnostics.prices.includes(57), "the multi-size listing is not in the evidence");
  // The "Retro" listings genuinely span $36-$122 across mixed sizes; that group still can't set a price.
  const retro = matched.filter((c) => /retro/i.test(c.title) && c.condition === "New" && c.priceEligible !== false).map((c) => c.price);
  assert.ok(Math.max(...retro) / Math.min(...retro) > 2);
});
