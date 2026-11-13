import type { Identification } from "../identification";
import { productProfile } from "../product-profile";
import type { AttributeKey, ListingCategory, ListingMarketplace } from "./types";

type AttributeRule = { key: AttributeKey; label: string; required: boolean; hint?: string };

const clothing =
  /\b(shirt|t-shirt|tee|hoodie|sweatshirt|jacket|coat|jeans|pants|trousers|shorts|dress|skirt|sweater|cardigan|blouse|jersey|vest|leggings|apparel|clothing|outerwear|parka|polo)\b/i;
const household =
  /\b(kitchen|appliance|decor|vase|blender|cookware|pan|pot|mug|cup|plate|bowl|dinnerware|ceramic|porcelain|lamp|chair|table|furniture|rug|pillow|candle|frame|mirror|toaster|kettle|vacuum)\b/i;
const phone = /\b(iphone|smartphone|phone|galaxy s|pixel \d)\b/i;

/** Map the existing product profile onto listing categories; clothing and household are listing-only splits. */
export function listingCategory(i: Identification): ListingCategory {
  const kind = productProfile(i).kind;
  const text = `${i.category || ""} ${i.productName || ""} ${i.model || ""}`;
  if (kind === "footwear") return "footwear";
  if (kind === "electronics") return "electronics";
  if (kind === "collectible") return "collectible";
  if (kind === "instrument") return "instrument";
  if (kind === "dinnerware" || kind === "furniture") return "household";
  if (clothing.test(text)) return "clothing";
  if (household.test(text)) return "household";
  return "general";
}

export const categoryLabels: Record<ListingCategory, string> = {
  footwear: "Sneakers & footwear",
  clothing: "Clothing",
  electronics: "Electronics",
  collectible: "Collectibles",
  instrument: "Musical instruments",
  household: "Home & household",
  general: "General merchandise",
};

/** Item specifics each category needs. Required items block a publishable listing until supplied or confirmed. */
export function attributeRules(category: ListingCategory, i?: Identification): AttributeRule[] {
  const base: AttributeRule[] = [{ key: "productType", label: "Product type", required: true }];
  switch (category) {
    case "footwear":
      return [
        ...base,
        { key: "brand", label: "Brand", required: true },
        { key: "model", label: "Model", required: true },
        { key: "size", label: "Size", required: true, hint: "Read it from the size tag inside the shoe." },
        { key: "department", label: "Department", required: true, hint: "Men, Women, Youth or Unisex." },
        { key: "color", label: "Color", required: true },
        { key: "styleCode", label: "Style code / SKU", required: false, hint: "Printed on the size tag or box label, e.g. DD1391-100." },
        { key: "edition", label: "Edition / variant", required: false },
        { key: "material", label: "Upper material", required: false },
      ];
    case "clothing":
      return [
        ...base,
        { key: "brand", label: "Brand", required: true },
        { key: "size", label: "Size", required: true, hint: "Use the size printed on the tag." },
        { key: "department", label: "Department", required: true, hint: "Men, Women, Unisex, Boys or Girls." },
        { key: "color", label: "Color", required: true },
        { key: "material", label: "Material", required: false, hint: "Copy it from the care label; don't guess." },
        { key: "measurements", label: "Measurements", required: false, hint: "Pit-to-pit and length help buyers most." },
        { key: "model", label: "Style / line", required: false },
      ];
    case "electronics":
      return [
        ...base,
        { key: "brand", label: "Brand", required: true },
        { key: "model", label: "Model", required: true, hint: "Use the model number from the label or settings screen." },
        { key: "storage", label: "Storage / configuration", required: phone.test(`${i?.productName} ${i?.model}`), hint: "e.g. 128 GB, Disc edition." },
        { key: "functionalStatus", label: "Functional status", required: true, hint: "Tested working, untested, or not working — only what you checked." },
        ...(phone.test(`${i?.productName || ""} ${i?.model || ""} ${i?.category || ""}`)
          ? [{ key: "carrierLock" as const, label: "Carrier / lock status", required: true, hint: "Unlocked, carrier-locked, iCloud/Google account removed?" }]
          : []),
        { key: "color", label: "Color", required: false },
      ];
    case "collectible":
      return [
        ...base,
        { key: "brand", label: "Brand / maker", required: false },
        { key: "edition", label: "Set number / edition", required: true, hint: "Set numbers, card numbers or edition markings." },
        { key: "model", label: "Name / series", required: false },
        { key: "quantity", label: "Completeness / quantity", required: true, hint: "Complete set? Pieces or cards included?" },
      ];
    case "instrument":
      return [
        ...base,
        { key: "brand", label: "Brand", required: true },
        { key: "model", label: "Model", required: false },
        { key: "subtype", label: "Instrument type", required: true, hint: "e.g. alto saxophone, acoustic guitar." },
        { key: "functionalStatus", label: "Playing condition", required: true, hint: "Only what you have checked." },
        { key: "color", label: "Finish / color", required: false },
      ];
    case "household":
      return [
        ...base,
        { key: "brand", label: "Brand / maker", required: false },
        { key: "material", label: "Material", required: false },
        { key: "dimensions", label: "Dimensions", required: true, hint: "Measure it; buyers rely on this." },
        { key: "quantity", label: "Quantity", required: false },
        { key: "color", label: "Color / pattern", required: false },
      ];
    default:
      return [
        ...base,
        { key: "brand", label: "Brand", required: false },
        { key: "model", label: "Model", required: false },
        { key: "color", label: "Color", required: false },
        { key: "material", label: "Material", required: false },
        { key: "dimensions", label: "Dimensions", required: false },
      ];
  }
}

export type MarketplaceProfile = {
  id: ListingMarketplace;
  label: string;
  titleLimit: number;
  descriptionLimit: number | null;
  directPublish: boolean;
  requiresShipping: boolean;
  limitNote: string;
};

/** Limits enforced in the editor. eBay's 80-character title is documented; others are conservative and noted. */
export const marketplaces: Record<ListingMarketplace, MarketplaceProfile> = {
  ebay: { id: "ebay", label: "eBay", titleLimit: 80, descriptionLimit: null, directPublish: true, requiresShipping: true, limitNote: "eBay titles are limited to 80 characters." },
  mercari: { id: "mercari", label: "Mercari", titleLimit: 80, descriptionLimit: 1000, directPublish: false, requiresShipping: true, limitNote: "Kept to 80-character titles and 1,000-character descriptions; confirm current limits in the Mercari app." },
  facebook: { id: "facebook", label: "Facebook Marketplace", titleLimit: 100, descriptionLimit: null, directPublish: false, requiresShipping: false, limitNote: "Short, clear titles work best; local pickup does not need package details." },
  other: { id: "other", label: "Other marketplace", titleLimit: 80, descriptionLimit: null, directPublish: false, requiresShipping: false, limitNote: "Generic export; check the destination marketplace's limits." },
};
