import {recommend} from "./valuation";
import type {MarketplaceResult,ProductQuery} from "./marketplaces";

export function retrievalDiagnostics(result:MarketplaceResult,query:ProductQuery,unique:number,duplicateRows:number,requests:number,latencyMs:number){
 const rec=recommend(result,query,undefined,result.retrievedAt?Date.parse(result.retrievedAt):Date.now());
 const pricingCandidates=result.comparables.filter(x=>x.priceEligible&&x.matchTier!=="related"&&!x.warnings.includes("Conflicting duplicate listing")).length;
 const error=result.status==="unavailable"||result.searchDiagnostics?.attempts.some(a=>a.error);
 return {uniqueListings:unique,duplicateRows,duplicateRate:unique+duplicateRows?duplicateRows/(unique+duplicateRows):null,
  pricingCandidates,cohortCount:rec.eligibleCount,
  bottleneck:rec.suggestedListingPrice!==null?"none" as const:error?"retrieval-error" as const:!result.examined?"no-results" as const:pricingCandidates<3?"matching" as const:"pricing-cohort" as const,
  latencyMs:Math.max(0,latencyMs),requests};
}
export function sufficientSearchEvidence(result:MarketplaceResult,query:ProductQuery){
 const rec=recommend(result,query,undefined,result.retrievedAt?Date.parse(result.retrievedAt):Date.now());
 return rec.suggestedListingPrice!==null&&rec.eligibleCount>=5&&rec.pricingDiagnostics.sellerCount>=3;
}
