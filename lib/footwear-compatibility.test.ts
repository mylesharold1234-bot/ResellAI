import {test} from "node:test";
import assert from "node:assert/strict";
import {tierComparable,searchPlan} from "./ebay-search";
import {matchMercari} from "./mercari-matching";
import {pricingEngine} from "./pricing-engine";
import {emptyMatchDetails,type Comparable,type MarketplaceResult,type ProductQuery} from "./marketplaces";
import {nonWearableReason} from "./footwear-compatibility";

const q:ProductQuery={identification:{brand:"Nike",model:"Air Jordan 1",productName:"Nike Air Jordan 1 High Top Sneaker",category:"Sneakers",colorway:"black and white",visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},details:{...emptyMatchDetails,condition:"new"}};
const row=(title:string,n=0,price=100):Comparable=>({id:String(n),title,price,currency:"USD",status:"asking",condition:"New",conditionId:"1000",url:"https://www.ebay.com/itm/"+n,observedAt:"2026-11-11T17:34:30.126Z",shipping:null,seller:"seller"+n,categories:[],matchReasons:[],warnings:[]});
const result=(items:Comparable[]):MarketplaceResult=>({provider:"ebay",environment:"production",status:"available",query:"fixture",comparables:items,examined:items.length,excluded:0,invalid:0,cached:false,warnings:[],retrievedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()});

test("wearable footwear excludes miniatures and accessories without rejecting small wearable shoes",()=>{
 for(const title of [
 "1/6 Scale Jordan 1 Sneakers for 12 inch Figure - Black White Mocha (1 Pair)",
 "Jordan 1 High Black White doll footwear", "Jordan 1 High Black White keychain",
 "Jordan 1 High Black White ornament", "Jordan 1 High Black White scale replica",
 ]){
  assert.equal(tierComparable(row(title),q).reason,"non_wearable_footwear");
  assert.equal(matchMercari(row(title),q).item,null);
 }
 assert.equal(nonWearableReason({...row("Jordan 1 High Black White"),categories:["Dolls & Doll Accessories"]},q),"non_wearable_footwear");
 const child={...q,details:{...q.details,sizeSystem:"US Youth" as const}};
 for(const title of ["Jordan 1 High Black White Kids Size 3","Jordan 1 High Black White Youth Size 5.5"]){
  assert.equal(tierComparable(row(title),child).item?.priceEligible,true);
  assert.equal(matchMercari(row(title),child).item?.priceEligible,true);
 }
});

test("all search stages preserve supported colors and silhouette without guessing an edition",()=>{
 const plan=searchPlan(q);
 assert.ok(plan.length<=4);
 for(const step of plan){
  assert.match(step.query,/black/);assert.match(step.query,/white/);assert.match(step.query,/high/);
  assert.doesNotMatch(step.query,/\b(?:mid|low|og|sp)\b/);
 }
 const unknown={...q,identification:{...q.identification,productName:"Nike Air Jordan 1 sneaker"}};
 for(const step of searchPlan(unknown))assert.doesNotMatch(step.query,/\b(?:mid|low|high|og|sp)\b/);
});

test("standard, OG and OG SP do not pool into a recommendation; valid groups still qualify",()=>{
 const titles=[
  ["Nike Air Jordan 1 Retro High OG SP High Top Colorblock Black White US 9",200],
  ["Nike Air Jordan 1 Men's High Top Sneaker US 7 Black White Lace-Up",45.5],
  ["NIKE Air Jordan 1 Retro High OG Men's Shoes Size 11.5 Black White NEW",87.99],
  ["NIKE Air Jordan 1 Retro High OG Men's Shoes Size 10 Black White NEW",87.99],
 ] as const;
 const items=titles.map(([title,price],n)=>tierComparable(row(title,n,price),q).item!);
 const weak=pricingEngine(result(items),q);
 assert.equal(weak.suggestedListingPrice,null);
 assert.equal(weak.eligibleCount,2);
 assert.equal(weak.variantCohort,"high/og");
 const added=tierComparable(row("Nike Air Jordan 1 Retro High OG Black White Size 12",4,95),q).item!;
 const supported=pricingEngine(result([...items,added]),q);
 assert.equal(supported.eligibleCount,3);
 assert.equal(supported.suggestedListingPrice,87.99);
 assert.deepEqual(supported.indicativeAskingRange,{low:87.99,high:95});
 const explicit={...q,identification:{...q.identification,model:"Air Jordan 1 High OG"}};
 assert.notEqual(tierComparable(row(titles[0][0]),explicit).item?.priceEligible,true);
 for(const title of ["Jordan 1 Mid Black White","Jordan 1 Low Black White"])assert.equal(tierComparable(row(title),q).item,null);
});


