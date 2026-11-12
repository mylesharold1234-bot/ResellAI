import {createHmac} from "node:crypto";
import {markets,readCaptures,readGold} from "./real-world-validation";
import {normalizeEbaySearch} from "./marketplace-providers/ebay";
import {normalizeMercari} from "./marketplace-providers/mercari";
import {redactDescription} from "./product-understanding";

type Market=(typeof markets)[number];
type Dict=Record<string,unknown>;
type Labels=ReturnType<typeof readGold>;
type Captures=ReturnType<typeof readCaptures>;
const obj=(x:unknown):x is Dict=>!!x&&typeof x==="object"&&!Array.isArray(x);
const text=(x:unknown)=>typeof x==="string"?redactDescription(x):undefined;
const scalar=(x:unknown)=>typeof x==="string"||typeof x==="number"?x:undefined;
const money=(x:unknown)=>obj(x)?{value:scalar(x.value),currency:text(x.currency)}:undefined;
function cleanUrl(x:unknown){
 if(typeof x!=="string")return undefined;
 try{
  const url=new URL(x);
  if(url.username||url.password||url.protocol!=="https:"||!["www.ebay.com","ebay.com","www.mercari.com"].includes(url.host))return undefined;
  return url.origin+url.pathname;
 }catch{return undefined;}
}

export function pilotLabels(input:unknown){
 const labels=readGold(input);
 if(labels.kind!=="real"||labels.cases.length!==10)
  throw Error("The pilot requires exactly 10 independently verified real products in labels.json.");
 for(const c of labels.cases){
  if(!c.accepted.brand?.length||!c.accepted.colorway?.length)
   throw Error("Record verified brand and colorway labels for "+c.id+".");
 }
 return labels;
}

export function sanitizePilotPage(provider:Market,input:unknown,salt:string){
 if(!obj(input)||input.errors||input.success===false)throw Error("Import a successful provider search response or record the failed capture as an error.");
 const hash=(id:unknown)=>typeof id==="string"&&id.trim()?createHmac("sha256",salt).update(provider+"\0"+id).digest("hex"):undefined;
 const categories=(v:unknown)=>Array.isArray(v)?v.map(c=>obj(c)?provider==="ebay"?{categoryName:text(c.categoryName)}:{name:text(c.name)}:null):undefined;
 if(provider==="ebay"){
  if(input.itemSummaries===undefined&&input.total===0)return {total:0};
  if(!Array.isArray(input.itemSummaries)||input.itemSummaries.length>200)throw Error("Expected an eBay Browse itemSummaries array.");
  return {itemSummaries:input.itemSummaries.map(r=>obj(r)?{
   itemId:text(r.itemId),title:text(r.title),price:money(r.price),condition:text(r.condition),conditionId:scalar(r.conditionId),
   itemWebUrl:cleanUrl(r.itemWebUrl),itemEndDate:text(r.itemEndDate),
   buyingOptions:Array.isArray(r.buyingOptions)?r.buyingOptions.filter(v=>typeof v==="string"):undefined,
   shippingOptions:Array.isArray(r.shippingOptions)?r.shippingOptions.slice(0,1).map(o=>obj(o)?{shippingCost:money(o.shippingCost)}:null):undefined,
   seller:obj(r.seller)?{username:hash(r.seller.username)}:undefined,categories:categories(r.categories),
   itemGroupType:r.itemGroupType||r.itemGroupHref?"variation":undefined,
  }:null)};
 }
 if(input.country!=="US"||!Array.isArray(input.items)||input.items.length>100)throw Error("Expected a Mercari US items array.");
 return {country:"US",items:input.items.map(r=>obj(r)?{
  id:text(r.id),name:text(r.name),price:typeof r.price==="number"?r.price:undefined,currency:text(r.currency),status:text(r.status),
  url:cleanUrl(r.url),seller_id:hash(r.seller_id),condition:text(r.condition),free_shipping:r.free_shipping===true,
  categories:categories(r.categories),
 }:null)};
}

export function sanitizePilotImport(input:unknown,salt:string){
 const captures=readCaptures(input);
 return {schemaVersion:1 as const,datasetId:captures.datasetId,kind:captures.kind,cases:captures.cases.map(c=>({
  id:c.id,identification:c.identification.status==="ok"?{status:"ok" as const,output:c.identification.output}:{status:"error" as const,reason:redactDescription(c.identification.reason)},
  details:c.details,
  markets:Object.fromEntries(markets.flatMap(provider=>{
   const m=c.markets[provider];
   return m?[[provider,{status:m.status,capturedAt:m.capturedAt,reason:text(m.reason),warnings:m.warnings?.map(redactDescription),
    pages:m.pages.map(page=>{
     const safe=sanitizePilotPage(provider,page,salt);
     if(provider==="ebay")normalizeEbaySearch(safe,"production",m.capturedAt);else normalizeMercari(safe,m.capturedAt);
     return safe;
    })}]]:[];
  })),
 }))};
}

