import {wearablePrimaryText} from "./listing-primary-text";
import type { Comparable, ProductQuery } from "./marketplaces";
export const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
const stop = new Set([
  "likely",
  "possibly",
  "possible",
  "unknown",
  "unidentified",
  "not",
  "visible",
  "the",
  "a",
  "an",
  "and",
  "or",
  "with",
  "for",
  "of",
  "by",
  "product",
  "model",
  "silhouette",
]);
export const tokens = (text: string) => [
  ...new Set(
    normalize(text)
      .split(" ")
      .filter((t) => t && !stop.has(t)),
  ),
];
const includesAll = (haystack: string, words: string[]) =>
  words.every((t) => haystack.split(" ").includes(t));
export function buildEbayQuery({
  identification: i,
  details: d,
}: ProductQuery) {
  const identity = [i.model || i.productName, i.brand]
    .filter(Boolean)
    .join(" ");
  // Never submit arbitrary AI prose as an exact product identifier.
  const words = tokens(identity);
  const extra = [
    d.productIdentifier || "",
    d.variant || i.colorway || "",
    d.size ? `${d.sizeSystem} size ${d.size}` : "",
    d.packaging === "original"
      ? "with box"
      : d.packaging === "none"
        ? "no box"
        : "",
  ];
  return [words.join(" "), ...extra]
    .join(" ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 100);
}
export function conditionGroup(id: string): string {
  if (["1000", "1500", "1750"].includes(id)) return "new";
  if (["2000", "2010", "2020", "2030", "2500"].includes(id))
    return "refurbished";
  if (id === "7000") return "parts";
  if (["2990", "3000", "3010", "4000", "5000", "6000"].includes(id)) return "used";
  return "";
}
export function matchComparable(
  item: Comparable,
  { identification: i, details: d }: ProductQuery,
  { allowPartialColor = false } = {},
): { matches: boolean; reasons: string[]; warnings: string[]; exclusionReason?: string } {
  const canonical = (v: string) => normalize(v).replace(/\baj\s*1\b/g, "jordan 1").replace(/\bair jordan\b/g, "jordan").replace(/\bjordan 1 retro (?=high\b|mid\b|low\b)/g,"jordan 1 ");
  const shoe = /sneaker|shoe|footwear/i.test(i.category || "");
  const title = canonical(shoe?wearablePrimaryText(item.title):item.title);
  const words = title.split(" ");
  const reasons: string[] = [];
  const warnings: string[] = [];
  let exclusionReason = "unsupported_or_accessory";
  const fail = () => ({ matches: false, reasons: [...reasons], warnings: [...warnings], exclusionReason });
  if (
    /\b(replica|rep|fake|inspired|custom|customized|customised)\b/.test(title)
  )
    return fail();
  if (
    shoe &&
    /\b(laces|shoelaces|keychain|keyring|poster|miniature|replacement|single shoe|left only|right only|box only|empty box|sneaker box)\b/.test(
      title,
    )
  )
    return fail();
  if (
    !/accessor|case|cover|part/i.test(i.category || "") &&
    /\b(case for|cover for|parts only|for parts|empty box|box only|lot of|bundle of)\b/.test(
      title,
    )
  )
    return fail();
  exclusionReason = "brand_or_model_mismatch";
  const jordan = /\bjordan\b/.test(canonical(i.model || i.productName || ""));
  const brand = jordan && /nike|jordan/i.test(i.brand || "") ? ["jordan"] : tokens(i.brand || "");
  const model = tokens(canonical(i.model || i.productName || "")).filter(
    (t) => !brand.includes(t),
  );
  if (
    !model.length ||
    !includesAll(title, model) ||
    (brand.length > 0 && !includesAll(title, brand))
  )
    return fail();
  const jordanSilhouette = /\bjordan 1 (mid|low|high)\b/.exec(canonical(i.model || ""));
  if (jordanSilhouette && !new RegExp(`\\bjordan 1 ${jordanSilhouette[1]}\\b`).test(title)) return fail();
  reasons.push("Brand/model words present in title");
  // Reject common conflicting silhouette and generation variants explicitly.
  if (shoe) {
    for (const variant of ["mid", "low", "high"])
      if (
        model.includes(variant) &&
        words.some((w) => ["mid", "low", "high"].includes(w) && w !== variant)
      )
        return fail();
  }
  exclusionReason = "identifier_mismatch";
  if (d.productIdentifier) {
    const id = normalize(d.productIdentifier);
    if (
      !(` ` + title + ` `).includes(` ` + id + ` `) &&
      !words.includes(id.replace(/ /g, ""))
    )
      return fail();
    reasons.push("User-confirmed product identifier present");
  }
  exclusionReason = "colorway_mismatch";
  const colors = tokens(i.colorway || "")
    .filter((t) =>
      [
        "black",
        "white",
        "red",
        "blue",
        "green",
        "yellow",
        "orange",
        "pink",
        "purple",
        "grey",
        "gray",
        "brown",
        "beige",
        "navy",
        "silver",
        "gold",
      ].includes(t),
    )
    .map((t) => (t === "grey" ? "gray" : t));
  const titleColors = title.replace(/\bgrey\b/g, "gray").replace(/\binfrared\b/g, "red").replace(/\bstarfish\b/g, "orange").replace(/\bsail\b/g, "beige");
  const completeColorMatch = includesAll(titleColors, colors);
  if (colors.length && !completeColorMatch && (!allowPartialColor || !colors.some(c=>tokens(titleColors).includes(c)))) return fail();
  if (
    colors.length &&
    tokens(titleColors).some(
      (t) =>
        [
          "black",
          "white",
          "red",
          "blue",
          "green",
          "yellow",
          "orange",
          "pink",
          "purple",
          "gray",
          "brown",
          "beige",
          "navy",
          "silver",
          "gold",
        ].includes(t) && !colors.includes(t),
    )
  )
    return fail();
  if (colors.length && completeColorMatch) reasons.push("Visible colors present in title");
  else if (colors.length) warnings.push("Only some visible colors are stated in the listing title");
  else warnings.push("Colorway could not be checked from title");
  exclusionReason = "variant_mismatch";
  if (d.variant && !includesAll(title, tokens(d.variant))) return fail();
  if (d.variant) reasons.push("Specified variant present");
  exclusionReason = "condition_mismatch";
  if (d.condition) {
    if (!conditionGroup(item.conditionId)){exclusionReason="condition_unverified";return fail();}
    if (conditionGroup(item.conditionId) !== d.condition) return fail();
    reasons.push("Requested condition group matched");
  } else
    warnings.push("Condition not restricted; prices may mix condition grades");
  exclusionReason = "size_or_sizing_group_unverified";
  if (d.size) {
    const escaped = d.size.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sizeMatch = new RegExp(
      `\\b(?:size|sz|us|uk|eu)\\s*${escaped}(?![\\d.])`,
    ).test(title);
    if(/\b(sizes|choose size|select size|multiple sizes)\b/.test(title)){
      exclusionReason="size_selection_unverified";return fail();
    }
    if(!sizeMatch){
      exclusionReason=/\b(?:size|sz|us|uk|eu)\s*\d/.test(title)?"size_mismatch":"size_unverified";
      return fail();
    }
    if(d.sizeSystem==="US Men"||d.sizeSystem==="US Women"||d.sizeSystem==="US Youth"){
      const required=d.sizeSystem==="US Men"?/\b(men|mens)\b/:d.sizeSystem==="US Women"?/\b(women|womens)\b/:/\b(youth|gs|kids|boys|girls)\b/;
      const opposite=d.sizeSystem==="US Men"?/\b(women|womens|youth|gs|kids)\b/:d.sizeSystem==="US Women"?/\b(men|mens|youth|gs|kids)\b/:/\b(men|mens|women|womens)\b/;
      if(opposite.test(title)){exclusionReason="sizing_group_mismatch";return fail();}
      if(!required.test(title)){exclusionReason="sizing_group_unverified";return fail();}
    }
    if (
      d.sizeSystem === "UK" &&
      !new RegExp(`\\buk\\s*${escaped}(?![\\d.])`).test(title)
    )
      return fail();
    if (
      d.sizeSystem === "EU" &&
      !new RegExp(`\\beu\\s*${escaped}(?![\\d.])`).test(title)
    )
      return fail();
    if(d.sizeSystem.startsWith("US")&&!/\bus\b/.test(title)){
      exclusionReason=/\b(?:uk|eu)\b/.test(title)?"sizing_system_mismatch":"sizing_system_unverified";return fail();
    }
    if (
      d.sizeSystem.startsWith("US") &&
      /\b(uk|eu)\b/.test(title) &&
      !new RegExp(`\\bus\\s*${escaped}(?![\\d.])`).test(title)
    )
      return fail();
    reasons.push("Size and sizing group evidenced in title");
  } else warnings.push("Size not restricted");
  exclusionReason = "packaging_unverified_or_mismatch";
  if (d.packaging === "original") {
    if (
      !/\b(with box|original box|og box|new in box|nib)\b/.test(title) ||
      /\b(no box|without box|replacement box)\b/.test(title)
    )
      return fail();
    reasons.push("Original packaging indicated in title");
  }
  if (d.packaging === "none") {
    if (!/\b(no box|without box)\b/.test(title)) return fail();
    reasons.push("No-box packaging indicated in title");
  }
  if (!d.packaging) warnings.push("Packaging not checked");
  if (shoe && !d.productIdentifier) warnings.push("Exact release unverified; similar-listing evidence only unless other verified attributes establish the variant");
  return { matches: true, reasons, warnings };
}

