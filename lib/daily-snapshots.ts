import {supportedFootwear} from "./footwear-compatibility";
import {createHash,randomUUID} from "node:crypto";
import {mkdir,readdir,readFile,rename,writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {MarketplaceProvider,MarketplaceResult,ProductQuery} from "./marketplaces";
import {pricingIdentity,recognizableName,productProfile,jordanEdition} from "./product-profile";
import {defaultPricingOptions,visibleConditionGroup} from "./pricing-engine";
import {recommend} from "./valuation";

const zone=process.env.RESELLAI_SNAPSHOT_TIMEZONE||"America/New_York";
const calendar=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"});
function dayAt(time:number){
 const fields=Object.fromEntries(calendar.formatToParts(time).map(part=>[part.type,part.value]));
 return fields.year+"-"+fields.month+"-"+fields.day;
}
function nextMidnight(time:number,day:string){
 let low=time,high=time+26*3_600_000;
 while(high-low>1){
   const mid=Math.floor((low+high)/2);
   if(dayAt(mid)===day)low=mid;else high=mid;
 }
 return new Date(high).toISOString();
}
const algorithm="2026-11-11.reference-1";
export function snapshotIdentity(provider:string,query:ProductQuery,day:string){
  const {identity,credible}=pricingIdentity(query.identification,query.details);
  const d=query.details;
  const clean=(v?:string|null)=>(v||"").normalize("NFKC").toLowerCase().trim().replace(/\s+/g," ");
  const colors=clean(identity.colorway).split(/[\s,/-]+/).filter(w=>w&&w!=="and").sort().join(" ");
  const identityFields=[provider==="mercari"&&process.env.MERCARI_MAX_SEARCH_QUERIES==="2"?2:1,supportedFootwear(query),provider,day,provider==="mercari"?algorithm+"/mercari-2":algorithm,clean(identity.brand).replace(/^nike(?: jordan)?$|^air jordan$/, /jordan 1/i.test(identity.model||"")?"jordan":"nike"),
    clean(identity.model)||clean(recognizableName(identity)),productProfile(identity).kind,colors,clean(d.size),clean(d.sizeSystem),
    d.condition||visibleConditionGroup(identity.visibleCondition),clean(d.variant)||jordanEdition(query.identification),d.productIdentifierVerified?clean(d.productIdentifier):"",
    clean(d.packaging),clean(d.subtype),clean(d.material),clean(d.dimensions),clean(d.includedAccessories),
    credible,identity.confidence==="low",!!identity.understanding?.conflicts.length&&!identity.userReviewedConflicts];
  return createHash("sha256").update(JSON.stringify(identityFields)).digest("hex");
}
type Stored={result:MarketplaceResult;recommendation:ReturnType<typeof recommend>;snapshot:{version:string;updatedAt:string;day:string;persisted?:boolean}};
export function createDailySnapshots(root=process.env.RESELLAI_SNAPSHOT_DIR||join(process.cwd(),".marketplace-snapshots"),now=Date.now){
  const pending=new Map<string,Promise<Stored>>();
  return async function load(provider:MarketplaceProvider,query:ProductQuery,refresh=false):Promise<Stored>{
    const time=now(),day=dayAt(time);
    const key=snapshotIdentity(provider.id,query,day);
    const directory=join(root,day,key);
    const current=pending.get(key);
    if(current)return current;
    const task=(async()=>{
      let versions:string[]=[];
      try{versions=(await readdir(directory)).filter(v=>/^\d{6}\.json$/.test(v)).sort();}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      if(!refresh&&versions.length)return JSON.parse(await readFile(join(directory,versions.at(-1)!),"utf8")) as Stored;
      const raw=await provider.search(query,{refresh});
      const partial=raw.searchCompleteness==="partial"||raw.searchDiagnostics?.attempts.some(a=>a.error)||
        raw.warnings.some(w=>/partial marketplace search|stopped further stages/i.test(w));
      const durable=!partial&&raw.status!=="unavailable"&&raw.environment==="production";
      if(partial&&versions.length){
        const prior=JSON.parse(await readFile(join(directory,versions.at(-1)!),"utf8")) as Stored;
        return {...prior,result:{...raw,status:"unavailable" as const,reason:"The refresh did not finish. Your previous daily snapshot was kept; try a manual refresh later."},snapshot:{...prior.snapshot,persisted:true}};
      }
      const version=String(versions.length+1).padStart(6,"0");
      const updatedAt=new Date(now()).toISOString();
      const expiresAt=nextMidnight(time,day);
      const result=durable?{...raw,expiresAt}:raw;
      const output={identityKey:key,matchingInputs:{identification:JSON.parse(JSON.stringify(query.identification)),details:Object.fromEntries(Object.entries(query.details).filter(([field,value])=>field!=="additionalDetails"&&value!==undefined))},normalizedIdentity:{brand:pricingIdentity(query.identification,query.details).identity.brand,model:pricingIdentity(query.identification,query.details).identity.model,colorway:query.identification.colorway,condition:query.details.condition||visibleConditionGroup(query.identification.visibleCondition),size:query.details.size,sizeSystem:query.details.sizeSystem,variant:query.details.variant||jordanEdition(query.identification),verifiedIdentifier:query.details.productIdentifierVerified?query.details.productIdentifier:null},result,recommendation:recommend(result,query,defaultPricingOptions,time),snapshot:{version,updatedAt,day,persisted:durable}};
      if(durable){
        await mkdir(directory,{recursive:true});
        const tmp=join(directory,randomUUID()+".tmp");
        await writeFile(tmp,JSON.stringify(output),{flag:"wx",mode:0o600});
        await rename(tmp,join(directory,version+".json"));
      }
      return output;
    })().finally(()=>pending.delete(key));
    pending.set(key,task);
    return task;
  };
}



