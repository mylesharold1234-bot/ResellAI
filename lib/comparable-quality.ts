import type {Comparable,ProductQuery} from "./marketplaces";
import {productProfile} from "./product-profile";

/** Evidence-only score. No price, image, SKU inference or provider preference. */
export function scoreComparable(item:Comparable):NonNullable<Comparable["quality"]>{
 const signals:string[]=[];
 let score=0;
 const add=(points:number,description:string)=>{score+=points;signals.push(description);};
 if(item.matchTier!=="related"&&item.matchReasons.some(x=>/brand\/model/i.test(x)))add(40,"Model evidenced in title");
 if(item.matchReasons.includes("Visible colors present in title"))add(20,"Visible palette supported");
 if(item.matchReasons.some(x=>/identifier|specified variant/i.test(x)))add(15,"Identifier or edition supported");
 if(item.matchReasons.some(x=>/size and sizing/i.test(x)))add(10,"Size and sizing system supported");
 if(item.conditionId)add(5,"Provider condition available");
 if(item.matchReasons.some(x=>/requested condition/i.test(x)))add(5,"Requested condition supported");
 if(item.priceEligible!==false&&item.matchTier!=="related"&&item.status==="asking"&&Number.isFinite(item.price)&&item.price>0)add(5,"Usable active asking price");
 if(item.priceEligible===false||item.matchTier==="related")signals.push("Context only; excluded from pricing");
 return {score,signals};
}

export function completeComparable(item:Comparable,query:ProductQuery){
 if(productProfile(query.identification).kind!=="footwear")return true;
 const wanted=[query.identification.model,query.identification.productName,query.details.variant].join(" ");
 if(/\b(?:cleats?|golf shoes?)\b/i.test(item.title)&&!/\b(?:cleats?|golf shoes?)\b/i.test(wanted))return false;
 return query.details.condition==="parts"||! /\b(?:single shoe|one shoe only|left shoe only|right shoe only|sole separation|for repair|unwearable)\b/i.test(item.title);
}
