import type { assessListing } from "../listing/readiness";
import { usableAttributes } from "../listing/template";
import type { AttributeKey, ListingDraft } from "../listing/types";
import { MARKETPLACE_ID } from "./config";

/** eBay Inventory API condition enum values used by ResellAI's four condition groups. */
export type EbayCondition = "NEW" | "NEW_OTHER" | "USED_EXCELLENT" | "SELLER_REFURBISHED" | "FOR_PARTS_OR_NOT_WORKING";

/**
 * Map ResellAI condition groups onto Inventory API conditions.
 * Allowed conditions differ by category; eBay validates the final choice when the offer is published.
 */
export function ebayCondition(draft: ListingDraft): EbayCondition | null {
  const { grade, packaging } = draft.condition;
  if (grade === "new") return packaging === "none" ? "NEW_OTHER" : "NEW";
  if (grade === "used") return "USED_EXCELLENT"; // eBay's "Used" / "Pre-owned" (condition ID 3000)
  if (grade === "refurbished") return "SELLER_REFURBISHED";
  if (grade === "parts") return "FOR_PARTS_OR_NOT_WORKING";
  return null;
}

/** Common eBay item-specific names. Category-required aspects are checked against eBay's taxonomy at publish time. */
export function aspectName(key: AttributeKey, category: ListingDraft["category"]): string | null {
  const map: Partial<Record<AttributeKey, string>> = {
    brand: "Brand",
    model: "Model",
    color: "Color",
    size: category === "footwear" ? "US Shoe Size" : "Size",
    department: "Department",
    styleCode: "Style Code",
    material: category === "footwear" ? "Upper Material" : "Material",
    storage: "Storage Capacity",
    productType: "Type",
    edition: "Edition",
    subtype: "Type",
    carrierLock: "Network",
  };
  return map[key] ?? null;
}

export function buildAspects(draft: ListingDraft) {
  const aspects: Record<string, string[]> = {};
  for (const a of usableAttributes(draft)) {
    const name = aspectName(a.key, draft.category);
    if (name && !aspects[name]) aspects[name] = [a.value.trim().slice(0, 65)];
  }
  for (const [name, value] of Object.entries(draft.ebay.extraAspects || {}))
    if (name.trim() && value.trim()) aspects[name.trim().slice(0, 40)] = [value.trim().slice(0, 65)];
  return aspects;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const descriptionHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");

export const skuForDraft = (draftId: string) => `RAI-${draftId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)}`;

const decimal = (v: string) => (v.trim() === "" ? 0 : Number(v));

export function buildInventoryItem(draft: ListingDraft) {
  const s = draft.shipping;
  const pounds = decimal(s.weightLb) + decimal(s.weightOz) / 16;
  const condition = ebayCondition(draft);
  return {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition,
    ...(condition && condition !== "NEW" && draft.condition.description.trim() ? { conditionDescription: draft.condition.description.trim().slice(0, 1000) } : {}),
    product: {
      title: draft.title.value.trim(),
      description: descriptionHtml(draft.description.value),
      aspects: buildAspects(draft),
      imageUrls: draft.ebay.imageUrls,
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

/** eBay-specific publishing requirements on top of general listing readiness. */
export function ebayPublishIssues(draft: ListingDraft, readiness: ReturnType<typeof assessListing>, requiredAspects: string[] = []) {
  const issues: string[] = [];
  if (draft.marketplace !== "ebay") issues.push("Select eBay as the marketplace.");
  if (!readiness.publishable) issues.push(`Complete the ${readiness.blockers.length} listing item${readiness.blockers.length === 1 ? "" : "s"} in "Before you list".`);
  if (!/^\d{1,10}$/.test(draft.ebay.categoryId.trim())) issues.push("Choose an eBay category.");
  if (!ebayCondition(draft)) issues.push("Choose a condition.");
  if (!draft.ebay.fulfillmentPolicyId || !draft.ebay.paymentPolicyId || !draft.ebay.returnPolicyId) issues.push("Choose shipping, payment and return policies from your eBay account.");
  if (!draft.ebay.merchantLocationKey) issues.push("Choose the inventory location the item ships from.");
  const urls = draft.ebay.imageUrls;
  if (!urls.length) issues.push("Add at least one hosted HTTPS image URL. eBay can't read photos stored only in this browser.");
  if (urls.length > 24) issues.push("eBay accepts at most 24 images.");
  if (urls.some((u) => { try { return new URL(u).protocol !== "https:"; } catch { return true; } })) issues.push("Every image URL must be a valid https:// address.");
  if (draft.title.value.trim().length > 80) issues.push("eBay titles are limited to 80 characters.");
  if (draft.shipping.whoPays !== "local-pickup" && [draft.shipping.length, draft.shipping.width, draft.shipping.height].some((v) => !(Number(v) > 0)))
    issues.push("Enter package length, width and height in inches.");
  const aspects = buildAspects(draft);
  const missingAspects = requiredAspects.filter((name) => !aspects[name]);
  if (missingAspects.length) issues.push(`eBay requires these item specifics for this category: ${missingAspects.join(", ")}.`);
  return issues;
}
