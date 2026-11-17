import type { Comparable, MarketplaceResult } from "./marketplaces";
import { listedAgoLabel, listingAge } from "./listing-age";

/**
 * Display helpers for the comparable-listing browser. Pure and client-safe: nothing here changes which
 * listings are matched or priced. It only explains, in plain words, what the pricing engine already decided.
 */

export type BrowserEvidence = {
  provider: "ebay" | "mercari";
  result: MarketplaceResult;
  recommendation: {
    eligibleCount: number;
    eligibleIds: string[];
    outlierIds: string[];
    suggestedListingPrice: number | null;
    marketReference?: { listingIds: string[] } | null;
  };
};

export type ListingUse = "price" | "reference" | "not-used";

export type BrowserRow = {
  id: string;
  provider: "ebay" | "mercari";
  marketplace: "eBay" | "Mercari";
  title: string;
  price: number;
  url: string;
  image: string | null;
  condition: string;
  size: ListingSize;
  use: ListingUse;
  /** Why a listing wasn't used for the price, in a seller's words. Empty when it was used. */
  why: string;
  /** "Listed 3 years ago", from the original listing date; "Listing date unknown" otherwise. */
  listed: string;
  score: number;
};

export type ListingSize = { kind: "single" | "multi" | "unknown"; label: string; value: string | null };

const SIZE = String.raw`\d{1,2}(?:\.5)?`;