export function assertPilotJoin(labels:Labels,captures:Captures){
 if(captures.datasetId!==labels.datasetId||captures.kind!==labels.kind||captures.cases.some(c=>!labels.cases.some(g=>g.id===c.id)))
  throw Error("Captures must use the same pilot dataset ID and kind and only independently labeled product IDs.");
}

export function blindReview(labels:Labels,captures:Captures){
 assertPilotJoin(labels,captures);
 const cases=labels.cases.flatMap(g=>{
  const c=captures.cases.find(x=>x.id===g.id);
  return markets.flatMap(provider=>{
   const m=c?.markets[provider];
   if(m?.status!=="ok")return [];
   const unique=new Map<string,{id:string;title:string;condition:string;url:string}>();
   // Show all reviewable IDs from the allowlisted pre-filter payload, even if the app
   // rejects their price/status or other metadata during normalization.
   for(const page of m.pages){
    if(!obj(page))continue;
    const rows=provider==="ebay"?page.itemSummaries:page.items;
    if(!Array.isArray(rows))continue;
    for(const r of rows){
     if(!obj(r))continue;
     const id=provider==="ebay"?r.itemId:r.id;
     if(typeof id!=="string"||!id.trim()||unique.has(id))continue;
     const link=cleanUrl(provider==="ebay"?r.itemWebUrl:r.url);
     const allowed=link&&(provider==="ebay"?/^https:\/\/(?:www\.)?ebay\.com\/itm\//.test(link):/^https:\/\/www\.mercari\.com\/us\/item\//.test(link));
     unique.set(id,{id,title:text(provider==="ebay"?r.title:r.name)??"",condition:text(r.condition)??"",url:allowed?link:""});
    }
   }
   return [{id:g.id,provider,verifiedIdentity:g.verifiedIdentity,model:g.verifiedModel,brand:g.accepted.brand?.[0],colorway:g.accepted.colorway?.[0],
    size:g.size,sizeSystem:g.sizeSystem,condition:g.condition,criteria:g.criteria,reviewer:"",listings:[...unique.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>({...r,verdict:"",reason:"",evidence:""}))}];
  });
 });
 return {schemaVersion:1,datasetId:labels.datasetId,cases};
}

export function mergePilotReviews(labels:Labels,captures:Captures,input:unknown){
 const expected=blindReview(labels,captures);
 if(!obj(input)||input.schemaVersion!==1||input.datasetId!==labels.datasetId||!Array.isArray(input.cases)||input.cases.length!==expected.cases.length)
  throw Error("Review file must contain all captured product/marketplace groups.");
 const output=structuredClone(labels);
 const used=new Set<string>();
 for(const c of input.cases){
  if(!obj(c)||typeof c.reviewer!=="string"||!c.reviewer.trim()||!Array.isArray(c.listings))throw Error("Each review group needs a human reviewer ID and listing judgments.");
  const target=expected.cases.find(r=>r.id===c.id&&r.provider===c.provider);
  if(!target||c.listings.length!==target.listings.length||used.has(target.id+"/"+target.provider))throw Error("Review groups must match the generated worksheet.");
  used.add(target.id+"/"+target.provider);
  const seen=new Set<string>();
  const rows=c.listings.map(r=>{
   if(!obj(r)||typeof r.id!=="string"||seen.has(r.id)||!target.listings.some(x=>x.id===r.id)||
      (r.verdict!=="relevant"&&r.verdict!=="irrelevant"&&r.verdict!=="uncertain")||
      typeof r.reason!=="string"||!r.reason.trim()||typeof r.evidence!=="string"||!r.evidence.trim())
    throw Error("Enter a verdict, reason and evidence for each listing. Use uncertain if you cannot verify it.");
   seen.add(r.id);
   return {id:r.id,verdict:r.verdict as "relevant"|"irrelevant"|"uncertain",reason:redactDescription(r.reason),evidence:redactDescription(r.evidence)};
  });
  const gold=output.cases.find(g=>g.id===target.id)!;
  const prior=gold.judgments[target.provider];
  gold.judgments[target.provider]={reviewer:c.reviewer,pool:prior?.pool??"retrieved-only",sales:prior?.sales,labels:[...(prior?.labels??[]).filter(r=>!seen.has(r.id)),...rows]};
 }
 return readGold(output);
}


/** Capture only provider search responses, never token exchanges, headers or request bodies. */
export function pilotCaptureFetch(provider:Market,salt:string,pages:unknown[],fetcher:typeof fetch=fetch):typeof fetch{
 return async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  const listing=provider==="ebay"?url.origin==="https://api.ebay.com"&&url.pathname==="/buy/browse/v1/item_summary/search":
   url.origin==="https://api.api.sh"&&url.pathname==="/mercari/v1/search";
  const res=await fetcher(input,init);
  if(listing&&res.ok){
   try{pages.push(sanitizePilotPage(provider,await res.clone().json(),salt));}catch{/* keep malformed responses out of replay */}
  }
  return res;
 };
}
