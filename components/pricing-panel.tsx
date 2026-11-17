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

type Bands = NonNullable<Recommendation["marketBands"]>;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** True when there's a dated band worth showing (enough recent listings, or older ones to set apart). */
export function hasMarketBands(b: Recommendation["marketBands"] | null | undefined): b is Bands {
  return !!b && (!!b.recent?.sufficient || !!b.older?.count);
}

/**
 * Asking-price reference bands from the same verified listings, split by listing age: the recent market
 * (first listed within a year) with its lower quarter, median and upper quarter, and older listings shown
 * separately as context. Reference only: never a recommendation, sale price or selling-speed estimate.
 */
export function MarketBands({ bands, marketplace }: { bands: Bands; marketplace: "eBay" | "Mercari" }) {
  const { recent, older, undated } = bands;
  return (
    <aside className="bands" aria-label={`${marketplace} asking-price reference`}>
      <p className="market-ref-head">
        <span className="pill">Reference only</span>
        <span>Asking prices, not sale prices</span>
      </p>
      {recent?.sufficient ? (
        <div className="band">
          <p className="band-title">Recent listings <span className="muted">· first listed in the past year</span></p>
          <dl className="band-stats">
            <div><dt>Lower quarter</dt><dd>{whole(recent.p25)}</dd></div>
            <div><dt>Median</dt><dd>{whole(recent.median)}</dd></div>
            <div><dt>Upper quarter</dt><dd>{whole(recent.p75)}</dd></div>
          </dl>
          <p className="fine">
            {plural(recent.count, "listing")} from {plural(recent.sellers, "seller")}
            {recent.outliers ? ` · ${plural(recent.outliers, "extreme ask")} left out` : ""}
          </p>
        </div>
      ) : (
        <p className="band-thin">
          <strong>Recent listings:</strong>{" "}
          {recent ? `only ${plural(recent.count, "listing")} from ${plural(recent.sellers, "seller")}` : "none"} with a reliable date from the past year, which isn&apos;t enough for a reference band (it needs {bands.minimumListings} from {bands.minimumSellers} sellers).
        </p>
      )}
      {older && older.count > 0 && (
        <div className="band band-older">
          <p className="band-title">Older listings <span className="muted">· up for over a year, shown separately</span></p>
          <p className="band-line">
            {older.sufficient ? <>Middle half ask {whole(older.p25)}–{whole(older.p75)} · median {whole(older.median)}</> : "Too few to summarize"}
            <span className="muted"> · {plural(older.count, "listing")} from {plural(older.sellers, "seller")}</span>
          </p>
          <p className="fine">Long-running listings may not reflect what pairs sell for, so they aren&apos;t mixed into the recent reference.</p>
        </div>
      )}
      {undated.count > 0 && <p className="fine">{plural(undated.count, "listing")} without a reliable listing date {undated.count === 1 ? "is" : "are"} left out of both.</p>}
      <p className="fine">These describe what sellers are asking for your item now. They aren&apos;t sale prices or a guide to how fast it will sell.</p>
    </aside>
  );
}

/**
 * Where verified asking prices sit when they're too spread out for one defensible price: the middle half,
 * the median and the extremes. Never styled or worded as a recommendation.
 */
export function AskingDistribution({ d, marketplace }: { d: NonNullable<Recommendation["askingDistribution"]>; marketplace: "eBay" | "Mercari" }) {
  const span = Math.max(1, d.max - d.min);
  const at = (v: number) => `${Math.round(((v - d.min) / span) * 100)}%`;
  return (
    <aside className="ask-dist" aria-label={`${marketplace} verified asking prices`}>
      <p className="market-ref-head">
        <span className="pill">Not a recommendation</span>
        <span>{d.count} verified listings · {d.sellers} sellers</span>
      </p>
      <p className="ask-dist-mid">Middle half asks {whole(d.p25)}–{whole(d.p75)} <span className="muted">· median {whole(d.median)}</span></p>
      <div className="ask-dist-bar" aria-hidden="true">
        <span className="ask-dist-iqr" style={{ left: at(d.p25), width: `calc(${at(d.p75)} - ${at(d.p25)})` }} />
        <span className="ask-dist-median" style={{ left: at(d.median) }} />
      </div>
      <p className="ask-dist-ends fine"><span>Lowest {whole(d.min)}</span><span>Highest {whole(d.max)}</span></p>
      <p className="fine">Current asking prices for your item, not sales. They vary too much for one fair price, so pick yours from where you&apos;d like to sell.</p>
    </aside>
  );
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
  details?: Pick<MatchDetails, "size" | "condition"> & Partial<Pick<MatchDetails, "packaging" | "productIdentifier" | "productIdentifierVerified">>;
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
  // A partial sample's price is an estimate on either marketplace; Mercari's close-match prices always are.
  const estimated = (marketplace === "Mercari" && !!rec?.provisional) || !!rec?.sampleCoverage?.partial;
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
          {rec?.sampleCoverage?.partial && explanation.detail && <p className="market-hint fine">{explanation.detail}</p>}
          {rec?.sampleCoverage?.partial && explanation.suggestion && <p className="market-hint">{explanation.suggestion}</p>}
          {!expired && hasMarketBands(rec?.marketBands) && <MarketBands bands={rec.marketBands} marketplace={marketplace} />}
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
          {!expired && hasMarketBands(rec?.marketBands) && <MarketBands bands={rec.marketBands} marketplace={marketplace} />}
          {!expired && !hasMarketBands(rec?.marketBands) && rec?.askingDistribution && rec.blockers.some((b) => /vary too widely/.test(b)) && <AskingDistribution d={rec.askingDistribution} marketplace={marketplace} />}
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
