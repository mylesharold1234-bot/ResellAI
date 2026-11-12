import {createHash,randomBytes,randomUUID} from "node:crypto";
import {mkdir,open,readFile,rename,stat,unlink,writeFile} from "node:fs/promises";
import {extname,join,resolve} from "node:path";
import {loadEnvConfig} from "@next/env";
import {createIdentifyHandler} from "../lib/identify-server";
import {createEbayProvider} from "../lib/marketplace-providers/ebay";
import {createMercariProvider} from "../lib/marketplace-providers/mercari";
import {emptyMatchDetails} from "../lib/marketplaces";
import {normalizeProduct} from "../lib/product-profile";
import {readCaptures} from "../lib/real-world-validation";
import {assertPilotJoin,blindReview,mergePilotReviews,pilotLabels,sanitizePilotImport,pilotCaptureFetch} from "../lib/real-world-pilot";

const root=resolve("evaluation/private");
const read=async(path:string)=>JSON.parse((await readFile(path,"utf8")).replace(/^\uFEFF/,"")) as unknown;
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const json=async(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2)+"\n",{flag:"wx",mode:0o600});
const save=async(path:string,value:unknown)=>{
 const tmp=path+"."+randomUUID()+".tmp";
 await json(tmp,value);
 try{await rename(tmp,path);}catch(error){await unlink(tmp).catch(()=>{});throw error;}
};
async function optional(path:string){
 try{return await read(path);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw e;}
}
const usage="Usage: npm run pilot -- <init|import|identify|collect|review|merge> <pilot-name> [arguments]. See docs/REAL-WORLD-PILOT-V1.md.";

