import {tierComparable} from "./ebay-search";
import {normalize,tokens} from "./product-matching";
import {jordanEdition,productProfile} from "./product-profile";
import type {Comparable,ProductQuery} from "./marketplaces";

export function matchMercari(item:Comparable,query:ProductQuery){
 const title=normalize(item.title);
 const match=tierComparable(item,query);
 if(!match.item)return match;
 const reject=(reason:string)=>({item:null,reason});
 const related=(reason:string)=>({item:{...match.item!,matchTier:"related" as const,priceEligible:false,
  warnings:[...match.item!.warnings,reason.replaceAll("_"," ")]},reason});
 if(/\b(?:damaged|broken|unwearable|sole separation|for repair|for parts|single shoe|one shoe only|left shoe only|right shoe only)\b/.test(title)||item.conditionId==="6000")
  return reject("damaged_or_incomplete");
 const wanted=normalize([query.identification.model,query.identification.productName,query.details.variant].join(" "));
 if(productProfile(query.identification).kind==="footwear"||/\bjordan 1\b/.test(wanted)){
  if(/\b(?:cleats?|football boots?|golf shoes?)\b/.test(title)&&!/\b(?:cleats?|football boots?|golf shoes?)\b/.test(wanted))return reject("incompatible_footwear_type");
  if(/\b\d+(?:\.\d+)?y\b|\b(?:boys|girls|youth|grade school|gs|toddler|preschool)\b/.test(title)&&
    !/\b(?:boys|girls|youth|grade school|gs|toddler|preschool)\b/.test(wanted+" "+normalize(query.details.sizeSystem)))
    return related("youth_size_group_unconfirmed");
  const palette=tokens(query.identification.colorway||"");
  const blackWhite=palette.includes("black")&&palette.includes("white")&&
   !palette.some(x=>/^(?:olive|teal|coral|amethyst|cream|beige|red|blue|green|purple|pink|yellow|orange|grey|gray)$/.test(x));
  const namedColor=/\b(?:olive|teal|coral|amethyst|cream|(?:hyper |game |sport )?royal|university blue|obsidian|coconut milk|tropical twist|zen master|graffiti|doodle)\b/;
  if(blackWhite&&namedColor.test(title)&&!namedColor.test(wanted+" "+normalize(query.identification.colorway||"")))
    return related("conflicting_colorway");
  if(/\bjordan 1\b/.test(wanted)&&!query.details.variant&&!query.details.productIdentifierVerified&&!jordanEdition(query.identification)&&
    /\b(?:se|craft|flyease|zoom|cmft|utility|homage|split|patent)\b/.test(title))return related("distinct_edition_unconfirmed");
  // Nike SB Dunks are a separate skateboarding line with different releases and prices (seen in a Dunk Low
  // snapshot: "Dunk Low Pro SB Black White Gum", HF3704-003, matched as close to a regular Dunk Low).
  if(/\bdunk\b/.test(wanted)&&/\b(?:sb|pro sb)\b/.test(title)&&!/\bsb\b/.test(wanted))return related("distinct_edition_unconfirmed");
  // A listing offering several sizes ("Men's Sizes 4/4.5/5/5.5", "sizes 7-10") doesn't say which pair the
  // price applies to, so it can't price one specific pair.
  if(multipleSizesListed(item.title))return related("multiple_sizes_listed");
 }
 return match;
}

/** "Sizes 4/4.5/5", "size 7-10", "7, 8, 9" — but not a single pair's men/women conversion like "11M/12.5W". */
export function multipleSizesListed(rawTitle:string){
 const t=rawTitle.toLowerCase();
 if(/\bsizes\b/.test(t))return true;
 if(/\b\d{1,2}(?:\.5)?\s*\/\s*\d{1,2}(?:\.5)?\s*\/\s*\d{1,2}(?:\.5)?\b/.test(t))return true;
 if(/\bsize\s*\d{1,2}(?:\.5)?\s*(?:-|–|to)\s*\d{1,2}(?:\.5)?\b/.test(t))return true;
 return false;
}
