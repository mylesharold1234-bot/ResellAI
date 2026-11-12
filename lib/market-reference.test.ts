import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {recommend} from './valuation';
import {tierComparable} from './ebay-search';
import {emptyMatchDetails,type ProductQuery,type Comparable,type MarketplaceResult} from './marketplaces';
import {PricingPanel} from '../components/pricing-panel';
import {MarketplaceProfit} from '../components/marketplace-intelligence';
const now=Date.now();
const query:ProductQuery={identification:{brand:'Nike',model:'Dunk Low',productName:'Nike Dunk Low',category:'Sneakers',colorway:'black white',visibleCondition:null,identifyingInformation:null,confidence:'medium',uncertainties:[],additionalEvidence:[]},details:{...emptyMatchDetails,size:'10',sizeSystem:'US Men',condition:'new'}};
function source(provider:'ebay'|'mercari'='ebay'):MarketplaceResult{
 const rows:Comparable[]=[65,70,75].map((price,n)=>({id:String(n),title:'Nike Dunk Low Panda Black White Mens Size 10',price,currency:'USD',status:'asking',condition:'New',conditionId:'1000',url:provider==='ebay'?'https://www.ebay.com/itm/'+n:'https://www.mercari.com/us/item/m'+n+'/',observedAt:new Date(now).toISOString(),shipping:null,seller:'seller'+n,categories:[],matchReasons:[],warnings:[]}));
 return {provider,status:'available',environment:'production',query:'Nike Dunk Low black white',comparables:rows.map(row=>tierComparable(row,query).item!),retrievedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),cached:true,examined:3,excluded:0,invalid:0,warnings:[]};
}
test('separate broader reference never populates recommendation or profit for either marketplace',()=>{
 for(const provider of ['ebay','mercari'] as const){
  const result=source(provider),rec=recommend(result,query,undefined,now);
  assert.equal(rec.suggestedListingPrice,null);assert.equal(rec.eligibleCount,0);
  assert.equal(rec.marketReference?.median,70);assert.equal(rec.marketReference.count,3);
  assert.equal(rec.marketReference.kind,'broader-market-asking-reference');
  const html=renderToStaticMarkup(createElement(PricingPanel,{recommendation:rec,expired:false}));
  assert.match(html,/Price unavailable/);assert.match(html,/Non-item-specific reference only/);assert.doesNotMatch(html,/Recommended Listing Price|class="big-value"/);
  const profit=renderToStaticMarkup(createElement(MarketplaceProfit,{ebay:{result,recommendation:rec},mercari:null,now}));
  assert.match(profit,/Profit unavailable without a current supported listing price/);assert.doesNotMatch(profit,/Hypothetical sale price/);
  const expired=renderToStaticMarkup(createElement(PricingPanel,{recommendation:rec,expired:true}));
  assert.doesNotMatch(expired,/Broader market asking-price reference/);
 }
});
test('broader reference preserves freshness, model, condition, variant, variation and seller safeguards',()=>{
 const base=source();
 for(const changed of [
  {...base,expiresAt:new Date(now-1).toISOString()},
  {...base,status:'unavailable' as const},
  {...base,comparables:base.comparables.slice(0,2)},
  {...base,comparables:base.comparables.map(x=>({...x,seller:'one'}))},
  {...base,comparables:base.comparables.map(x=>({...x,title:x.title.replace('Dunk Low','Dunk High')}))},
  {...base,comparables:base.comparables.map(x=>({...x,conditionId:'3000'}))},
  {...base,comparables:base.comparables.map(x=>({...x,warnings:['Variation selection unverified']}))},
 ])assert.equal(recommend(changed,query,undefined,now).marketReference,null);
 const sku={...query,details:{...query.details,productIdentifier:'DD1391-100',productIdentifierVerified:true}};
 assert.equal(recommend(base,sku,undefined,now).marketReference,null);
 assert.equal(recommend(base,{...query,details:{...query.details,variant:'Special Edition'}},undefined,now).marketReference,null);
});
test('item-specific evidence takes priority and remains deterministic',()=>{
 const result=source();
 result.comparables=result.comparables.map(x=>tierComparable({...x,title:x.title.replace('Mens Size','Mens US Size'),warnings:[]},query).item!);
 const rec=recommend(result,query,undefined,now);
 assert.equal(rec.suggestedListingPrice,70);assert.equal(rec.marketReference,null);
 assert.deepEqual(rec,recommend(result,query,undefined,now));
});