async function main(){
 if(process.env.NODE_ENV==="production")throw Error("The pilot CLI is development-only.");
 const [command,name,...args]=process.argv.slice(2);
 if(!command||!name||!/^[a-zA-Z0-9_-]{1,50}$/.test(name)||!["init","import","identify","collect","review","merge"].includes(command))throw Error(usage);
 await mkdir(root,{recursive:true});
 const lockPath=join(root,".pilot.lock");
 const lock=await open(lockPath,"wx",0o600).catch(()=>{throw Error("Another pilot command is running, or a stale lock remains. See the pilot guide.");});
 try{
  const dir=join(root,name);
  const labelsPath=join(dir,"labels.json"),capturesPath=join(dir,"captures.json");
  if(command==="init"){
   if(args.length)throw Error(usage);
   await mkdir(dir);
   await json(labelsPath,{schemaVersion:1,datasetId:name,kind:"real",cases:[]});
   console.log("Created "+labelsPath+". Add exactly 10 independently verified product labels.");
   return;
  }
  const labels=pilotLabels(await read(labelsPath));
  const raw=await optional(capturesPath);
  const captures=readCaptures(raw??{schemaVersion:1,datasetId:labels.datasetId,kind:"real",cases:[]});
  assertPilotJoin(labels,captures);
  const freezePath=join(dir,".labels-sha256.json");
  const labelHash=digest(labels);
  const frozen=await optional(freezePath);
  if(frozen!==undefined&&frozen!==labelHash)throw Error("Original product labels changed after collection began. Start a separate pilot rather than changing ground truth.");
  let isFrozen=frozen!==undefined;
  const freeze=async()=>{if(!isFrozen){await json(freezePath,labelHash);isFrozen=true;}};
  const validPermission=(ref:string|undefined)=>!!ref&&/^[a-zA-Z0-9_-]{1,100}$/.test(ref);
  async function recordPermission(action:string,ref:string){
   const path=join(dir,"permissions.json");
   const entries=(await optional(path)??[]) as unknown[];
   await save(path,[...entries,{action,reference:ref,recordedAt:new Date().toISOString()}]);
  }
  const writeCaptures=async()=>{await freeze();await save(capturesPath,captures);};
  const saltPath=join(dir,".seller-salt.json");
  async function salt(){
   const existing=await optional(saltPath);
   if(typeof existing==="string")return existing;
   const value=randomBytes(32).toString("hex");
   await json(saltPath,value);return value;
  }
  if(command==="import"){
   const [input,authorized,permission]=args;
   if(!input||authorized!=="--authorized"||!validPermission(permission)||args.length!==3)throw Error(usage);
   const imported=readCaptures(sanitizePilotImport(await read(resolve(input)),await salt()));
   assertPilotJoin(labels,imported);
   for(const c of imported.cases){
    const prior=captures.cases.find(x=>x.id===c.id);
    if(!prior){captures.cases.push(c);continue;}
    if(digest(prior.identification)!==digest(c.identification)||digest(prior.details??null)!==digest(c.details??null))throw Error("Import cannot replace the recorded identification or submitted details for "+c.id+".");
    for(const provider of ["ebay","mercari"] as const){
     if(!c.markets[provider])continue;
     if(prior.markets[provider])throw Error("Import cannot replace an existing capture for "+c.id+" / "+provider+".");
     prior.markets[provider]=c.markets[provider];
    }
   }
   await writeCaptures();
   await recordPermission("manual-import",permission);
   console.log("Imported and minimized authorized captures.");
   return;
  }
  if(command==="review"||command==="merge"){
   if(args.length||!captures.cases.length)throw Error("Record pilot captures before preparing or merging reviews.");
   const worksheet=join(dir,"review.json");
   if(command==="review"){await json(worksheet,blindReview(labels,captures));console.log("Review "+worksheet+" independently.");}
   else {await json(join(dir,"labels.reviewed.json"),mergePilotReviews(labels,captures,await read(worksheet)));console.log("Created labels.reviewed.json. Run validate:real with captures.json.");}
   return;
  }
  const [id,option,authorized,permission]=args;
  if(!labels.cases.some(x=>x.id===id))throw Error("Provide an independently labeled product ID.");
  loadEnvConfig(process.cwd(),true,{info(){},error(){}});
  if(command==="identify"){
   if(args.length!==2||captures.cases.some(x=>x.id===id))throw Error("Identify needs a photo path and an ID without a recorded attempt.");
   if(!process.env.OPENAI_API_KEY?.trim())throw Error("The existing OPENAI_API_KEY is not configured.");
   const imageType:Record<string,string>={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp"};
   const type=imageType[extname(option).toLowerCase()];
   if(!type||(await stat(option)).size>10*1024*1024)throw Error("Use one PNG, JPEG, or WebP photo within the app upload limit.");
   await freeze();
   const form=new FormData();
   form.append("images",new File([new Uint8Array(await readFile(option))],"product"+extname(option),{type}));
   const res=await createIdentifyHandler({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_VISION_MODEL||"gpt-4.1-mini"})(new Request("http://localhost/api/identify",{method:"POST",body:form}));
   const body=await res.json();
   const record={id,identification:res.ok?{status:"ok",output:body.identification}:{status:"error",reason:"Existing identification handler returned HTTP "+res.status},markets:{}};
   captures.cases.push(readCaptures({...captures,cases:[record]}).cases[0]);
   await writeCaptures();
   console.log("Recorded identification outcome for "+id+" (HTTP "+res.status+").");
   return;
  }
  if((option!=="ebay"&&option!=="mercari")||authorized!=="--authorized"||!validPermission(permission)||args.length!==4)throw Error(usage);
  const provider=option;
  const c=captures.cases.find(x=>x.id===id);
  if(!c||c.identification.status!=="ok"||c.markets[provider])throw Error("Collect requires a successful captured identification and no existing capture for this provider.");
  if(provider==="ebay"&&(!process.env.EBAY_CLIENT_ID||!process.env.EBAY_CLIENT_SECRET||process.env.EBAY_ENVIRONMENT!=="production"||process.env.EBAY_PRODUCTION_APPROVED!=="true"))
   throw Error("Live eBay capture needs the existing approved Production integration.");
  if(provider==="mercari"&&!process.env.APISH_API_KEY?.trim())throw Error("The existing APISH_API_KEY is not configured.");
  await freeze();
  const stamp=new Date().toISOString(),time=Date.parse(stamp);
  const budgetPath=join(root,".collection-budget.json");
  const previous=(await optional(budgetPath)??[]) as {provider:string;at:number;until?:number}[];
  const recent=previous.filter(x=>x.at>time-86_400_000);
  if(recent.some(x=>x.provider===provider&&(x.until??0)>time))throw Error("The provider requested a cooldown. Wait before collecting again.");
  const hours=recent.filter(x=>x.provider===provider&&x.at>time-3_600_000);
  if(hours.length>=(provider==="mercari"?5:25)||recent.filter(x=>x.provider===provider).length>=(provider==="mercari"?20:50))
   throw Error("Pilot collection budget reached. Wait before collecting another product.");
  const attempt={provider,at:time,until:0};
  await save(budgetPath,[...recent,attempt]);
  await recordPermission(provider+"-"+id,permission);
  const pages:unknown[]=[];
  const secret=await salt();
  const captureFetch=pilotCaptureFetch(provider,secret,pages);
  const api=provider==="ebay"?createEbayProvider({clientId:process.env.EBAY_CLIENT_ID,clientSecret:process.env.EBAY_CLIENT_SECRET,environment:"production",productionApproved:true,fetcher:captureFetch}):
   createMercariProvider({apiKey:process.env.APISH_API_KEY,fetcher:captureFetch});
  const result=await api.search({identification:normalizeProduct(c.identification.output),details:c.details??emptyMatchDetails});
  if(result.retryAfterSeconds){attempt.until=Date.now()+result.retryAfterSeconds*1000;await save(budgetPath,[...recent,attempt]);}
  c.markets[provider]=result.status==="unavailable"||!pages.length?{status:"error",capturedAt:stamp,pages:[],reason:result.reason??"No valid pre-filter response captured."}:
   {status:"ok",capturedAt:result.retrievedAt??stamp,pages,warnings:result.warnings};
  await writeCaptures();
  console.log("Recorded "+provider+" "+c.markets[provider]?.status+" for "+id+" ("+c.markets[provider]?.pages.length+" pre-filter pages).");
 }finally{await lock.close();await unlink(lockPath);}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Pilot command failed.");process.exitCode=1;});
