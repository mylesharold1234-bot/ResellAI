import type {MarketplaceResult} from "../lib/marketplaces";
export function RetrievalDiagnostics({result}:{result?:MarketplaceResult}){
 const diagnostics=result?.retrievalDiagnostics;
 if(!result||!diagnostics)return null;
 const labels={
  none:"A qualifying cohort is available",
  "retrieval-error":"Search could not complete; review the failed stage",
  "no-results":"The marketplace returned no results",
  matching:"Too few retrieved listings passed matching; review query coverage and rejection reasons",
  "pricing-cohort":"Candidates were found, but no cohort passed pricing safeguards",
 };
 return <details className="fine block"><summary>Search retrieval diagnostics</summary>
  <p>{labels[diagnostics.bottleneck]}</p>
  <p>{result.examined} rows returned · {diagnostics.uniqueListings} unique normalized listings · {diagnostics.duplicateRows} duplicate rows
    · {diagnostics.pricingCandidates} pricing candidates · {diagnostics.cohortCount} in final cohort</p>
  <p>{diagnostics.requests} provider search requests recorded · {Math.round(diagnostics.latencyMs)} ms
    {diagnostics.duplicateRate!==null?" · Duplicate rate: "+(100*diagnostics.duplicateRate).toFixed(1)+"%":""}</p>
  <ul>{result.searchDiagnostics?.attempts.map((step,index)=><li key={index}>
   {step.stage}: “{step.query}” — {step.returned} rows, {step.unique??"—"} new IDs, {step.duplicates??"—"} duplicates,
   {step.candidates??"—"} new compatible candidates · {step.latencyMs??"—"} ms{step.error?"; "+step.error:""}
  </li>)}</ul>
  <p>Times and request counts describe the saved search, not the cost of reopening a daily snapshot. No seller identifiers, credentials or raw provider payloads are included here.</p>
 </details>;
}
