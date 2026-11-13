import { sneakerProceeds, EBAY_FEE_SOURCE } from "../ebay-fees";
import type { MarketplaceResult } from "../marketplaces";
import { listingDisplayPrice } from "../pricing-engine";
import { marketplaceProfitScenario } from "../pricing-intelligence";
import type { recommend } from "../valuation";
import type {
  ListingCategory,
  ListingConditionGrade,
  ListingMarketplace,
  ListingPricing,
  PricingEvidenceSummary,
} from "./types";

export type MarketEvidence = { result: MarketplaceResult; recommendation: ReturnType<typeof recommend> } | null;

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Linear-interpolated quantile of an ascending list. */
export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return money(sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo));
}

/**
 * Condense the existing pricing engine's output for the listing editor.
 * No pricing is recomputed: the suggested price, cohort and blockers come from `recommend()`.
 * Quick-sale / patient points are quartiles of the same qualifying cohort, shown only with >= 5 asks.
 */
export function summarizeEvidence(provider: "ebay" | "mercari", data: MarketEvidence): PricingEvidenceSummary {
  const empty: PricingEvidenceSummary = {
    provider,
    status: "unavailable",
    environment: "production",
    suggested: null,
    median: null,
    low: null,
    high: null,
    count: 0,
    quickSale: null,
    patient: null,
    conditionCohort: "",
    pricingBasis: "none",
    retrievedAt: null,
    expiresAt: null,
    blockers: [],
    reason: "No completed marketplace search for this item.",
  };
  if (!data) return empty;
  const { result, recommendation: rec } = data;
  const base = {
    ...empty,
    environment: result.environment,
    retrievedAt: result.retrievedAt,
    expiresAt: result.expiresAt,
    conditionCohort: rec.conditionCohort || "",
    blockers: rec.blockers,
    reason: result.reason || null,
  };
  if (result.status === "unavailable") return { ...base, status: "unavailable", reason: result.reason || "Marketplace search unavailable." };
  if (result.environment !== "production")
    return { ...base, status: "unavailable", reason: "Sandbox listings are test data, not market evidence." };
  if (rec.suggestedListingPrice === null || !rec.statistics)
    return { ...base, status: "insufficient", reason: rec.blockers[0] || "Not enough comparable listings for a recommendation." };
  const prices = [...(rec.pricingDiagnostics?.prices || [])].sort((a, b) => a - b);
  const quartiles = prices.length >= 5;
  return {
    ...base,
    status: "supported",
    suggested: listingDisplayPrice(rec.suggestedListingPrice, rec.indicativeAskingRange),
    median: rec.statistics.median,
    low: rec.statistics.lowest,
    high: rec.statistics.highest,
    count: rec.eligibleCount,
    quickSale: quartiles ? quantile(prices, 0.25) : null,
    patient: quartiles ? quantile(prices, 0.75) : null,
    pricingBasis: rec.pricingBasis,
    reason: null,
  };
}

/** Whether evidence was gathered for the condition the seller is listing. */
export function conditionFit(evidence: PricingEvidenceSummary, grade: ListingConditionGrade): "match" | "mismatch" | "unknown" {
  if (!grade || !evidence.conditionCohort) return "unknown";
  const cohort = evidence.conditionCohort.toLowerCase();
  if (grade === "new") return cohort === "new" ? "match" : "mismatch";
  if (grade === "used") return cohort === "used" || cohort === "like new" ? "match" : "mismatch";
  return cohort === grade ? "match" : "mismatch";
}

export function evidenceStale(evidence: PricingEvidenceSummary, now = Date.now()) {
  return !!evidence.expiresAt && Date.parse(evidence.expiresAt) <= now;
}

const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

export type ProceedsResult =
  | {
      ok: true;
      fee: number;
      feeLabel: string;
      feeSource: string | null;
      proceeds: number;
      profit: number | null;
      roi: number | null;
      assumptions: string[];
      tip: string | null;
    }
  | { ok: false; reason: string };

