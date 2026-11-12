import type {Comparable,ProductQuery} from './marketplaces';
import {normalize} from './product-matching';
import {recognizableName} from './product-profile';
export type PrimaryKind='complete'|'accessory'|'parts'|'uncertain';
export function primaryProduct(item:Pick<Comparable,'title'|'categories'>,query:ProductQuery){
 const title=normalize(item.title), wanted=normalize(recognizableName(query.identification));
 const included:string[]=[];
 const primaryClause=title.split(/\b(with|includes|including|comes with)\b/)[0];
 const accessories=['case','mouthpiece','gloves','reeds','cleaning kit','neck strap','controller','controllers','lens','lenses','charger','earpads','headband','mouthpieces','ligatures','caps','neck','pads'];
 for(const a of accessories)if(new RegExp('\\b'+a+'\\b').test(title))included.push(a);
 if(/\b(parts only|for parts|not working|broken|incomplete|missing keys|body only no keys)\b/.test(primaryClause))return {kind:'parts' as PrimaryKind,included,reason:'Incomplete or nonworking primary product'};
 const instrument=['saxophone','guitar','violin','trumpet','clarinet','flute'].find(x=>wanted.includes(x));
 const object=instrument||(/headphones?/.test(wanted)?'headphone':/playstation|ps5|console/.test(wanted)?'console':/camera/.test(wanted)?'camera':null);
 const requestedAccessory=/mouthpiece|ligature|neck strap|reeds|case|controller|lens|lenses/.test(wanted);
 if(requestedAccessory)return {kind:'accessory' as PrimaryKind,included,reason:'The requested primary product is itself an accessory'};
 if(!object)return {kind:'uncertain' as PrimaryKind,included,reason:'Use general product matching'};
 const objectPresent=object==='console'?/\b(ps5|playstation|console)\b/.test(title):new RegExp('\\b'+object+'s?\\b').test(title);
 if(!objectPresent)return {kind:'uncertain' as PrimaryKind,included,reason:'Primary product not evidenced'};
 const explicitIncluded=/\b(with|includes|including|comes with|complete|kit|package)\b|\bw\s+(case|mouthpiece|controller|lens)/.test(title);
 const accessoryOnly=/\b(only|replacement|fits|compatible with|for yamaha|for saxophone|for ps5|case for|mouthpiece for)\b/.test(title);
 const main=title.split(/\b(with|includes|including|comes with)\b/)[0];
 const accessoryLead=/^(?:\w+\s+){0,2}(?:mouthpiece|ligature|reeds|case|controller|lens|lenses)\b/.test(main);
 if(object==='saxophone'){const at=title.search(/\bsaxophones?\b/);const prefix=at>=0?title.slice(0,at):'';if(/mouthpieces?|ligatures?|neck|pads?|reeds?|strap|case|bag|caps?/.test(prefix)&&/\b(for|fits|replacement|stock|compatible)\b/.test(prefix))return {kind:'accessory' as PrimaryKind,included,reason:'A separate instrument component sold for a saxophone'};if(/saxophones?\s+(mouthpieces?|ligatures?|reeds?|necks?|pads?|cleaning kit|neck strap)\b/.test(main))return {kind:'accessory' as PrimaryKind,included,reason:'Accessory or accessory lot, not a complete instrument'};}
 const categoryComplete=item.categories.some(c=>object==='saxophone'?/^saxophones$/i.test(c):/video game consoles|digital cameras|headphones/i.test(c));
 const accessoryTail=object==='saxophone'?/saxophone\s+(mouthpiece|ligature|reeds|case|neck strap)\b/.test(main):object==='console'?/\b(controller|controllers|dualsense)\b/.test(main):object==='headphone'?/headphones?\s+(case|earpads|headband)\b/.test(main):/camera\s+(lens|lenses|case|strap)\b/.test(main);
 if(included.length && (accessoryOnly||accessoryLead||(accessoryTail&&!explicitIncluded&&!(categoryComplete&&included.length>=2)&&!(object==='console'&&/\bconsole\b/.test(main)))))return {kind:'accessory' as PrimaryKind,included,reason:'Accessory-only listing, not a complete primary product'};
 if(/\b(lot of|bundle of|two consoles|2 consoles|multiple instruments)\b/.test(title))return {kind:'uncertain' as PrimaryKind,included,reason:'Multiple primary products are not comparable to one item'};
 return {kind:'complete' as PrimaryKind,included,reason:included.length?'Complete primary product; accessories included':'Complete primary product evidenced'};
}
