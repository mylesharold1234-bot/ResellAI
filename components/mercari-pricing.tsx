"use client";
import {useEffect} from "react";
import type {MarketplaceResult,ProductQuery} from "../lib/marketplaces";
import type {recommend} from "../lib/valuation";
import {RetrievalDiagnostics} from "./retrieval-diagnostics";
import {PricingPanel,dollars} from "./pricing-panel";
import type {PricingEvidence} from "../lib/pricing-intelligence";
import {useRequest} from "./use-request";

type Data={result:MarketplaceResult;recommendation:ReturnType<typeof recommend>;snapshot?:{version:string;updatedAt:string;persisted?:boolean}};
export function MercariPricing({query,now,confirmationId,onEvidence}:{query:ProductQuery;now:number;confirmationId:string|null;onEvidence:(scope:string,data:PricingEvidence|null)=>void}){
  const scope=JSON.stringify(query);
  const {state,run,previous}=useRequest<Data>(scope);
  const data=state.status==="success"?state.data:null;
  const result=data?.result;
  useEffect(()=>{onEvidence(scope,data);},[scope,data,onEvidence]);
  function search(refresh=false){
    return run(async signal=>{
      let response:Response;
      try{
        response=await fetch("/api/marketplaces/mercari",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({...query,refresh}),signal:AbortSignal.any([signal,AbortSignal.timeout(55000)])});
      }catch{throw Error("Could not reach Mercari comparisons. Try again.");}
      const body=await response.json().catch(()=>null);
      if(!response.ok||body?.result?.provider!=="mercari"||!body.recommendation)throw Error(body?.error||"Mercari comparisons are unavailable.");
      if(body.result.status==="unavailable")throw Error((body.result.reason||"Mercari is unavailable.")+
        (body.result.retryAfterSeconds?" Retry after about "+body.result.retryAfterSeconds+" seconds.":""));
      return body;
    });
  }
  useEffect(()=>{
    let cancelled=false;
    queueMicrotask(()=>{if(!cancelled&&confirmationId)void search();});
    return ()=>{cancelled=true;};
  },[confirmationId]);
  const display=data??previous;
  return <PricingPanel marketplace="Mercari" recommendation={data?.recommendation} previous={previous?.recommendation}
    expired={!!display?.result.expiresAt&&Date.parse(display.result.expiresAt)<=now} requestStatus={state.status}
    error={state.status==="error"?state.message:undefined} updatedAt={display?.snapshot?.updatedAt??display?.result.retrievedAt}
    version={display?.snapshot?.persisted===false?undefined:display?.snapshot?.version} snapshotNotice={data?.snapshot?.persisted===false?"Incomplete search: this observation is not saved as a daily snapshot. Refresh manually when the provider is available.":undefined} onRefresh={()=>void search(!!previous)}>
    <RetrievalDiagnostics result={result}/>
    {result&&data&&<details className="block"><summary>Mercari pricing diagnostics</summary>
      <p>{result.examined} retrieved · {result.invalid} invalid or duplicate · {data.recommendation.eligibleCount} in final cohort</p>
      <ul>{Object.entries(result.diagnostics?.exclusions||{}).map(([reason,count])=><li key={reason}>{reason.replaceAll("_"," ")}: {count}</li>)}</ul>
      {data.recommendation.pricingDiagnostics&&<>
        <p>Final cohort: {data.recommendation.pricingDiagnostics.prices.map(dollars).join(", ")||"none"}.</p>
        <p>Median: {data.recommendation.statistics?dollars(data.recommendation.statistics.median):"unavailable"} · High/low ratio: {data.recommendation.pricingDiagnostics.spread?.toFixed(2)??"—"} · MAD: {data.recommendation.pricingDiagnostics.mad==null?"—":dollars(data.recommendation.pricingDiagnostics.mad)} · Outlier band: {data.recommendation.pricingDiagnostics.outlierBand==null?"—":dollars(data.recommendation.pricingDiagnostics.outlierBand)} · Sellers: {data.recommendation.pricingDiagnostics.sellerCount}</p>
        <ul>{data.recommendation.pricingDiagnostics.outliers.map(item=><li key={item.id}>{item.id}: {dollars(item.price)} — {item.reason}</li>)}</ul>
      </>}
      <p>{data.recommendation.suggestedListingPrice===null?data.recommendation.blockers.join(" "):data.recommendation.rationale}</p>
      <details><summary>Per-listing matching decisions</summary><ul>{result.diagnostics?.rows.map(row=><li key={row.id}>{row.title} — {row.stage}: {row.reason.replaceAll("_"," ")}</li>)}</ul></details>
    </details>}
    {!!result?.comparables.length&&<details className="block"><summary>View Mercari listing prices</summary>
      <p className="fine">API.SH credits for the saved search: {result.creditsUsed??"not reported"}.</p>
      <ul>{[...result.comparables].sort((a,b)=>(b.quality?.score??0)-(a.quality?.score??0)||a.id.localeCompare(b.id)).map(item=><li key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a> — {dollars(item.price)} · {item.condition} · {item.matchTier}{item.quality?" · evidence "+item.quality.score+"/100":""}{data?.recommendation.eligibleIds.includes(item.id)?" · used in price statistics":""}</li>)}</ul>
    </details>}
  </PricingPanel>;
}
