import type { assessListing } from "../listing/readiness";
import { usableAttributes } from "../listing/template";
import type { AttributeKey, ListingDraft } from "../listing/types";
import type { AllowedCondition, CategoryAspect } from "./client";
import { MARKETPLACE_ID } from "./config";

/**
 * eBay condition IDs and their Inventory API ConditionEnum values, from eBay's
 * "Item condition ID and name values" table (Selling Integration Guide, checked 2026-11-13).
 */
export const conditionEnumById: Record<string, string> = {
  "1000": "NEW",
  "1500": "NEW_OTHER",
  "1750": "NEW_WITH_DEFECTS",
  "2000": "CERTIFIED_REFURBISHED",
  "2010": "EXCELLENT_REFURBISHED",
  "2020": "VERY_GOOD_REFURBISHED",
  "2030": "GOOD_REFURBISHED",
  "2500": "SELLER_REFURBISHED",
  "2750": "LIKE_NEW",
  "2990": "PRE_OWNED_EXCELLENT",
  "3000": "USED_EXCELLENT",
  "3010": "PRE_OWNED_FAIR",
  "4000": "USED_VERY_GOOD",
  "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE",
  "7000": "FOR_PARTS_OR_NOT_WORKING",
};

/** eBay ignores conditionDescription for these (createOrReplaceInventoryItem contract). */
const NEW_CONDITIONS = new Set(["NEW", "LIKE_NEW", "NEW_OTHER", "NEW_WITH_DEFECTS"]);

/** Condition IDs that fit each ResellAI condition group, most specific first. */
const candidatesFor: Record<string, string[]> = {
  "new:original": ["1000"],
  "new:none": ["1500", "1000"],
  "new:": ["1000", "1500"],
  used: ["3000", "2990", "4000", "5000", "6000", "3010"],
  refurbished: ["2500", "2000", "2010", "2020", "2030"],
  parts: ["7000"],
};

/** Default eBay condition ID for the draft, restricted to the category's allowed conditions when known. */
export function suggestedConditionId(draft: ListingDraft, allowed?: AllowedCondition[]) {
  const { grade, packaging } = draft.condition;
  if (!grade) return null;
  const options = candidatesFor[grade === "new" ? `new:${packaging}` : grade] || [];
  if (!allowed?.length) return options[0] ?? null;
  return options.find((id) => allowed.some((c) => c.id === id)) ?? null;
}

/** Allowed eBay conditions compatible with the seller's confirmed condition group. */
export function compatibleConditions(draft: ListingDraft, allowed: AllowedCondition[]) {
  const { grade } = draft.condition;
  const ids = grade === "new" ? ["1000", "1500", "1750"] : candidatesFor[grade] || [];
  return allowed.filter((c) => ids.includes(c.id));
}

export function chosenConditionId(draft: ListingDraft) {
  return draft.ebay.conditionId || suggestedConditionId(draft);
}

export function ebayCondition(draft: ListingDraft): string | null {
  const id = chosenConditionId(draft);
  return id ? conditionEnumById[id] ?? null : null;
}

/** ResellAI attribute → eBay aspect names it can fill (first match wins against the category's aspect list). */
const aspectNames: Partial<Record<AttributeKey, string[]>> = {
  brand: ["Brand"],
  model: ["Model", "Product Line"],
  color: ["Color", "Colour"],
  size: ["US Shoe Size", "Size", "US Size"],
  department: ["Department"],
  styleCode: ["Style Code", "MPN"],
  material: ["Upper Material", "Material"],
  storage: ["Storage Capacity"],
  productType: ["Type"],
  edition: ["Edition", "Version"],
  subtype: ["Type"],
  carrierLock: ["Network", "Lock Status"],
};

/**
 * Item specifics from confirmed listing values. With the category's aspect list, values are placed under
 * the names eBay uses for that category; without it, the first conventional name is used.
 */
