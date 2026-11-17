import { tierComparable } from "./ebay-search";
import { matchMercari } from "./mercari-matching";
import { conditionGroup, sizingGroupConflict } from "./product-matching";
import type { Comparable, MarketplaceResult, ProductQuery } from "./marketplaces";

/**
 * Sorts one marketplace's listings of the same product into how closely they match the seller's item:
 * same size and condition, same size in another condition, and same condition in other or unstated sizes.
 *
 * It only reuses the existing matching rules and never produces a price: the recommendation and its
 * thresholds stay with the pricing engine. Listings of another product, edition, colorway, sizing group
 * (women's, kids') or multi-size listings never appear here.
 */
export type TierListing = {
  id: string;
  title: string;
  price: number;
  url: string;
  image: string | null;
  condition: string;
  size: string;
  sizeSource: "listing details" | "title" | "not stated";
  box: "stated" | "no box" | "not mentioned";
  usedForPrice: boolean;
};
export type ComparisonTier = { listings: TierListing[]; low: number | null; high: number | null; sellers: number };
export type ComparisonTiers = {
  provider: "ebay" | "mercari";
  size: string;
  condition: string;
  exact: ComparisonTier;
  sameSizeOtherCondition: ComparisonTier;
  sameConditionOtherSize: ComparisonTier;
  /** Matching listings whose size or condition couldn't be compared with the seller's item. */
  unplaced: number;
};

const CONDITION_LABEL: Record<string, string> = { new: "new", used: "used", refurbished: "refurbished", parts: "for parts" };
const OTHER_SIZE = new Set(["size_mismatch", "size_evidence_conflict"]);

export function comparisonTiers(
  result: Pick<MarketplaceResult, "provider" | "comparables">,
  q: ProductQuery,
  usedIds: string[] = [],
): ComparisonTiers | null {
  const d = q.details;
  if (!d.size.trim() || !d.condition) return null;
  const match = result.provider === "mercari" ? matchMercari : tierComparable;
  const product = [q.identification.model, q.identification.productName].join(" ");
  // Same product, colors and edition, with size, condition and box left open.
  const open: ProductQuery = { ...q, details: { ...d, size: "", sizeSystem: "", condition: "", packaging: "" } };
  // Size checked, condition and box left open.
  const sized: ProductQuery = { ...q, details: { ...d, condition: "", packaging: "" } };
  const used = new Set(usedIds);
  type Placed = { listing: TierListing; seller: string | null };
  const exact: Placed[] = [], sameSize: Placed[] = [], sameCondition: Placed[] = [];
  let unplaced = 0;
  const seen = new Set<string>();
  for (const row of result.comparables) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    // Rematch from source facts, keeping only the provider's price-integrity warnings.
    const source: Comparable = { ...row, quality: undefined, matchReasons: [], warnings: row.warnings.filter((w) => /^Variation selection unverified|^Conflicting duplicate listing|^Seller identifier unavailable|^Condition unavailable/.test(w)) };
    const sameProduct = match(source, open);
    if (!sameProduct.item || sameProduct.item.matchTier === "related" || !sameProduct.item.priceEligible) continue;
    if (sizingGroupConflict(source, d.sizeSystem, product)) continue;
    const sizeCheck = match(source, sized);
    const sizeState = sizeCheck.item?.priceEligible ? "same" : OTHER_SIZE.has(sizeCheck.reason) ? "other" : "unknown";
    const group = conditionGroup(source.conditionId);
    if (!group) {
      unplaced++;
      continue;
    }
    const listing = { listing: toListing(source, used.has(source.id)), seller: source.seller };
    if (sizeState === "same" && group === d.condition) exact.push(listing);
    else if (sizeState === "same") sameSize.push(listing);
    else if (group === d.condition) sameCondition.push(listing);
    else unplaced++;
  }
  return {
    provider: result.provider,
    size: [d.size, d.sizeSystem].filter(Boolean).join(" "),
    condition: CONDITION_LABEL[d.condition] || d.condition,
    exact: summarize(exact),
    sameSizeOtherCondition: summarize(sameSize),
    sameConditionOtherSize: summarize(sameCondition),
    unplaced,
  };
}

function toListing(c: Comparable, usedForPrice: boolean): TierListing {
  const titleSize = /\b(?:size|sz|us|mens|men'?s|men)\s*:?\s*(\d{1,2}(?:\.5)?)(?![\d.])|\b(\d{1,2}(?:\.5)?)\s*m\b/i.exec(c.title.replace(/[’']/g, ""));
  const size = c.aspects?.size ? `Size ${c.aspects.size}` : titleSize ? `Size ${Number(titleSize[1] ?? titleSize[2])}` : "Size not stated";
  const t = c.title.toLowerCase();
  const titleNoBox = /\b(no box|without box|replacement box)\b/.test(t);
  const titleBox = /\b(with box|original box|og box|new in box|nib|bnib)\b/.test(t);
  const ebayBox = c.conditionId === "1000" && /\bnew with box\b/i.test(c.condition);
  const box: TierListing["box"] = titleNoBox || c.statedPackaging === "none" || (c.conditionId === "1500" && /without box/i.test(c.condition)) ? "no box" : titleBox || ebayBox || c.statedPackaging === "original" ? "stated" : "not mentioned";
  return { id: c.id, title: c.title, price: c.price, url: c.url, image: c.image ?? null, condition: c.condition, size, sizeSource: c.aspects?.size ? "listing details" : titleSize ? "title" : "not stated", box, usedForPrice };
}

function summarize(placed: { listing: TierListing; seller: string | null }[]): ComparisonTier {
  const sorted = placed.map((p) => p.listing).sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
  const sellers = new Set(placed.map((p) => p.seller).filter(Boolean)).size;
  return { listings: sorted, low: sorted[0]?.price ?? null, high: sorted.at(-1)?.price ?? null, sellers };
}
