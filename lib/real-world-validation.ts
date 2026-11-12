import { parseIdentification, type Identification } from "./identification";
import { emptyMatchDetails, parseMatchDetails, type MatchDetails, type MarketplaceResult, type Comparable } from "./marketplaces";
import { normalizeEbaySearch } from "./marketplace-providers/ebay";
import { normalizeMercari } from "./marketplace-providers/mercari";
import { completeComparable, scoreComparable } from "./comparable-quality";
import { tierComparable } from "./ebay-search";
import { matchMercari } from "./mercari-matching";
import { listingDisplayPrice } from "./pricing-engine";
import { normalizeProduct } from "./product-profile";
import { recommend } from "./valuation";

export const markets=["ebay","mercari"] as const;
type Market=typeof markets[number];
const fields=["brand","model","productName","category","colorway","visibleCondition","identifyingInformation"] as const;
type Field=typeof fields[number];
type Label={id:string;verdict:"relevant"|"irrelevant"|"uncertain";reason:string;evidence:string};
type Sale={id:string;price:number;currency:string;basis:string;soldAt:string;evidence:string;authorized:boolean;verified:boolean;meetsCriteria:boolean};
type Gold={id:string;category:string;source:string;reviewer:string;photoRef:string;verifiedIdentity:string;verifiedModel:string;verifiedIdentifier?:string;size:string|null;sizeSystem:string|null;condition:string;criteria:string;accepted:Partial<Record<Field,string[]>>;
 judgments:Partial<Record<Market,{pool:"independent"|"retrieved-only";reviewer?:string;labels:Label[];sales?:Sale[]}>>};
type Capture={id:string;identification:{status:"ok";output:Identification}|{status:"error";reason:string};details?:MatchDetails;
 markets:Partial<Record<Market,{status:"ok"|"error";capturedAt:string;pages:unknown[];reason?:string;warnings?:string[]}>>};
type Document<T>={schemaVersion:1;datasetId:string;kind:"real"|"synthetic";cases:T[]};

