import {pricingEngine,defaultPricingOptions,type PricingOptions} from './pricing-engine';
import {broaderMarketReference,type MarketReference} from './market-reference';
import type {
  Comparable,
  MarketplaceResult,
  ProductQuery,
} from "./marketplaces";
export const roundMoney = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function askingStatistics(items: Comparable[]) {
  const seen = new Set<string>();
  const prices = items
    .filter(
      (x) =>
        x.status === "asking" &&
        x.currency === "USD" &&
        Number.isFinite(x.price) &&
        x.price > 0 &&
        !seen.has(x.id) &&
        !!seen.add(x.id),
    )
    .map((x) => Math.round(x.price * 100))
    .sort((a, b) => a - b);
  if (!prices.length) return null;
  const n = prices.length;
  const median =
    n % 2 ? prices[(n - 1) / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2;
  return {
    count: n,
    median: roundMoney(median / 100),
    average: roundMoney(prices.reduce((a, b) => a + b, 0) / n / 100),
    lowest: prices[0] / 100,
    highest: prices[n - 1] / 100,
  };
}
export type SampleCoverage={partial:boolean;read:number;reportedTotal:number|null;share:number|null;order:'best-match'|'relevance'};
/**
 * How representative the sample is. A search that stopped at a full page, without reaching at least three
 * quarters of what the marketplace reports, is a partial sample in the marketplace's own ranking order
 * (eBay Best Match, Mercari relevance), not the whole market. Older snapshots without totals are judged
 * from their pages alone.
 */
export function sampleCoverage(result:MarketplaceResult):SampleCoverage{
 const order=result.provider==='mercari'?'relevance' as const:'best-match' as const;
 const c=result.searchDiagnostics?.coverage;
 if(c){
  const share=c.reportedTotal?Math.min(1,c.read/c.reportedTotal):null;
  return {partial:!c.exhausted&&(share===null||share<0.75),read:c.read,reportedTotal:c.reportedTotal,share,order};
 }
 const attempts=result.searchDiagnostics?.attempts||[];
 const full=attempts.some(a=>a.limit>0&&a.returned>=a.limit);
 return {partial:full,read:attempts[0]?.returned??result.examined,reportedTotal:null,share:null,order};
}
type Recommendation=ReturnType<typeof pricingEngine>&{marketReference?:MarketReference|null;sampleCoverage?:SampleCoverage};
/** Adds sample coverage to a recommendation (including one saved before coverage existed). */
export function withCoverage<T extends Recommendation>(rec:T,result:MarketplaceResult):T{
 if(rec.sampleCoverage)return rec;
 const coverage=sampleCoverage(result);
 // A price from a partial sample is an estimate, and says so; it is never presented as the whole market.
 const partialPrice=coverage.partial&&rec.suggestedListingPrice!==null;
 return {...rec,provisional:rec.provisional||partialPrice,sampleCoverage:coverage,
  reasons:partialPrice?[...rec.reasons,'Partial sample: the first '+coverage.read+(coverage.reportedTotal?' of about '+coverage.reportedTotal:'')+' results in '+(coverage.order==='best-match'?'eBay Best Match':'Mercari relevance')+' order; the full market may differ.']:rec.reasons};
}
export function recommend(result:MarketplaceResult,query:ProductQuery,options:PricingOptions=defaultPricingOptions,now=Date.now()):Recommendation{
 const item=pricingEngine(result,query,options,now);
 return withCoverage({...item,marketReference:item.suggestedListingPrice===null?broaderMarketReference(result,query,now):null},result);
}
