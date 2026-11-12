import type { Identification } from "./identification";
export type MatchDetails = {
  productIdentifierVerified?: boolean;
  subtype?: string;
  material?: string;
  dimensions?: string;
  additionalDetails?: string;
  includedAccessories?: string;
  size: string;
  sizeSystem:
    "" | "US Men" | "US Women" | "US Youth" | "UK" | "EU" | "Clothing";
  condition: "" | "new" | "used" | "refurbished" | "parts";
  packaging: "" | "original" | "none";
  variant: string;
  productIdentifier: string;
};
export const emptyMatchDetails: MatchDetails = {
  size: "",
  sizeSystem: "",
  condition: "",
  packaging: "",
  variant: "",
  productIdentifier: "",
};
export type ProductQuery = {
  identification: Identification;
  details: MatchDetails;
};
export type Comparable = {
  quality?: {score:number; signals:string[]};
  priceEligible?: boolean;
  matchTier?: "exact" | "close" | "related";
  id: string;
  title: string;
  price: number;
  currency: "USD";
  status: "asking";
  condition: string;
  conditionId: string;
  url: string;
  observedAt: string;
  shipping: number | null;
  seller: string | null;
  categories: string[];
  matchReasons: string[];
  warnings: string[];
};
export type MarketplaceResult = {
  searchCompleteness?: "complete" | "partial";
  evidenceId?: string;
  provider: "ebay" | "mercari";
  status: "available" | "unavailable" | "no_matches";
  environment: "production" | "sandbox";
  reason?: string;
  query: string;
  comparables: Comparable[];
  retrievedAt: string | null;
  expiresAt: string | null;
  cached: boolean;
  examined: number;
  excluded: number;
  invalid: number;
  warnings: string[];
  diagnostics?: { normalized: number; accepted: number; exclusions: Record<string, number>; rows: { id: string; title: string; stage: string; reason: string }[] };
  retrievalDiagnostics?: {uniqueListings:number;duplicateRows:number;duplicateRate:number|null;pricingCandidates:number;cohortCount:number;bottleneck:"none"|"retrieval-error"|"no-results"|"matching"|"pricing-cohort";latencyMs:number;requests:number};
  searchDiagnostics?: {cacheKey: string; attempts: {stage: string; query: string; filter: string; limit: number; returned: number; unique?:number; duplicates?:number; candidates?:number; latencyMs?:number; error?: string}[]; exact: number; close: number; related: number};
  retryAfterSeconds?: number;
  creditsUsed?: number | null;
};
export interface MarketplaceProvider {
  id: string;
  search(query: ProductQuery, options?: {refresh?: boolean}): Promise<MarketplaceResult>;
}
export type DataProvenance = "verified" | "estimate" | "demo";
export function parseMatchDetails(value: unknown): MatchDetails {
  if (!value || typeof value !== "object")
    throw new Error("Matching details are required.");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(emptyMatchDetails).some(
      (k) => typeof v[k] !== "string" || (v[k] as string).length > 100,
    )
  )
    throw new Error("Keep each matching detail under 100 characters.");
  if (
    !["", "US Men", "US Women", "US Youth", "UK", "EU", "Clothing"].includes(
      v.sizeSystem as string,
    ) ||
    !["", "new", "used", "refurbished", "parts"].includes(
      v.condition as string,
    ) ||
    !["", "original", "none"].includes(v.packaging as string)
  )
    throw new Error("Choose valid matching options.");
  if (Boolean((v.size as string).trim()) !== Boolean(v.sizeSystem))
    throw new Error(
      "Provide both size and sizing system, or leave both blank.",
    );
  if (
    v.sizeSystem &&
    v.sizeSystem !== "Clothing" &&
    !/^\d{1,2}(?:\.\d)?$/.test((v.size as string).trim())
  )
    throw new Error("Enter a numeric shoe size, such as 9.5.");
  const result = Object.fromEntries(
    Object.keys(emptyMatchDetails).map((k) => [k, (v[k] as string).trim()]),
  ) as unknown as MatchDetails;
  if (result.size && !/^[a-zA-Z0-9 .-]{1,20}$/.test(result.size))
    throw new Error("Enter a plain size such as 9.5, M or XL.");
  if (
    result.productIdentifier &&
    !/^[a-zA-Z0-9 -]{3,40}$/.test(result.productIdentifier)
  )
    throw new Error(
      "Enter only the exact SKU, GTIN or model identifier, without notes.",
    );
  for (const key of ["subtype", "material", "dimensions", "additionalDetails", "includedAccessories"] as const) {
    if(v[key] !== undefined && (typeof v[key] !== "string" || (v[key] as string).length>300)) throw new Error("Keep optional item details under 300 characters.");
    if(typeof v[key] === "string") result[key]=(v[key] as string).trim();
  }
  if (v.productIdentifierVerified !== undefined && typeof v.productIdentifierVerified !== "boolean") throw new Error("Identifier verification must be true or false.");
  if (v.productIdentifierVerified === true) result.productIdentifierVerified = true;
  return result;
}

