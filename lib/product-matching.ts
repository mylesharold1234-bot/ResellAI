import {wearablePrimaryText} from "./listing-primary-text";
import type { Comparable, MatchDetails, ProductQuery } from "./marketplaces";
import { styleCodesIn, styleGroup, type SizingGroup } from "./style-codes";
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
    /\b(replica|rep|fake|inspired|custom|customized|customised|by you|nike id|nikeid)\b/.test(title)
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
    const size = sizeEvidence(item, d, title, i.model || i.productName || "");
    if (!size.ok) {
      exclusionReason = size.reason;
      return fail();
    }
    reasons.push(size.reason);
  } else warnings.push("Size not restricted");
  exclusionReason = "packaging_unverified_or_mismatch";
  // eBay's own condition "New with box" / "New without box" is structured packaging evidence.
  const ebayWithBox = item.conditionId === "1000" && /\bnew with box\b/i.test(item.condition);
  const ebayWithoutBox = item.conditionId === "1500" && /\bnew without box\b/i.test(item.condition);
  // A seller's description that states the box plainly (Mercari has no structured box field).
  const describedBox = item.statedPackaging === "original", describedNoBox = item.statedPackaging === "none";
  if (d.packaging === "original") {
    const titleBox = /\b(with box|original box|og box|new in box|nib)\b/.test(title);
    if ((!titleBox && !ebayWithBox && !describedBox) || ebayWithoutBox || describedNoBox || /\b(no box|without box|replacement box)\b/.test(title)) return fail();
    reasons.push(titleBox ? "Original packaging indicated in title" : ebayWithBox ? "Original box stated in eBay's condition (New with box)" : "Original box stated in the seller's description");
  }
  if (d.packaging === "none") {
    const titleNoBox = /\b(no box|without box)\b/.test(title);
    if ((!titleNoBox && !ebayWithoutBox && !describedNoBox) || ebayWithBox || describedBox) return fail();
    reasons.push(titleNoBox ? "No-box packaging indicated in title" : ebayWithoutBox ? "No box stated in eBay's condition (New without box)" : "No box stated in the seller's description");
  }
  if (!d.packaging) warnings.push("Packaging not checked");
  if (shoe && !d.productIdentifier) warnings.push("Exact release unverified; similar-listing evidence only unless other verified attributes establish the variant");
  return { matches: true, reasons, warnings };
}


const GROUP_WORDS: Record<SizingGroup, RegExp> = {
  men: /\b(men|mens)\b/,
  women: /\b(women|womens|wmns)\b/,
  youth: /\b(youth|gs|kids|boys|girls|grade school)\b/,
};
const wantedGroup = (system: string): SizingGroup | null =>
  system === "US Men" ? "men" : system === "US Women" ? "women" : system === "US Youth" ? "youth" : null;
const departmentGroup = (department?: string): SizingGroup | null => {
  const d = (department || "").toLowerCase();
  if (/unisex/.test(d)) return null;
  if (/\b(women|womens|ladies)\b/.test(d)) return "women";
  if (/\b(men|mens)\b/.test(d)) return "men";
  if (/\b(boys|girls|kids|youth|unisex kids)\b/.test(d)) return "youth";
  return null;
};
/** US "10M" / "10M/11.5W" notation: a men's US size, with the women's conversion after the slash. */
const menNotation = (title: string, size?: string) =>
  new RegExp(`\\b${size ? size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "\\d{1,2}(?:\\.5)?"}\\s*m\\b`).test(title);

/**
 * Which sizing groups a listing's evidence points to: the title's words, men's "10M" notation, a known
 * style code, and eBay's Department item specific. Several groups means the listing is ambiguous.
 */
export function listingSizingGroups(item: Comparable, title: string, product: string): Set<SizingGroup> {
  const groups = new Set<SizingGroup>();
  // "Women's 12 / Men's 10.5" style dual labels name both; "women" contains "men", so test women first.
  const withoutWomen = title.replace(/\b(women|womens|wmns)\b/g, " ");
  if (GROUP_WORDS.women.test(title)) groups.add("women");
  if (GROUP_WORDS.men.test(withoutWomen) || menNotation(title)) groups.add("men");
  if (GROUP_WORDS.youth.test(title)) groups.add("youth");
  const fromCode = styleGroup([item.title, item.aspects?.styleCode || ""].join(" "), product);
  if (fromCode) groups.add(fromCode);
  const fromDepartment = departmentGroup(item.aspects?.department);
  if (fromDepartment) groups.add(fromDepartment);
  return groups;
}

/** True when the listing's own evidence places it in a different sizing group than the one requested. */
export function sizingGroupConflict(item: Comparable, sizeSystem: string, product: string) {
  const wanted = wantedGroup(sizeSystem);
  if (!wanted) return false;
  const groups = listingSizingGroups(item, normalize(item.title), product);
  return [...groups].some((g) => g !== wanted);
}

/** Several sizes offered in one listing ("Sizes 4/4.5/5", "size 7-10"), so its one price isn't for one pair. */
export function multipleSizesListed(rawTitle: string) {
  const t = rawTitle.toLowerCase();
  if (/\bsizes\b|\b(?:choose|select|multiple|various|all) (?:your )?sizes?\b/.test(t)) return true;
  if (/\b\d{1,2}(?:\.5)?\s*\/\s*\d{1,2}(?:\.5)?\s*\/\s*\d{1,2}(?:\.5)?\b/.test(t)) return true;
  if (/\bsize\s*\d{1,2}(?:\.5)?\s*(?:-|–|to)\s*\d{1,2}(?:\.5)?\b/.test(t)) return true;
  return false;
}

