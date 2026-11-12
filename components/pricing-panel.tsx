"use client";
import type { ReactNode } from "react";
import type { recommend } from "../lib/valuation";
import { listingDisplayPrice, type PricingOptions } from "../lib/pricing-engine";
import {evidenceQuality} from "../lib/pricing-intelligence";
import { RequestSpinner, SkeletonLines } from "./request-loading";

type Recommendation=ReturnType<typeof recommend>;
export const dollars=(price:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(price);
export function PricingPanel({marketplace="eBay",recommendation,previous,expired,requestStatus,updatedAt,version,onRefresh,error,children,historical,snapshotNotice}:{
  marketplace?:"eBay"|"Mercari";recommendation?:Recommendation;previous?:Recommendation;
  expired:boolean;requestStatus?:"idle"|"loading"|"success"|"error";updatedAt?:string|null;version?:string;
  onRefresh?:()=>void;error?:string;children?:ReactNode;historical?:number|null;
  snapshotNotice?:string;
  options?:PricingOptions;onChange?:(value:PricingOptions)=>void;
}){
 const loading=requestStatus==="loading";
 const old=loading||requestStatus==="error";
 const rec=old?previous:recommendation;
 const range=rec?.indicativeAskingRange??null;
 const price=listingDisplayPrice(rec?.suggestedListingPrice??null,range);
 const quality=rec?evidenceQuality(rec):null;
 return <section className="panel valuation" aria-label={marketplace+" pricing"}>
  <div className="row"><h2>{marketplace}</h2><span className="pill">{expired?"EXPIRED SNAPSHOT":"ASKING ≠ SOLD"}</span></div>
  <div role="status" className="sr-only">{loading?"Analyzing "+marketplace+" marketplace prices.":rec&&!old?"Pricing analysis complete.":""}</div>
  {loading&&<p className="market-price-loading"><RequestSpinner size={18}/>Analyzing marketplace prices…</p>}
  {old&&price!==null&&<p className="fine"><strong>Previous results</strong></p>}
  {(!expired||old)&&price!==null&&range?<div className="market-price-result">
    <h3>{marketplace==="Mercari"&&rec?.provisional?"Estimated Listing Price":"Recommended Listing Price"}</h3>
    <div className="big-value">{dollars(price)}</div>
    <p><strong>Comparable Asking Range:</strong> {dollars(range.low)}–{dollars(range.high)}</p>
    <p>Based on {rec?.eligibleCount} comparable {marketplace} listings.</p>
    <p>Evidence quality: <strong>{quality?.level}</strong></p>
  </div>:loading?<div aria-busy="true"><SkeletonLines/></div>:<div>
    <h3>{requestStatus==="idle"?"Ready to compare listings":"Price unavailable"}</h3>
    {expired?<p className="fine">Refresh market prices for a new recommendation.{historical!=null?" Historical starting ask: "+dollars(historical)+".":""}</p>:
      <p className="fine">{rec?.blockers[0]||"A price appears when enough relevant active listings qualify."}</p>}
  </div>}
  {!expired&&!old&&rec&&price===null&&rec.blockers.length>0&&<p className="fine"><strong>Insufficient evidence.</strong></p>}
  {!expired&&!old&&!loading&&price===null&&rec?.marketReference&&<aside className="block" aria-label="Broader market asking-price reference">
    <h3>Broader market asking-price reference</h3>
    <p><strong>Median asking price: {dollars(rec.marketReference.median)}</strong></p>
    <p>Observed asking range: {dollars(rec.marketReference.range.low)}–{dollars(rec.marketReference.range.high)} · {rec.marketReference.count} listings</p>
    <p className="fine">Non-item-specific reference only. Not a recommended price for your item, a verified sale value, or a guaranteed sale price. Excluded from the profit calculator.</p>
    <p className="fine">{rec.marketReference.scope}</p>
    <ul className="fine">{rec.marketReference.excludedAttributes.map(reason=><li key={reason}>{reason}</li>)}</ul>
  </aside>}
  {snapshotNotice&&<p className="fine">{snapshotNotice}</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {updatedAt&&<p className="fine">Updated {new Date(updatedAt).toLocaleString()}{version?" · Version "+Number(version):""}</p>}
  {onRefresh&&<button className="secondary" disabled={loading} onClick={onRefresh}>
    {loading?"Searching…":requestStatus==="error"?"Retry "+marketplace+" search":rec?"Refresh Market Prices":"Search "+marketplace+" comparables"}
  </button>}
  {rec&&<details className="block"><summary>Pricing assumptions and evidence</summary>
    <p className="fine">{rec.rationale} Item asks exclude shipping, tax, and seller fees. The median may be displayed at a nearby .99 price only if it stays within the observed range and within $0.25 of the median. A recommended listing price does not establish a completed-sale price.</p>
    <p className="fine">Median: {rec.statistics?dollars(rec.statistics.median):"Unavailable"} · Condition cohort: {rec.conditionCohort||"unknown"} · {rec.pricingBasis} evidence{rec.variantCohort?" · Footwear group: "+rec.variantCohort:""}</p>
    {quality&&<p className="fine">{quality.reasons.join(" · ")}</p>}
    <ul>{[...new Set([...rec.blockers,...rec.limitations,...rec.reasons])].map(reason=><li key={reason}>{reason}</li>)}</ul>
    <ul>{Object.entries(rec.exclusions).map(([reason,count])=><li key={reason}>{reason}: {count}</li>)}</ul>
  </details>}
  {children}
 </section>;
}