const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const nonempty=(v:unknown):v is string=>typeof v==="string"&&!!v.trim();
const date=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT.*Z$/.test(v)&&Number.isFinite(Date.parse(v));
function requireThat(test:unknown,where:string):asserts test{if(!test)throw Error("Invalid evaluation data: "+where);}
function unique(ids:string[],where:string){requireThat(new Set(ids).size===ids.length,where+" contains duplicate IDs");}
function doc(input:unknown,where:string){
 requireThat(obj(input)&&input.schemaVersion===1&&nonempty(input.datasetId)&&(input.kind==="real"||input.kind==="synthetic")&&Array.isArray(input.cases),where+" manifest");
 return input as unknown as Document<unknown>;
}
export function readGold(input:unknown):Document<Gold>{
 const d=doc(input,"labels");
 for(const v of d.cases){
  requireThat(obj(v)&&nonempty(v.id),"product ID");
  const p=v.id;
  for(const name of ["category","source","reviewer","photoRef","verifiedIdentity","verifiedModel","condition","criteria"])requireThat(nonempty(v[name]),p+"."+name);
  requireThat(v.verifiedIdentifier===undefined||nonempty(v.verifiedIdentifier),p+" verifiedIdentifier");
  requireThat((v.size===null&&v.sizeSystem===null)||(nonempty(v.size)&&nonempty(v.sizeSystem)),p+" size and sizing system");
  requireThat(obj(v.accepted)&&Array.isArray(v.accepted.model)&&Array.isArray(v.accepted.category),p+" model/category accepted labels");
  for(const [field,aliases] of Object.entries(v.accepted))requireThat(fields.includes(field as Field)&&Array.isArray(aliases)&&aliases.length>0&&aliases.every(nonempty),p+" "+field+" aliases");
  requireThat(obj(v.judgments)&&Object.keys(v.judgments).every(k=>markets.includes(k as Market)),p+" judgments");
  for(const [market,j] of Object.entries(v.judgments)){
   requireThat(obj(j)&&(j.pool==="independent"||j.pool==="retrieved-only")&&Array.isArray(j.labels),p+" "+market+" judgment pool");
   for(const l of j.labels)requireThat(obj(l)&&nonempty(l.id)&&["relevant","irrelevant","uncertain"].includes(String(l.verdict))&&nonempty(l.reason)&&nonempty(l.evidence),p+" listing judgment");
   unique(j.labels.map(l=>l.id),p+" "+market+" judgments");
   if(j.sales!==undefined){
    requireThat(Array.isArray(j.sales),p+" sales");
    for(const s of j.sales)requireThat(obj(s)&&nonempty(s.id)&&typeof s.price==="number"&&Number.isFinite(s.price)&&s.price>0&&nonempty(s.currency)&&nonempty(s.basis)&&date(s.soldAt)&&nonempty(s.evidence)&&typeof s.authorized==="boolean"&&typeof s.verified==="boolean"&&typeof s.meetsCriteria==="boolean",p+" sale record");
    unique(j.sales.map(s=>s.id),p+" "+market+" sales");
   }
  }
 }
 const gold=d as Document<Gold>;
 unique(gold.cases.map(x=>x.id),"products");
 return gold;
}
export function readCaptures(input:unknown):Document<Capture>{
 const d=doc(input,"captures");
 const cases=d.cases.map(v=>{
  requireThat(obj(v)&&nonempty(v.id)&&obj(v.identification)&&obj(v.markets),"capture case");
  const p=v.id,i=v.identification;
  requireThat(i.status==="ok"||(i.status==="error"&&nonempty(i.reason)),p+" identification outcome");
  requireThat(Object.keys(v.markets).every(k=>markets.includes(k as Market)),p+" marketplace keys");
  for(const [market,m] of Object.entries(v.markets)){
   requireThat(obj(m)&&date(m.capturedAt)&&(m.status==="ok"||m.status==="error")&&Array.isArray(m.pages),p+" "+market+" capture");
   requireThat(m.status==="ok"?m.pages.length>0:m.pages.length===0&&nonempty(m.reason),p+" "+market+" pages or error reason");
   requireThat(m.warnings===undefined||(Array.isArray(m.warnings)&&m.warnings.every(nonempty)),p+" "+market+" warnings");
   requireThat(m.pages.length<=(market==="ebay"?4:2),p+" "+market+" page limit");
  }
  requireThat(i.status==="ok"||!Object.values(v.markets).some(m=>obj(m)&&m.status==="ok"),p+" cannot replay successful search without identification");
  const capture=v as unknown as Capture;
  return {...capture,identification:i.status==="ok"?{status:"ok" as const,output:parseIdentification(i.output)}:capture.identification,
   details:v.details===undefined?undefined:parseMatchDetails(v.details)};
 });
 unique(cases.map(x=>x.id),"captures");
 return {...d,cases};
}

const ratio=(a:number,b:number)=>b?a/b:null;
const normalized=(v:string)=>v.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const median=(a:number[])=>{const b=[...a].sort((x,y)=>x-y),i=Math.floor(b.length/2);return b.length%2?b[i]:(b[i-1]+b[i])/2;};
function metric(predicted:Set<string>,labels:Label[],recallAllowed:boolean){
 const truth=new Map(labels.map(x=>[x.id,x]));
 const tp=[...predicted].filter(x=>truth.get(x)?.verdict==="relevant");
 const fp=[...predicted].filter(x=>truth.get(x)?.verdict==="irrelevant");
 const unjudged=[...predicted].filter(x=>!truth.has(x)||truth.get(x)?.verdict==="uncertain");
 const missed=labels.filter(l=>l.verdict==="relevant"&&!predicted.has(l.id)).map(l=>l.id);
 return {tp,fp,unjudged,missed,precision:ratio(tp.length,tp.length+fp.length),
  judgmentCoverage:ratio(tp.length+fp.length,predicted.size),recall:recallAllowed?ratio(tp.length,tp.length+missed.length):null,recallAllowed};
}

