import {test} from "node:test";
import assert from "node:assert/strict";
import {evidenceQuality,compareMarketplaceEvidence,marketplaceProfitScenario} from "./pricing-intelligence";
import {pricingEngine} from "./pricing-engine";
import {emptyMatchDetails,type MarketplaceResult,type ProductQuery} from "./marketplaces";

const now=Date.parse("2026-11-10T12:00:00Z");
const q:ProductQuery={identification:{brand:"Sony",model:"WH-1000XM5",productName:"Sony WH-1000XM5 Headphones",category:"Headphones",colorway:null,visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},details:{...emptyMatchDetails,condition:"used"}};
function fixture(provider:"ebay"|"mercari",prices:number[]):MarketplaceResult{
 return {provider,environment:"production",status:"available",query:"sony headphones",retrievedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),cached:false,examined:prices.length,excluded:0,invalid:0,warnings:[],comparables:prices.map((price,i)=>({
 id:String(i),title:"Sony WH-1000XM5 Headphones",price,currency:"USD",status:"asking",matchTier:"exact",priceEligible:true,condition:"Used",conditionId:"3000",url:"https://example.test/item/"+i,observedAt:new Date(now).toISOString(),shipping:null,seller:"seller"+i,categories:[],matchReasons:[],warnings:[],
 }))};
}
const evaluate=(result:MarketplaceResult)=>({result,recommendation:pricingEngine(result,q,undefined,now)});

test("comparison prefers independently stronger evidence, not a higher ask",()=>{
 const ebay=evaluate(fixture("ebay",[90,92,95,96,98,99,100,101]));
 const mercari=evaluate(fixture("mercari",[105,110,120,125,130]));
 assert.equal(evidenceQuality(ebay.recommendation).level,"High");
 assert.equal(evidenceQuality(mercari.recommendation).level,"Medium");
 assert.equal(compareMarketplaceEvidence(ebay,mercari,now).marketplace,"eBay");
 assert.equal(compareMarketplaceEvidence(null,mercari,now).marketplace,null);
 assert.equal(compareMarketplaceEvidence(ebay,mercari,now+300001).marketplace,null);
 const otherGrade=evaluate({...mercari.result,comparables:mercari.result.comparables.map(i=>({...i,conditionId:"2990"}))});
 assert.equal(compareMarketplaceEvidence(ebay,otherGrade,now).marketplace,null);
 assert.equal(evidenceQuality({...ebay.recommendation,reasons:["Partial marketplace search: server failure"]}).level,"Limited");
});

test("pricing benchmark compares identical synthetic inputs with the previous selection rules",t=>{
 const clean=fixture("ebay",[90,95,100,105,110,900]);
 const duplicate=fixture("mercari",[85,100,105]);
 duplicate.comparables.push({...duplicate.comparables[0],price:80});
 const mixed=fixture("ebay",[60,65,70,75,95,100,105,108,110]);
 mixed.comparables=mixed.comparables.map((item,i)=>({...item,matchTier:"close",quality:{score:i<4?50:80,signals:[]}}));
 const empty=fixture("mercari",[]);
 const cases=[clean,duplicate,mixed,empty];
 // Legacy adapter kept the first duplicate; legacy engine only preferred a
 // high-evidence subset when the combined cohort failed.
 const before=cases.map(result=>{
  const rows=[...new Map([...result.comparables].reverse().map(row=>[row.id,row])).values()];
  return evaluate({...result,comparables:rows.map(row=>({...row,quality:undefined}))}).recommendation;
 });
 const after=cases.map(result=>evaluate(result).recommendation);
 const summary=(rows:typeof before)=>rows.map(r=>[r.suggestedListingPrice,r.eligibleCount]);
 t.diagnostic(JSON.stringify({before:summary(before),after:summary(after)}));
 assert.deepEqual(summary(before),[[100,5],[100,3],[95,9],[null,0]]);
 assert.deepEqual(summary(after),[[100,5],[null,2],[105,5],[null,0]]);
 assert.equal(after[1].exclusions["exact: conflicting duplicate listing"],2);
 assert.deepEqual(after[2].indicativeAskingRange,{low:95,high:110});
});

test("profit requires explicit costs and calculates net and negative profit in cents",()=>{
 const amounts={purchase:"40",buyerShipping:"5",sellerShipping:"8.50",fee:"13.02",extras:"0"};
 assert.deepEqual(marketplaceProfitScenario(100,amounts),{proceeds:83.48,profit:43.48});
 assert.equal(marketplaceProfitScenario(100,{...amounts,fee:""}),null);
 assert.equal(marketplaceProfitScenario(100,{...amounts,extras:"-1"}),null);
 assert.deepEqual(marketplaceProfitScenario(10,{...amounts,purchase:"20"}),{proceeds:-6.52,profit:-26.52});
});
