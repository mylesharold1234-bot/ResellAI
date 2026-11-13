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
      const k = w.toLowerCase().replace(/[^a-z0-9.'-]/g, "");
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join(" "))
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

export function buildConditionDescription(draft: ListingDraft) {
  const c = draft.condition;
  const lines: string[] = [];
  const phrase = conditionPhrase(draft);
  if (phrase) lines.push(`${phrase}.`);
  if (c.grade === "new" && c.packaging === "") lines.push("Packaging: not specified.");
  if (c.defects.trim()) lines.push(`Flaws noted by the seller: ${c.defects.trim().replace(/\.?$/, ".")}`);
  else if (c.noKnownDefects) lines.push("No other flaws known to the seller.");
  lines.push("Please review all photos for the exact condition.");
  return lines.join(" ");
}

/** Fact-only description. Sections without confirmed information are omitted rather than guessed. */
export function buildDescription(draft: ListingDraft, marketplace: ListingMarketplace = draft.marketplace) {
  const v = (k: AttributeKey) => value(draft, k);
  const name = [v("brand"), v("model") || v("productType")].filter(Boolean);
  const intro = dedupe(name).join(" ") + (v("color") ? ` in ${v("color")}` : "") + ".";
  const specifics = textAttributes(draft).filter((a) => a.key !== "productType").map((a) => `- ${a.label}: ${a.value.trim()}`);
  const sections = [intro];
  if (specifics.length) sections.push(["Item details:", ...specifics].join("\n"));
  sections.push(`Condition:\n${(draft.condition.description || buildConditionDescription(draft)).trim()}`);
  if (draft.includedItems.value.trim() && draft.includedItems.confirmed) sections.push(`Included: ${draft.includedItems.value.trim()}.`);
  const s = draft.shipping;
  if (s.confirmed && s.whoPays === "local-pickup") sections.push("Local pickup.");
  else if (s.confirmed && s.handlingDays.trim()) sections.push(`Ships within ${s.handlingDays.trim()} business day${s.handlingDays.trim() === "1" ? "" : "s"}${s.service.trim() ? ` via ${s.service.trim()}` : ""}.`);
  const text = sections.join("\n\n");
  const limit = marketplaces[marketplace].descriptionLimit;
  return limit && text.length > limit ? text.slice(0, limit - 1).replace(/\s+\S*$/, "") + "…" : text;
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
  if (marketplace === "facebook") tips.push("For local sales, meet in a public place and accept payment before handing over the item.");
  return tips;
}