test("explicit Retro High OG accepts abbreviated OG titles but never OG SP editions",()=>{
 const target={...q,identification:{...q.identification,model:"Air Jordan 1 Retro High OG",productName:"Air Jordan 1 Retro High OG"}};
 for(const title of ["Nike Air Jordan 1 Retro High OG Black White","Nike Air Jordan 1 High OG Black White"]){
  assert.equal(tierComparable(row(title),target).item?.priceEligible,true);
  assert.equal(matchMercari(row(title),target).item?.priceEligible,true);
 }
 assert.notEqual(tierComparable(row("Nike Air Jordan 1 Retro High OG SP Black White"),target).item?.priceEligible,true);
 assert.notEqual(matchMercari(row("Nike Air Jordan 1 High OG SP Black White"),target).item?.priceEligible,true);
 const same=["Nike Air Jordan 1 Retro High OG Black White","Nike Air Jordan 1 High OG Black White","Nike Air Jordan 1 High OG Black White"].map((t,n)=>tierComparable(row(t,n,90+n*5),target).item!);
 assert.equal(pricingEngine(result(same),target).suggestedListingPrice,95);
});

test("ordinary standard and unknown-edition groups remain usable without mixing silhouettes",()=>{
 const standard={...q,identification:{...q.identification,model:"Air Jordan 1 High",productName:"Air Jordan 1 High"}};
 const unknown={...q,identification:{...q.identification,productName:"Air Jordan 1 sneakers"}};
 const rows=["Nike Air Jordan 1 High Black White Size 8","Nike Air Jordan 1 High Black White Size 9","Nike Air Jordan 1 High Black White Size 10"].map((title,n)=>tierComparable(row(title,n,90+n*5),standard).item!);
 assert.equal(pricingEngine(result(rows),standard).suggestedListingPrice,95);
 assert.equal(pricingEngine(result(rows),unknown).suggestedListingPrice,95);
 const mixed=[row("Jordan 1 High Black White",0,100),row("Jordan 1 Mid Black White",1,100),row("Jordan 1 Low Black White",2,100)].map(x=>tierComparable(x,unknown).item!);
 assert.equal(pricingEngine(result(mixed),unknown).suggestedListingPrice,null);
 assert.equal(nonWearableReason(row("Dolls Kill platform sneakers"),standard),null);
});

test("complete wearable shoes can include a keychain without admitting accessory-only listings",()=>{
 const title="Nike Air Jordan 1 High Black White Shoes with Box and Keychain";
 assert.equal(tierComparable(row(title),q).item?.priceEligible,true);
 assert.equal(matchMercari(row(title),q).item?.priceEligible,true);
 const qualified=[90,95,100].map((price,n)=>tierComparable(row(title,n,price),q).item!);
 assert.equal(pricingEngine(result(qualified),q).suggestedListingPrice,95);
 for(const bad of ["Nike Air Jordan 1 High Black White Keychain with Box","Nike Air Jordan 1 High Black White Miniature Shoes with Keychain","Nike Air Jordan 1 High Black White shoes for dolls with keychain"]){
  assert.equal(tierComparable(row(bad),q).item,null);
  assert.equal(matchMercari(row(bad),q).item,null);
 }
 assert.equal(tierComparable({...row(title),categories:["Keychains"]},q).item,null);
});
