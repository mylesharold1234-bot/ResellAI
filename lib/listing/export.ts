import { marketplaces } from "./categories";
import { conditionPhrase } from "./template";
import type { ListingDraft, ListingMarketplace } from "./types";

export type ListingExport = {
  marketplace: ListingMarketplace;
  title: string;
  description: string;
  price: string;
  condition: string;
  specifics: [string, string][];
  text: string;
};

const mercariConditionHint: Record<string, string> = {
  new: "New",
  used: "Pre-owned — choose Like new, Good, Fair or Poor in Mercari to match your photos",
  refurbished: "Refurbished — choose the closest Mercari condition",
  parts: "Poor (for parts / not working)",
};

/** Marketplace-ready copy for manual posting. Only confirmed or identified values are exported. */
export function exportListing(draft: ListingDraft, marketplace: ListingMarketplace = draft.marketplace): ListingExport {
  const profile = marketplaces[marketplace];
  const specifics = draft.attributes
    .filter((a) => a.source !== "missing" && a.value.trim() && (a.source !== "ai-inferred" || a.confirmed))
    .map((a) => [a.label, a.value.trim()] as [string, string]);
  const condition = marketplace === "mercari" ? mercariConditionHint[draft.condition.grade] || "" : conditionPhrase(draft);
  const price = draft.pricing.price === null ? "" : draft.pricing.price.toFixed(2);
  const description = profile.descriptionLimit && draft.description.value.length > profile.descriptionLimit
    ? draft.description.value.slice(0, profile.descriptionLimit)
    : draft.description.value;
  const text = [
    `TITLE (${draft.title.value.length}/${profile.titleLimit})`,
    draft.title.value,
    "",
    `PRICE: ${price ? "$" + price : "not set"}`,
    `CONDITION: ${condition || "not set"}`,
    "",
    "ITEM SPECIFICS",
    ...specifics.map(([k, v]) => `${k}: ${v}`),
    "",
    "DESCRIPTION",
    description,
  ].join("\n");
  return { marketplace, title: draft.title.value, description, price, condition, specifics, text };
}
