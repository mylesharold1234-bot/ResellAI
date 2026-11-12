import {retrievalDiagnostics,sufficientSearchEvidence} from "../retrieval-diagnostics";
import {scoreComparable} from "../comparable-quality";
import {matchMercari} from "../mercari-matching";
import {searchPlan} from "../ebay-search";
import type {Comparable,MarketplaceProvider,MarketplaceResult,ProductQuery} from "../marketplaces";

const endpoint = "https://api.api.sh/mercari/v1/search";
const limit = 100;
const ttl = 300_000;
const earliest=(previous:string|null,current:string)=>previous&&previous<current?previous:current;
class MercariError extends Error {}
type Row = Record<string,unknown>;
const object = (x: unknown): x is Row => !!x && typeof x === "object" && !Array.isArray(x);
const conditions: Record<string,string> = {new:"1000","like new":"2990",good:"3000",fair:"5000",poor:"6000"};

export function normalizeMercari(body:unknown,stamp:string) {
  if(!object(body)||body.success===false||body.country!=="US"||!Array.isArray(body.items)||body.items.length>limit)
    throw new MercariError("Mercari returned an unexpected response.");
  const items:Comparable[]=[];
  const seen=new Set<string>();
  let duplicateRows=0;
  for(const x of body.items){
    if(!object(x)||typeof x.id!=="string"||!/^m\d+$/.test(x.id)||
      x.status!=="on_sale"||x.currency!=="USD"||typeof x.price!=="number"||!Number.isFinite(x.price)||x.price<=0||
      typeof x.name!=="string"||!x.name.trim()||typeof x.url!=="string")continue;
    let url:URL;
    try{url=new URL(x.url);}catch{continue;}
    if(url.origin!=="https://www.mercari.com"||url.username||url.password||url.pathname.replace(/\/$/,"")!=="/us/item/"+x.id)continue;

    const condition=typeof x.condition==="string"?x.condition.trim().slice(0,80):"Unknown";
    const label=condition.toLowerCase().replace(/[_-]/g," ");
    const conditionId=Object.hasOwn(conditions,label)?conditions[label]:"";
    const conditionLabel=conditionId==="2990"?"Like New":condition;
    if(seen.has(x.id)){
      duplicateRows++;
      const prior=items.find(item=>item.id===x.id);
      if(prior&&(prior.price!==x.price||prior.conditionId!==conditionId))prior.warnings.push("Conflicting duplicate listing");
      continue;
    }
    seen.add(x.id);
    items.push({id:x.id,title:x.name.trim().slice(0,250),price:x.price,currency:"USD",status:"asking",
      condition:conditionLabel,conditionId,url:url.origin+url.pathname,observedAt:stamp,shipping:x.free_shipping===true?0:null,
      seller:typeof x.seller_id==="string"&&x.seller_id?x.seller_id.slice(0,100):null,
      categories:Array.isArray(x.categories)?x.categories.filter(object).flatMap(c=>typeof c.name==="string"?[c.name.slice(0,80)]:[]).slice(0,10):[],
      matchReasons:[],warnings:[]});
  }
  const credits=typeof body.credits_used==="number"&&Number.isSafeInteger(body.credits_used)&&body.credits_used>=0?body.credits_used:null;
  return {items,examined:body.items.length,duplicateRows,credits,providerCached:body.cached===true};
}