export function buildAspects(draft: ListingDraft, categoryAspects?: CategoryAspect[]) {
  const aspects: Record<string, string[]> = {};
  const known = new Map((categoryAspects || []).map((a) => [a.name.toLowerCase(), a]));
  for (const a of usableAttributes(draft)) {
    const names = aspectNames[a.key] || [];
    const meta = categoryAspects?.length ? names.map((n) => known.get(n.toLowerCase())).find(Boolean) : undefined;
    const name = categoryAspects?.length ? meta?.name : names[0];
    if (!name || aspects[name]) continue;
    let value = a.value.trim();
    if (meta?.mode === "SELECTION_ONLY" && meta.values.length) {
      const match = meta.values.find((v) => v.toLowerCase() === value.toLowerCase());
      if (!match) continue; // not an allowed value; the seller picks one in the publish form
      value = match;
    }
    aspects[name] = [value.slice(0, meta?.maxLength ?? 65)];
  }
  for (const [name, value] of Object.entries(draft.ebay.extraAspects || {}))
    if (name.trim() && value.trim()) aspects[name.trim().slice(0, 40)] = [value.trim().slice(0, 65)];
  return aspects;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → HTML using only <br>, which is on eBay's allowed-tag list for product.description. */
export const descriptionHtml = (text: string) =>
  text
    .trim()
    .split(/\n{2,}/)
    .map((p) => escapeHtml(p.trim()).replace(/\n/g, "<br>"))
    .join("<br><br>");

/** product.description max length (createOrReplaceInventoryItem contract), including markup. */
export const EBAY_DESCRIPTION_LIMIT = 4000;

export const skuForDraft = (draftId: string) => `RAI-${draftId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)}`;

const decimal = (v: string) => (v.trim() === "" ? 0 : Number(v));

/** HTTPS image URLs for the listing: eBay-hosted copies of the selected photos (in photo order), then any manual URLs. */
export function listingImageUrls(draft: ListingDraft, now = Date.now()) {
  const hosted = draft.photos
    .filter((p) => p.selected)
    .map((p) => draft.ebay.hostedImages?.[p.id])
    .filter((h): h is NonNullable<typeof h> => !!h && (!h.expiresAt || Date.parse(h.expiresAt) > now))
    .map((h) => h.url);
  return [...new Set([...hosted, ...draft.ebay.imageUrls])].slice(0, 24);
}

/** Selected photos that still need uploading to eBay (never uploaded, or the unused upload has expired). */
export function photosNeedingUpload(draft: ListingDraft, environment: "production" | "sandbox", now = Date.now()) {
  return draft.photos.filter((p) => {
    if (!p.selected) return false;
    const h = draft.ebay.hostedImages?.[p.id];
    return !h || h.environment !== environment || (!!h.expiresAt && Date.parse(h.expiresAt) <= now);
  });
}

export function buildInventoryItem(draft: ListingDraft, categoryAspects?: CategoryAspect[], now = Date.now()) {
  const s = draft.shipping;
  const pounds = decimal(s.weightLb) + decimal(s.weightOz) / 16;
  const condition = ebayCondition(draft);
  return {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition,
    ...(condition && !NEW_CONDITIONS.has(condition) && draft.condition.description.trim() ? { conditionDescription: draft.condition.description.trim().slice(0, 1000) } : {}),
    product: {
      title: draft.title.value.trim(),
      description: descriptionHtml(draft.description.value),
      aspects: buildAspects(draft, categoryAspects),
      imageUrls: listingImageUrls(draft, now),
    },
    ...(s.whoPays !== "local-pickup" && pounds > 0
      ? {
          packageWeightAndSize: {
            dimensions: { length: decimal(s.length), width: decimal(s.width), height: decimal(s.height), unit: "INCH" },
            weight: { value: Math.round(pounds * 100) / 100, unit: "POUND" },
          },
        }
      : {}),
  };
}

export function buildOffer(draft: ListingDraft) {
  return {
    sku: skuForDraft(draft.id),
    marketplaceId: MARKETPLACE_ID,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: draft.ebay.categoryId.trim(),
    listingDescription: descriptionHtml(draft.description.value),
    listingPolicies: {
      fulfillmentPolicyId: draft.ebay.fulfillmentPolicyId,
      paymentPolicyId: draft.ebay.paymentPolicyId,
      returnPolicyId: draft.ebay.returnPolicyId,
    },
    pricingSummary: { price: { value: (draft.pricing.price ?? 0).toFixed(2), currency: "USD" } },
    merchantLocationKey: draft.ebay.merchantLocationKey,
  };
}

export type CategoryRules = { aspects?: CategoryAspect[]; conditions?: AllowedCondition[]; conditionRequired?: boolean };

/**
 * eBay-specific publishing requirements on top of general listing readiness.
 * `photosPending` lets the browser count photos that will be uploaded during publishing.
 */
export function ebayPublishIssues(draft: ListingDraft, readiness: ReturnType<typeof assessListing>, rules: CategoryRules = {}, { photosPending = false, now = Date.now() } = {}) {
  const issues: string[] = [];
  if (draft.marketplace !== "ebay") issues.push("Select eBay as the marketplace.");
  if (!readiness.publishable) issues.push(`Complete the ${readiness.blockers.length} listing item${readiness.blockers.length === 1 ? "" : "s"} in "Before you list".`);
  if (!/^\d{1,10}$/.test(draft.ebay.categoryId.trim())) issues.push("Choose an eBay category.");
  const conditionId = chosenConditionId(draft);
  if (!conditionId || !conditionEnumById[conditionId]) issues.push("Choose an eBay condition.");
  else if (rules.conditions?.length && !rules.conditions.some((c) => c.id === conditionId))
    issues.push("This eBay category doesn't accept the chosen condition. Pick one of the category's conditions.");
  if (!draft.ebay.fulfillmentPolicyId || !draft.ebay.paymentPolicyId || !draft.ebay.returnPolicyId) issues.push("Choose or create shipping, payment and return policies.");
  if (!draft.ebay.merchantLocationKey) issues.push("Choose or add the location the item ships from.");
  const urls = listingImageUrls(draft, now);
  if (!urls.length && !(photosPending && draft.photos.some((p) => p.selected))) issues.push("Select at least one photo (or add a hosted image URL).");
  if (draft.ebay.imageUrls.some((u) => { try { return new URL(u).protocol !== "https:"; } catch { return true; } })) issues.push("Every manual image URL must be a valid https:// address.");
  if (draft.title.value.trim().length > 80) issues.push("eBay titles are limited to 80 characters.");
  if (descriptionHtml(draft.description.value).length > EBAY_DESCRIPTION_LIMIT) issues.push(`Shorten the description: eBay allows ${EBAY_DESCRIPTION_LIMIT.toLocaleString()} characters including formatting.`);
  if (draft.shipping.whoPays !== "local-pickup" && [draft.shipping.length, draft.shipping.width, draft.shipping.height].some((v) => !(Number(v) > 0)))
    issues.push("Enter package length, width and height in inches.");
  const aspects = buildAspects(draft, rules.aspects);
  const missing = (rules.aspects || []).filter((a) => a.required && !aspects[a.name]).map((a) => a.name);
  if (missing.length) issues.push(`eBay requires these item specifics for this category: ${missing.join(", ")}.`);
  return issues;
}
