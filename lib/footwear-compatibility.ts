import {wearablePrimaryText} from "./listing-primary-text";
import type {Comparable,ProductQuery} from "./marketplaces";
import {normalize} from "./product-matching";
import {productProfile} from "./product-profile";

export function nonWearableReason(item:Comparable,q:ProductQuery):string|null{
 if(productProfile(q.identification).kind!=="footwear")return null;
 const target=normalize([q.identification.productName,q.identification.category].join(" "));
 if(/\b(?:miniature|doll|keychain|ornament|figurine|scale replica)\b/.test(target))return null;
 if(/\b(?:dolls|doll accessories|action figures|keychains?|keyrings?|ornaments?)\b/.test(normalize(item.categories.join(" "))))return "non_wearable_footwear";
 const evidence=normalize(wearablePrimaryText(item.title)+" "+item.categories.join(" "));
 if(/\b(?:miniature|miniatures|keychain|keychains|keyring|ornament|ornaments|dollhouse|figurine|figurines|action figure|doll shoes|doll footwear|doll sneakers|for dolls|for a doll|for barbie|for ken|shoe charm|sneaker charm)\b/.test(evidence)||
    /\b\d+\s*(?:\/|:)\s*\d+\s*scale\b/i.test(item.title)||
    /\b(?:scale replica|scale model|for (?:a )?\d+[- ]?(?:inch|inches|in) figure|12 inch figure)\b/.test(evidence))
   return "non_wearable_footwear";
 return null;
}
export function footwearSignature(value:string){
 const text=normalize(value).replace(/\bhigh[- ]top\b/g,"high");
 const silhouettes=["high","mid","low"].filter(x=>new RegExp("\\b"+x+"\\b").test(text));
 const silhouette=silhouettes.length===1?silhouettes[0]:"unspecified";
 const markers=[...new Set(text.match(/\b(?:og|sp|se|craft|flyease|zoom|cmft|utility|patent)\b/g)||[])].sort();
 if(!markers.length&&/\bretro\b/.test(text))markers.push("retro");
 return {silhouette,edition:markers.join("+")||"unspecified"};
}
export function supportedFootwear(q:ProductQuery){
 // A subtype/name can supply an explicitly stated silhouette when model is only the family.
 const model=footwearSignature(q.identification.model||"");
 const name=footwearSignature(q.identification.productName||"");
 const subtype=footwearSignature(q.details.subtype||q.identification.understanding?.subtype||"");
 const variant=footwearSignature(q.details.variant||"");
 return {silhouette:model.silhouette!=="unspecified"?model.silhouette:subtype.silhouette!=="unspecified"?subtype.silhouette:name.silhouette,
 edition:variant.edition!=="unspecified"?variant.edition:model.edition!=="unspecified"?model.edition:name.edition};
}
export function footwearCohort(item:Comparable,q:ProductQuery){
 if(productProfile(q.identification).kind!=="footwear")return "";
 const signature=footwearSignature(item.title);
 return signature.silhouette+"/"+signature.edition;
}

export function footwearSubtypeEvidence(item:Comparable,subtype:string){
 const requested=footwearSignature(subtype),listed=footwearSignature(item.title);
 if(requested.silhouette!=="unspecified"){
  if(listed.silhouette==="unspecified")return {state:"missing" as const,reason:"subtype_unverified"};
  if(listed.silhouette!==requested.silhouette)return {state:"contradiction" as const,reason:"subtype_mismatch"};
 }
 const extras=normalize(subtype).split(" ").filter(t=>t&&!["high","mid","low","top","tops","shoe","shoes","sneaker","sneakers","trainer","trainers","footwear"].includes(t));
 if(extras.some(t=>!normalize(item.title).split(" ").includes(t)))return {state:"missing" as const,reason:"subtype_unverified"};
 return {state:"confirmed" as const,reason:"subtype_compatible"};
}
