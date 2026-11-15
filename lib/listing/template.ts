import { marketplaces } from "./categories";
import type { AttributeKey, ListingDraft, ListingMarketplace } from "./types";

/** Strict set for structured exports (item specifics): seller-confirmed, identified, or AI-inferred values the seller confirmed. */
export const usableAttributes = (draft: ListingDraft) =>
  draft.attributes.filter((a) => a.source !== "missing" && a.value.trim() && (a.source !== "ai-inferred" || a.confirmed));

/** The item's identity (what it is) was approved by the seller at "Confirm identification", so text may name it. */
const identityKeys: AttributeKey[] = ["brand", "model", "productType"];

/**
 * Values listing text may state. Adds the seller-approved identity to the strict set; other AI inferences
 * (material, subtype, transcribed codes…) stay out until confirmed. Readiness still requires each required
 * AI-inferred value to be confirmed before publishing.
 */
export const textAttributes = (draft: ListingDraft) =>
  draft.attributes.filter((a) => a.source !== "missing" && a.value.trim() && (a.source !== "ai-inferred" || a.confirmed || identityKeys.includes(a.key)));
const value = (draft: ListingDraft, key: AttributeKey) => textAttributes(draft).find((a) => a.key === key)?.value.trim() || "";

/** Remove words already present earlier in the title (e.g. brand repeated inside the model). */
function dedupe(parts: string[]) {
  const seen = new Set<string>();
  return parts
    .map((part) => part.split(/\s+/).filter((w) => {
      if (!w) return false;
      const k = w.toLowerCase().replace(/[^a-z0-9.'-]/g, "");
      if (!k) return /^[/&+]$/.test(w); // keep separators such as "Black / White"
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join(" ").replace(/^[/&+]\s*|\s*[/&+]$/g, ""))
    .filter(Boolean);
}

export function conditionPhrase(draft: ListingDraft) {
  const { grade, packaging } = draft.condition;
  if (grade === "new") return packaging === "original" ? "New with Box" : packaging === "none" ? "New without Box" : "New";
  if (grade === "used") return "Pre-Owned";
  if (grade === "refurbished") return "Refurbished";
  if (grade === "parts") return "For Parts or Not Working";
  return "";
}

/** Deterministic, fact-only title. Parts are added by priority and kept in natural reading order. */
export function buildTitle(draft: ListingDraft, marketplace: ListingMarketplace = draft.marketplace) {
  const limit = marketplaces[marketplace].titleLimit;
  const v = (k: AttributeKey) => value(draft, k);
  const dept = v("department");
  const size = v("size");
  const sizeText = size ? (draft.category === "footwear" && dept ? `${dept === "Youth" ? "Youth" : dept + "'s"} Size ${size}` : `Size ${size}`) : "";
  const core = v("model") || v("productType");
  type Part = { text: string; priority: number };
  const byCategory: Record<string, Part[]> = {
    footwear: [{ text: v("brand"), priority: 1 }, { text: core, priority: 1 }, { text: v("edition"), priority: 3 }, { text: v("color"), priority: 4 }, { text: sizeText, priority: 2 }, { text: v("styleCode"), priority: 5 }, { text: conditionPhrase(draft), priority: 6 }],
    clothing: [{ text: v("brand"), priority: 1 }, { text: v("model") ? `${v("model")} ${v("productType")}` : v("productType"), priority: 1 }, { text: v("color"), priority: 3 }, { text: dept ? `${dept}'s` : "", priority: 4 }, { text: sizeText, priority: 2 }, { text: v("material"), priority: 5 }, { text: conditionPhrase(draft), priority: 6 }],
    electronics: [{ text: v("brand"), priority: 1 }, { text: core, priority: 1 }, { text: v("storage"), priority: 2 }, { text: v("color"), priority: 4 }, { text: v("carrierLock"), priority: 3 }, { text: draft.condition.grade === "parts" ? "For Parts" : "", priority: 2 }],
    default: [{ text: v("brand"), priority: 1 }, { text: core, priority: 1 }, { text: v("subtype"), priority: 2 }, { text: v("edition"), priority: 2 }, { text: v("color"), priority: 4 }, { text: v("material"), priority: 5 }, { text: conditionPhrase(draft), priority: 6 }],
  };
  const parts = (byCategory[draft.category] || byCategory.default).map((p, order) => ({ ...p, order })).filter((p) => p.text);
  const chosen: typeof parts = [];
  for (const part of [...parts].sort((a, b) => a.priority - b.priority || a.order - b.order)) {
    const candidate = dedupe([...chosen, part].sort((a, b) => a.order - b.order).map((p) => p.text)).join(" ");
    if (candidate.length <= limit) chosen.push(part);
  }
  const title = dedupe(chosen.sort((a, b) => a.order - b.order).map((p) => p.text)).join(" ");
  return title.length <= limit ? title : title.slice(0, limit).replace(/\s+\S*$/, "");
}

/** "US Men's 10", "US Women's 8.5", "M (Men's)": size and department as buyers read them. */
export function sizeLabel(draft: ListingDraft) {
  const size = value(draft, "size");
  if (!size) return "";
  const dept = value(draft, "department");
  const deptText = dept === "Youth" ? "Youth" : dept ? `${dept}'s` : "";
  if (draft.category === "footwear" && /^\d/.test(size)) return deptText ? `US ${deptText} ${size}` : `US ${size}`;
  return deptText ? `${size} (${deptText})` : size;
}

const sneakerWords = /\b(sneakers?|dunk|jordan|air max|air force|yeezy|runner|running|trainer|basketball|skate|new balance|samba|gazelle|forum|chuck|vans|converse)\b/i;

/** The plain noun for the item ("sneakers", "shoes", "item"), used in natural sentences. */
export function itemNoun(draft: ListingDraft) {
  const name = `${draft.identification.productName || ""} ${draft.identification.model || ""} ${draft.identification.category || ""}`;
  if (draft.category === "footwear") return sneakerWords.test(name) ? "sneakers" : "shoes";
  return "item";
}

export function buildConditionDescription(draft: ListingDraft) {
  const c = draft.condition;
  const lines: string[] = [];
  const phrase = conditionPhrase(draft);
  if (phrase) lines.push(`${phrase}.`);
  if (c.defects.trim()) lines.push(`Flaws noted by the seller: ${c.defects.trim().replace(/\.?$/, ".")}`);
  else if (c.noKnownDefects && c.grade && c.grade !== "new") lines.push("The seller isn't aware of any flaws beyond normal signs of use.");
  if (c.grade && c.grade !== "new") lines.push("Please see the photos for the exact condition.");
  return lines.join(" ");
}

/**
 * Fact-only description in the format buyers scan: a short natural introduction, a key-details block and a
 * closing line. Details without a confirmed value are left out silently rather than called "missing".
 */
export function buildDescription(draft: ListingDraft, marketplace: ListingMarketplace = draft.marketplace) {
  const v = (k: AttributeKey) => value(draft, k);
  const noun = itemNoun(draft);
  const pairNoun = noun === "sneakers" || noun === "shoes";
  const name = dedupe([v("brand"), v("model") || v("productType")].filter(Boolean)).join(" ");
  const edition = v("edition");
  const color = v("color");
  const nounInName = noun !== "item" && name.toLowerCase().includes(noun.replace(/s$/, ""));
  const colorText = color ? (draft.category === "footwear" || draft.category === "clothing" ? ` in the ${color} colorway` : ` in ${color}`) : "";
  const editionText = edition && !name.toLowerCase().includes(edition.toLowerCase()) ? ` (${edition})` : "";
  const intro = [`${name || "This item"}${editionText}${noun !== "item" && !nounInName ? ` ${noun}` : ""}${colorText}.`];
  if (draft.category === "footwear" && /\blow\b/i.test(name)) intro.push("The low-top silhouette pairs easily with everyday casual outfits.");

  // Buyers scan identity first, then fit: brand, model, color, size, then the rest.
  const order: AttributeKey[] = ["brand", "model", "edition", "color", "size", "styleCode", "storage", "carrierLock", "functionalStatus", "subtype", "material", "dimensions", "measurements", "quantity"];
  const rank = (k: AttributeKey) => (order.includes(k) ? order.indexOf(k) : order.length);
  const details: [string, string][] = [];
  for (const a of [...textAttributes(draft)].sort((x, y) => rank(x.key) - rank(y.key))) {
    if (a.key === "productType" || a.key === "department") continue;
    details.push(a.key === "size" ? ["Size", sizeLabel(draft)] : [a.label.replace(/ \/ .*$/, ""), a.value.trim()]);
  }
  const condition = conditionPhrase(draft);
  if (condition) details.push(["Condition", condition]);
  const c = draft.condition;
  if (c.grade && c.grade !== "new" && c.defects.trim()) details.push(["Flaws", c.defects.trim().replace(/\.$/, "")]);

  const sections = [intro.join(" ")];
  if (details.length) sections.push(details.map(([k, val]) => `${k}: ${val}`).join("\n"));
  const includedValue = draft.includedItems.value.trim();
  const included = draft.includedItems.confirmed && includedValue && !/^item only$/i.test(includedValue) ? includedValue : "";
  const subject = pairNoun ? `the ${noun}` : "the item";
  sections.push(`${included ? `Includes ${included}.` : `Includes ${subject} shown in the photos.`} Please review the images to see the exact ${pairNoun ? "pair" : "item"} you'll receive.`);
  const text = sections.join("\n\n");
  const limit = marketplaces[marketplace].descriptionLimit;
  return limit && text.length > limit ? text.slice(0, limit - 1).replace(/\s+\S*$/, "") + "…" : text;
}

export type GeneratedTextField = "title" | "description" | "condition";

/**
 * Fingerprint of the confirmed facts a generated field depends on. If it changes after the text was
 * written, the text is out of date (e.g. the seller corrected the size after generating).
 */
export function factsKey(draft: ListingDraft, field: GeneratedTextField) {
  const c = draft.condition;
  const condition = [c.grade, c.packaging, c.defects.trim(), c.noKnownDefects ? 1 : 0];
  if (field === "condition") return JSON.stringify(condition);
  const attrs = textAttributes(draft).map((a) => [a.key, a.value.trim()]);
  const included = field === "description" && draft.includedItems.confirmed ? draft.includedItems.value.trim() : "";
  return JSON.stringify([draft.marketplace, attrs, condition, included]);
}

/** Generated fields whose underlying facts changed since they were written. */
export function staleFields(draft: ListingDraft): GeneratedTextField[] {
  const from = draft.generatedFrom || {};
  const text = { title: draft.title.value, description: draft.description.value, condition: draft.condition.description };
  return (["title", "description", "condition"] as const).filter((f) => !!text[f].trim() && !!from[f] && from[f] !== factsKey(draft, f));
}

/** Practical, marketplace-specific advice derived from the draft. No price or demand claims. */
export function marketplaceRecommendations(draft: ListingDraft, marketplace: ListingMarketplace = draft.marketplace) {
  const tips: string[] = [];
  const has = (k: AttributeKey) => !!value(draft, k);
  if (draft.category === "footwear") {
    tips.push("Photograph both sides, the soles, the heel and the size tag; buyers check soles and tags first.");
    if (!has("styleCode")) tips.push("Add the style code from the size tag or box label; it's the most reliable way buyers search for the exact release.");
  }
  if (draft.category === "clothing") tips.push("Add flat-lay measurements (pit-to-pit and length); sizing varies between brands.");
  if (draft.category === "electronics") tips.push("Show the item powered on, and state exactly what you tested. Remove any accounts or activation locks before selling.");
  if (draft.category === "collectible") tips.push("Photograph set numbers, edition markings and any wear closely; collectors price on completeness.");
  if (draft.category === "household") tips.push("Include a measuring tape in one photo to show scale.");
  if (marketplace === "ebay") {
    tips.push("Fill in every item specific eBay suggests for your category; they power eBay search filters.");
    if (draft.category === "footwear") tips.push("On eBay, eligible sneakers sold at $150 or more may go through Authenticity Guarantee; that's applied by eBay, not stated in your listing.");
  }
  if (marketplace === "mercari") tips.push("Mercari buyers filter by condition; choose the closest Mercari condition grade and explain any wear in the description.");
  return tips;
}
