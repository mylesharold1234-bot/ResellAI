import {readFile,readdir,mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tierComparable,searchPlan} from "../lib/ebay-search";
import {matchMercari} from "../lib/mercari-matching";
import {scoreComparable} from "../lib/comparable-quality";
import {recommend} from "../lib/valuation";
import {emptyMatchDetails,type ProductQuery,type MarketplaceResult} from "../lib/marketplaces";

async function main(){
 const root=".marketplace-snapshots/2026-11-11";
 const records=[];
 for(const dir of (await readdir(root)).sort()){
  let d;
  try{d=JSON.parse(await readFile(join(root,dir,"000002.json"),"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")continue;throw error;}
  const r=d.result as MarketplaceResult,n=d.normalizedIdentity;
  if(!n||!/jordan/i.test(r.query)||n.model!=="Air Jordan 1")continue;
  const q:ProductQuery={identification:{brand:n.brand,model:n.model,productName:r.query,category:"Sneakers",colorway:n.colorway,visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},
   details:{...emptyMatchDetails,condition:n.condition==="new"?"new":"",size:n.size,sizeSystem:n.sizeSystem,variant:n.variant}};
  const decisions=r.comparables.map(item=>{
   // Old matching warnings are generated outputs, not provider evidence.
   const source={...item,warnings:item.warnings.filter(w=>/^Variation selection unverified|^Conflicting duplicate listing|^Seller identifier unavailable/.test(w)),matchReasons:[]};
   const m=r.provider==="mercari"?matchMercari(source,q):tierComparable(source,q);
   return {id:item.id,title:item.title,price:item.price,reason:m.reason,item:m.item};
  });
  const rows=decisions.flatMap(m=>m.item?[{...m.item,quality:scoreComparable(m.item)}]:[]);
  const now=Date.parse(r.retrievedAt!);
  const rec=recommend({...r,comparables:rows},q,undefined,now);
  const reasons:Record<string,number>={};
  for(const m of decisions)if(!m.item?.priceEligible)reasons[m.reason]=(reasons[m.reason]||0)+1;
  records.push({provider:r.provider,source:join(root,dir,"000002.json"),originalRetrieved:r.examined,replayRows:r.comparables.length,
   reconstruction:"Model/color/condition/size from normalized snapshot identity; product name approximated by saved search query, which explicitly states high top. Medium confidence. Pre-filter rejected rows are unavailable.",
   before:{eligible:d.recommendation.eligibleCount,price:d.recommendation.suggestedListingPrice,statistics:d.recommendation.statistics,blockers:d.recommendation.blockers},
   after:{retained:rows.length,pricingCandidates:rows.filter(x=>x.priceEligible).length,eligible:rec.eligibleCount,price:rec.suggestedListingPrice,statistics:rec.statistics,cohort:rec.variantCohort,blockers:rec.blockers,pricingExclusions:rec.exclusions},
   rejectedReasons:reasons,plannedQueries:searchPlan(q),newApiRequests:0,
   rows:decisions.map(({item,...m})=>({...m,tier:item?.matchTier??null,eligible:item?.priceEligible===true,selected:rec.eligibleIds.includes(m.id)}))});
 }
 const output="evaluation/private/matching-replay";
 await mkdir(output,{recursive:true});
 await writeFile(join(output,"retained-jordan-replay.json"),JSON.stringify(records,null,2)+"\n");
 for(const {rows,...summary} of records)console.log(JSON.stringify(summary));
}
main().catch(()=>{console.error("Saved-listing replay failed.");process.exitCode=1;});
