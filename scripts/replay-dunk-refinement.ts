import {mkdir,readFile,readdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tierComparable} from "../lib/ebay-search";
import {matchMercari} from "../lib/mercari-matching";
import {recommend} from "../lib/valuation";
import {scoreComparable} from "../lib/comparable-quality";
import {emptyMatchDetails,type MarketplaceResult,type ProductQuery} from "../lib/marketplaces";
async function main(){
 const root=".marketplace-snapshots/2026-11-11",records=[];
 for(const dir of (await readdir(root)).sort()){
  let d;
  try{d=JSON.parse(await readFile(join(root,dir,"000001.json"),"utf8"));}catch{continue;}
  const result=d.result as MarketplaceResult;
  if(!/dunk/i.test(result.query))continue;
  const n=d.normalizedIdentity,refined=!!n.size;
  // The old snapshots did not save complete submitted details.
  // General runs' warnings explicitly show no selected condition.
  const q:ProductQuery={identification:{brand:n.brand,model:n.model,productName:result.query,category:"Sneakers",colorway:n.colorway,visibleCondition:refined?null:"Appears new",identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},
   details:{...emptyMatchDetails,size:n.size,sizeSystem:n.sizeSystem,condition:refined?"new":"",variant:n.variant}};
  const passes=[];
  for(const subtype of refined?["","Low-top sneaker"]:[""]){
   const query={...q,details:{...q.details,subtype}};
   const decisions=result.comparables.map(item=>{
    const source={...item,matchReasons:[],warnings:item.warnings.filter(w=>/^Variation selection unverified|^Conflicting duplicate listing|^Seller identifier unavailable/.test(w))};
    const matched=result.provider==="mercari"?matchMercari(source,query):tierComparable(source,query);
    return {id:item.id,title:item.title,price:item.price,condition:item.condition,item:matched.item,reason:matched.reason};
   });
   const comparables=decisions.flatMap(m=>m.item?[{...m.item,quality:scoreComparable(m.item)}]:[]);
   const pricing=recommend({...result,comparables},query,undefined,Date.parse(result.retrievedAt!));
   const reasons:Record<string,number>={};
   for(const m of decisions)if(!m.item?.priceEligible)reasons[m.reason]=(reasons[m.reason]||0)+1;
   passes.push({subtype:subtype||"not supplied in replay",eligible:pricing.eligibleCount,price:pricing.suggestedListingPrice,marketReference:pricing.marketReference,blockers:pricing.blockers,reasons,
    decisions:decisions.map(({item,...m})=>({...m,tier:item?.matchTier,priceEligible:item?.priceEligible===true,selected:pricing.eligibleIds.includes(m.id)}))});
  }
  records.push({provider:result.provider,refined,identity:n,source:join(root,dir,"000001.json"),originalRetrieved:result.examined,replayRows:result.comparables.length,
   before:{eligible:d.recommendation.eligibleCount,price:d.recommendation.suggestedListingPrice},passes});
 }
 const output="evaluation/private/refinement-replay";
 await mkdir(output,{recursive:true});
 await writeFile(join(output,"dunk-refinement.json"),JSON.stringify(records,null,2)+"\n");
 for(const {passes,...record} of records)console.log(JSON.stringify({...record,passes:passes.map(({decisions,...m})=>m)}));
}
main().catch(()=>{console.error("Refinement replay failed");process.exitCode=1;});
