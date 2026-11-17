import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { comparisonTiers } from "./comparison-tiers";
import { statedPackaging } from "./product-matching";
import { matchMercari } from "./mercari-matching";
import { scoreComparable } from "./comparable-quality";
import { recommend } from "./valuation";
import { createMarketplaceHandler } from "./marketplace-server";
import { mercariImage, normalizeMercari } from "./marketplace-providers/mercari";
import { emptyMatchDetails, type MarketplaceResult, type ProductQuery } from "./marketplaces";
import { ComparisonTiersView } from "../components/comparison-tiers";

const now = Date.parse("2026-11-15T18:00:00Z");
const stamp = new Date(now).toISOString();
const query: ProductQuery = {
  identification: { brand: "Nike", productName: "Nike Dunk Low sneaker", category: "sneaker", model: "Dunk Low", colorway: "black and white", visibleCondition: "appears new", identifyingInformation: null, confidence: "high", uncertainties: [], additionalEvidence: [] },
  details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: "new", packaging: "original" },
};

test("box status is read only from plain statements in a seller's description", () => {
  assert.equal(statedPackaging("Brand New In Original Box"), "original");
  assert.equal(statedPackaging("Comes with original box, tissue paper, and size tag intact"), "original");
  assert.equal(statedPackaging("Includes OG box"), "original");
  assert.equal(statedPackaging("Barely used size 9 W/ Box"), "original");
  assert.equal(statedPackaging("Good condition, worn, no box"), "none");
  assert.equal(statedPackaging("Ships without original box"), "none");
  assert.equal(statedPackaging("Box: No Box"), "none");
  assert.equal(statedPackaging("comes with replacement box"), "none");
  // Contradictory or irrelevant mentions prove nothing.
  assert.equal(statedPackaging("No original box included"), null);
  assert.equal(statedPackaging("light creasing on the toe box"), null);
  assert.equal(statedPackaging("OG laces for right shoe are in box"), null);
  assert.equal(statedPackaging("Panda colorway, worn twice"), null);
});

test("Mercari photos come only from Mercari's image host", () => {
  assert.equal(mercariImage({ thumbnail: "https://u-mercari-images.mercdn.net/photos/m1_1.jpg?1&width=200&height=200" }), "https://u-mercari-images.mercdn.net/photos/m1_1.jpg?1&width=200&height=200");
  assert.equal(mercariImage({ thumbnail: "https://evil.example/x.jpg", photos: ["https://u-mercari-images.mercdn.net/photos/m1_1.jpg"] }), "https://u-mercari-images.mercdn.net/photos/m1_1.jpg");
  assert.equal(mercariImage({ thumbnail: "http://u-mercari-images.mercdn.net/x.jpg" }), null);
  assert.equal(mercariImage({}), null);
});

type Row = { id: string; name: string; price: number; condition: string; size: string | null; category: string | null; seller: string | null; describedBox?: "original" | "none" };
function savedMercari(): MarketplaceResult {
  const { rows } = JSON.parse(readFileSync(new URL("./test-support/mercari-dunk-low-panda-10-2026-11-15.json", import.meta.url), "utf8")) as { rows: Row[] };
  const body = {
    success: true, country: "US",
    items: rows.map((r) => ({ id: r.id, name: r.name, price: r.price, currency: "USD", status: "on_sale", url: `https://www.mercari.com/us/item/${r.id}/`, condition: r.condition, seller_id: r.seller, size: r.size, categories: r.category ? [{ name: r.category }] : [],
      thumbnail: `https://u-mercari-images.mercdn.net/photos/${r.id}_1.jpg`, description: r.describedBox === "original" ? "Comes with original box" : r.describedBox === "none" ? "No box" : "" })),
  };
  const comparables = normalizeMercari(body, stamp).items.flatMap((i) => { const m = matchMercari(i, query); return m.item ? [{ ...m.item, quality: scoreComparable(m.item) }] : []; });
  return { provider: "mercari", environment: "production", status: "available", query: "nike dunk low panda mens size 10", comparables, retrievedAt: stamp, expiresAt: "2026-11-16T05:00:00.000Z", cached: true, examined: 100, excluded: 0, invalid: 0, warnings: [] };
}

