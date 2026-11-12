/** Remove only explicitly included small accessories from an otherwise wearable primary item.
 * No prices, classifications or missing product attributes are inferred.
 */
export function wearablePrimaryText(title:string){
 const match=/\b(?:with|includes|including|comes with)\b/i.exec(title);
 if(!match)return title;
 const primary=title.slice(0,match.index);
 if(!/\b(?:shoes|sneakers|boots|trainers)\b/i.test(primary)||
    /\b(?:miniature|doll|keychains?|keyrings?|ornaments?|replica|figure|single)\b/i.test(primary))return title;
 const included=title.slice(match.index);
 return primary+included.replace(/\b(?:keychains?|keyrings?|ornaments?)\b/gi,"");
}
