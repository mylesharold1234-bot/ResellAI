import type { assessListing, ReadinessIssue } from "../listing/readiness";
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
  // productType holds the product's name ("Nike Dunk Low"), not eBay's "Type" (e.g. "Athletic"), so it isn't mapped.
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

/** Package weight and dimensions, only when the seller entered them (needed for calculated shipping). */
export function packageDetails(draft: ListingDraft) {
  const s = draft.shipping;
  if (s.whoPays === "local-pickup") return null;
  const pounds = decimal(s.weightLb) + decimal(s.weightOz) / 16;
  const dims = [s.length, s.width, s.height].map((v) => Number(v));
  const hasDims = dims.every((n) => n > 0);
  if (!(pounds > 0) && !hasDims) return null;
  return {
    ...(hasDims ? { dimensions: { length: dims[0], width: dims[1], height: dims[2], unit: "INCH" } } : {}),
    ...(pounds > 0 ? { weight: { value: Math.round(pounds * 100) / 100, unit: "POUND" } } : {}),
  };
}

export function buildInventoryItem(draft: ListingDraft, categoryAspects?: CategoryAspect[], now = Date.now()) {
  const pkg = packageDetails(draft);
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
    ...(pkg ? { packageWeightAndSize: pkg } : {}),
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

export type EbayCheckOptions = {
  /** Browser only: selected photos will be uploaded to eBay as part of publishing. */
  photosPending?: boolean;
  /** The chosen shipping policy calculates postage from package size, so eBay needs weight and dimensions. */
  calculatedShipping?: boolean;
  now?: number;
};

/**
 * eBay's own publishing requirements (on top of general listing readiness), each with the reason and inline fix.
 * Every item here is required by the Inventory/Offer APIs or the category's rules; nothing is a ResellAI preference.
 */
export function ebayRequirements(draft: ListingDraft, rules: CategoryRules = {}, { photosPending = false, calculatedShipping = false, now = Date.now() }: EbayCheckOptions = {}): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const add = (id: string, message: string, why: string, fix: string) => issues.push({ id, severity: "blocker", basis: "marketplace", message, why, fix, target: "ebay-settings" });
  if (draft.marketplace !== "ebay") add("ebay-marketplace", "Select eBay as the marketplace.", "Direct publishing is available for eBay.", "marketplace");
  if (!/^\d{1,10}$/.test(draft.ebay.categoryId.trim())) add("ebay-category", "Choose an eBay category.", "eBay files every listing under a category; it also decides the required item specifics.", "ebay-category");
  const conditionId = chosenConditionId(draft);
  if (!conditionId || !conditionEnumById[conditionId]) add("ebay-condition", "Choose an eBay condition.", "eBay needs a condition from its own list.", "ebay-condition");
  else if (rules.conditions?.length && !rules.conditions.some((c) => c.id === conditionId))
    add("ebay-condition", "This eBay category doesn't accept the chosen condition. Pick one of the category's conditions.", "Each eBay category allows only certain conditions.", "ebay-condition");
  if (!draft.ebay.fulfillmentPolicyId || !draft.ebay.paymentPolicyId || !draft.ebay.returnPolicyId)
    add("ebay-policies", "Choose or create shipping, payment and return policies.", "eBay takes shipping cost, payment and returns from your business policies.", "ebay-policies");
  if (!draft.ebay.merchantLocationKey) add("ebay-location", "Choose or add the location the item ships from.", "eBay shows buyers where the item ships from.", "ebay-location");
  const urls = listingImageUrls(draft, now);
  if (!urls.length && !(photosPending && draft.photos.some((p) => p.selected))) add("ebay-photos", "Select at least one photo (or add a hosted image URL).", "eBay requires at least one photo.", "photos");
  if (draft.ebay.imageUrls.some((u) => { try { return new URL(u).protocol !== "https:"; } catch { return true; } }))
    add("ebay-photo-urls", "Every manual image URL must be a valid https:// address.", "eBay only accepts secure image links.", "ebay-photo-urls");
  if (draft.title.value.trim().length > 80) add("ebay-title-length", "eBay titles are limited to 80 characters.", "eBay rejects longer titles.", "title");
  if (descriptionHtml(draft.description.value).length > EBAY_DESCRIPTION_LIMIT)
    add("ebay-description-length", `Shorten the description: eBay allows ${EBAY_DESCRIPTION_LIMIT.toLocaleString()} characters including formatting.`, "eBay rejects longer descriptions.", "description");
  if (calculatedShipping) {
    const pkg = packageDetails(draft);
    if (!pkg?.weight || !pkg?.dimensions)
      add("ebay-package", "Enter the packed weight and box dimensions.", "Your shipping policy uses calculated postage, which eBay prices from package size.", "package");
  }
  const aspects = buildAspects(draft, rules.aspects);
  for (const a of (rules.aspects || []).filter((x) => x.required && !aspects[x.name]))
    add(`ebay-aspect-${a.name}`, `Add "${a.name}" (eBay requires it for this category).`, `eBay won't publish in this category without ${a.name}.`, `ebay-aspect:${a.name}`);
  return issues;
}

/**
 * Everything that blocks an eBay publish, as plain messages. Used by the server before any eBay write, so the
 * final API publication is blocked by the same genuine requirements the browser shows.
 */
export function ebayPublishIssues(draft: ListingDraft, readiness: ReturnType<typeof assessListing>, rules: CategoryRules = {}, options: EbayCheckOptions = {}) {
  const issues: string[] = [];
  if (!readiness.publishable) issues.push(...readiness.blockers.map((b) => b.message));
  const ebay = ebayRequirements(draft, rules, options).map((i) => i.message);
  // eBay's aspect requirements are summarised as one line for API callers.
  const aspectMissing = ebayRequirements(draft, rules, options).filter((i) => i.id.startsWith("ebay-aspect-")).map((i) => i.id.slice("ebay-aspect-".length));
  issues.push(...ebay.filter((m) => !/^Add ".*" \(eBay requires it/.test(m)));
  if (aspectMissing.length) issues.push(`eBay requires these item specifics for this category: ${aspectMissing.join(", ")}.`);
  return [...new Set(issues)];
}
