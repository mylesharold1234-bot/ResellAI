import {tierComparable} from './ebay-search';
import {matchMercari} from './mercari-matching';
import {scoreComparable} from './comparable-quality';
import {pricingEngine,defaultPricingOptions} from './pricing-engine';
import type {MarketplaceResult,ProductQuery} from './marketplaces';

export type MarketReference={kind:'broader-market-asking-reference';median:number;range:{low:number;high:number};count:number;listingIds:string[];scope:string;updatedAt:string|null;excludedAttributes:string[]};
// Uses the same response only. Never retrieves or looks up another product's snapshot.
export function broaderMarketReference(result:MarketplaceResult,q:ProductQuery,now:number):MarketReference|null{
 if(!q.details.size||!q.details.sizeSystem)return null;
 const broader:ProductQuery={...q,details:{...q.details,size:'',sizeSystem:''}};
 const rows=result.comparables.flatMap(row=>{
  // Rematch from source facts; preserve upstream price-integrity warnings.
  const source={...row,quality:undefined,matchReasons:[],warnings:row.warnings.filter(w=>/^Variation selection unverified|^Conflicting duplicate listing|^Seller identifier unavailable/.test(w))};
  const match=result.provider==='mercari'?matchMercari(source,broader):tierComparable(source,broader);
  return match.item?[{...match.item,quality:scoreComparable(match.item)}]:[];
 });
 // Existing thresholds, condition/edition cohorts, outlier and seller rules apply unchanged.
 const evidence=pricingEngine({...result,comparables:rows},broader,defaultPricingOptions,now);
 if(evidence.suggestedListingPrice===null||!evidence.statistics||!evidence.indicativeAskingRange)return null;
 return {kind:'broader-market-asking-reference',median:evidence.statistics.median,range:evidence.indicativeAskingRange,count:evidence.eligibleCount,listingIds:evidence.eligibleIds,
  scope:'Same model, supported colors and compatible condition/edition; across unverified sizes and sizing groups. Item-only active asks, excluding shipping, tax and fees.',updatedAt:result.retrievedAt,
  excludedAttributes:['Size '+q.details.size+' / '+q.details.sizeSystem+' is not verified for this broader cohort.']};
}
