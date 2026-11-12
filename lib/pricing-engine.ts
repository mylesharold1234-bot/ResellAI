import {nonWearableReason,footwearCohort} from "./footwear-compatibility";
import type {Comparable,MarketplaceResult,ProductQuery} from './marketplaces';
import {pricingIdentity} from './product-profile';
import {conditionGroup} from './product-matching';
export type PricingOptions={negotiationMarginPercent:number;offerDiscountLowPercent:number;offerDiscountHighPercent:number;shippingBasis:'item'|'delivered';buyerShippingCharge:number};
export const defaultPricingOptions:PricingOptions={negotiationMarginPercent:0,offerDiscountLowPercent:10,offerDiscountHighPercent:20,shippingBasis:'item',buyerShippingCharge:0};
export function parsePricingOptions(value:unknown):PricingOptions{
 if(value===undefined)return {...defaultPricingOptions};if(!value||typeof value!=='object')throw Error('Invalid pricing assumptions.');const v={...defaultPricingOptions,...value as object};
 for(const [k,max] of [['negotiationMarginPercent',30],['offerDiscountLowPercent',50],['offerDiscountHighPercent',60],['buyerShippingCharge',1000]] as const)if(typeof v[k]!=='number'||!Number.isFinite(v[k])||v[k]<0||v[k]>max)throw Error('Pricing assumptions are outside supported bounds.');
 if(v.offerDiscountHighPercent<v.offerDiscountLowPercent||!['item','delivered'].includes(v.shippingBasis))throw Error('Choose valid offer discounts and shipping basis.');return v;
}
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const median=(a:number[])=>a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;
export function visibleConditionGroup(value?:string|null){
 const text=(value||'').toLowerCase();
 if(/\b(?:not new|heavy wear|heavily worn|for parts)\b/.test(text))return '';
 if(/\blike[- ]new\b/.test(text))return 'new or like new';
 return /\b(?:appears?|looks?|seems?) (?:to be )?new\b|^new\b|\bunworn\b/.test(text)?'new':'';
}
export function listingDisplayPrice(price:number|null,range:{low:number;high:number}|null){
 if(price===null||!range)return price;
 const candidate=money(Math.round(price+0.01)-0.01);
 return candidate>=range.low&&candidate<=range.high&&Math.abs(candidate-price)<=0.25?candidate:price;
}
export function pricingEngine(result:MarketplaceResult,q:ProductQuery,options:PricingOptions=defaultPricingOptions,now=Date.now()){
 const assumptions=parsePricingOptions(options),seen=new Set<string>();
 const exclusions:Record<string,number>={};
 const exclude=(tier:string,reason:string)=>{const key=tier+': '+reason;exclusions[key]=(exclusions[key]||0)+1;};
 const signatures=new Map<string,string>();
 const conflicting=new Set<string>();
 for(const row of result.comparables){
  if(!Number.isFinite(row.price)||row.price<=0||row.status!=="asking"||row.currency!=="USD")continue;
  const signature=JSON.stringify([row.price,row.conditionId,row.shipping,row.seller,row.matchTier,row.priceEligible,row.title]);
  const prior=signatures.get(row.id);
  if(prior!==undefined&&prior!==signature)conflicting.add(row.id);
  signatures.set(row.id,signature);
 }
 const all=[...result.comparables].sort((a,b)=>a.id.localeCompare(b.id)||a.price-b.price||a.title.localeCompare(b.title)).filter(x=>{
  if(!Number.isFinite(x.price)||x.price<=0||x.status!=='asking'||x.currency!=='USD'){exclude(x.matchTier||'unclassified','invalid active USD ask');return false;}
  if(conflicting.has(x.id)||x.warnings.includes("Conflicting duplicate listing")){exclude(x.matchTier||'unclassified','conflicting duplicate listing');return false;}
  if(seen.has(x.id)){exclude(x.matchTier||'unclassified','duplicate item');return false;}
  seen.add(x.id);return true;
 });
 const visible=visibleConditionGroup(q.identification.visibleCondition);
 const appearsNew=!!visible;
 const allowLikeNew=visible==='new or like new';
 const groups=new Map<string,Comparable[]>();
 for(const x of all){
  const tier=x.matchTier||'exact';
  const nonWearable=nonWearableReason(x,q);
  if(nonWearable){exclude(tier,nonWearable);continue;}
  if(tier==='related'){exclude(tier,'context only');continue;}
  if(x.warnings.some(w=>w.startsWith('Variation selection unverified'))){exclude(tier,'variation price unverified');continue;}
  if(x.priceEligible===false){exclude(tier,'match checks failed (see listing filter diagnostics)');continue;}
  if(assumptions.shippingBasis==='delivered'&&x.shipping===null){exclude(tier,'quoted shipping unavailable');continue;}
  let g=conditionGroup(x.conditionId);
  if(!q.details.condition&&appearsNew&&g==='used'&&/\blike[- ]new\b/i.test(x.condition))g='like new';
  if(!g||(g==='parts'&&q.details.condition!=='parts')||(q.details.condition&&g!==q.details.condition)||(!q.details.condition&&appearsNew&&g!=='new'&&!(allowLikeNew&&g==='like new'))){exclude(tier,'incompatible or unknown condition');continue;}
  const cohortKey=g+(footwearCohort(x,q)?'|'+footwearCohort(x,q):'');
  groups.set(cohortKey,[...(groups.get(cohortKey)||[]),x]);
 }
 const summarize=(items:Comparable[])=>{
  const priced=items.map(item=>({item,value:money(item.price+(assumptions.shippingBasis==='delivered'?item.shipping||0:0))})).sort((a,b)=>a.value-b.value||a.item.id.localeCompare(b.item.id));
  let kept=priced,outliers:typeof priced=[];
  let mad:number|null=null,band:number|null=null;
  if(priced.length>=5){
   const m=median(priced.map(x=>x.value));
   mad=median(priced.map(x=>Math.abs(x.value-m)).sort((a,b)=>a-b));
   const threshold=Math.max(m*0.2,3*1.4826*mad);
   band=threshold;
   kept=priced.filter(x=>Math.abs(x.value-m)<=threshold);outliers=priced.filter(x=>Math.abs(x.value-m)>threshold);
  }
  const vals=kept.map(x=>x.value);
  const stats=vals.length?{count:vals.length,median:money(median(vals)),average:money(vals.reduce((a,b)=>a+b,0)/vals.length),lowest:vals[0],highest:vals[vals.length-1]}:null;
  const sellers=new Set(kept.map(x=>x.item.seller).filter(Boolean)).size;
  return {kept,outliers,stats,sellers,mad,band,spread:stats?stats.highest/stats.lowest:Infinity};
 };
 const qualified=(sample:ReturnType<typeof summarize>,minimum:number,sellers:number)=>sample.kept.length>=minimum&&sample.sellers>=sellers&&sample.spread<=2;
 const bySize=[...groups].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
 const exactGroups=bySize.map(([condition,rows])=>({condition,sample:summarize(rows.filter(x=>!x.matchTier||x.matchTier==='exact')),stronger:undefined}));
 const estimatedGroups=bySize.map(([condition,rows])=>{
  const highEvidence=rows.filter(x=>(x.quality?.score??0)>=75);
  const stronger=qualified(summarize(highEvidence),3,2)?highEvidence:rows.filter(x=>x.matchTier==='exact'||x.matchReasons.includes('Visible colors present in title'));
  const subset=summarize(stronger);
  const combined=summarize(rows);
  const preferStrong=highEvidence.length===stronger.length&&qualified(subset,5,3);
  return (!qualified(combined,3,2)||preferStrong)&&stronger.length<rows.length&&qualified(subset,3,2)
   ?{condition,sample:subset,stronger:new Set(stronger.map(x=>x.id))}
   :{condition,sample:combined,stronger:undefined};
 });
 const exactChoice=q.details.condition&&q.identification.confidence!=='low'?exactGroups.find(x=>qualified(x.sample,5,3)):undefined;
 const standard=estimatedGroups.find(x=>qualified(x.sample,3,2));
 // Only split on independent product evidence, never by picking a convenient price window.
 const mercariGrades=result.provider==="mercari"&&!exactChoice&&!standard?bySize.flatMap(([condition,rows])=>{
  const grades=new Map<string,Comparable[]>();
  for(const item of rows){if(item.conditionId)grades.set(item.conditionId,[...(grades.get(item.conditionId)||[]),item]);}
  return [...grades.values()].filter(group=>group.length<rows.length).map(group=>({condition,sample:summarize(group),stronger:new Set(group.map(x=>x.id)),grade:group[0].condition}));
 }).filter(x=>qualified(x.sample,3,2)).sort((a,b)=>b.sample.kept.length-a.sample.kept.length||b.sample.sellers-a.sample.sellers||a.grade.localeCompare(b.grade)||a.condition.localeCompare(b.condition)):[];
 const gradeChoice=mercariGrades[0];
 const choice=exactChoice||standard||gradeChoice||estimatedGroups[0];
 const selectedGroup=choice?.condition||q.details.condition||'';
 const condition=selectedGroup.split('|')[0];
 const {kept,outliers,stats,sellers,spread,mad,band}=choice?.sample||summarize([]);
 for(const [group,rows] of groups)for(const x of rows){
  if(group!==selectedGroup)exclude(x.matchTier||'exact','outside selected condition or edition cohort');
  else if(exactChoice&&x.matchTier==='close')exclude('close','exact cohort sufficient');
  else if(choice?.stronger&&!choice.stronger.has(x.id))exclude(x.matchTier||'exact',gradeChoice?'outside qualified '+gradeChoice.grade+' condition grade':'stronger comparable evidence sufficient');
 }
 for(const {item} of outliers)exclude(item.matchTier||'exact','price outlier');
 const fresh=!!result.expiresAt&&Date.parse(result.expiresAt)>now;
 const conflict=!!q.identification.understanding?.conflicts.length&&!q.identification.userReviewedConflicts;
 const identity=pricingIdentity(q.identification,q.details);
 const verifiedIdentifier=!!q.details.productIdentifier?.trim()&&q.details.productIdentifierVerified;
 const marketplace=result.provider==="mercari"?"Mercari":"eBay";
 const blockers:string[]=[];
 if(!fresh)blockers.push('Refresh comparisons to retrieve current '+marketplace+' listings.');
 else if(result.status!=='available'||result.environment!=='production')blockers.push('Current production '+marketplace+' listings are unavailable. Try refreshing comparisons.');
 if(!identity.credible&&!verifiedIdentifier)blockers.push('Confirm the exact product. Add a clear photo of the model label or verify a product identifier. ');
 if(conflict)blockers.push('Resolve the conflict between the photo and description.');
 if(kept.length<3)blockers.push('At least three eligible listings are needed. Confirm the model, variant and condition, then refresh comparisons.');
 if(kept.length>=3&&sellers<2)blockers.push('At least two identified sellers must support the comparison.');
 if(stats&&spread>2)blockers.push('The comparable prices vary too widely. Confirm the exact variant and condition to narrow the results.');
 const adequate=!!stats&&blockers.length===0;
 const limitations=[...new Set(kept.flatMap(({item})=>item.warnings).filter(w=>/not confirmed|not verified|not selected|not fully evidenced|Only some visible colors|Full visible colorway|confidence is low/i.test(w)))];
 const exactEnough=adequate&&!!exactChoice&&identity.credible;
 const current=fresh&&result.environment==='production'&&result.status==='available';
 const anchor=stats?.median;const supported=adequate&&current;
 const listing=anchor===undefined?null:money(Math.max(0,anchor-(assumptions.shippingBasis==='delivered'?assumptions.buyerShippingCharge:0)));
 const recommended=supported&&listing!==null&&listing>0;
 if(supported&&!recommended)blockers.push('Lower the buyer shipping charge or use item-only pricing to calculate a positive listing price.');
 const modeled=recommended&&anchor!==undefined?{low:money(anchor*(1-assumptions.offerDiscountHighPercent/100)),high:money(anchor*(1-assumptions.offerDiscountLowPercent/100))}:null;
 const categoryValues=all.map(x=>x.price).sort((a,b)=>a-b);const scenarioAnchor=anchor??(categoryValues.length?money(median(categoryValues)):null);
 return {statistics:stats,pricingBasis:exactEnough?'exact' as const:stats?'close' as const:'none' as const,suggestedListingPrice:recommended?listing:null,blockers,exclusions,limitations,pricingDiagnostics:{prices:kept.map(x=>x.value),sellerCount:sellers,spread:Number.isFinite(spread)?spread:null,mad,outlierBand:band,grade:gradeChoice?.grade??null,outliers:outliers.map(x=>({id:x.item.id,price:x.value,reason:"Outside 3× scaled MAD band (20% median floor)"}))},marginAdjustedAsk:recommended&&assumptions.negotiationMarginPercent>0?money(listing!+anchor!*assumptions.negotiationMarginPercent/100):null,expectedSellingPrice:null,modeledOfferRange:modeled,illustrativeScenario:!supported&&current&&scenarioAnchor!==null?{anchor:scenarioAnchor,low:money(scenarioAnchor*(1-assumptions.offerDiscountHighPercent/100)),high:money(scenarioAnchor*(1-assumptions.offerDiscountLowPercent/100)),label:'Illustrative negotiation scenario anchored to observed asks; not an item-specific prediction'}:null,provisional:recommended&&!exactEnough,dataQuality:!stats?'unavailable':exactEnough&&current?'moderate':supported?'limited':'low',eligibleCount:kept.length,eligibleIds:kept.map(x=>x.item.id),outlierIds:outliers.map(x=>x.item.id),conditionCohort:condition,variantCohort:selectedGroup.split('|')[1]??null,shippingBasis:assumptions.shippingBasis,assumptions,fresh,indicativeAskingRange:stats&&stats.count>=3&&spread<=2?{low:stats.lowest,high:stats.highest}:null,rationale:recommended?(exactEnough?'Qualified':'Provisional close-comparable')+' starting ask: robust median of '+kept.length+' active listings in the '+(gradeChoice?.grade||condition)+' condition cohort. Not a verified sale value.':!fresh?'Historical snapshot only. Refresh manually for current pricing.':'Insufficient comparable evidence for an item-specific recommendation.',reasons:[...result.warnings,...(!q.details.condition?['Condition not selected: using one '+(condition||'unavailable')+' condition cohort'+(appearsNew?' based on visible condition.':'.')]:[]),...(assumptions.shippingBasis==='item'?['Item-price basis excludes shipping and tax; unknown shipping is not assumed free.']:['Delivered basis includes only listings with quoted shipping. Suggested item price subtracts your selected buyer shipping charge.']),...(outliers.length?[outliers.length+' extreme asking-price outliers excluded using a 3× scaled-MAD band with a 20% median floor.']:[]),...(q.identification.confidence==='low'?['Low-confidence image identification limits guidance to an estimate.']:[]),...(conflict?['Resolve the image/description conflict before using item-specific guidance.']:[]),...(stats&&spread>2?['Eligible asking prices still span more than 2× after robust filtering; no item-specific recommendation is available.']:[]),...(kept.length<3?['Fewer than three eligible listings remain.']:[]),...(sellers<2?['Fewer than two identified sellers support the sample.']:[]),'Accessory packages are compared as advertised; unverified accessory differences receive no invented price adjustment.','Offer discounts and negotiation margins are user-adjustable assumptions, not observed conversion rates.','No sold transactions, demand, sell-through, or future price evidence is available.'],soldEvidence:'Unavailable: active asking listings only.',sellNow:'Not assessed: active asks do not establish demand or timing.',marketplaceChoice:marketplace+' only evaluated. No cross-marketplace ranking.'};
}

