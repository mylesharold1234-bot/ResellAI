import { auditDraftText } from "./claims";
import type { ListingDraft, TextSource } from "./types";

export type GeneratedField = "title" | "description" | "condition" | "recommendations";
export const generatedFields: GeneratedField[] = ["title", "description", "condition", "recommendations"];

export type GeneratedListing = {
  source: "ai" | "template";
  title?: string;
  description?: string;
  condition?: string;
  recommendations?: string[];
  warnings: string[];
};

/**
 * Merge generated text into a draft. Only the requested fields change.
 * Seller-edited text is preserved by a full "generate" unless `overwriteUserEdits` is set
 * (a per-field regenerate is an explicit request, so it sets that flag).
 */
export function applyGenerated(
  draft: ListingDraft,
  generated: GeneratedListing,
  fields: GeneratedField[],
  { overwriteUserEdits = false, now = new Date().toISOString() } = {},
): ListingDraft {
  const source: TextSource = generated.source === "ai" ? "ai-generated" : "template";
  const replace = (current: TextSource) => overwriteUserEdits || current !== "user-edited";
  let next: ListingDraft = { ...draft, updatedAt: now };
  if (fields.includes("title") && generated.title !== undefined && replace(draft.title.source))
    next = { ...next, title: { value: generated.title, source, warnings: [] } };
  if (fields.includes("description") && generated.description !== undefined && replace(draft.description.source))
    next = { ...next, description: { value: generated.description, source, warnings: [] } };
  if (fields.includes("condition") && generated.condition !== undefined && replace(draft.condition.descriptionSource))
    next = { ...next, condition: { ...next.condition, description: generated.condition, descriptionSource: source, confirmed: false } };
  if (fields.includes("recommendations") && generated.recommendations) next = { ...next, recommendations: generated.recommendations };
  const audit = auditDraftText(next);
  return {
    ...next,
    title: { ...next.title, warnings: audit.title.map((x) => x.message) },
    description: { ...next.description, warnings: audit.description.map((x) => x.message) },
  };
}

export function editText(draft: ListingDraft, field: "title" | "description", value: string, now = new Date().toISOString()): ListingDraft {
  const next = { ...draft, updatedAt: now, [field]: { value, source: value ? "user-edited" : "empty", warnings: [] } } as ListingDraft;
  const audit = auditDraftText(next);
  return { ...next, [field]: { ...next[field], warnings: audit[field].map((x) => x.message) } };
}

/** Structural validation for drafts read back from browser storage. */
export function parseDraft(value: unknown): ListingDraft {
  const v = value as ListingDraft;
  const ok =
    !!v &&
    typeof v === "object" &&
    typeof v.id === "string" &&
    v.schemaVersion === 1 &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    ["ebay", "mercari", "facebook", "other"].includes(v.marketplace) &&
    !!v.identification &&
    Array.isArray(v.attributes) &&
    !!v.condition &&
    !!v.title &&
    !!v.description &&
    Array.isArray(v.photos) &&
    !!v.pricing &&
    Array.isArray(v.pricing.evidence) &&
    !!v.shipping &&
    !!v.ebay;
  if (!ok) throw new Error("This saved draft is unreadable or from an unsupported version.");
  return v;
}
