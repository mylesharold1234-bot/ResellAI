import { auditDraftText, type ClaimIssue } from "./claims";
import { marketplaces } from "./categories";
import { conditionFit, evidenceStale } from "./pricing";
import type { ListingDraft, ListingMarketplace } from "./types";

/**
 * - blocker: publishing is not allowed until it's resolved (a marketplace requirement or a safety/accuracy check).
 * - warning: worth fixing; doesn't block.
 * - suggestion: optional improvement.
 */
export type IssueSeverity = "blocker" | "warning" | "suggestion";

/** Why something blocks: the marketplace requires it, or ResellAI needs it to list the item accurately and safely. */
export type IssueBasis = "marketplace" | "accuracy";

export type ReadinessIssue = {
  id: string;
  severity: IssueSeverity;
  message: string;
  /** One sentence telling the seller why this matters. */
  why?: string;
  basis?: IssueBasis;
  /** Section/element to scroll to. */
  target: string;
  /** Inline fix the review and checklist can render (e.g. "attr:size", "condition-flaws", "price"). */
  fix?: string;
};

const gradeLabel: Record<string, string> = { new: "new", used: "used", refurbished: "refurbished", parts: "for parts" };

function textIssues(id: string, label: string, target: string, issues: ClaimIssue[], userEdited: boolean): ReadinessIssue[] {
  return issues.map((x) => ({
    id: `${id}-${x.code}`,
    // A seller's own wording is their responsibility: surface it, but don't block on it.
    severity: x.severity === "error" && !userEdited ? "blocker" : "warning",
    message: `${label}: ${x.message}`,
    why: "Buyers rely on listing text; ResellAI won't publish AI-written claims your confirmed details don't support.",
    basis: "accuracy",
    target,
    fix: target === "condition" ? "condition-text" : target,
  }));
}

/**
 * Everything the seller still has to supply before the listing is publishable on `marketplace`, classified.
 * Only genuine marketplace requirements and accuracy/safety checks are blockers; everything ResellAI can
 * fill in itself (condition description, package details covered by a shipping policy) is not.
 */
