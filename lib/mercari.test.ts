import {test} from "node:test";
import assert from "node:assert/strict";
import {createMercariProvider} from "./marketplace-providers/mercari";
import {createMarketplaceHandler} from "./marketplace-server";
import {emptyMatchDetails,type ProductQuery} from "./marketplaces";

const query:ProductQuery={identification:{brand:"Nike",model:"Air Jordan 1 Mid",productName:"Air Jordan 1 Mid",category:"Sneakers",colorway:"black white",visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},details:{...emptyMatchDetails,condition:"used"}};
const row=(id:number,price:number,name="Air Jordan 1 Mid Black White",status="on_sale")=>({id:"m"+id,name,price,currency:"USD",status,url:"https://www.mercari.com/us/item/m"+id+"/",seller_id:String(id),condition:"Good"});
const response=()=>Response.json({country:"US",credits_used:1,items:[row(1,90),row(2,100),row(3,110),row(4,1,undefined,"sold"),row(5,20,"Jordan 1 Low Black White"),{...row(6,1),url:"https://evil.example/us/item/m6/"},row(1,90)]});
const request=()=>new Request("http://localhost/api/marketplaces/mercari",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(query)});

test("Mercari search validates API.SH request, listing provenance and separate pricing",async()=>{
 let calls=0;
 const handler=createMarketplaceHandler(createMercariProvider({apiKey:"test-key",fetcher:async(input,init)=>{
   calls++;const url=new URL(String(input));
   assert.equal(url.origin+url.pathname,"https://api.api.sh/mercari/v1/search");
   assert.equal(url.searchParams.get("q"),"nike air jordan 1 mid black white");
   assert.equal(url.searchParams.get("status"),"on_sale");
   assert.equal(url.searchParams.get("country"),"US");
   assert.equal(url.searchParams.has("cursor"),false);
   assert.equal(new Headers(init?.headers).get("x-api-key"),"test-key");
   return response();
 }}));
 const a=await (await handler(request())).json();
 assert.equal(a.result.provider,"mercari");
 assert.equal(a.result.evidenceId,undefined);
 assert.equal(a.result.creditsUsed,1);
 assert.equal(a.result.invalid,3);
 assert.equal(a.result.excluded,1);
 assert.deepEqual(a.result.comparables.map((x:{id:string})=>x.id),["m1","m2","m3"]);
 assert.equal(a.recommendation.suggestedListingPrice,100);
 assert.equal(a.recommendation.eligibleCount,3);
 assert.equal(a.recommendation.expectedSellingPrice,null);
 assert.doesNotMatch(JSON.stringify(a),/test-key/);
 const b=await (await handler(request())).json();
 assert.equal(b.result.cached,true);
 assert.equal(b.result.creditsUsed,0);
 assert.equal(calls,1);
});

test("Mercari coalesces concurrent searches and caps requests even on provider errors",async()=>{
 let calls=0;
 let release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});
 const p=createMercariProvider({apiKey:"test",fetcher:async()=>{calls++;await gate;return new Response(null,{status:500});}});
 const searches=[p.search(query),p.search(query)];
 release();
 await Promise.all(searches);
 assert.equal(calls,1);
 for(let i=0;i<4;i++)await p.search(query);
 assert.equal(calls,5);
 assert.match((await p.search(query)).reason||"",/credit safeguard/);
 assert.equal(calls,5);
});

test("Mercari skips missing keys and cools down after API.SH throttling",async()=>{
 let calls=0;
 const fetcher:typeof fetch=async()=>{calls++;return new Response(null,{status:429,headers:{"Retry-After":"120"}});};
 assert.match((await createMercariProvider({fetcher}).search(query)).reason||"",/APISH_API_KEY/);
 const p=createMercariProvider({apiKey:"test",fetcher,now:()=>0});
 assert.equal((await p.search(query)).retryAfterSeconds,120);
 assert.equal((await p.search(query)).retryAfterSeconds,120);
 assert.equal(calls,1);
});

test("Mercari Jordan cohort separates color, footwear type, edition, youth sizes and damaged pairs",async()=>{
 const p=createMercariProvider({apiKey:"test",fetcher:async()=>Response.json({country:"US",items:[
  row(1,45),row(2,60),row(3,75),
  row(4,100,"Nike Air Jordan 1 Mid Medium Olive Black White Men’s Size 14 DQ8426-092"),
  row(5,15.56,"Air Jordan 1 Mid SE Split Black White Homage Women’s 6.5 DR0501-101"),
  row(6,22.5,"Air Jordan 1 Mid Tropical Twist Teal Black White 3Y"),
  row(7,120,"Air Jordan 1 Mid Panda Elite Black White Football Cleats Size 9.5"),
  row(8,20,"Jordan 1 Mid Black White Damaged"),
  row(9,80,"Jordan 1 High Black White"),
  row(10,20,"Jordan 1 Mid Black White Single Shoe"),
  row(1,45),row(11,109.95,"Nike Air Jordan 1 Mid Hyper Royal Black White"),
 ]})});
 const result=await p.search(query);
 assert.equal(result.examined,12);
 assert.equal(result.invalid,1);
 assert.equal(result.diagnostics?.exclusions.conflicting_colorway,2);
 assert.equal(result.diagnostics?.exclusions.distinct_edition_unconfirmed,1);
 assert.equal(result.diagnostics?.exclusions.youth_size_group_unconfirmed,1);
 assert.equal(result.diagnostics?.exclusions.incompatible_footwear_type,1);
 assert.deepEqual(result.comparables.filter(x=>x.priceEligible).map(x=>x.price),[45,60,75]);
 const {recommend}=await import("./valuation");
 const rec=recommend(result,query);
 assert.equal(rec.suggestedListingPrice,60);
 assert.equal(rec.provisional,true);
 assert.deepEqual(rec.indicativeAskingRange,{low:45,high:75});
});

test("Mercari uses a coherent condition grade only if it independently qualifies",async()=>{
 const p=createMercariProvider({apiKey:"test",fetcher:async()=>Response.json({country:"US",items:[
   row(1,80),row(2,90),row(3,100),{...row(4,20),condition:"Fair"},{...row(5,30),condition:"Fair"},{...row(6,40),condition:"Like New"}
 ]})});
 const {recommend}=await import("./valuation");
 const result=await p.search(query);
 const rec=recommend(result,query);
 assert.equal(rec.pricingDiagnostics.grade,"Good");
 assert.deepEqual(rec.pricingDiagnostics.prices,[80,90,100]);
 assert.equal(rec.suggestedListingPrice,90);
 assert.equal(recommend({...result,provider:"ebay"},query).suggestedListingPrice,null);
 assert.equal(recommend({...result,comparables:result.comparables.map(i=>({...i,seller:"one"}))},query).suggestedListingPrice,null);
});