test("saved Mercari search: tiers show the evidence without loosening the three-listing minimum", () => {
  const result = savedMercari();
  const rec = recommend(result, query, undefined, now);
  // Only one listing passes every check (size 10, men's, new, box stated); the minimum stays at three.
  assert.equal(rec.eligibleCount, 1);
  assert.equal(rec.suggestedListingPrice, null);
  assert.equal(rec.marketReference, null);
  const tiers = comparisonTiers(result, query, rec.suggestedListingPrice === null ? [] : rec.eligibleIds)!;
  assert.deepEqual(tiers.exact.listings.map((l) => [l.price, l.condition, l.size, l.box]), [[79.99, "New", "Size 10", "not mentioned"], [80.75, "New", "Size 10", "stated"]]);
  assert.equal(tiers.exact.sellers, 2);
  assert.deepEqual(tiers.sameSizeOtherCondition.listings.map((l) => l.condition).sort(), ["Fair", "Good", "Good", "Good"]);
  assert.equal(tiers.sameSizeOtherCondition.low, 28.5);
  assert.deepEqual(tiers.sameConditionOtherSize.listings.map((l) => l.size), ["Size 15"]);
  const all = [...tiers.exact.listings, ...tiers.sameSizeOtherCondition.listings, ...tiers.sameConditionOtherSize.listings];
  for (const l of all) {
    // Never another release, sizing group or a multi-size listing.
    assert.doesNotMatch(l.title, /\bSB\b|twist|women|\bGS\b|\b\d+y\b|sizes|reverse/i, l.title);
    assert.equal(l.sizeSource === "not stated" ? null : l.size.startsWith("Size "), l.sizeSource === "not stated" ? null : true);
    assert.match(l.url, /^https:\/\/www\.mercari\.com\/us\/item\/m\d+\/$/);
    assert.match(l.image!, /^https:\/\/u-mercari-images\.mercdn\.net\//);
    assert.equal(l.usedForPrice, false);
  }

  const html = renderToStaticMarkup(createElement(ComparisonTiersView, { tiers, marketplace: "Mercari", reference: rec.marketReference }));
  for (const heading of ["Same size and condition", "Same size, other conditions", "Same condition, other sizes", "Broader market reference"]) assert.match(html, new RegExp(heading));
  assert.match(html, /Fewer than 3, so Mercari can(&#x27;|')t recommend a price from these/);
  assert.ok(html.includes("2 listings · 2 sellers · asking $79.99–$80.75"));
  assert.match(html, /Box included/);
  assert.match(html, /Box not mentioned/);
  assert.match(html, /not sales/);
  assert.match(html, /Not available\. It needs at least 3 matching listings/);
  assert.doesNotMatch(html, /Price found|Suggested asking price|Used for the price/);
  assert.match(html, /href="https:\/\/www\.mercari\.com\/us\/item\/m\d+\/" target="_blank" rel="noopener noreferrer"/);
});

test("tiers need a confirmed size and condition, and the route returns them with every result", async () => {
  const result = savedMercari();
  assert.equal(comparisonTiers(result, { ...query, details: { ...query.details, size: "" } }), null);
  assert.equal(comparisonTiers(result, { ...query, details: { ...query.details, condition: "" } }), null);
  const handler = createMarketplaceHandler({ id: "mercari", search: async () => result });
  const response = await handler(new Request("http://localhost/api/marketplaces/mercari", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query) }));
  const body = await response.json();
  assert.equal(body.tiers.exact.listings.length, 2);
  assert.equal(body.recommendation.suggestedListingPrice, null);
});
