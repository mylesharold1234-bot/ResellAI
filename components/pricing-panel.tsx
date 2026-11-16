"use client";
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { recommend } from "../lib/valuation";
import type { MatchDetails } from "../lib/marketplaces";
import { listingDisplayPrice, type PricingOptions } from "../lib/pricing-engine";
import { evidenceQuality } from "../lib/pricing-intelligence";
import { explainPricing } from "../lib/pricing-explanation";
import { RequestSpinner, SkeletonLines } from "./request-loading";
import { useDebugView } from "./ui";

type Recommendation = ReturnType<typeof recommend>;
export const dollars = (price: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price);
const whole = (price: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(price);

/** The price a marketplace's evidence supports right now, or null. */
export function supportedPrice(rec: Recommendation | undefined | null) {
  return listingDisplayPrice(rec?.suggestedListingPrice ?? null, rec?.indicativeAskingRange ?? null);
}

/**
 * A broader asking-price reference: same model, condition and colors across sizes. Deliberately styled and
 * worded so it can never be read as a price for the seller's own size.
 */
export function BroaderReference({ reference, marketplace, size }: { reference: NonNullable<Recommendation["marketReference"]>; marketplace: "eBay" | "Mercari"; size?: string }) {
  const s = size?.trim();
  return (
    <aside className="market-ref" aria-label={`${marketplace} broader asking-price reference`}>
      <p className="market-ref-head">
        <span className="pill">Reference only</span>
        <span>All sizes · asking prices</span>
      </p>
      <p className="market-ref-range">
        Most ask {whole(reference.range.low)}–{whole(reference.range.high)}
        <span className="muted"> · median {dollars(reference.median)} · {reference.count} listings</span>
      </p>
      <p className="fine">
        {s ? `Not a price for size ${s}. ` : "Not a price for your exact item. "}
        These listings match the model, colors and condition, but their sizes weren&apos;t checked. They&apos;re current asking prices, not sales.
      </p>
    </aside>
  );
}

/**
 * One marketplace's price, in plain language. When no price is supported, the seller sees why and what helps;
 * the engine's technical evidence (cohorts, exclusions, diagnostics) is only shown in the developer view.
 */
export function PricingPanel({
  marketplace = "eBay",
  recommendation,
  previous,
  expired,
  requestStatus,
  updatedAt,
  onRefresh,
  error,
  children,
  details,
  snapshotNotice,
}: {
  marketplace?: "eBay" | "Mercari";
  recommendation?: Recommendation;
  previous?: Recommendation;
  expired: boolean;
  requestStatus?: "idle" | "loading" | "success" | "error";
  updatedAt?: string | null;
  version?: string;
  onRefresh?: () => void;
  error?: string;
  children?: ReactNode;
  historical?: number | null;
  snapshotNotice?: string;
  details?: Pick<MatchDetails, "size" | "condition">;
  options?: PricingOptions;
  onChange?: (value: PricingOptions) => void;
}) {
  const debug = useDebugView();
  const loading = requestStatus === "loading";
  const old = loading || requestStatus === "error";
  const rec = old ? previous : recommendation;
  const range = rec?.indicativeAskingRange ?? null;
  const price = supportedPrice(rec);
  const explanation = explainPricing(marketplace, rec, details, { expired: expired && !old });
  const estimated = marketplace === "Mercari" && !!rec?.provisional;
  return (
    <section className="market-row" aria-label={`${marketplace} price`}>
      <div className="market-row-head">
        <span className="market-name">{marketplace}</span>
        {price !== null && !expired ? <span className="pill success">{estimated ? "Estimate" : "Price found"}</span> : !loading && rec ? <span className="pill">No price yet</span> : null}
      </div>
      <div role="status" className="sr-only">{loading ? `Checking ${marketplace} prices.` : price !== null ? `${marketplace} price ready.` : ""}</div>
      {loading && !rec ? (
        <div aria-busy="true">
          <p className="market-loading"><RequestSpinner size={16} /> Checking {marketplace} prices…</p>
          <SkeletonLines count={2} />
        </div>
      ) : price !== null && (!expired || old) ? (
        <>
          <p className="market-price">{dollars(price)}</p>
          <p className="market-why">
            {explanation.headline}
            {range ? ` Most ask ${whole(range.low)}–${whole(range.high)}.` : ""}
          </p>
          {loading && <p className="fine"><RequestSpinner size={13} /> Updating…</p>}
        </>
      ) : requestStatus === "idle" && !rec ? (
        <p className="market-why">Ready to check {marketplace} prices.</p>
      ) : (
        <>
          <p className="market-price is-empty" aria-hidden="true">—</p>
          <p className="market-why">
            <strong>{explanation.headline}</strong>
            {explanation.detail ? ` ${explanation.detail}` : ""}
          </p>
          {explanation.suggestion && <p className="market-hint">{explanation.suggestion}</p>}
          {!expired && rec?.marketReference && <BroaderReference reference={rec.marketReference} marketplace={marketplace} size={details?.size} />}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {onRefresh && (
        <button type="button" className="text-link market-refresh" disabled={loading} onClick={onRefresh}>
          <RefreshCw size={13} aria-hidden="true" /> {loading ? "Checking…" : requestStatus === "error" ? "Try again" : "Refresh"}
        </button>
      )}
      {debug && rec && (
        <details className="details-link debug-box">
          <summary>Developer details · {marketplace}</summary>
          <div className="fine">
            {updatedAt && <p>Updated {new Date(updatedAt).toLocaleString()}</p>}
            {snapshotNotice && <p>{snapshotNotice}</p>}
            <p>{rec.rationale}</p>
            <p>Median: {rec.statistics ? dollars(rec.statistics.median) : "—"} · condition cohort: {rec.conditionCohort || "unknown"} · basis: {rec.pricingBasis}{rec.variantCohort ? ` · footwear group: ${rec.variantCohort}` : ""} · quality: {evidenceQuality(rec).level}</p>
            {rec.pricingDiagnostics && (
              <p>Kept {rec.pricingDiagnostics.prices.length}: {rec.pricingDiagnostics.prices.map(dollars).join(", ") || "none"} · spread {rec.pricingDiagnostics.spread?.toFixed(2) ?? "—"} · MAD {rec.pricingDiagnostics.mad ?? "—"}</p>
            )}
            <ul>{[...new Set([...rec.blockers, ...rec.limitations, ...rec.reasons])].map((r) => <li key={r}>{r}</li>)}</ul>
            <ul>{Object.entries(rec.exclusions).map(([r, n]) => <li key={r}>{r}: {n}</li>)}</ul>
            {rec.marketReference && <p>Broader reference (not item-specific): median {dollars(rec.marketReference.median)}, {rec.marketReference.count} listings. {rec.marketReference.scope}</p>}
            {children}
          </div>
        </details>
      )}
    </section>
  );
}
