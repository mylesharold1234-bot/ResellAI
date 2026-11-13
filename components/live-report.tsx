"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useIdentification } from "./identification-context";
import { ReportItem } from "./report-item";
import { MatchDetailsFields } from "./match-details-fields";
import { FacebookMarketplaceSection } from "./facebook-marketplace-section";
import { EbayProceeds } from "./ebay-proceeds";
import { parseMatchDetails, type MarketplaceResult } from "../lib/marketplaces";
import {RetrievalDiagnostics} from "./retrieval-diagnostics";
import {PricingPanel} from "./pricing-panel";
import {EbayAIReview} from "./ebay-ai-review";
import {listingDisplayPrice} from "../lib/pricing-engine";
import type { recommend } from "../lib/valuation";
import { loadingMessages, SkeletonLines } from "./request-loading";
import { useRequest } from "./use-request";
import { MarketplaceComparison, MarketplaceProfit } from "./marketplace-intelligence";
import type {PricingEvidence} from "../lib/pricing-intelligence";
import { MercariPricing } from "./mercari-pricing";
import { CreateListingButton } from "./listing/create-listing-button";
type ReportData = {
  result: MarketplaceResult;
  recommendation: ReturnType<typeof recommend>;
  snapshot?:{version:string;updatedAt:string;persisted?:boolean};
};
const dollars = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(v);
export function LiveReport() {
  const { state, dispatch } = useIdentification();
  const [lastSuccessfulKey, setLastSuccessfulKey] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [searchName, setSearchName] = useState("");
  const nameIdentity = useRef(JSON.stringify(state.confirmed));
  const searchIdentification = state.confirmed && nameIdentity.current === JSON.stringify(state.confirmed) && searchName.trim() ? {...state.confirmed, productName:searchName.trim(), model:searchName.trim()} : state.confirmed;
  const key = JSON.stringify({
    identification: searchIdentification,
    details: state.details,
  });
  const request = useRequest<ReportData>(key);
  const [mercari,setMercari]=useState<{scope:string;data:PricingEvidence|null}|null>(null);
  const onMercariEvidence=useCallback((scope:string,data:PricingEvidence|null)=>setMercari({scope,data}),[]);
  const mercariQuery=state.confirmed?{identification:state.confirmed,details:state.details}:null;
  const mercariEvidence=mercari?.scope===JSON.stringify(mercariQuery)?mercari.data:null;
  const loading = request.state.status === "loading";
  const error = request.state.status === "error" ? request.state.message : "";
  const data = request.state.status === "success" ? request.state.data : null;
  const result = data?.result;
  const recommendation = data?.recommendation;
  const stats = recommendation?.statistics;
  function search(refresh=false) {
    if (!searchIdentification) return;
    return request.run(async signal => {
      const details = parseMatchDetails(state.details);
      try {
        const response = await fetch("/api/marketplaces/ebay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identification: searchIdentification, details, refresh }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]),
        });
        const payload = await response.json();
        if (!response.ok || !payload.result || !payload.recommendation)
          throw Error(payload.error || "Marketplace search failed. Please try again.");
        if (payload.result.status === "unavailable") {
          const retry = payload.result.retryAfterSeconds;
          throw Error((payload.result.reason || "eBay is currently unavailable.") + (retry ? " Retry after approximately " + retry + " seconds." : ""));
        }
        return payload as ReportData;
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw Error("eBay search timed out. Please try again.");
        if (error instanceof TypeError || error instanceof SyntaxError) throw Error("Could not read the eBay response. Please try again.");
        throw error;
      }
    }, () => setLastSuccessfulKey(key));
  }
  // Strict Mode can discard the first effect before it starts a request.
  const identityKey = JSON.stringify(state.confirmed);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled && state.confirmed) void search(); });
    return () => { cancelled = true; };
  }, [identityKey, state.confirmationId]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const expiry=(data??request.previous)?.result.expiresAt;
  const expired=!!expiry&&Date.parse(expiry)<=clock;
  const isProduction = result?.environment === "production";
  const suggested =
    !expired && isProduction
      ? (listingDisplayPrice(recommendation?.suggestedListingPrice??null,recommendation?.indicativeAskingRange??null))
      : null;
  if (!state.confirmed)
    return (
      <section className="wrap workspace narrow">
        <div className="eyebrow">YOUR RESALE REPORT</div>
        <h1 className="page-title">Confirm an item to get started.</h1>
        <p className="lead">
          Identify a product, review the details and confirm it before searching
          eBay. Reloading clears your current session.
        </p>
        <div className="actions">
          <Link href="/analyze" className="button">
            Analyze an Item
          </Link>
          <Link href="/analysis?demo=1" className="text-link">
            Open separate demo ↗
          </Link>
        </div>
        <div className="info-card">
          <strong>No market data loaded.</strong>
          <p>No fictional prices are shown in a live report.</p>
        </div>
      </section>
    );
  return (
    <section className="wrap workspace">
      <div className="demo-notice">
        <ShieldCheck size={17} />
        <span>
          <strong>Evidence first.</strong> Active asking prices only.
          Completed-sale prices, demand and forecasts are unavailable.
        </span>
      </div>
      <div className="section-heading">
        <div>
          <Link className="back" href="/dashboard">
            ← Dashboard
          </Link>
          <h1 className="page-title">Your resale evidence</h1>
          <p className="muted">
            Actual listing evidence, with its limits in view.
          </p>
        </div>
        <Link href="/analyze" className="secondary">
          Review identification <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="report-grid marketplace-report-grid">
        <ReportItem />
        <PricingPanel recommendation={recommendation} previous={request.previous?.recommendation} expired={expired} requestStatus={request.state.status} error={error||undefined} updatedAt={(data??request.previous)?.snapshot?.updatedAt??(data??request.previous)?.result.retrievedAt} version={(data??request.previous)?.snapshot?.persisted===false?undefined:(data??request.previous)?.snapshot?.version} snapshotNotice={data?.snapshot?.persisted===false?"Incomplete search: this observation is not saved as a daily snapshot. Refresh manually when the provider is available.":undefined} onRefresh={()=>void search(!!request.previous)} />
        {mercariQuery&&<MercariPricing query={mercariQuery} now={clock} confirmationId={state.confirmationId} onEvidence={onMercariEvidence} />}
      </div>
      <MarketplaceComparison ebay={searchIdentification===state.confirmed?data:null} mercari={mercariEvidence} now={clock} />
      <CreateListingButton ebay={searchIdentification===state.confirmed?data:null} mercari={mercariEvidence} />
      <EbayAIReview result={result} />
      <section className="panel block">
        <h2>Refine your comparables</h2>
        <p role="status" className={loading ? "sr-only" : undefined}>{loading ? "Analyzing eBay marketplace listings. " + loadingMessages.ebay.join(". ") : error ? "" : !result ? "Ready to search eBay." : result.examined === 0 ? "Search completed: eBay returned zero listings." : result.comparables.length === 0 ? "Listings retrieved, but none matched the item." : recommendation?.suggestedListingPrice ? "Relevant listings and a qualified asking-price recommendation available." : "Relevant listings available; insufficient evidence for a reliable specific-item valuation."}</p>
        <p className="muted">
          Optional details improve matching quality. Uncertain attributes keep a listing in close or related evidence rather than exact pricing.
        </p>
        <MatchDetailsFields
          identification={state.confirmed}
          value={state.details}
          onChange={(details) => dispatch({ type: "details", details })}
          disabled={loading}
        />
        <p className="fine block">
          Brand, model and SKU are optional. Add an exact SKU only if you can
          verify it from your product. Results are a filtered sample, not a
          census of the marketplace.
        </p>
        {result?.reason && (
          <div className="info-card" role="status">
            <strong>
              {result.status === "unavailable"
                ? "Marketplace data unavailable"
                : "Search result"}
            </strong>
            <p>{result.reason}</p>
            {result.retryAfterSeconds && (
              <p>
                Retry after approximately {result.retryAfterSeconds} seconds.
              </p>
            )}
          </div>
        )}
        {result?.status === "no_matches" && (
          <div className="info-card">
            <strong>{result.examined === 0 ? "eBay returned zero listings." : "No matching listings after filtering."}</strong>
            <p>
              Review the item description or optional details. Broader discovery queries are shown in advanced diagnostics; no demo prices are substituted.
            </p>
          </div>
        )}
        {lastSuccessfulKey && lastSuccessfulKey !== key && request.state.status === "idle" && (
          <p className="fine">
            Details changed. Search again; previous statistics have been
            cleared.
          </p>
        )}
      </section>
      <section className="panel block"><h2>Refine eBay search</h2><label>Recognizable product name<input maxLength={100} disabled={loading} value={searchName} placeholder={state.confirmed.productName || "Product name"} onChange={e=>{nameIdentity.current=JSON.stringify(state.confirmed);setSearchName(e.target.value);}} /></label><p className="fine">Broad name searches run first. Size, condition, edition and verified identifiers refine match quality rather than suppressing the broad search. Use Search eBay comparables after editing.</p></section>
      {loading && <section className="panel block" aria-label="Marketplace comparison results">
        <h2>Marketplace comparison results</h2>
        <div aria-busy="true">
          <div className="market-stats" aria-hidden="true">{["Median asking", "Average asking", "Lowest asking", "Highest asking", "Matching listings"].map(label =>
            <div key={label}><span className="muted">{label}</span><span className="request-skeleton request-skeleton--stat" /></div>)}</div>
          <SkeletonLines count={3} />
        </div>
      </section>}
      {result && result.status !== "unavailable" && (
        <>
          <section className="panel block">
            <div className="section-heading">
              <div>
                <h2>
                  {isProduction
                    ? "Comparable asking-price statistics"
                    : "Sandbox statistics — not market evidence"}
                </h2>
                <p className="muted">
                  Item price only. Shipping is listed separately; taxes are not
                  included.
                </p>
              </div>
              <span className="pill">
                {result.cached ? "CACHED SNAPSHOT" : "API SNAPSHOT"}
              </span>
            </div>
            <div className="market-stats">
              {[
                ["Median asking", stats?.median],
                ["Average asking", stats?.average],
                ["Lowest asking", stats?.lowest],
                ["Highest asking", stats?.highest],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <span className="muted">{label}</span>
                  <strong>{dollars(value as number | undefined)}</strong>
                </div>
              ))}
              <div>
                <span className="muted">Matching listings</span>
                <strong>{result.comparables.length}</strong>
                <small>{stats?.count || 0} listings eligible for asking-price statistics</small>
              </div>
            </div>
            <p className="fine block">
              Last retrieved:{" "}
              {result.retrievedAt
                ? new Date(result.retrievedAt).toLocaleString()
                : "Not retrieved"}{" "}
              · Expires:{" "}
              {result.expiresAt
                ? new Date(result.expiresAt).toLocaleString()
                : "N/A"}{" "}
              · {result.examined} examined · {result.excluded} mismatches
              excluded · {result.invalid} invalid, duplicate, ended or
              unsupported rows excluded.
            </p>
            <RetrievalDiagnostics result={result}/>
            {result.searchDiagnostics && <details className="info-card"><summary>Advanced search diagnostics</summary><div><strong>{result.searchDiagnostics.exact} exact · {result.searchDiagnostics.close} close · {result.searchDiagnostics.related} related</strong><p>Pricing basis: {recommendation?.pricingBasis}. Related listings and unresolved attribute mismatches never contribute to pricing.</p><ul>{result.searchDiagnostics.attempts.map(a=><li key={a.stage}>{a.stage}: “{a.query}” — {a.returned} returned{a.error ? `; ${a.error}` : ""}</li>)}</ul><small>Cache reference: {result.searchDiagnostics.cacheKey}</small></div></details>}
            {result.diagnostics && (
              <details className="fine"><summary>Listing filter diagnostics: {result.diagnostics.accepted} accepted of {result.examined} returned</summary>
                <p>{result.diagnostics.normalized} valid rows reached product matching. Variation listings may be displayed while excluded from statistics.</p>
                <ul>{Object.entries(result.diagnostics.exclusions).map(([reason, count]) => <li key={reason}>{reason.replaceAll("_", " ")}: {count}</li>)}</ul>
                <ul>{result.diagnostics.rows.map((row, index) => <li key={`${row.id}-${index}`}>{row.title || row.id}: {row.stage} — {row.reason.replaceAll("_", " ")}</li>)}</ul>
              </details>
            )}
            {expired && (
              <p className="error">
                Snapshot expired. Figures below are historical observations, not
                current quotes.
              </p>
            )}
          </section>
          <section className="panel block">
            <h2>Listings supporting the evidence</h2>
            {(["exact", "close", "related"] as const).map(tier => <div key={tier}><h3>{tier === "exact" ? "Exact comparables" : tier === "close" ? "Close comparables — attributes may differ" : "Related listings — context only"} ({result.comparables.filter(item=>(item.matchTier || "exact")===tier).length})</h3><div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "eBay listing",
                      "Item asking price",
                      "Shipping quoted",
                      "Seller condition",
                      "Match evidence",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.comparables.filter(item=>(item.matchTier || "exact")===tier).sort((a,b)=>(b.quality?.score??0)-(a.quality?.score??0)||a.id.localeCompare(b.id)).map((item) => (
                    <tr key={item.id}>
                      <td className="listing-title">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.title} ↗
                        </a>
                        <small>
                          {item.seller
                            ? `Seller: ${item.seller}`
                            : "Seller unavailable"}
                        </small>
                      </td>
                      <td>{dollars(item.price)}</td>
                      <td>
                        {item.shipping === null
                          ? "Not quoted"
                          : dollars(item.shipping)}
                      </td>
                      <td>{item.condition}</td>
                      <td className="listing-match">
                        {item.quality && <small>Evidence score: {item.quality.score}/100 · {item.quality.signals.join(", ")}</small>}{item.matchReasons.join(" · ")}
                        {item.warnings.map(warning => <small key={warning}>{warning}</small>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>)}
            <p className="fine block">
              Missing details that improve accuracy: condition, category-specific size/storage/edition, and an item-verified identifier where available. A LEGO theme alone cannot establish a set value.
              Active listings can change or end. Shipping quotes may depend on
              buyer location. A title match does not verify condition,
              authenticity or availability of a particular size. Review each
              source listing.
            </p>
          </section>
        </>
      )}
      <div className="two-grid block">
        <div className="panel">
          <h2>What the evidence supports</h2>
          <dl>
            <div>
              <dt>Price basis</dt>
              <dd>Active item asking prices</dd>
            </div>
            <div>
              <dt>Verified resale value</dt>
              <dd>Unavailable</dd>
            </div>
            <div>
              <dt>Completed sales</dt>
              <dd>Not accessible</dd>
            </div>
            <div>
              <dt>Best marketplace</dt>
              <dd>See marketplace evidence comparison above</dd>
            </div>
            <div>
              <dt>Sell now / seasonality</dt>
              <dd>Not assessed</dd>
            </div>
          </dl>
          <p className="fine block">
            eBay evidence and any permitted Facebook comparisons are separate.
            Without sold evidence, there is no defensible expected selling price
            or timing recommendation.
          </p>
        </div>
        <div className="panel insights">
          <h2>Evidence limitations</h2>
          <ul className="evidence-list">
            {[
              ...new Set([
                ...(recommendation?.reasons || []),
                "Active inventory is a biased sample of unsold asking prices.",
                "No historical price series or future predictions are generated.",
              ]),
            ].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <Link href="/analysis?demo=1" className="text-link">
            Open the separate fictional demo ↗
          </Link>
        </div>
      </div>
      <FacebookMarketplaceSection />
      <MarketplaceProfit ebay={data} mercari={mercariEvidence} now={clock} />
      <EbayProceeds
        key={key + String(suggested)}
        askingPrice={suggested}
        isSneaker={/sneaker|shoe|footwear/i.test(
          state.confirmed.category || "",
        )}
      />
    </section>
  );
}
