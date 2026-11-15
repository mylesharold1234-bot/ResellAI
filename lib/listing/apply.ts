import { auditDraftText } from "./claims";
import { factsKey, staleFields, type GeneratedTextField } from "./template";
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
  {
    overwriteUserEdits = false,
    now = new Date().toISOString(),
    /** The draft the text was generated from; its facts are recorded so later changes mark the text out of date. */
    writtenFrom = draft,
  }: { overwriteUserEdits?: boolean; now?: string; writtenFrom?: ListingDraft } = {},
): ListingDraft {
  const source: TextSource = generated.source === "ai" ? "ai-generated" : "template";
  const replace = (current: TextSource) => overwriteUserEdits || current !== "user-edited";
  let next: ListingDraft = { ...draft, updatedAt: now };
  const from = { ...(draft.generatedFrom || {}) };
  if (fields.includes("title") && generated.title !== undefined && replace(draft.title.source)) {
    next = { ...next, title: { value: generated.title, source, warnings: [] } };
    from.title = factsKey(writtenFrom, "title");
  }
  if (fields.includes("description") && generated.description !== undefined && replace(draft.description.source)) {
    next = { ...next, description: { value: generated.description, source, warnings: [] } };
    from.description = factsKey(writtenFrom, "description");
  }
  // Writing the condition note doesn't change whether the seller verified the condition itself.
  if (fields.includes("condition") && generated.condition !== undefined && replace(draft.condition.descriptionSource)) {
    next = { ...next, condition: { ...next.condition, description: generated.condition, descriptionSource: source } };
    from.condition = factsKey(writtenFrom, "condition");
  }
  if (fields.includes("recommendations") && generated.recommendations) next = { ...next, recommendations: generated.recommendations };
  const audit = auditDraftText(next);
  return {
    ...next,
    generatedFrom: from,
    title: { ...next.title, warnings: audit.title.map((x) => x.message) },
    description: { ...next.description, warnings: audit.description.map((x) => x.message) },
  };
}

/** The seller's own text. It is never replaced automatically; it's only flagged if the facts change later. */
export function editText(draft: ListingDraft, field: "title" | "description", value: string, now = new Date().toISOString()): ListingDraft {
  const next = {
    ...draft,
    updatedAt: now,
    [field]: { value, source: value ? "user-edited" : "empty", warnings: [] },
    generatedFrom: { ...(draft.generatedFrom || {}), [field]: factsKey(draft, field) },
  } as ListingDraft;
  const audit = auditDraftText(next);
  return { ...next, [field]: { ...next[field], warnings: audit[field].map((x) => x.message) } };
}

export function editConditionText(draft: ListingDraft, value: string, now = new Date().toISOString()): ListingDraft {
  return {
    ...draft,
    updatedAt: now,
    condition: { ...draft.condition, description: value, descriptionSource: value ? "user-edited" : "empty" },
    generatedFrom: { ...(draft.generatedFrom || {}), condition: factsKey(draft, "condition") },
  };
}

/** Which out-of-date fields can be refreshed automatically (generated text) vs. need the seller's say-so (edited text). */
export function refreshPlan(draft: ListingDraft) {
  const stale = staleFields(draft);
  const sourceOf = (f: GeneratedTextField) => (f === "condition" ? draft.condition.descriptionSource : draft[f].source);
  return {
    automatic: stale.filter((f) => sourceOf(f) !== "user-edited"),
    needsApproval: stale.filter((f) => sourceOf(f) === "user-edited"),
  };
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
    // "facebook" is accepted from drafts saved before Facebook Marketplace was removed (mapped below).
    ["ebay", "mercari", "facebook", "other"].includes(v.marketplace as string) &&
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
  // Facebook Marketplace is no longer offered. Its drafts keep every field and open as "Other marketplace".
  return (v.marketplace as string) === "facebook" ? { ...v, marketplace: "other" } : v;
}
