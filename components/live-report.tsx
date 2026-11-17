"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useIdentification } from "./identification-context";
import { MatchDetailsFields } from "./match-details-fields";
import { EbayProceeds } from "./ebay-proceeds";
import { parseMatchDetails, type MarketplaceResult } from "../lib/marketplaces";
import {RetrievalDiagnostics} from "./retrieval-diagnostics";
import {PricingPanel,supportedPrice,dollars} from "./pricing-panel";
import { useDebugView } from "./ui";
import {EbayAIReview} from "./ebay-ai-review";
import {listingDisplayPrice} from "../lib/pricing-engine";
import type { recommend } from "../lib/valuation";
import { loadingMessages } from "./request-loading";
import { useRequest } from "./use-request";
import { MarketplaceComparison, MarketplaceProfit } from "./marketplace-intelligence";
import type {PricingEvidence} from "../lib/pricing-intelligence";
import { MercariPricing } from "./mercari-pricing";
import { CreateListingButton } from "./listing/create-listing-button";
import { ComparableBrowser } from "./comparable-browser";
import { ComparisonTiersView } from "./comparison-tiers";
import { listingCounts, type BrowserEvidence } from "../lib/comparable-browser";
type ReportData = {
  result: MarketplaceResult;
  recommendation: ReturnType<typeof recommend>;
  snapshot?:{version:string;updatedAt:string;persisted?:boolean};
};
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
  const debug = useDebugView();
  const [refineOpen, setRefineOpen] = useState(false);
  // The seller's own price. Always allowed, with or without a recommendation; never replaced by one.
  const [manualText, setManualText] = useState("");
  const manualNumber = Number(manualText.replace(/[$,\s]/g, ""));
  const manualPrice = manualText.trim() && Number.isFinite(manualNumber) && manualNumber > 0 && manualNumber <= 100000 ? Math.round(manualNumber * 100) / 100 : null;
  if (!state.confirmed)
    return (
      <section className="wrap workspace narrow">
        <h1 className="page-title">No item yet</h1>
        <p className="lead">Start with a photo. We&apos;ll identify the item and show what it&apos;s worth.</p>
        <div className="actions">
          <Link href="/analyze" className="button">Start with a photo</Link>
          <Link href="/analysis?demo=1" className="secondary">See an example</Link>
        </div>
      </section>
    );

  const item = state.confirmed;
  const d = state.details;
  const chips = [
    item.brand,
    d.size ? `Size ${d.size}${d.sizeSystem && d.sizeSystem !== "Clothing" ? ` ${d.sizeSystem.replace("US ", "US ")}` : ""}` : null,
    d.condition ? { new: "New", used: "Used", refurbished: "Refurbished", parts: "For parts" }[d.condition] : null,
    d.packaging === "original" ? "With box" : null,
    item.colorway,
  ].filter(Boolean) as string[];
  const ebayPrice = !expired && isProduction ? supportedPrice(recommendation) : null;
  const mercariPrice = mercariEvidence && mercariEvidence.result.expiresAt && Date.parse(mercariEvidence.result.expiresAt) > clock ? supportedPrice(mercariEvidence.recommendation) : null;
  const best = ebayPrice !== null ? { price: ebayPrice, market: "eBay", rec: recommendation } : mercariPrice !== null ? { price: mercariPrice, market: "Mercari", rec: mercariEvidence?.recommendation } : null;
  const missingKeyDetails = !d.size || !d.condition;
  const sized = /sneaker|shoe|footwear|boot|apparel|clothing|shirt|hoodie|jacket|pants|dress/i.test(`${item.category || ""} ${item.productName || ""}`);
  // eBay found plenty of verified listings, but their asks are too spread out for one price.
  const dispersed = !expired && recommendation?.askingDistribution && recommendation.blockers.some((b) => /vary too widely/.test(b)) ? recommendation.askingDistribution : null;
  const hasReference = !expired && (!!recommendation?.marketReference || !!mercariEvidence?.recommendation.marketReference);
  const browse: BrowserEvidence[] = [
    ...(result && result.status !== "unavailable" && recommendation ? [{ provider: "ebay" as const, result, recommendation }] : []),
    ...(mercariEvidence && mercariEvidence.result.status !== "unavailable" ? [{ provider: "mercari" as const, result: mercariEvidence.result, recommendation: mercariEvidence.recommendation }] : []),
  ];
  const counts = browse.map((b) => ({ market: b.provider === "ebay" ? "eBay" : "Mercari", ...listingCounts(b.result, b.recommendation) }));
  const usedTotal = counts.reduce((n, c) => n + c.used, 0);

  return (
    <section className="wrap workspace report">
      <Link className="back" href="/analyze">← Edit item</Link>

      <header className="report-head">
        <div className="report-photo">{state.photos[0] ? <img src={state.photos[0].url} alt={`Your photo of ${item.productName}`} /> : null}</div>
        <div className="report-title">
          <h1>{item.productName}</h1>
          {!!chips.length && <div className="chip-row">{chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>}
        </div>
      </header>

      <section className="card price-card" aria-labelledby="price-h">
        <div className="price-hero">
          <p id="price-h" className="price-label">Suggested asking price</p>
          {best ? (
            <>
              <p className="price-value">{dollars(best.price)}</p>
              <p className="muted">{best.rec?.sampleCoverage?.partial ? `An estimate from part of the ${best.market} market. ` : `From current ${best.market} listings. `}These are asking prices, not completed sales.</p>
            </>
          ) : loading || (!mercariEvidence && !!state.confirmationId) ? (
            <p className="price-value is-loading" aria-busy="true"><span className="request-skeleton request-skeleton--price" /></p>
          ) : (
            <>
              <p className="price-value is-empty">{dispersed ? "Prices vary too much" : "Not enough data"}</p>
              <p className="muted">{dispersed ? `Verified listings for your item ask ${dollars(dispersed.p25)}–${dollars(dispersed.p75)} (middle half), too wide for one fair price. Set your own price below.` : <>We couldn&apos;t find enough similar listings{d.size ? ` in size ${d.size}` : ""} to suggest a price{missingKeyDetails && sized ? ". Adding the size and condition usually helps." : "."}</>}</p>
              {hasReference && <p className="muted">A broader asking-price reference is shown alongside. It isn&apos;t a price for your {d.size ? "size" : "exact item"}.</p>}
              {missingKeyDetails && sized && (
                <button type="button" className="text-link" onClick={() => setRefineOpen(true)}>Add size and condition</button>
              )}
            </>
          )}
          <div className="your-price">
            <label htmlFor="your-price">Your price</label>
            <div className="your-price-input">
              <span aria-hidden="true">$</span>
              <input id="your-price" inputMode="decimal" autoComplete="off" placeholder={best ? best.price.toFixed(2) : "0.00"} value={manualText} onChange={(e) => setManualText(e.target.value)} aria-describedby="your-price-help" aria-invalid={!!manualText.trim() && manualPrice === null} />
            </div>
            <p id="your-price-help" className="fine">
              {manualText.trim() && manualPrice === null ? "Enter a price like 65 or 65.00." : best ? "Optional. Leave blank to use the suggested price." : "Optional. Set your own price, even without a suggestion. It's used for your listing and profit estimate."}
            </p>
          </div>
          <div className="price-cta">
            <CreateListingButton ebay={searchIdentification === state.confirmed ? data : null} mercari={mercariEvidence} manualPrice={manualPrice} />
          </div>
        </div>

        <div className="market-rows">
          <PricingPanel
            details={state.details}
            recommendation={recommendation}
            previous={request.previous?.recommendation}
            expired={expired}
            requestStatus={request.state.status}
            error={error || undefined}
            updatedAt={(data ?? request.previous)?.snapshot?.updatedAt ?? (data ?? request.previous)?.result.retrievedAt}
            onRefresh={() => void search(true)}
          >
            {debug && <RetrievalDiagnostics result={result} />}
          </PricingPanel>
          {mercariQuery && <MercariPricing query={mercariQuery} now={clock} confirmationId={state.confirmationId} onEvidence={onMercariEvidence} />}
        </div>
      </section>

      <div className="report-sections">
        <details className="disclosure" open={refineOpen} onToggle={(e) => setRefineOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>Improve accuracy <small>{missingKeyDetails && sized ? "Add size and condition" : "Size, condition and more"}</small></summary>
          <div className="disclosure-body">
            <p className="muted">Prices update after you change these.</p>
            <MatchDetailsFields identification={state.confirmed} value={state.details} onChange={(details) => dispatch({ type: "details", details })} disabled={loading} part="essential" />
            <details className="details-link">
              <summary>More details</summary>
              <MatchDetailsFields identification={state.confirmed} value={state.details} onChange={(details) => dispatch({ type: "details", details })} disabled={loading} part="more" />
              <label className="field block">
                Search eBay with a different name
                <input maxLength={100} disabled={loading} value={searchName} placeholder={state.confirmed.productName || "Product name"} onChange={(e) => { nameIdentity.current = JSON.stringify(state.confirmed); setSearchName(e.target.value); }} />
              </label>
            </details>
            <div>
              <button type="button" className="secondary" disabled={loading} onClick={() => void search()}>Update prices</button>
              {lastSuccessfulKey && lastSuccessfulKey !== key && request.state.status === "idle" && <p className="fine block">Details changed. Update prices to see new results.</p>}
            </div>
          </div>
        </details>

        {!!browse.length && (
          <details className="disclosure">
            <summary>Listings we compared <small>{counts.map((c) => `${c.market} ${c.checked} checked`).join(" · ")} · {usedTotal ? `${usedTotal} used for the price` : "none usable for a price"}</small></summary>
            <div className="disclosure-body">
              {/* Only the listings behind an actual eBay price; never a blocked or broader sample. */}
              {stats && ebayPrice !== null && (
                <div className="market-stats" aria-label="eBay listings used for the price">
                  {[["Typical", stats.median], ["Lowest", stats.lowest], ["Highest", stats.highest]].map(([label, value]) => (
                    <div key={String(label)}><span className="muted">{label}</span><strong>{dollars(value as number)}</strong></div>
                  ))}
                </div>
              )}
              <ComparableBrowser sources={browse} size={d.size} />
            </div>
          </details>
        )}

        {mercariEvidence?.tiers && (
          <details className="disclosure">
            <summary>
              Mercari listings by match{" "}
              <small>
                {mercariEvidence.tiers.exact.listings.length} same size and condition · {mercariEvidence.tiers.sameSizeOtherCondition.listings.length} same size · {mercariEvidence.tiers.sameConditionOtherSize.listings.length} same condition
              </small>
            </summary>
            <div className="disclosure-body">
              <ComparisonTiersView tiers={mercariEvidence.tiers} marketplace="Mercari" reference={expired ? null : mercariEvidence.recommendation.marketReference} />
            </div>
          </details>
        )}

        <details className="disclosure">
          <summary>Profit calculator <small>Estimate what you&apos;ll keep</small></summary>
          <div className="disclosure-body">
            <MarketplaceProfit ebay={data} mercari={mercariEvidence} now={clock} manualPrice={manualPrice} />
            {/sneaker|shoe|footwear/i.test(state.confirmed.category || "") && <EbayProceeds key={key + String(manualPrice ?? suggested)} askingPrice={manualPrice ?? suggested} ownPrice={manualPrice !== null} isSneaker />}
          </div>
        </details>

        <details className="disclosure">
          <summary>About these prices</summary>
          <div className="disclosure-body">
            <ul className="evidence-list">
              <li>Prices come from items currently listed for sale, not from completed sales.</li>
              <li>We only compare listings that match your item, and leave out ones that don&apos;t.</li>
              <li>We don&apos;t predict how fast an item will sell.</li>
            </ul>
          </div>
        </details>

        {debug && (
          <details className="disclosure">
            <summary>Developer details</summary>
            <div className="disclosure-body fine">
              <MarketplaceComparison ebay={searchIdentification === state.confirmed ? data : null} mercari={mercariEvidence} now={clock} />
              <EbayAIReview result={result} />
              {result?.searchDiagnostics && <p>{result.searchDiagnostics.exact} exact · {result.searchDiagnostics.close} close · {result.searchDiagnostics.related} related · {result.examined} examined · {result.excluded} excluded · {result.invalid} invalid</p>}
              {result?.diagnostics && <ul>{Object.entries(result.diagnostics.exclusions).map(([r, n]) => <li key={r}>{r.replaceAll("_", " ")}: {n}</li>)}</ul>}
              {result?.reason && <p>{result.reason}</p>}
              <p>{(recommendation?.reasons || []).join(" ")}</p>
            </div>
          </details>
        )}
      </div>
      <div role="status" className="sr-only">{loading ? "Checking prices. " + loadingMessages.ebay.join(". ") : ""}</div>
    </section>
  );
}