export function assessListing(draft: ListingDraft, marketplace: ListingMarketplace = draft.marketplace, now = Date.now()) {
  const issues: ReadinessIssue[] = [];
  const add = (issue: Omit<ReadinessIssue, "target"> & { target?: string }) => issues.push({ target: issue.fix?.split(":")[0] || "listing", ...issue });
  const profile = marketplaces[marketplace];

  for (const a of draft.attributes) {
    const label = a.label.toLowerCase();
    if (a.required && (a.source === "missing" || !a.value.trim()))
      add({ id: `attr-${a.key}`, severity: "blocker", basis: "accuracy", message: `Add the ${label}.`, why: a.hint || `Buyers filter and decide by ${label}; ResellAI won't guess it.`, target: "specifics", fix: `attr:${a.key}` });
    else if (a.required && a.source === "ai-inferred" && !a.confirmed)
      add({ id: `attr-${a.key}`, severity: "blocker", basis: "accuracy", message: `Check the ${label}: "${a.value}".`, why: "The AI inferred this from your photo. Confirm it or correct it so the listing is accurate.", target: "specifics", fix: `attr:${a.key}` });
    else if (!a.required && a.source === "ai-inferred" && a.value.trim() && !a.confirmed)
      add({ id: `attr-${a.key}`, severity: "suggestion", message: `${a.label} "${a.value}" was inferred by AI. Confirm it to include it in the listing.`, why: "Unconfirmed AI guesses are left out of your listing until you check them.", target: "specifics", fix: `attr:${a.key}` });
  }

  const c = draft.condition;
  if (!c.grade)
    add({ id: "condition-grade", severity: "blocker", basis: "marketplace", message: "Choose the item's condition.", why: "Every marketplace requires a condition, and it decides which price comparisons apply.", fix: "condition-grade" });
  else if (c.gradeSource === "ai-inferred" && !c.confirmed)
    add({ id: "condition-grade", severity: "blocker", basis: "accuracy", message: `Check the condition: the AI suggested "${gradeLabel[c.grade]}".`, why: "Condition was inferred from your photo. Confirm it so buyers get what they expect.", fix: "condition-grade" });
  // Flaws only matter for items that aren't new; a new item's condition is described by its grade and packaging.
  if (c.grade && c.grade !== "new" && !c.defects.trim() && !c.noKnownDefects)
    add({ id: "condition-defects", severity: "blocker", basis: "accuracy", message: "Describe any flaws, or confirm there are none you know of.", why: "Pre-owned listings must disclose wear; undisclosed flaws lead to returns and disputes.", fix: "condition-flaws" });
  if (c.grade === "new" && !c.packaging)
    add({ id: "condition-packaging", severity: "suggestion", message: "Say whether the original box is included.", why: "\"New with box\" is one of the first things buyers look for.", fix: "condition-grade" });

  const needsIncluded = ["electronics", "instrument", "collectible"].includes(draft.category);
  if (needsIncluded && !draft.includedItems.confirmed)
    add({ id: "included", severity: "blocker", basis: "accuracy", message: "Confirm what's included (write \"Item only\" if nothing else).", why: "Buyers of electronics, instruments and collectibles price on completeness.", fix: "included" });
  else if (draft.includedItems.value.trim() && !draft.includedItems.confirmed)
    add({ id: "included", severity: "warning", message: "Included items were inferred by AI; confirm them to mention them in the listing.", fix: "included" });

  const audits = auditDraftText(draft);
  if (!draft.title.value.trim()) add({ id: "title", severity: "blocker", basis: "marketplace", message: "Add a title.", why: "Every listing needs a title.", fix: "title" });
  if (draft.title.value.length > profile.titleLimit)
    add({ id: "title-length", severity: "blocker", basis: "marketplace", message: `Shorten the title to ${profile.titleLimit} characters.`, why: `${profile.label} rejects longer titles.`, fix: "title" });
  issues.push(...textIssues("title", "Title", "title", audits.title, draft.title.source === "user-edited"));
  if (!draft.description.value.trim()) add({ id: "description", severity: "blocker", basis: "marketplace", message: "Add a description.", why: "Every listing needs a description.", fix: "description" });
  if (profile.descriptionLimit && draft.description.value.length > profile.descriptionLimit)
    add({ id: "description-length", severity: "blocker", basis: "marketplace", message: `Shorten the description to ${profile.descriptionLimit.toLocaleString()} characters.`, why: `${profile.label} limits description length.`, fix: "description" });
  issues.push(...textIssues("description", "Description", "description", audits.description, draft.description.source === "user-edited"));
  issues.push(...textIssues("condition-text", "Condition note", "condition", audits.condition, c.descriptionSource === "user-edited"));

  if (!draft.photos.some((p) => p.selected) && !draft.ebay.imageUrls.length)
    add({ id: "photos", severity: "blocker", basis: "marketplace", message: "Select at least one photo.", why: "Listings need at least one photo.", fix: "photos" });

  const p = draft.pricing;
  if (p.price === null || !(p.price > 0)) {
    const supported = p.evidence.some((e) => e.status === "supported");
    add({ id: "price", severity: "blocker", basis: "marketplace", message: supported ? "Set a price." : "Set a price (there wasn't enough market evidence to suggest one).", why: "A fixed-price listing needs a price.", fix: "price" });
  } else if (p.priceSource !== "manual" && p.priceProvider) {
    const e = p.evidence.find((x) => x.provider === p.priceProvider);
    if (e && conditionFit(e, c.grade) === "mismatch")
      add({ id: "price-condition", severity: "blocker", basis: "accuracy", message: `The suggested price comes from ${e.conditionCohort} listings, but this item is ${gradeLabel[c.grade] || c.grade}. Set your own price.`, why: "Prices from a different condition group would misprice this item.", fix: "price" });
    if (e && evidenceStale(e, now))
      add({ id: "price-stale", severity: "warning", message: `Market prices were retrieved ${e.retrievedAt ? new Date(e.retrievedAt).toLocaleDateString() : "earlier"} and may be out of date.`, why: "Re-run the analysis for current asking prices.", fix: "price" });
  }

  // Package details: eBay takes shipping from the seller's shipping policy (checked with the eBay rules), and
  // Facebook/other are often local. Mercari prints its label from the weight, so suggest it there.
  const s = draft.shipping;
  if (marketplace === "mercari" && s.whoPays !== "local-pickup" && !s.weightLb.trim() && !s.weightOz.trim())
    add({ id: "shipping-weight", severity: "suggestion", message: "Add the packed weight for Mercari's prepaid label.", why: "Mercari prices its shipping label by weight.", fix: "package" });

  const blockers = issues.filter((x) => x.severity === "blocker");
  return {
    publishable: blockers.length === 0,
    blockers,
    warnings: issues.filter((x) => x.severity === "warning"),
    suggestions: issues.filter((x) => x.severity === "suggestion"),
  };
}

export type Readiness = ReturnType<typeof assessListing>;