/** Fee, net proceeds and profit for the seller's chosen price. Reuses the existing fee and profit helpers. */
export function listingProceeds(
  p: ListingPricing,
  category: ListingCategory,
  marketplace: ListingMarketplace,
): ProceedsResult {
  if (p.price === null || !Number.isFinite(p.price) || p.price <= 0) return { ok: false, reason: "Set a listing price to see fees and proceeds." };
  const fields = { buyerShipping: p.buyerShipping, sellerShipping: p.sellerShipping, extras: p.extras, salesTax: p.salesTax, purchase: p.purchaseCost };
  if (Object.values(fields).some((v) => v.trim() !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0)))
    return { ok: false, reason: "Enter amounts as non-negative numbers." };
  const assumptions = [
    ...(p.buyerShipping.trim() === "" ? ["Shipping charged to buyer not entered (treated as $0)."] : []),
    ...(p.sellerShipping.trim() === "" ? ["Your shipping cost not entered (treated as $0)."] : []),
  ];
  const purchase = p.purchaseCost.trim() === "" ? null : Number(p.purchaseCost);
  const sneakerMode = p.feeMode === "ebay-athletic-sneakers";
  if (sneakerMode && !(marketplace === "ebay" && category === "footwear"))
    return { ok: false, reason: "The eBay athletic-sneaker fee profile only applies to sneakers listed on eBay. Choose a custom fee." };
  let fee: number;
  let proceeds: number;
  let tip: string | null = null;
  if (sneakerMode) {
    const run = (price: number) =>
      sneakerProceeds({ price, buyerShipping: num(p.buyerShipping), salesTax: num(p.salesTax), sellerShipping: num(p.sellerShipping), extras: num(p.extras) });
    const r = run(p.price);
    fee = r.fee;
    proceeds = r.proceeds;
    if (r.rate > 0.1 && p.price >= 130 && p.price + num(p.buyerShipping) + num(p.salesTax) < 150) {
      const target = money(150 - num(p.buyerShipping) - num(p.salesTax));
      const at = run(target);
      if (at.proceeds > r.proceeds)
        tip = `Pricing at $${target.toFixed(2)} crosses eBay's $150 athletic-sneaker threshold (8% instead of 13.6% + $0.40): about $${at.proceeds.toFixed(2)} to you instead of $${r.proceeds.toFixed(2)}.`;
    }
  } else {
    if (p.feePercent.trim() === "" || !Number.isFinite(Number(p.feePercent)) || Number(p.feePercent) < 0 || Number(p.feePercent) > 50)
      return { ok: false, reason: "Enter the marketplace fee percentage that applies to your account (0–50%)." };
    if (p.fixedFee.trim() !== "" && (!Number.isFinite(Number(p.fixedFee)) || Number(p.fixedFee) < 0))
      return { ok: false, reason: "Enter the fixed per-order fee as a non-negative number." };
    fee = money((p.price + num(p.buyerShipping)) * (Number(p.feePercent) / 100) + num(p.fixedFee));
    const scenario = marketplaceProfitScenario(p.price, {
      purchase: String(purchase ?? 0),
      buyerShipping: String(num(p.buyerShipping)),
      sellerShipping: String(num(p.sellerShipping)),
      fee: String(fee),
      extras: String(num(p.extras)),
    });
    if (!scenario) return { ok: false, reason: "These amounts are outside the supported range." };
    proceeds = scenario.proceeds;
  }
  const profit = purchase === null ? null : money(proceeds - purchase);
  return {
    ok: true,
    fee,
    feeLabel: sneakerMode ? "eBay athletic-sneaker final value fee" : `${p.feePercent}% fee${num(p.fixedFee) ? ` + $${num(p.fixedFee).toFixed(2)} per order` : ""}`,
    feeSource: sneakerMode ? EBAY_FEE_SOURCE : null,
    proceeds,
    profit,
    roi: profit !== null && purchase && purchase > 0 ? money((profit / purchase) * 100) : null,
    assumptions,
    tip,
  };
}