export function evaluateValidation(goldInput:unknown,captureInput:unknown){
 const gold=readGold(goldInput),captures=readCaptures(captureInput);
 requireThat(gold.datasetId===captures.datasetId&&gold.kind===captures.kind,"labels and captures must share dataset ID and kind");
 const lookup=new Map(captures.cases.map(c=>[c.id,c]));
 const goldIds=new Set(gold.cases.map(c=>c.id));
 requireThat(captures.cases.every(c=>goldIds.has(c.id)),"capture without an independent product label");
 const cases=gold.cases.map(g=>{
  const capture=lookup.get(g.id);
  const identity=capture?.identification.status==="ok"?capture.identification.output:null;
  const identification=fields.flatMap(field=>{
   const aliases=g.accepted[field];if(!aliases)return [];
   const actual=identity?.[field]??null;
   return [{field,actual,outcome:!actual?"missing":aliases.some(a=>normalized(a)===normalized(actual))?"correct":"incorrect"}];
  });
  const marketplace=markets.map(provider=>{
   const input=capture?.markets[provider],judgment=g.judgments[provider];
   if(!identity||!input||input.status==="error")return {provider,status:capture?.identification.status==="error"?"identification-blocked":!input?"not-recorded":"provider-error",reason:capture?.identification.status==="error"?capture.identification.reason:input?.reason||null};
   const labels=judgment?.labels||[];
   const query={identification:normalizeProduct(identity),details:capture?.details??emptyMatchDetails};
   const normalizedPages=input.pages.map(page=>provider==="ebay"?normalizeEbaySearch(page,"production",input.capturedAt):normalizeMercari(page,input.capturedAt));
   const dedup=new Map<string,Comparable>();
   for(const row of normalizedPages.flatMap(page=>page.items)){
    const first=dedup.get(row.id);
    if(!first)dedup.set(row.id,{...row,warnings:[...row.warnings]});
    else if(first.price!==row.price||first.conditionId!==row.conditionId||row.warnings.includes("Conflicting duplicate listing")){
      if(!first.warnings.includes("Conflicting duplicate listing"))first.warnings.push("Conflicting duplicate listing");
    }
   }
   const candidates=[...dedup.values()];
   const retrieved=new Set(candidates.map(item=>item.id));
   const decisions=candidates.map(item=>{
    const match=provider==="mercari"?matchMercari(item,query):completeComparable(item,query)?tierComparable(item,query):{item:null,reason:"incompatible_or_incomplete_footwear"};
    return {id:item.id,title:item.title,reason:match.reason,item:match.item};
   });
   const matched=decisions.flatMap(x=>x.item?[{...x.item,quality:scoreComparable(x.item)}]:[]);
   const eligible=new Set(matched.filter(x=>x.priceEligible&&x.matchTier!=="related"&&!x.warnings.includes("Conflicting duplicate listing")).map(x=>x.id));
   const captured=Date.parse(input.capturedAt);
   const result:MarketplaceResult={provider,environment:"production",status:matched.length?"available":"no_matches",query:"offline replay",comparables:matched,retrievedAt:input.capturedAt,
    expiresAt:new Date(captured+300000).toISOString(),cached:false,examined:normalizedPages.reduce((a,b)=>a+b.examined,0),excluded:candidates.length-matched.length,invalid:normalizedPages.reduce((a,b)=>a+b.examined,0)-candidates.length,warnings:input.warnings??[]};
   const rec=recommend(result,query,undefined,captured),price=listingDisplayPrice(rec.suggestedListingPrice,rec.indicativeAskingRange);
   const independent=judgment?.pool==="independent";
   const match=metric(eligible,labels,independent),withinRetrieved=metric(eligible,labels.filter(l=>retrieved.has(l.id)),true);
   const cohort=metric(new Set(rec.eligibleIds),labels,independent);
   const saleRecords=(judgment?.sales||[]).filter(s=>s.authorized&&s.verified&&s.meetsCriteria&&s.currency==="USD"&&s.basis==="item-only"&&Date.parse(s.soldAt)<=captured&&Date.parse(s.soldAt)>=captured-90*86400000);
   const reference=saleRecords.length>=3?median(saleRecords.map(s=>s.price)):null;
   const error=reference!==null&&price!==null?price-reference:null;
   const failureTypes=[
    ...(input.warnings?.some(w=>/partial|cooldown|stopped further stages/i.test(w))?["partial-capture"]:[]),
    ...(match.fp.length?["incorrect-match"]:[]),...(withinRetrieved.missed.length?["missed-relevant-retrieved"]:[]),
    ...(independent&&labels.some(l=>l.verdict==="relevant"&&!retrieved.has(l.id))?["retrieval-gap"]:[]),
    ...(price===null?[(rec.pricingDiagnostics.spread??0)>2?"excessive-dispersion":"insufficient-evidence"]:[]),
   ];
   return {provider,status:"evaluated",examined:result.examined,retrieved:retrieved.size,match,withinRetrieved,cohort,price,range:rec.indicativeAskingRange,
    blockers:rec.blockers,eligibleCount:rec.eligibleCount,dispersion:rec.pricingDiagnostics.spread,
    reference,referenceSales:saleRecords.length,referenceStatus:reference!==null?"eligible":saleRecords.length?"fewer-than-three-eligible-sales":"no-authorized-verified-sales",error,absoluteError:error===null?null:Math.abs(error),
    percentageError:error===null||reference===null?null:Math.abs(error)/reference,
    failureTypes,decisions:decisions.map(({id,title,reason,item})=>({id,title,reason,tier:item?.matchTier??null,pricingEligible:eligible.has(id),selected:rec.eligibleIds.includes(id)}))};
  });
  return {id:g.id,category:g.category,verifiedIdentity:g.verifiedIdentity,identificationStatus:capture?.identification.status??"not-recorded",identification,marketplace};
 });
 const fieldSummary=fields.map(field=>{
  const rows=cases.filter(x=>x.identificationStatus!=="not-recorded").flatMap(x=>x.identification.filter(i=>i.field===field));
  const correct=rows.filter(x=>x.outcome==="correct").length;
  return {field,total:rows.length,correct,incorrect:rows.filter(x=>x.outcome==="incorrect").length,missing:rows.filter(x=>x.outcome==="missing").length,accuracy:ratio(correct,rows.length)};
 });
 const summary=markets.map(provider=>{
  const all=cases.flatMap(x=>x.marketplace.filter(m=>m.provider===provider));
  const evaluated=all.filter(x=>x.status==="evaluated"&&x.match!==undefined);
  const recommendations=evaluated.filter(x=>x.price!==null).length;
  const aggregate=(key:"match"|"cohort"|"withinRetrieved")=>{
   const rows=evaluated.map(x=>x[key]!);
   const tp=rows.reduce((n,x)=>n+x.tp.length,0),fp=rows.reduce((n,x)=>n+x.fp.length,0),unjudged=rows.reduce((n,x)=>n+x.unjudged.length,0);
   const recallRows=rows.filter(x=>x.recallAllowed),recalled=recallRows.reduce((n,x)=>n+x.tp.length,0),missed=recallRows.reduce((n,x)=>n+x.missed.length,0);
   return {tp,fp,unjudged,recalled,missed,precision:ratio(tp,tp+fp),recall:ratio(recalled,recalled+missed),judgmentCoverage:ratio(tp+fp,tp+fp+unjudged)};
  };
  const scored=evaluated.filter(x=>x.absoluteError!==null);
  const avg=(f:(x:typeof scored[number])=>number)=>scored.length?scored.reduce((n,x)=>n+f(x),0)/scored.length:null;
  const failures:Record<string,number>={};
  for(const row of all)for(const reason of row.failureTypes??[row.status])failures[reason]=(failures[reason]||0)+1;
  const byCategory=[...new Set(cases.map(c=>c.category))].sort().map(category=>{
   const rows=cases.filter(c=>c.category===category).flatMap(c=>c.marketplace.filter(x=>x.provider===provider));
   const recorded=rows.filter(x=>x.status!=="not-recorded").length;
   const supported=rows.filter(x=>x.status==="evaluated"&&x.price!==null).length;
   return {category,recorded,supported,coverage:ratio(supported,recorded)};
  });
  return {provider,byCategory,recorded:all.filter(x=>x.status!=="not-recorded").length,evaluated:evaluated.length,recommendations,
   coverage:ratio(recommendations,all.filter(x=>x.status!=="not-recorded").length),coverageAmongSuccessfulCaptures:ratio(recommendations,evaluated.length),
   matching:aggregate("match"),withinRetrieved:aggregate("withinRetrieved"),cohort:aggregate("cohort"),
   pricingError:{cases:scored.length,mae:avg(x=>x.absoluteError!),mape:avg(x=>x.percentageError!),bias:avg(x=>x.error!)},failures};
 });
 return {schemaVersion:1,datasetId:gold.datasetId,kind:gold.kind,labeledProducts:gold.cases.length,capturedProducts:captures.cases.length,
  meetsTarget:gold.cases.length>=50&&gold.cases.length<=100,fieldSummary,summary,cases};
}

