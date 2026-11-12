import {nonWearableReason,footwearSignature,supportedFootwear,footwearSubtypeEvidence} from "./footwear-compatibility";
import {primaryProduct} from './primary-product';
import {conditionGroup} from './product-matching';
import {assessIdentification, genericObjectWords, known, normalizeProduct, recognizableName, productProfile, pricingIdentity, jordanEdition} from './product-profile';
import {createHash} from 'node:crypto';
import type {Comparable, ProductQuery} from './marketplaces';
import {emptyMatchDetails} from './marketplaces';
import {matchComparable, normalize, tokens} from './product-matching';
export type MatchTier = 'exact' | 'close' | 'related';
export function searchPlan(query: ProductQuery) {
 const i=normalizeProduct(query.identification);
 const rawName=normalize(recognizableName(i));
 const statedShape=footwearSignature(i.model||"").silhouette;
 const name=productProfile(i).kind==="footwear"&&["mid","low"].includes(statedShape)?rawName.replace(/\bhigh top\b/g,"").trim():rawName;
 const brand=normalize(known(i.brand));
 const model=normalize(known(i.model));
 const object=genericObjectWords(i);
 const visual=tokens(i.colorway || '').filter(t=>['black','white','red','blue','green','gray','grey','silver','gold','pink','purple','brown'].includes(t)).join(' ');
 const full=brand && !tokens(brand).every(w=>tokens(name).includes(w)) ? brand+' '+name : name;
 const alias=full.replace(/(?:nike )?air jordan/g,'nike jordan').replace(/playstation\s*5/g,'ps5').replace(/wh 1000xm5/g,'wh1000xm5');
 const unique=(v:string)=>[...new Set(normalize(v).split(' ').filter(Boolean))].join(' ');
 const supported=supportedFootwear(query);
 const silhouette=productProfile(i).kind==='footwear'&&supported.silhouette!=='unspecified'?supported.silhouette:'';
 const brandType=brand ? unique(brand+' '+(query.details.subtype || '')+' '+object) : name;
 const broad=object || name;
 const modelHint=model&&!tokens(model).every(token=>tokens(full).includes(token))?model:'';
 const edition=productProfile(i).kind==='footwear'&&supported.edition!=='unspecified'?supported.edition.replaceAll('+',' '):'';
 const plausible=(i.understanding?.candidates||[]).filter(c=>normalize(c.model)===model&&c.variant).map(c=>unique([full,visual,c.variant].join(' '))).sort();
 const constrained=(v:string,identifier="")=>{
  const proposed=unique([v,silhouette,edition,visual].join(' '));
  if(proposed.length<=100)return proposed;
  // Keep complete supported attributes; descriptive title words are expendable.
  const core=unique([identifier,brand,model||name,query.details.subtype||'',silhouette,edition,visual].join(' '));
  if(core.length>100)return '';
  let bounded=core;
  for(const word of proposed.split(' ')){
   if(bounded.split(' ').includes(word))continue;
   if(bounded.length+1+word.length<=100)bounded+=' '+word;
  }
  return bounded;
 };
 const compact=unique([brand,model||name||brandType,query.details.subtype||''].join(' '));
 const shorthand=compact.replace(/(?:nike )?(?:air )?jordan 1/g,'AJ1').replace(/playstation 5/g,'PS5').replace(/wh 1000xm5/g,'WH1000XM5');
 const candidates=[{stage:'A',query:constrained([full,modelHint,query.details.subtype||''].join(' '))},{stage:'B',query:plausible[0]?constrained(plausible[0]):constrained(compact)},{stage:'C',query:constrained(shorthand!==compact?shorthand:alias !== full ? alias : (model||broad))}];
 if(query.details.productIdentifierVerified && query.details.productIdentifier) candidates.push({stage:'D',query:constrained(full+' '+query.details.productIdentifier,query.details.productIdentifier)});
 const seen=new Set<string>();return candidates.map(x=>({...x,query:x.query})).filter(x=>x.query&&!seen.has(x.query)&&!!seen.add(x.query)).slice(0,4);
}
export function searchCacheKey(query:ProductQuery){return createHash('sha256').update(JSON.stringify({version:20,identification:query.identification,details:query.details})).digest('hex').slice(0,24);}
export function tierComparable(item:Comparable,query:ProductQuery):{item:Comparable|null;reason:string}{
 const nonWearable=nonWearableReason(item,query);
 if(nonWearable)return {item:null,reason:nonWearable};
 if(conditionGroup(item.conditionId)==="parts"&&query.details.condition!=="parts")return {item:null,reason:"parts_condition_not_complete_item"};
 const primary=primaryProduct(item,query);
 const profile=productProfile(query.identification);
 const requestedAccessory=/mouthpiece|case|controller|lens/i.test(recognizableName(query.identification));
 if(primary.kind === "parts" && query.details.condition !== "parts")return {item:null,reason:"parts_only_primary_product"};
 if(primary.kind === "accessory" && !requestedAccessory)return {item:null,reason:"accessory_only_primary_product"};
 const specificity=assessIdentification(query.identification,query.details);
 const identity=pricingIdentity(query.identification,query.details);
 const canonical=(v:string)=>v.replace(/\bps5\b/gi,'PlayStation 5').replace(/\bwh1000xm5\b/gi,'WH-1000XM5');
 const i={...identity.identity, model:canonical(identity.identity.model || recognizableName(query.identification))};
 let title=canonical(item.title);
 if(/iphone/i.test(i.model)&&/iphone/i.test(title)&&!/apple/i.test(title))title=`Apple ${title}`;
 if(/playstation/i.test(i.model)&&/playstation/i.test(title)&&!/sony/i.test(title))title=`Sony ${title}`;
 const checked={...item,title:primary.kind === "complete" ? title.replace(/bundle of|bundle/g, " ") : title};
 const broad={identification:{...i,colorway:null},details:{...emptyMatchDetails}};
 const family=matchComparable(checked,broad);
 const object=genericObjectWords(query.identification);
 const titleWords=normalize(title);
 const singular=(v:string)=>v.replace(/\b(saxophones|chairs|plates|lamps|shoes|headphones)\b/g,w=>w.slice(0,-1));
 const objectMatch=!!object && tokens(singular(object)).every(w=>tokens(singular(titleWords)).includes(w));
 const instrument=profile.kind==='instrument', dinnerware=profile.kind==='dinnerware';
 if(primary.kind !== "complete" && instrument && !/mouthpiece|ligature|reed|neck strap/i.test(recognizableName(query.identification)) && /mouthpiece|ligature|reed|neck strap|repair kit|replacement pad|case only/.test(titleWords) && !/with (?:a |the )?(?:mouthpiece|case|reeds)|includes|complete instrument/.test(titleWords))return {item:null,reason:'instrument_accessory'};
 if(instrument){const desired=normalize(recognizableName(query.identification)+' '+(query.details.subtype||'')); const types=['alto','tenor','soprano','baritone'];const specified=types.find(t=>tokens(desired).includes(t));if(specified&&(types.some(t=>t!==specified&&tokens(titleWords).includes(t)) || /sopranino|c melody/.test(titleWords)))return {item:null,reason:'incompatible_instrument_subtype'};}
 if(dinnerware){
  const context=normalize(title+' '+item.categories.join(' '));
  if(/license|licence|barbell|weight plate|armor|armour|switch plate|steel plate|aluminum plate|washer|face plate|magazine|screws|dental|toothguide|plate hanger/.test(titleWords) || !/ceramic|porcelain|china|stoneware|earthenware|dinner|luncheon|dessert|salad|bread plate|pottery|corelle|melamine|serveware|cookware|glass plate/.test(context))return {item:null,reason:'not_dinnerware_evidence'};
 }
 if(profile.kind==='furniture'){
  const desired=normalize(recognizableName(query.identification));
  if(/miniature|dollhouse|doll house|toy furniture/.test(titleWords)&&!/miniature|dollhouse|toy/.test(desired))return {item:null,reason:'miniature_not_full_size_furniture'};
  if(/lamp/.test(desired)&&/headlight|headlamp|xenon|hid d2|reptile|grow light|plant growing|uv black|no lamp included|replacement bulb/.test(titleWords))return {item:null,reason:'not_household_lamp'};
 }
 if(dinnerware && /dinner/.test(normalize(recognizableName(query.identification))) && /decorative|wall plate|display plate/.test(titleWords))return {item:null,reason:'decorative_not_dinnerware'};
 if(profile.kind==='footwear' && /adult|men|mens|women|womens/.test(normalize(recognizableName(query.identification)+' '+query.details.sizeSystem)) && /toddler|infant|baby/.test(titleWords))return {item:null,reason:'incompatible_age_group'};
 if(!family.matches && (!objectMatch || (profile.kind==='footwear' && !!known(query.identification.model))))return {item:null,reason:family.exclusionReason || 'unrelated_product'};

 // A different silhouette/generation must never be promoted by relaxing detail checks.
 const shoe=profile.kind==='footwear'||/\bjordan 1 (?:mid|low|high)\b/i.test(i.model);
 if(shoe){
  const requested=supportedFootwear(query),listed=footwearSignature(title);
  if(requested.silhouette!=="unspecified"&&listed.silhouette!=="unspecified"&&listed.silhouette!==requested.silhouette)
    return {item:null,reason:"incompatible_footwear_silhouette"};
  if(requested.edition!=="unspecified"&&listed.edition!==requested.edition)
    return {item:{...item,matchTier:"related",priceEligible:false,matchReasons:family.reasons,warnings:[...item.warnings,"Edition not established or incompatible; context only"]},reason:"incompatible_footwear_edition"};
 }
 const working=normalize(title);
 const unsupported= /\b(case|cover|replacement|controller|controllers|dualshock|dualsense|stand|mount|bracket|earpads|ear cushions|headband|charger|charging cable|skin|sticker|manual|instructions|display model|dummy|icloud locked|activation locked|mdm locked|box only|empty box|bundle|lot of|replica|fake|custom|for parts|parts only|broken|not working)\b/.exec(working);
 if(primary.kind !== "complete" && unsupported && !normalize(recognizableName(query.identification)).includes(unsupported[0]))return {item:null,reason:'accessory_bundle_or_unsupported'};
 if(profile.kind==='electronics' && /playstation|console/i.test(recognizableName(query.identification)) && /\bgames?\b/.test(working) && !/\b(console|system)\b/.test(working))return {item:null,reason:'game_not_console'};
 if(!shoe && /iphone|playstation/i.test(i.model) && /\b(pro|max|plus|slim|digital|disc)\b/.test(working) && !/\b(pro|max|plus|slim|digital|disc)\b/.test(normalize(`${i.model} ${query.details.variant}`))) {
  return {item:{...item,matchTier:'related',priceEligible:false,matchReasons:family.reasons,warnings:[...item.warnings,'Different or unconfirmed edition; context only, excluded from pricing']},reason:'related_edition'};
 }
 if(/lego/i.test(i.brand||"") && !query.details.productIdentifierVerified && !/\b\d{4,7}\b/.test(i.model)) return {item:{...item,matchTier:"related",priceEligible:false,matchReasons:family.reasons,warnings:[...item.warnings,"LEGO theme only; supply a set number for comparable pricing. Context only."]},reason:"theme_only_not_same_set"};
 if(instrument && primary.kind==='complete'){
  const desired=normalize(recognizableName(query.identification)+' '+(query.details.subtype||''));
  const subtype=['alto','tenor','soprano','baritone'].find(t=>tokens(desired).includes(t));
  const sameSubtype=!!subtype&&tokens(titleWords).includes(subtype);
  const brand=known(query.identification.brand);
  const sameBrand=!brand||tokens(brand).every(w=>tokens(titleWords).includes(w));
  const sameCondition=!query.details.condition||conditionGroup(item.conditionId)===query.details.condition;
  if(sameSubtype&&sameBrand&&(!identity.credible))return {item:{...item,matchTier:'close',priceEligible:sameCondition&&!!item.conditionId,matchReasons:['Complete instrument',subtype+' subtype matched',...(brand?['Brand words matched']:['Brand unspecified; broader instrument evidence'])],warnings:[...item.warnings,'Provisional comparison: model or manufacturer not fully established',...(primary.included.length?['Included accessories: '+primary.included.join(', ')]:[])]},reason:'close_primary_instrument'};
 }
 if(!family.matches || !identity.credible) return {item:{...item,matchTier:'related',priceEligible:false,matchReasons:[objectMatch?'Recognizable object type present in title':'General product family present'],warnings:[...item.warnings,...specificity.missing,'General category context, not specific-product valuation']},reason:!family.matches?(family.exclusionReason||'model_not_evidenced'):'specific_model_unconfirmed'};
 const details={...query.details,variant:query.details.variant||jordanEdition(query.identification),productIdentifier:query.details.productIdentifierVerified?query.details.productIdentifier:''};
 const strict=matchComparable(checked,{identification:i,details});
 const similar=!strict.matches&&strict.exclusionReason==='colorway_mismatch'?matchComparable(checked,{identification:i,details},{allowPartialColor:true}):strict;
 const subtypeEvidence=shoe&&query.details.subtype?footwearSubtypeEvidence(item,query.details.subtype):null;
 const extraConflicts=([['material',query.details.material],['dimensions',query.details.dimensions],['subtype',query.details.subtype]] as const).filter(([key,v])=>v&&(key==='subtype'&&subtypeEvidence?subtypeEvidence.state!=='confirmed':!tokens(v).every(w=>tokens(normalize(title)).includes(w)))); 
 const accessoryWords=tokens(query.details.includedAccessories||"").filter(w=>!["with","and","includes"].includes(w));
 const singularWord=(w:string)=>w.endsWith("s")?w.slice(0,-1):w;
 const accessoryMissing=accessoryWords.some(w=>!tokens(titleWords).some(t=>singularWord(t)===singularWord(w)));
 const missing:string[]=[];
 if(accessoryMissing)missing.push("Included accessory package not fully evidenced in title; provisional comparison");
 if(!details.condition)missing.push('Condition not selected');
 if(shoe&&(!details.size||!details.sizeSystem))missing.push('Shoe size and sizing system not confirmed');
 if(shoe&&!details.productIdentifierVerified&&!details.variant)missing.push('Exact release identifier or variant not verified');
 if(shoe&&!strict.reasons.some(r=>r==='Visible colors present in title'))missing.push('Full visible colorway not evidenced');
 if(query.identification.confidence==='low')missing.push('Identification confidence is low');
 if(/lego|building/i.test(`${i.brand} ${i.category}`)&&!details.productIdentifierVerified&&!/\b\d{4,7}\b/.test(i.model))missing.push('LEGO set number not verified');
 if(/iphone/i.test(i.model)&&!query.details.variant&&!/\b(?:64|128|256|512|1024)\s*(?:gb|tb)\b/i.test(i.model))missing.push("Storage and edition not confirmed");
 if(/playstation/i.test(i.model)&&!query.details.variant&&!/disc|digital|slim|pro/i.test(i.model))missing.push("Console edition not confirmed");
 const uncertainVariation=item.warnings.some(w=>w.startsWith('Variation selection unverified'))||(shoe&&/\b(?:multiple sizes|choose (?:your )?size|select (?:your )?size|various sizes|all sizes)\b/i.test(title));
 const tier:MatchTier=strict.matches&&!extraConflicts.length&&!missing.length&&!uncertainVariation?'exact':'close';
 if(shoe&&/\b(?:gs|ps|td|youth|kids|toddler|infant|preschool|grade school)\b/i.test(title)&&! /\b(?:gs|ps|td|youth|kids|toddler|infant|preschool|grade school)\b/i.test(`${query.details.sizeSystem} ${query.details.variant} ${query.identification.productName}`))return {item:{...item,matchTier:'related',priceEligible:false,matchReasons:family.reasons,warnings:[...item.warnings,'Youth sizing group not established for the confirmed product; context only']},reason:'youth_sizing_group_unconfirmed'};
 const eligible=similar.matches&&!extraConflicts.length&&!uncertainVariation&&!!conditionGroup(item.conditionId);
 const reason=uncertainVariation?'variation_price_unverified':!similar.matches?(similar.exclusionReason||'attributes_not_evidenced'):extraConflicts.length?(subtypeEvidence&&subtypeEvidence.state!=='confirmed'?subtypeEvidence.reason:'extra_attributes_not_evidenced'):!conditionGroup(item.conditionId)?'unknown_condition':tier==='exact'?'exact_comparable':(missing.length?missing.join('; '):'partial_color_evidence');
 const warnings=[...item.warnings,...(primary.included.length?['Included accessories: '+primary.included.join(', ')]:[]),...missing,...extraConflicts.map(([key])=>`${key} not evidenced in listing title`),...similar.warnings,...(!strict.matches?[`Attribute uncertainty: ${similar.exclusionReason||strict.exclusionReason}; not an exact comparable`]:[])];
 return {item:{...item,matchTier:tier,priceEligible:eligible,matchReasons:similar.reasons.length?similar.reasons:family.reasons,warnings:[...new Set(warnings)]},reason};
}

