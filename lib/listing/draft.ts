import type { Identification } from "../identification";
import type { MatchDetails } from "../marketplaces";
import { visibleConditionGroup } from "../pricing-engine";
import { known, recognizableName, type FieldSources } from "../product-profile";
import { attributeRules, listingCategory } from "./categories";
import { conditionFit, summarizeEvidence, type MarketEvidence } from "./pricing";
import type {
  AttributeKey,
  ListingAttribute,
  ListingCategory,
  ListingConditionGrade,
  ListingDraft,
  ListingMarketplace,
  ListingPricing,
  PricingEvidenceSummary,
  Provenance,
} from "./types";

type Source = FieldSources[keyof FieldSources];

export function provenanceOf(source: Source | undefined, value: string): Provenance {
  if (!value.trim()) return "missing";
  if (source === "user-provided" || source === "independently-verified") return "user-confirmed";
  if (source === "image-visible" || source === "user-described") return "identified";
  return "ai-inferred";
}

const sameText = (a?: string | null, b?: string | null) =>
  (a || "").trim().toLowerCase().replace(/\s+/g, " ") === (b || "").trim().toLowerCase().replace(/\s+/g, " ");

const departmentFor = (system: MatchDetails["sizeSystem"]) =>
  system === "US Men" ? "Men" : system === "US Women" ? "Women" : system === "US Youth" ? "Youth" : "";

/** Candidate value + provenance for each attribute, using only confirmed identification data and seller details. */
export function attributeValue(
  key: AttributeKey,
  i: Identification,
  d: MatchDetails,
  sources: FieldSources,
): { value: string; source: Provenance } {
  const fromField = (field: keyof FieldSources, value: string | null | undefined) => {
    const v = known(value);
    return { value: v, source: provenanceOf(sources[field], v) };
  };
  const user = (value?: string) => ({ value: (value || "").trim(), source: (value || "").trim() ? ("user-confirmed" as const) : ("missing" as const) });
  const understanding = i.understanding;
  switch (key) {
    case "productType":
      return fromField("productName", recognizableName(i) || i.productName);
    case "brand":
      return fromField("brand", i.brand);
    case "model":
      return fromField("model", i.model);
    case "color":
      return fromField("colorway", i.colorway);
    case "size":
      return user(d.size);
    case "department":
      return user(departmentFor(d.sizeSystem));
    case "styleCode":
      if (d.productIdentifierVerified && d.productIdentifier.trim()) return user(d.productIdentifier);
      return fromField("identifyingInformation", i.identifyingInformation);
    case "edition":
      return user(d.variant);
    case "subtype": {
      const v = (d.subtype || "").trim();
      if (v) return { value: v, source: sameText(v, understanding?.subtype) ? "ai-inferred" : "user-confirmed" };
      const inferred = (understanding?.subtype || "").trim();
      return { value: inferred, source: inferred ? "ai-inferred" : "missing" };
    }
    case "material": {
      if ((d.material || "").trim()) return user(d.material);
      const evidence = understanding?.evidence.find((e) => e.field === "materials");
      if (!evidence?.value.trim()) return { value: "", source: "missing" };
      return { value: evidence.value.trim(), source: evidence.source === "ai-inferred" ? "ai-inferred" : "identified" };
    }
    case "dimensions":
      return user(d.dimensions);
    case "storage":
      return /\b\d+\s?(gb|tb)\b/i.test(d.variant) ? user(d.variant) : { value: "", source: "missing" };
    default:
      return { value: "", source: "missing" };
  }
}

export function buildAttributes(category: ListingCategory, i: Identification, d: MatchDetails, sources: FieldSources): ListingAttribute[] {
  return attributeRules(category, i).map((rule) => {
    const { value, source } = attributeValue(rule.key, i, d, sources);
    return { ...rule, value, source, confirmed: source === "user-confirmed" };
  });
}

const usedWords = /\b(worn|used|creas\w*|scuff\w*|wear|pre-?owned|scratch\w*|stain\w*|faded|pilling)\b/i;

