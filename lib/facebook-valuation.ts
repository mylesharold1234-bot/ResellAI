import type { FacebookResult } from "./facebook";
import type { ProductQuery } from "./marketplaces";
import { askingStatistics } from "./valuation";
export function facebookValuation(result: FacebookResult, query: ProductQuery) {
  const statistics = askingStatistics(result.comparables);
  const shoe = /shoe|sneaker|footwear/i.test(
    query.identification.category || "",
  );
  const sufficient =
    result.status === "available" &&
    !!statistics &&
    statistics.count >= 5 &&
    query.identification.confidence !== "low" &&
    !!result.location.condition &&
    (!shoe || !!query.details.size) &&
    statistics.highest / statistics.lowest <= 2;
  return {
    statistics,
    evidenceQuality: !statistics
      ? "unavailable"
      : sufficient
        ? "moderate"
        : "low",
    suggestedListingPrice: sufficient ? statistics!.median : null,
    estimatedSellingRange: null,
    askingRange: statistics
      ? { low: statistics.lowest, high: statistics.highest }
      : null,
    explanation: sufficient
      ? "Starting listing price equals the median of at least five title-matched active asks, with a selected condition filter and price spread at most 2×. This is a heuristic, not a forecast."
      : "A recommendation needs at least five relevant active asks, a condition filter, non-low identification confidence, size for shoes and price spread no greater than 2×.",
    sellingRangeExplanation:
      "No verified transactions or calibrated asking-to-selling discount model are available. A defensible selling-price range cannot be inferred. The displayed range is observed asking prices only.",
    warnings: [
      ...new Set([
        ...result.warnings,
        ...result.comparables.flatMap((c) => c.warnings),
        "Seller independence is not verified by this endpoint.",
        "Title matching and search-filter condition do not independently verify exact variant, wear or authenticity.",
      ]),
    ],
  };
}
