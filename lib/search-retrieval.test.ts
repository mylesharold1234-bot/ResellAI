import {test} from "node:test";
import assert from "node:assert/strict";
import {createEbayProvider} from "./marketplace-providers/ebay";
import {createMercariProvider,mercariSearchPlan} from "./marketplace-providers/mercari";
import {searchPlan} from "./ebay-search";
import {emptyMatchDetails,type ProductQuery} from "./marketplaces";
import {recommend} from "./valuation";
const query:ProductQuery={identification:{brand:"Nike",model:"Air Jordan 1",productName:"Nike Air Jordan 1 High Top Sneaker",category:"Sneakers",colorway:"black white",visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},details:{...emptyMatchDetails,condition:"new"}};
const title="Nike Air Jordan 1 High Black White";
const ebayRow=(n:number)=>({itemId:"v1|"+n+"|0",title,price:{value:String(90+n),currency:"USD"},condition:"New",conditionId:"1000",itemWebUrl:"https://www.ebay.com/itm/"+n,buyingOptions:["FIXED_PRICE"],seller:{username:"s"+n}});
const mercariRow=(n:number)=>({id:"m"+n,name:title,price:90+n,currency:"USD",status:"on_sale",condition:"New",url:"https://www.mercari.com/us/item/m"+n+"/",seller_id:"s"+n});

test("query plans preserve supported constraints and use equivalent aliases without inventing variants",()=>{
 for(const step of searchPlan(query)){assert.match(step.query,/black/);assert.match(step.query,/white/);assert.match(step.query,/high/);}
 assert.ok(searchPlan(query).some(x=>/aj1/i.test(x.query)));
 assert.equal(mercariSearchPlan(query)[0].query,"nike air jordan 1 high black white");
 const explicit={...query,identification:{...query.identification,model:"Air Jordan 1 Retro High OG SP"}};
 for(const step of searchPlan(explicit))assert.match(step.query,/og.*sp/);
});

test("eBay stops on a usable close cohort instead of spending all fallback calls",async()=>{
 let calls=0;
 const api=createEbayProvider({clientId:"test",clientSecret:"test",environment:"production",productionApproved:true,fetcher:async input=>{
  if(String(input).includes("oauth2"))return Response.json({access_token:"test",expires_in:7200});
  calls++;return Response.json({itemSummaries:[1,2,3,4,5].map(ebayRow)});
 }});
 const r=await api.search(query);
 assert.equal(calls,1);
 assert.equal(r.retrievalDiagnostics?.pricingCandidates,5);
 assert.equal(r.retrievalDiagnostics?.bottleneck,"none");
 assert.equal(recommend(r,query).eligibleCount,5);
 await api.search(query);assert.equal(calls,1);
});

test("eBay alias fallback merges only unique IDs and diagnoses matched candidates",async()=>{
 const terms:string[]=[];
 const api=createEbayProvider({clientId:"test",clientSecret:"test",environment:"production",productionApproved:true,fetcher:async input=>{
  if(String(input).includes("oauth2"))return Response.json({access_token:"test",expires_in:7200});
  const q=new URL(String(input)).searchParams.get("q")!;terms.push(q);
  const rows=/aj1/i.test(q)?[...[1,2,3,4,5].map(ebayRow),{...ebayRow(9),title:"Nike Air Jordan 1 Low Red White"}]:terms.length===1?[]:[ebayRow(1)];
  return Response.json({itemSummaries:rows});
 }});
 const r=await api.search(query);
 assert.equal(terms.length,3);
 assert.equal(r.retrievalDiagnostics?.uniqueListings,6);
 assert.equal(r.retrievalDiagnostics?.duplicateRows,1);
 assert.equal(r.retrievalDiagnostics?.requests,3);
 assert.equal(recommend(r,query).suggestedListingPrice,93);
 assert.equal(r.comparables.filter(x=>x.priceEligible).length,5);
 assert.equal(r.excluded,1);
 assert.ok(terms.every(x=>/high/.test(x)&&/black/.test(x)&&/white/.test(x)));
});

test("Mercari remains one credit by default; opt-in alias fallback deduplicates and stops when enough",async()=>{
 let calls=0;
 const fetcher:typeof fetch=async input=>{
  calls++;const text=new URL(String(input)).searchParams.get("q")!;
  return Response.json({country:"US",credits_used:1,items:(/aj1/i.test(text)?[1,2,3,4,5]:[1,2]).map(mercariRow)});
 };
 const single=await createMercariProvider({apiKey:"test",fetcher}).search(query);
 assert.equal(calls,1);assert.equal(single.creditsUsed,1);assert.equal(recommend(single,query).suggestedListingPrice,null);
 calls=0;
 const expanded=createMercariProvider({apiKey:"test",fetcher,maxQueries:2});
 const combined=await expanded.search(query);
 assert.equal(calls,2);assert.equal(combined.creditsUsed,2);
 assert.equal(combined.retrievalDiagnostics?.duplicateRows,2);
 assert.equal(combined.retrievalDiagnostics?.uniqueListings,5);
 assert.equal(recommend(combined,query).suggestedListingPrice,93);
 const again=await expanded.search(query);
 assert.equal(calls,2);assert.equal(again.creditsUsed,0);
});

test("Mercari fallback failure retains real first-query evidence and reports a partial retrieval",async()=>{
 let calls=0;
 const api=createMercariProvider({apiKey:"test",maxQueries:2,fetcher:async()=>{
  calls++;return calls===1?Response.json({country:"US",credits_used:1,items:[mercariRow(1)]}):new Response(null,{status:500});
 }});
 const r=await api.search(query);
 assert.equal(r.comparables.length,1);assert.equal(r.searchDiagnostics?.attempts.length,2);
 assert.equal(r.retrievalDiagnostics?.bottleneck,"retrieval-error");
 assert.equal(r.retrievalDiagnostics?.requests,2);
 assert.equal(recommend(r,query).suggestedListingPrice,null);
});

test("Mercari opt-in does not issue a fallback when the first page already qualifies",async()=>{
 let calls=0;
 const api=createMercariProvider({apiKey:"test",maxQueries:2,fetcher:async()=>{
  calls++;return Response.json({country:"US",credits_used:1,items:[1,2,3,4,5].map(mercariRow)});
 }});
 const result=await api.search(query);
 assert.equal(calls,1);assert.equal(result.creditsUsed,1);
});

test("long names preserve full supported constraints rather than truncating them",()=>{
 const long={...query,identification:{...query.identification,model:"Air Jordan 1 Mid OG",productName:"Nike Air Jordan 1 high-top sneaker "+"descriptive ".repeat(60)}};
 const plans=searchPlan(long);
 assert.ok(plans.length);
 for(const step of plans){
  assert.ok(step.query.length<=100);
  assert.match(step.query,/jordan 1|aj1/);
  assert.match(step.query,/mid/);assert.match(step.query,/og/);
  assert.match(step.query,/black/);assert.match(step.query,/white/);
  assert.doesNotMatch(step.query,/\bhigh\b/);
 }
 const short={...query,identification:{...query.identification,model:"Air Jordan 1 Mid",productName:"Air Jordan 1 high top sneaker"}};
 assert.ok(searchPlan(short).every(x=>! /\bhigh\b/.test(x.query)));
});
