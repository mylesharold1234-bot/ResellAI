import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createDailySnapshots,snapshotIdentity} from "./daily-snapshots";
import {emptyMatchDetails,type MarketplaceProvider,type MarketplaceResult,type ProductQuery} from "./marketplaces";
import {listingDisplayPrice,pricingEngine} from "./pricing-engine";

const query:ProductQuery={identification:{brand:"Nike",model:"Air Jordan 1 Mid",productName:"Air Jordan 1 Mid",category:"Sneakers",colorway:"black and white",visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},details:emptyMatchDetails};
const start=Date.parse("2026-11-09T12:00:00Z");
function fixture(provider:"ebay"|"mercari",prices:number[],now=start):MarketplaceResult{
 return {provider,environment:"production",status:"available",query:"jordan",retrievedAt:new Date(now).toISOString(),
 expiresAt:new Date(now+300000).toISOString(),cached:false,examined:prices.length,excluded:0,invalid:0,warnings:[],
 comparables:prices.map((price,i)=>({id:String(i),title:"Jordan 1 Mid Black White",price,currency:"USD",status:"asking",matchTier:"close",priceEligible:true,
 condition:"Used",conditionId:"3000",url:provider==="ebay"?"https://www.ebay.com/itm/"+i:"https://www.mercari.com/us/item/m"+i,observedAt:new Date(now).toISOString(),shipping:null,seller:"s"+i,categories:[],matchReasons:[],warnings:[]}))};
}
test("daily snapshots persist across instances, isolate marketplaces and refresh only on request",async()=>{
 const root=await mkdtemp(join(tmpdir(),"resellai-snapshots-"));
 try{
  let time=start,calls=0,failed=false;
  const provider:MarketplaceProvider={id:"ebay",async search(_,options){
   calls++; const result=fixture("ebay",options?.refresh?[110,120,130]:[90,100,110],time);
   return failed?{...result,status:"unavailable"}:result;
  }};
  const read=createDailySnapshots(root,()=>time);
  const [first,duplicate]=await Promise.all([read(provider,query),read(provider,query)]);
  assert.deepEqual(first,duplicate);
  time+=3_600_000;
  const restart=createDailySnapshots(root,()=>time);
  const repeated=await restart(provider,{...query,identification:{...query.identification,brand:"Jordan",colorway:"White / Black",productName:"Likely Air Jordan 1 Mid Sneakers",uncertainties:["Exact release unclear"]}});
  assert.deepEqual(first,repeated);
  assert.equal(calls,1);
  const updated=await restart(provider,query,true);
  assert.equal(updated.snapshot.version,"000002");
  assert.equal(updated.recommendation.suggestedListingPrice,120);
  failed=true;
  await restart(provider,query,true);
  assert.deepEqual(await restart(provider,query),updated);
  const mercari=await restart({id:"mercari",search:async()=>fixture("mercari",[50,60,70],time)},query);
  assert.equal(mercari.recommendation.suggestedListingPrice,60);
  assert.equal(mercari.result.provider,"mercari");
  assert.equal(mercari.snapshot.version,"000001");
  time+=86_400_000;
  failed=false;
  const next=await restart(provider,query);
  assert.notEqual(next.snapshot.day,first.snapshot.day);
  assert.equal(next.snapshot.version,"000001");
  assert.equal(calls,4);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("snapshot identities separate size, condition, color, verified SKU and silhouette",()=>{
 const key=(q:ProductQuery)=>snapshotIdentity("mercari",q,"2026-11-09");
 for(const variation of [
  {...query,details:{...emptyMatchDetails,size:"9.5",sizeSystem:"US Men" as const}},
  {...query,details:{...emptyMatchDetails,condition:"new" as const}},
  {...query,details:{...emptyMatchDetails,variant:"SE",productIdentifierVerified:true,productIdentifier:"AB1234"}},
  {...query,identification:{...query.identification,colorway:"red white"}},
  {...query,identification:{...query.identification,model:"Air Jordan 1 High"}},
  {...query,identification:{...query.identification,model:"Air Jordan 1 Mid SE"}},
 ])assert.notEqual(key(variation),key(query));
});

test("pricing is order-stable, preserves insufficient evidence and rounds within the exact observed cohort",()=>{
 const result=fixture("mercari",[15.56,90,95,100,105,110,999]);
 const original=pricingEngine(result,query,undefined,start);
 const reversed=pricingEngine({...result,comparables:[...result.comparables].reverse()},query,undefined,start);
 assert.deepEqual(original,reversed);
 assert.deepEqual(original.indicativeAskingRange,{low:90,high:110});
 assert.equal(listingDisplayPrice(original.suggestedListingPrice,original.indicativeAskingRange),99.99);
 assert.equal(listingDisplayPrice(100,{low:100,high:100}),100);
 const dispersed=fixture("mercari",[15,45,60,80,100]);
 assert.equal(pricingEngine(dispersed,query,undefined,start).suggestedListingPrice,null);
 for(const i of [2,3,4])dispersed.comparables[i].matchReasons=["Visible colors present in title"];
 const narrowed=pricingEngine(dispersed,query,undefined,start);
 assert.equal(narrowed.suggestedListingPrice,80);
 assert.deepEqual(narrowed.indicativeAskingRange,{low:60,high:100});
});

test("partial retrieval is not frozen for the day and cannot replace a complete snapshot",async()=>{
 const root=await mkdtemp(join(tmpdir(),"resellai-partial-snapshot-"));
 try{
  let partial=true,calls=0;
  const provider:MarketplaceProvider={id:"ebay",search:async()=>{
    calls++;
    return {...fixture("ebay",[90,100,110]),searchCompleteness:partial?"partial":"complete",warnings:partial?["Partial marketplace search: stage failure"]:[]};
  }};
  const read=createDailySnapshots(root,()=>start);
  const first=await read(provider,query);
  assert.equal(first.snapshot.persisted,false);
  assert.equal(Date.parse(first.result.expiresAt!),start+300000);
  partial=false;
  const complete=await read(provider,query);
  assert.equal(calls,2);
  assert.equal(complete.snapshot.persisted,true);
  assert.equal(complete.snapshot.version,"000001");
  partial=true;
  const failed=await read(provider,query,true);
  assert.equal(failed.result.status,"unavailable");
  assert.match(failed.result.reason||"",/previous daily snapshot was kept/);
  assert.deepEqual(await read(provider,query),complete);
  assert.equal(calls,3);
 }finally{await rm(root,{recursive:true,force:true});}
});
