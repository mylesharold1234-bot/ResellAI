import type { MatchDetails } from "./marketplaces";

/** The parts of a pricing recommendation the explanation needs (kept narrow so it's easy to test). */
export type ExplainableRecommendation = {
  suggestedListingPrice: number | null;
  blockers: string[];
  statistics: { count: number; lowest: number; highest: number; median: number } | null;
  eligibleCount?: number;
};

export type PricingExplanation = {
  state: "priced" | "unavailable";
  /** One short sentence a seller understands at a glance. */
  headline: string;
  /** Why, in plain words. */
  detail?: string;
  /** What the seller can do about it, when anything helps. */
  suggestion?: string;
};

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/**
 * Turn the pricing engine's safeguards into a short, honest explanation for sellers. It never invents a
 * price: it only explains why one couldn't be recommended, using the engine's own evidence.
 */
export function explainPricing(
  marketplace: "eBay" | "Mercari",
  rec: ExplainableRecommendation | null | undefined,
  details: Pick<MatchDetails, "size" | "condition"> & Partial<Pick<MatchDetails, "packaging">> = { size: "", condition: "" },
  { expired = false }: { expired?: boolean } = {},
): PricingExplanation {
  if (expired) return { state: "unavailable", headline: "These prices are out of date.", suggestion: "Refresh to check current listings." };
  if (!rec) return { state: "unavailable", headline: `Checking ${marketplace} prices…` };
  if (rec.suggestedListingPrice !== null)
    return {
      state: "priced",
      headline: `Based on ${rec.eligibleCount ?? rec.statistics?.count ?? 0} similar ${marketplace} listings.`,
      detail: "These are current asking prices, not completed sales.",
    };
  const b = rec.blockers.join(" ");
  const size = details.size?.trim();
  const condition = details.condition;
  // What the engine actually checked for "your item", so the count matches what sellers see in the tiers.
  const checked = condition ? (details.packaging === "original" ? "size, condition and box" : "size and condition") : "size";
  if (/Current production .* listings are unavailable/.test(b))
    return { state: "unavailable", headline: `${marketplace} prices aren't available right now.`, suggestion: "Try again in a few minutes." };
  if (/Refresh comparisons/.test(b)) return { state: "unavailable", headline: "These prices are out of date.", suggestion: "Refresh to check current listings." };
  if (/Confirm the exact product/.test(b))
    return { state: "unavailable", headline: "We need the exact model to compare prices.", suggestion: "Add a clear photo of the label or tag, or enter the style code." };
  if (/conflict between the photo and description/.test(b))
    return { state: "unavailable", headline: "Your photo and description don't agree.", suggestion: "Review the item details and confirm which is right." };
  if (/vary too widely/.test(b)) {
    const s = rec.statistics;
    const range = s ? `Similar ${marketplace} listings range from ${money(s.lowest)} to ${money(s.highest)}` : `Similar ${marketplace} listings are priced very differently`;
    const why = !size && !condition ? "because they mix different sizes and conditions" : !size ? "because they mix different sizes" : !condition ? "because they mix different conditions" : "even for your size and condition";
    return {
      state: "unavailable",
      headline: "Prices vary too much to recommend one.",
      detail: `${range}, ${why}.`,
      suggestion: !size || !condition ? `Add the ${[!size && "size", !condition && "condition"].filter(Boolean).join(" and ")} for a tighter estimate.` : undefined,
    };
  }
  if (/At least three eligible listings/.test(b))
    return {
      state: "unavailable",
      headline: size ? `Not enough ${marketplace} listings in size ${size} to price this confidently.` : `Not enough similar ${marketplace} listings right now.`,
      detail: size
        ? !rec.eligibleCount
          ? `None of the ${marketplace} listings found match your ${checked}. A price needs at least 3.`
          : `Only ${rec.eligibleCount} ${marketplace} ${rec.eligibleCount === 1 ? "listing matches" : "listings match"} your ${checked}. A price needs at least 3.`
        : undefined,
      suggestion: size ? (marketplace === "Mercari" ? "The closest Mercari listings are grouped below under Mercari listings by match." : undefined) : "Adding the exact model or size can help.",
    };
  if (/two identified sellers/.test(b)) return { state: "unavailable", headline: `Too few different ${marketplace} sellers to rely on.` };
  if (/buyer shipping charge/.test(b)) return { state: "unavailable", headline: "The shipping charge is higher than the price.", suggestion: "Lower the buyer shipping charge." };
  return { state: "unavailable", headline: `Not enough reliable ${marketplace} evidence for a price yet.` };
}