export function mercariSearchPlan(query:ProductQuery){
 const identification=query.identification;
 const base=searchPlan({...query,identification:{...identification,understanding:identification.understanding?{...identification.understanding,candidates:[]}:undefined}});
 const first=base.find(x=>x.stage==="B")||base[0];
 const second=base.find(x=>x.stage==="C")||base.find(x=>x.query!==first?.query);
 return [first,second].filter((x,i,a):x is NonNullable<typeof x>=>!!x&&a.findIndex(y=>y?.query===x.query)===i).slice(0,2);
}
export function createMercariProvider({apiKey,fetcher=fetch,now=Date.now,maxQueries=1}:{apiKey?:string;fetcher?:typeof fetch;now?:()=>number;maxQueries?:number}):MarketplaceProvider{
 type Snapshot=ReturnType<typeof normalizeMercari>&{stamp:string;expires:number};
 const cache=new Map<string,Snapshot>(),pending=new Map<string,Promise<Snapshot>>();
 let calls:number[]=[],cooldown=0,networkCount=0;
 async function fetchPage(text:string,refresh:boolean){
  const time=now(),key=text.toLowerCase();
  for(const [k,v] of cache)if(v.expires<=time)cache.delete(k);
  const old=cache.get(key);
  if(!refresh&&old?.stamp.slice(0,10)===new Date(time).toISOString().slice(0,10))return {value:old,reused:true};
  const running=pending.get(key);
  if(running)return {value:await running,reused:true};
  calls=calls.filter(t=>t>time-86_400_000);
  if(time<cooldown)throw new MercariError("API.SH temporarily limited Mercari searches.");
  if(pending.size)throw new MercariError("Another Mercari search is running. Try again shortly.");
  if(calls.length>=20||calls.filter(t=>t>time-3_600_000).length>=5)throw new MercariError("Local Mercari credit safeguard reached (5 requests per hour, 20 per day). Try again later.");
  calls.push(time);
  const job=(async()=>{
   const url=new URL(endpoint);
   url.search=new URLSearchParams({q:text,country:"US",status:"on_sale",sort:"relevance",limit:String(limit),raw:"0",fresh:"1"}).toString();
   networkCount++;
   const r=await fetcher(url,{headers:{"x-api-key":apiKey!.trim(),Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(25000)});
   if(r.status===429||r.status===402){
    const header=r.headers.get("Retry-After");
    const seconds=header?(Number.isFinite(Number(header))?Number(header):(Date.parse(header)-now())/1000):0;
    cooldown=now()+Math.max(r.status===402?900:60,Number.isFinite(seconds)?seconds:0)*1000;
    throw new MercariError(r.status===402?"API.SH credits are unavailable. Check your account balance.":"API.SH rate limit reached. Try again later.");
   }
   if(r.status===401||r.status===403){cooldown=now()+60_000;throw new MercariError("API.SH rejected the key or Mercari endpoint access. Check the server configuration.");}
   if(!r.ok)throw new MercariError("API.SH could not complete the Mercari search. Try again later.");
   const stamp=new Date(now()).toISOString();
   const value={...normalizeMercari(await r.json(),stamp),stamp,expires:now()+ttl};
   if(cache.size>=50)cache.delete(cache.keys().next().value!);
   cache.set(key,value);return value;
  })().finally(()=>pending.delete(key));
  pending.set(key,job);
  return {value:await job,reused:false};
 }
 return {id:"mercari",async search(query,{refresh=false}={}){
  const plan=mercariSearchPlan(query).slice(0,maxQueries===2?2:1),text=plan[0]?.query||"";
  const unavailable=(reason:string):MarketplaceResult=>({provider:"mercari",environment:"production",status:"unavailable",reason,query:text,comparables:[],retrievedAt:null,expiresAt:null,cached:false,examined:0,excluded:0,invalid:0,warnings:[],
    ...(cooldown>now()?{retryAfterSeconds:Math.ceil((cooldown-now())/1000)}:{})});
  if(!apiKey?.trim())return unavailable("Mercari is not configured. Add APISH_API_KEY to resellai/.env.local and restart the server.");
  if(!text)return unavailable("Confirm a recognizable product before searching Mercari.");
  const start=now(),networkStart=networkCount,all=new Map<string,Comparable>(),attempts:NonNullable<MarketplaceResult["searchDiagnostics"]>["attempts"]=[];
  let examined=0,invalid=0,duplicates=0,requests=0,credits:number|null=0,stamp:string|null=null,expires=Infinity,cached=false;
  const warnings=["Active Mercari asking prices only; no sold prices or fee estimates."];
  let result:MarketplaceResult|undefined;
  for(const [index,step] of plan.entries()){
   if(index&&result&&sufficientSearchEvidence(result,query))break;
   if(index&&now()-start>22000){warnings.push("Partial marketplace search: fallback skipped to preserve request timeout.");break;}
   const attemptStart=now();
   const attempt={stage:step.stage,query:step.query,filter:"US active USD asking listings",limit,returned:0,unique:0,duplicates:0,candidates:0,latencyMs:0,error:undefined as string|undefined};
   attempts.push(attempt);
   try{
    const fetched=await fetchPage(step.query,refresh);
    cached=cached||fetched.reused||fetched.value.providerCached;
    if(!fetched.reused){requests++;credits=credits===null||fetched.value.credits===null?null:credits+fetched.value.credits;}
    const page=fetched.value;
    stamp=earliest(stamp,page.stamp);expires=Math.min(expires,page.expires);
    attempt.returned=page.examined;examined+=page.examined;
    invalid+=page.examined-page.items.length;duplicates+=page.duplicateRows;attempt.duplicates+=page.duplicateRows;
    const newIds=new Set<string>();
    for(const row of page.items){
     const previous=all.get(row.id);
     if(previous){
      invalid++;duplicates++;attempt.duplicates++;
      if(previous.price!==row.price||previous.conditionId!==row.conditionId||row.warnings.includes("Conflicting duplicate listing"))previous.warnings.push("Conflicting duplicate listing");
      continue;
     }
     all.set(row.id,{...row,warnings:[...row.warnings]});newIds.add(row.id);attempt.unique++;
    }
    const sources=[...all.values()],matches=sources.map(item=>matchMercari(item,query));
    const comparables=matches.flatMap(m=>m.item?[{...m.item,quality:scoreComparable(m.item)}]:[]);
    const exclusions:Record<string,number>={};
    const rows=matches.map((m,i)=>{
     if(!m.item?.priceEligible)exclusions[m.reason]=(exclusions[m.reason]||0)+1;
     return {id:sources[i].id,title:sources[i].title,stage:m.item?.matchTier||"rejected",reason:m.reason};
    });
    attempt.candidates=matches.filter(m=>m.item?.priceEligible&&newIds.has(m.item.id)).length;
    result={provider:"mercari",environment:"production",status:comparables.length?"available":"no_matches",query:text,comparables,retrievedAt:stamp,expiresAt:new Date(expires).toISOString(),cached,
      examined,invalid,excluded:all.size-comparables.length,creditsUsed:credits,warnings,
      diagnostics:{normalized:all.size,accepted:comparables.length,exclusions,rows},
      searchDiagnostics:{cacheKey:"mercari-query-cache",attempts,exact:comparables.filter(x=>x.matchTier==="exact").length,close:comparables.filter(x=>x.matchTier==="close").length,related:comparables.filter(x=>x.matchTier==="related").length}};
   }catch(error){
    attempt.error=error instanceof MercariError?error.message:"Mercari search failed or timed out. Try again.";
    if(!result){
     const failed=unavailable(attempt.error);
     failed.searchDiagnostics={cacheKey:"mercari-query-cache",attempts,exact:0,close:0,related:0};
     failed.retrievalDiagnostics=retrievalDiagnostics(failed,query,all.size,duplicates,networkCount-networkStart,now()-start);
     return failed;
    }
    warnings.push("Partial marketplace search: "+attempt.error);
    break;
   }finally{attempt.latencyMs=now()-attemptStart;}
  }
  if(!result)return unavailable("Mercari search unavailable.");
  result.searchCompleteness=warnings.some(w=>/^Partial marketplace search/.test(w))?"partial":"complete";
  result.retrievalDiagnostics=retrievalDiagnostics(result,query,all.size,duplicates,networkCount-networkStart,now()-start);
  return result;
 }};
}

