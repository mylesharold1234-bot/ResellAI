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
export function recommend(result:MarketplaceResult,query:ProductQuery,options:PricingOptions=defaultPricingOptions,now=Date.now()):ReturnType<typeof pricingEngine>&{marketReference?:MarketReference|null}{
 const item=pricingEngine(result,query,options,now);
 return {...item,marketReference:item.suggestedListingPrice===null?broaderMarketReference(result,query,now):null};
}