export function initialConditionGrade(i: Identification, d: MatchDetails): { grade: ListingConditionGrade; source: Provenance } {
  if (d.condition) return { grade: d.condition, source: "user-confirmed" };
  if (visibleConditionGroup(i.visibleCondition) === "new") return { grade: "new", source: "ai-inferred" };
  if (usedWords.test(i.visibleCondition || "")) return { grade: "used", source: "ai-inferred" };
  return { grade: "", source: "missing" };
}

/** Pick a starting price only from supported evidence that matches the listed condition. */
export function initialPrice(evidence: PricingEvidenceSummary[], marketplace: ListingMarketplace, grade: ListingConditionGrade) {
  const preferred = marketplace === "mercari" ? ["mercari", "ebay"] : ["ebay", "mercari"];
  for (const provider of preferred) {
    const e = evidence.find((x) => x.provider === provider);
    if (e?.status === "supported" && e.suggested !== null && conditionFit(e, grade) !== "mismatch")
      return { price: e.suggested, priceSource: "evidence" as const, priceProvider: e.provider };
  }
  return { price: null, priceSource: null, priceProvider: null };
}

export type DraftInput = {
  id: string;
  now: string;
  identification: Identification;
  details: MatchDetails;
  sources: FieldSources;
  photos: { id: string; name: string }[];
  ebay: MarketEvidence;
  mercari: MarketEvidence;
  marketplace?: ListingMarketplace;
};

/** Create a listing draft from the confirmed analysis. Deterministic: no AI call, no invented values. */
export function createListingDraft(input: DraftInput): ListingDraft {
  const { identification: i, details: d } = input;
  const category = listingCategory(i);
  const marketplace = input.marketplace || "ebay";
  const condition = initialConditionGrade(i, d);
  const evidence = [summarizeEvidence("ebay", input.ebay), summarizeEvidence("mercari", input.mercari)];
  const accessories = (d.includedAccessories || "").trim();
  const accessoriesSource: Provenance = !accessories
    ? "missing"
    : sameText(accessories, (i.understanding?.includedAccessories || []).join(", "))
      ? "ai-inferred"
      : "user-confirmed";
  const pricing: ListingPricing = {
    evidence,
    ...initialPrice(evidence, marketplace, condition.grade),
    purchaseCost: "",
    feeMode: marketplace === "ebay" && category === "footwear" ? "ebay-athletic-sneakers" : "custom",
    feePercent: "",
    fixedFee: "",
    buyerShipping: "",
    salesTax: "",
    sellerShipping: "",
    extras: "",
  };
  return {
    id: input.id,
    schemaVersion: 1,
    createdAt: input.now,
    updatedAt: input.now,
    marketplace,
    category,
    identification: i,
    details: d,
    attributes: buildAttributes(category, i, d, input.sources),
    condition: {
      grade: condition.grade,
      gradeSource: condition.source,
      packaging: d.packaging,
      description: "",
      descriptionSource: "empty",
      defects: "",
      noKnownDefects: false,
      confirmed: false,
    },
    includedItems: { value: accessories, source: accessoriesSource, confirmed: accessoriesSource === "user-confirmed" },
    title: { value: "", source: "empty", warnings: [] },
    description: { value: "", source: "empty", warnings: [] },
    recommendations: [],
    photos: input.photos.map((p) => ({ id: p.id, name: p.name, selected: true })),
    pricing,
    shipping: { weightLb: "", weightOz: "", length: "", width: "", height: "", service: "", handlingDays: "", whoPays: "", confirmed: false },
    ebay: { categoryId: "", imageUrls: [], fulfillmentPolicyId: "", paymentPolicyId: "", returnPolicyId: "", merchantLocationKey: "", publish: null },
  };
}

/** Seller edits an attribute: their value becomes user-confirmed. Clearing it makes it missing. */
export function editAttribute(draft: ListingDraft, key: AttributeKey, value: string): ListingDraft {
  return {
    ...draft,
    attributes: draft.attributes.map((a) =>
      a.key !== key ? a : { ...a, value, source: value.trim() ? "user-confirmed" : "missing", confirmed: !!value.trim() },
    ),
  };
}

export function confirmAttribute(draft: ListingDraft, key: AttributeKey, confirmed = true): ListingDraft {
  return { ...draft, attributes: draft.attributes.map((a) => (a.key === key && a.value.trim() ? { ...a, confirmed } : a)) };
}
