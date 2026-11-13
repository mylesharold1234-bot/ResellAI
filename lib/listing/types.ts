import type { Identification } from "../identification";
import type { MatchDetails } from "../marketplaces";

/**
 * Where a listing value came from. Shown to the seller next to every field.
 * - user-confirmed: typed, edited or explicitly confirmed by the seller
 * - identified: visible in the photo or stated in the seller's notes, reviewed at confirmation
 * - ai-inferred: the AI's interpretation; must be confirmed before a listing is publishable
 * - missing: no supported value
 */
export type Provenance = "user-confirmed" | "identified" | "ai-inferred" | "missing";

export type ListingMarketplace = "ebay" | "mercari" | "facebook" | "other";

export type ListingCategory =
  | "footwear"
  | "clothing"
  | "electronics"
  | "collectible"
  | "instrument"
  | "household"
  | "general";

export type AttributeKey =
  | "brand"
  | "model"
  | "productType"
  | "color"
  | "size"
  | "department"
  | "styleCode"
  | "material"
  | "dimensions"
  | "storage"
  | "functionalStatus"
  | "edition"
  | "subtype"
  | "quantity"
  | "measurements"
  | "carrierLock";

export type ListingAttribute = {
  key: AttributeKey;
  label: string;
  value: string;
  source: Provenance;
  /** Required for a publishable listing in this category. */
  required: boolean;
  /** Seller explicitly confirmed an AI-inferred or identified value. */
  confirmed: boolean;
  hint?: string;
};

export type ListingConditionGrade = "" | "new" | "used" | "refurbished" | "parts";

export type ListingCondition = {
  grade: ListingConditionGrade;
  gradeSource: Provenance;
  packaging: "" | "original" | "none";
  /** Seller-facing narrative condition description. */
  description: string;
  descriptionSource: TextSource;
  defects: string;
  noKnownDefects: boolean;
  /** Seller confirmed grade, description and defects are accurate. */
  confirmed: boolean;
};

export type TextSource = "empty" | "ai-generated" | "template" | "user-edited";

export type ListingText = { value: string; source: TextSource; warnings: string[] };

export type ListingPhotoRef = { id: string; name: string; selected: boolean };

export type PricingEvidenceSummary = {
  provider: "ebay" | "mercari";
  status: "supported" | "insufficient" | "unavailable";
  environment: "production" | "sandbox";
  /** Existing ResellAI recommendation (robust median of qualifying active asks). */
  suggested: number | null;
  median: number | null;
  low: number | null;
  high: number | null;
  count: number;
  /** Lower-quartile active ask: undercuts most competing listings. Only with >=5 qualifying asks. */
  quickSale: number | null;
  /** Upper-quartile active ask: for sellers willing to wait. Only with >=5 qualifying asks. */
  patient: number | null;
  conditionCohort: string;
  pricingBasis: "exact" | "close" | "none";
  retrievedAt: string | null;
  expiresAt: string | null;
  blockers: string[];
  reason: string | null;
};

export type PriceSource = "evidence" | "quick-sale" | "patient" | "manual";

export type FeeMode = "ebay-athletic-sneakers" | "custom";

export type ListingPricing = {
  evidence: PricingEvidenceSummary[];
  price: number | null;
  priceSource: PriceSource | null;
  priceProvider: "ebay" | "mercari" | null;
  purchaseCost: string;
  feeMode: FeeMode;
  feePercent: string;
  fixedFee: string;
  buyerShipping: string;
  salesTax: string;
  sellerShipping: string;
  extras: string;
};

export type ListingShipping = {
  weightLb: string;
  weightOz: string;
  length: string;
  width: string;
  height: string;
  service: string;
  handlingDays: string;
  whoPays: "" | "buyer" | "seller" | "local-pickup";
  confirmed: boolean;
};

export type EbayPublishRecord = {
  sku: string;
  offerId: string | null;
  listingId: string | null;
  status: "not-started" | "in-progress" | "published" | "failed";
  lastError: string | null;
  updatedAt: string;
};

export type ListingDraft = {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  marketplace: ListingMarketplace;
  category: ListingCategory;
  /** Snapshot of the identification the seller confirmed. Never re-identified. */
  identification: Identification;
  details: MatchDetails;
  attributes: ListingAttribute[];
  condition: ListingCondition;
  includedItems: { value: string; source: Provenance; confirmed: boolean };
  title: ListingText;
  description: ListingText;
  recommendations: string[];
  photos: ListingPhotoRef[];
  pricing: ListingPricing;
  shipping: ListingShipping;
  ebay: {
    categoryId: string;
    imageUrls: string[];
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
    merchantLocationKey: string;
    /** Extra eBay item specifics the seller typed in (e.g. category-required aspects). User-confirmed. */
    extraAspects?: Record<string, string>;
    publish: EbayPublishRecord | null;
  };
};
