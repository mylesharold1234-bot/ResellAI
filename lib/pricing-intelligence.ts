import type {recommend} from "./valuation";
import type {MarketplaceResult} from "./marketplaces";

export type PricingEvidence={result:MarketplaceResult;recommendation:ReturnType<typeof recommend>};
type Recommendation=PricingEvidence["recommendation"];
export function evidenceQuality(rec:Recommendation){
 const {spread,sellerCount}=rec.pricingDiagnostics??{};
 const incomplete=rec.reasons.some(r=>/search stage failed|stopped further stages|rate limit|partial marketplace/i.test(r));
 const uncertain=rec.limitations.some(r=>/confidence is low|not verified|not confirmed|only some visible colors/i.test(r));
 const level:"Insufficient"|"Limited"|"Medium"|"High"=rec.suggestedListingPrice===null?"Insufficient":rec.provisional||incomplete||uncertain?"Limited":
  rec.eligibleCount>=8&&(sellerCount??0)>=4&&(spread??Infinity)<=1.35?"High":"Medium";
 const reasons=[
  rec.pricingBasis==="exact"?"Exact-match cohort":"Close or incompletely verified cohort",
  rec.eligibleCount+" qualifying listings from "+(sellerCount??0)+" identified sellers",
  ...(spread==null?[]:[spread.toFixed(2)+"× high-to-low asking-price spread"]),
  ...(uncertain?["Some product attributes remain unconfirmed"]:[]),
  ...(incomplete?["Some search stages did not finish"]:[]),
 ];
 return {level,reasons};
}

export function compareMarketplaceEvidence(ebay:PricingEvidence|null,mercari:PricingEvidence|null,now:number){
 const current=(x:PricingEvidence|null)=>x&&x.result.status==="available"&&x.result.environment==="production"&&
  !!x.result.expiresAt&&Date.parse(x.result.expiresAt)>now&&x.recommendation.suggestedListingPrice!==null;
 if(!current(ebay)||!current(mercari))return {marketplace:null,reason:"Both marketplaces need a current, supported recommendation before they can be compared."};
 const a=ebay!,b=mercari!;
 const conditions=(x:PricingEvidence)=>{
  const ids=new Set(x.recommendation.eligibleIds);
  return [...new Set(x.result.comparables.filter(item=>ids.has(item.id)).map(item=>item.conditionId))].sort().join(",");
 };
 if(!conditions(a)||conditions(a)!==conditions(b)||a.recommendation.conditionCohort!==b.recommendation.conditionCohort)
  return {marketplace:null,reason:"The recommendations use different condition evidence, so neither marketplace is preferred."};
 const first=evidenceQuality(a.recommendation),second=evidenceQuality(b.recommendation);
 const order={Insufficient:0,Limited:1,Medium:2,High:3};
 const left=order[first.level],right=order[second.level];
 if(left===right||Math.max(left,right)<2)return {marketplace:null,reason:"The available evidence does not establish a clear marketplace preference."};
 const winner=left>right?first:second;
 return {marketplace:left>right?"eBay":"Mercari",reason:winner.reasons.join(" · ")};
}

export function marketplaceProfitScenario(price:number,fields:Record<"purchase"|"buyerShipping"|"sellerShipping"|"fee"|"extras",string>){
 if(!Number.isFinite(price)||price<=0||price>Number.MAX_SAFE_INTEGER/600||Object.values(fields).some(x=>!x.trim()||!Number.isFinite(Number(x))||Number(x)<0||Number(x)>Number.MAX_SAFE_INTEGER/600))return null;
 const cents=(value:number)=>Math.round(value*100);
 const gross=cents(price)+cents(Number(fields.buyerShipping));
 const proceeds=gross-cents(Number(fields.sellerShipping))-cents(Number(fields.fee))-cents(Number(fields.extras));
 return {proceeds:proceeds/100,profit:(proceeds-cents(Number(fields.purchase)))/100};
}