/** The shoe size a title states, if it states exactly one. Never guesses a size the title doesn't give. */
export function listingSize(title: string): ListingSize {
  const t = title.toLowerCase().replace(/[’']/g, "");
  if (
    /\bsizes\b|\b(?:choose|select|multiple|various|all) (?:your )?sizes?\b/.test(t) ||
    new RegExp(String.raw`\b${SIZE}\s*/\s*${SIZE}\s*/\s*${SIZE}\b`).test(t) ||
    new RegExp(String.raw`\bsize\s*${SIZE}\s*(?:-|–|to)\s*${SIZE}\b`).test(t)
  )
    return { kind: "multi", label: "Several sizes", value: null };
  const found = new Set<string>();
  const add = (s: string) => {
    const n = Number(s);
    if (n >= 1 && n <= 18) found.add(String(n));
  };
  // "Size 10", "sz 10", "US 10", "Men's 10", "M 10"
  for (const m of t.matchAll(new RegExp(String.raw`\b(?:size|sz|us|mens|men|m)\s*:?\s*(${SIZE})(?![\d.])`, "g"))) add(m[1]);
  // "10M", "10 US", "10 mens" (but not a women's conversion like "11.5W")
  for (const m of t.matchAll(new RegExp(String.raw`\b(${SIZE})\s*(?:m|us|mens|men)\b`, "g"))) add(m[1]);
  if (!found.size) return { kind: "unknown", label: "Size not stated", value: null };
  // Two numbers (often a women's/men's conversion written loosely) — don't pick one.
  if (found.size > 1) return { kind: "unknown", label: "Size unclear", value: null };
  const value = [...found][0];
  return { kind: "single", label: `Size ${value}`, value };
}

/** Plain-language reasons for the engine's match codes. Unknown codes fall back to a neutral phrase. */
const REASONS: Record<string, string> = {
  condition_mismatch: "Different condition",
  condition_unverified: "Condition not stated",
  unknown_condition: "Condition not stated",
  size_mismatch: "Different size",
  size_evidence_conflict: "Title and listing details disagree on size",
  size_unverified: "Size not confirmed from the title",
  size_selection_unverified: "Several sizes in one listing",
  size_or_sizing_group_unverified: "Size not confirmed from the title",
  sizing_group_unverified: "Men's or women's sizing not stated",
  sizing_group_mismatch: "Different sizing (men's/women's/kids)",
  sizing_system_unverified: "US sizing not stated",
  sizing_system_mismatch: "Different size system (UK/EU)",
  variation_price_unverified: "Several sizes, one price",
  multiple_sizes_listed: "Several sizes in one listing",
  packaging_unverified_or_mismatch: "Box not mentioned in the title",
  colorway_mismatch: "Different colors",
  conflicting_colorway: "Different colors",
  youth_sizing_group_unconfirmed: "Kids' sizing",
  youth_size_group_unconfirmed: "Kids' sizing",
  incompatible_age_group: "Kids' sizing",
  distinct_edition_unconfirmed: "Different edition",
  incompatible_footwear_edition: "Different edition",
  incompatible_footwear_silhouette: "Different style",
  brand_or_model_mismatch: "Different model",
  identifier_mismatch: "Different style code",
  variant_mismatch: "Different version",
  damaged_or_incomplete: "Damaged or incomplete",
  specific_model_unconfirmed: "Model not confirmed",
  model_not_evidenced: "Model not stated",
};

export function reasonLabel(code: string | undefined | null) {
  if (!code) return "Not a close enough match";
  if (REASONS[code]) return REASONS[code];
  // The engine joins "missing evidence" notes with "; " for close listings that are otherwise eligible.
  if (/Shoe size and sizing system not confirmed/.test(code)) return "Size not confirmed";
  return "Not a close enough match";
}

/** The reason a listing was set aside, from the provider's own per-listing diagnostics or its warnings. */
function codeFor(c: Comparable, rows: Map<string, string>) {
  const fromRows = rows.get(c.id);
  if (fromRows) return fromRows;
  const w = c.warnings.find((x) => x.startsWith("Attribute uncertainty: "));
  if (w) return w.slice("Attribute uncertainty: ".length).split(";")[0];
  if (c.warnings.some((x) => x.startsWith("Variation selection unverified"))) return "variation_price_unverified";
  if (c.warnings.some((x) => /^Youth sizing group/.test(x))) return "youth_sizing_group_unconfirmed";
  return null;
}

export function browserRows(sources: BrowserEvidence[]): BrowserRow[] {
  const out: BrowserRow[] = [];
  for (const { provider, result, recommendation: rec } of sources) {
    const priced = new Set(rec.suggestedListingPrice !== null ? rec.eligibleIds : []);
    const reference = new Set(rec.marketReference?.listingIds ?? []);
    const outliers = new Set(rec.outlierIds);
    const rows = new Map<string, string>();
    for (const r of result.diagnostics?.rows ?? []) if (r.stage !== "deduplication" && !rows.has(r.id)) rows.set(r.id, r.reason);
    const seen = new Set<string>();
    for (const c of result.comparables) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const use: ListingUse = priced.has(c.id) ? "price" : reference.has(c.id) ? "reference" : "not-used";
      const why =
        use !== "not-used"
          ? ""
          : outliers.has(c.id)
            ? "Unusually high or low price"
            : c.matchTier === "related" || c.priceEligible === false
              ? reasonLabel(codeFor(c, rows))
              : "Outside the group used for the price";
      out.push({
        id: c.id,
        provider,
        marketplace: provider === "mercari" ? "Mercari" : "eBay",
        title: c.title,
        price: c.price,
        url: c.url,
        image: c.image ?? null,
        condition: c.condition,
        // The marketplace's own size (eBay item specifics, Mercari's size field) beats words in the title.
        size: c.aspects?.size ? { kind: "single", label: `Size ${c.aspects.size}`, value: c.aspects.size } : listingSize(c.title),
        use,
        why,
        listed: listedAgoLabel(listingAge(c)),
        score: c.quality?.score ?? 0,
      });
    }
  }
  const rank: Record<ListingUse, number> = { price: 0, reference: 1, "not-used": 2 };
  return out.sort((a, b) => rank[a.use] - rank[b.use] || b.score - a.score || a.price - b.price || a.id.localeCompare(b.id));
}

export type BrowserFilter = { marketplace: "all" | "ebay" | "mercari"; show: "used" | "close" | "all"; yourSize: boolean };

export function filterRows(rows: BrowserRow[], f: BrowserFilter, size?: string) {
  const wanted = size?.trim() ? String(Number(size)) : null;
  return rows.filter(
    (r) =>
      (f.marketplace === "all" || r.provider === f.marketplace) &&
      (f.show === "all" || (f.show === "used" ? r.use !== "not-used" : r.use !== "not-used" || r.score >= 60)) &&
      (!f.yourSize || !wanted || r.size.value === wanted),
  );
}

/** "174 checked · 0 used for the price" — never presents matched-but-unusable listings as "found". */
export function listingCounts(result: Pick<MarketplaceResult, "comparables" | "retrievalDiagnostics" | "diagnostics">, rec: { eligibleCount: number; suggestedListingPrice: number | null }) {
  const checked = result.retrievalDiagnostics?.uniqueListings ?? result.diagnostics?.normalized ?? result.comparables.length;
  const used = rec.suggestedListingPrice !== null ? rec.eligibleCount : 0;
  return { checked, used, label: `${checked} checked · ${used ? `${used} used for the price` : "none usable for a price"}` };
}
