import type {Identification, IdentityField} from './identification';
import type {MatchDetails} from './marketplaces';
import {normalize, tokens} from './product-matching';
export const known = (v:string|null|undefined):string => !v || /^(unknown|unbranded|not (visible|known|identified|specified)|n\/?a|none|unidentified)$/i.test(v.trim()) ? '' : v.trim();
export function recognizableName(i:Identification) {
 const named=known(i.productName);
 const generic=/^(musical instruments?|product|item|object|device|unknown)$/i.test(named);
 return ((generic ? known(i.understanding?.primaryProduct) : named)||known(i.model)||known(i.understanding?.primaryProduct)||known(i.category)).replace(/\b(unbranded|unknown brand|unknown model|likely|possibly)\b/gi,'').replace(/\s+/g,' ').trim();
}
export function normalizeProduct(i:Identification):Identification {
 return {...i,brand:known(i.brand)||null,model:known(i.model)||null,productName:recognizableName(i)||null};
}
export function productProfile(i:Identification) {
 const text=normalize(`${i.category||''} ${i.productName||''} ${i.model||''}`);
 if(/sneaker|shoe|footwear|boot|sandal/.test(text))return {kind:'footwear',fields:['size','condition','colorway','verified release identifier']};
 if(/saxophone|guitar|violin|trumpet|clarinet|instrument|flute|trombone|keyboard|piano/.test(text))return {kind:'instrument',fields:['instrument subtype','manufacturer','model','configuration','condition']};
 if(/plate|dinnerware|bowl|porcelain|ceramic|dish|teacup/.test(text))return {kind:'dinnerware',fields:['maker','pattern or collection','material','diameter or dimensions','quantity','condition']};
 if(/chair|table|lamp|sofa|furniture|desk|cabinet/.test(text))return {kind:'furniture',fields:['item type','material','dimensions','maker','condition']};
 if(/lego|collectible|trading card|figurine|star wars/.test(text))return {kind:'collectible',fields:['edition or set number','year','condition','authenticity evidence']};
 if(/headphone|console|playstation|iphone|phone|electronic|camera|laptop|computer/.test(text))return {kind:'electronics',fields:['brand','model or generation','storage or configuration','condition']};
 return {kind:'general',fields:['manufacturer if known','model or identifying markings','material or configuration','dimensions','condition']};
}
export function assessIdentification(i:Identification,details?:MatchDetails) {
 const p=productProfile(i),name=recognizableName(i); const missing:string[]=[];
 if(!name)missing.push('Recognizable product description');
 const brand=known(i.brand),model=known(i.model);
 const genericModel=!model || normalize(model)===normalize(i.category||'') || /^(saxophone|alto saxophone|plate|ceramic dinner plate|chair|vintage wooden chair|table lamp|star wars)$/i.test(model);
 if(!brand)missing.push(p.kind==='dinnerware'?'Maker or identifying markings':'Brand or manufacturer, if known');
 if(genericModel)missing.push(p.kind==='dinnerware'?'Pattern, collection or markings':p.kind==='furniture'?'Maker or distinctive design details':'Specific model or identifying markings');
 if(p.kind==='instrument'&&!/alto|tenor|soprano|baritone|bass|acoustic|electric/i.test(`${name} ${details?.subtype || ''}`))missing.push('Instrument subtype');
 if(p.kind==='collectible'&&!/\d{4,7}/.test(`${name} ${details?.productIdentifier||''}`))missing.push('Edition or set number');
 if(i.uncertainties.some(u=>/brand|manufacturer|model|identity|subtype|maker|pattern|collection/i.test(u)))missing.push('AI reported uncertainty about identifying details');
 if(i.confidence==='low')missing.push('Identification is uncertain; another photo may help');
 return {recognizable:!!name,specific:!!name&&!missing.length,missing,profile:p};
}
export function genericObjectWords(i:Identification) {
 const name=normalize(recognizableName(i));
 // These are object families, not an allowlist: unknown objects fall back to their description.
 const words=['saxophone','guitar','violin','trumpet','clarinet','flute','plate','bowl','chair','lamp','table','sofa','headphones','headphone','console','iphone','sneaker','shoes','shoe'];
 if(/playstation|\bps5\b/.test(name))return 'console';
 const found=words.find(w=>tokens(name).includes(w));
 return found || normalize(known(i.category)||recognizableName(i));
}
export type FieldSources = Partial<Record<IdentityField,'image-visible'|'user-described'|'ai-inferred'|'user-provided'|'independently-verified'>>;

/** Optional AI caveats guide confidence, not whether the stated model is searchable. */
export function pricingIdentity(i:Identification, details?:MatchDetails) {
 const clean=(value:string)=>value.replace(/\b(?:likely|possibly|appears to be|probable)\b/gi,'').trim();
 const explicit=clean(known(i.model));
 const jordan=normalize(explicit||recognizableName(i)).match(/\b(?:air )?jordan 1 (?:retro )?(mid|low|high)\b/);
 const identity={...i,model:jordan?'Air Jordan 1 '+jordan[1]:explicit||null,brand:known(i.brand)||(jordan?'Jordan':null)};
 return {identity,credible:assessIdentification({...identity,uncertainties:[],confidence:'medium'},details).specific};
}

/** Preserve explicit Jordan editions that would otherwise be lost when canonicalizing the silhouette. */
export function jordanEdition(i:Identification){
 const model=normalize(i.model||'');
 const name=normalize(i.productName||'');
 if(!/\bjordan 1 (?:retro )?(mid|low|high)\b/.test(model+' '+name))return '';
 return [...new Set((model+' '+name).match(/\b(?:se|craft|og|flyease|zoom|cmft|utility)\b/g)||[])].sort().join(' ');
}