/**
 * Size evidence for one listing. eBay's structured item specifics are used when present; otherwise only
 * what the title states. An unknown size is never treated as a match.
 */
export function sizeEvidence(item: Comparable, d: MatchDetails, title: string, product: string): { ok: true; reason: string } | { ok: false; reason: string } {
  const escaped = d.size.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wanted = wantedGroup(d.sizeSystem);
  const groups = listingSizingGroups(item, title, product);
  const groupCheck = (): string | null => {
    if (!wanted) return null;
    if ([...groups].some((g) => g !== wanted)) return "sizing_group_mismatch";
    if (!groups.has(wanted)) return "sizing_group_unverified";
    return null;
  };
  const a = item.aspects;
  if (a?.size) {
    const same = Number.isFinite(Number(a.size)) && Number.isFinite(Number(d.size)) ? Number(a.size) === Number(d.size) : a.size.trim().toLowerCase() === d.size.trim().toLowerCase();
    if (!same) return { ok: false, reason: "size_mismatch" };
    // The title and the structured field must not disagree ("Men's Size 10" filed as 10.5 proves nothing).
    // A multi-size listing's variation keeps the group's title ("Sz 7-11"), which describes every variation.
    const groupTitle = a.source === "ebay-item-group";
    const stated = [...title.matchAll(/\b(?:size|sz|us|mens|men)\s*(\d{1,2}(?:\.5)?)(?![\d.])/g), ...title.matchAll(/\b(\d{1,2}(?:\.5)?)\s*m\b/g)].map((m) => Number(m[1]));
    if (!groupTitle && stated.some((n) => n !== Number(a.size))) return { ok: false, reason: "size_evidence_conflict" };
    if (!groupTitle && multipleSizesListed(item.title)) return { ok: false, reason: "size_selection_unverified" };
    const group = groupCheck();
    if (group) return { ok: false, reason: group };
    if (d.sizeSystem.startsWith("US") && a.sizeSystem !== "US") return { ok: false, reason: "sizing_system_unverified" };
    if ((d.sizeSystem === "UK" || d.sizeSystem === "EU") && a.sizeSystem !== d.sizeSystem) return { ok: false, reason: "sizing_system_unverified" };
    return { ok: true, reason: "Size and sizing group stated in eBay item specifics" };
  }
  if (/\b(sizes|choose size|select size|multiple sizes)\b/.test(title) || multipleSizesListed(item.title)) return { ok: false, reason: "size_selection_unverified" };
  const notation = d.sizeSystem === "US Men" && menNotation(title, d.size.toLowerCase());
  const sizeMatch = notation || new RegExp(`\\b(?:size|sz|us|uk|eu)\\s*${escaped}(?![\\d.])`).test(title);
  if (!sizeMatch) return { ok: false, reason: /\b(?:size|sz|us|uk|eu)\s*\d/.test(title) || menNotation(title) ? "size_mismatch" : "size_unverified" };
  const group = groupCheck();
  if (group) return { ok: false, reason: group };
  if (d.sizeSystem === "UK" && !new RegExp(`\\buk\\s*${escaped}(?![\\d.])`).test(title)) return { ok: false, reason: "size_or_sizing_group_unverified" };
  if (d.sizeSystem === "EU" && !new RegExp(`\\beu\\s*${escaped}(?![\\d.])`).test(title)) return { ok: false, reason: "size_or_sizing_group_unverified" };
  // "10M/11.5W" is US notation; otherwise a US size needs "US" in the title.
  if (d.sizeSystem.startsWith("US") && !/\bus\b/.test(title) && !notation)
    return { ok: false, reason: /\b(?:uk|eu)\b/.test(title) ? "sizing_system_mismatch" : "sizing_system_unverified" };
  if (d.sizeSystem.startsWith("US") && /\b(uk|eu)\b/.test(title) && !new RegExp(`\\bus\\s*${escaped}(?![\\d.])`).test(title) && !notation)
    return { ok: false, reason: "size_or_sizing_group_unverified" };
  return { ok: true, reason: "Size and sizing group evidenced in title" };
}

/**
 * Packaging a seller states plainly in free text ("Brand new in original box", "No box"). Shoe-part
 * phrases ("toe box") are ignored, and text that says both, such as "No original box included",
 * proves nothing either way. Returns null unless the statement is unambiguous.
 */
export function statedPackaging(text: string): "original" | "none" | null {
  const t = normalize(text).replace(/\btoe ?box(?:es)?\b/g, " ");
  const none = /\b(?:no (?:original |og |nike )?box|without (?:the |a |an |its |original |og )*box|box (?:is )?(?:not included|missing)|missing (?:the )?box|replacement box)\b/.test(t);
  const withBox = /\b(?:new in (?:original |og )?box|nib|bnib|(?:comes with|includes?|including|with|w) (?:the |its |a )?(?:original |og |nike )?box|(?:original|og|nike) box (?:is )?included|box included|og all)\b/.test(t);
  if (none && withBox) return null;
  return none ? "none" : withBox ? "original" : null;
}
