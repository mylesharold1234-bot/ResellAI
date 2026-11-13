import { auditDraftText, type ClaimIssue } from "./claims";
import { marketplaces } from "./categories";
import { conditionFit, evidenceStale } from "./pricing";
import type { ListingDraft, ListingMarketplace } from "./types";

export type ReadinessIssue = { id: string; severity: "blocker" | "warning"; message: string; target: string };

const gradeLabel: Record<string, string> = { new: "new", used: "used", refurbished: "refurbished", parts: "for parts" };

function textIssues(id: string, label: string, target: string, issues: ClaimIssue[], userEdited: boolean): ReadinessIssue[] {
  return issues.map((x) => ({
    id: `${id}-${x.code}`,
    // A seller's own wording is their responsibility: surface it, but don't block on it.
    severity: x.severity === "error" && !userEdited ? "blocker" : "warning",
    message: `${label}: ${x.message}`,
    target,
  }));
}

/** Everything the seller still has to supply or confirm before the listing is publishable on `marketplace`. */
export function assessListing(draft: ListingDraft, marketplace: ListingMarketplace = draft.marketplace, now = Date.now()) {
  const issues: ReadinessIssue[] = [];
  const add = (id: string, severity: ReadinessIssue["severity"], message: string, target: string) => issues.push({ id, severity, message, target });
  const profile = marketplaces[marketplace];

  for (const a of draft.attributes) {
    if (!a.required) continue;
    if (a.source === "missing" || !a.value.trim()) add(`attr-${a.key}`, "blocker", `Add ${a.label.toLowerCase()}${a.hint ? ` — ${a.hint}` : "."}`, `attr-${a.key}`);
    else if (a.source === "ai-inferred" && !a.confirmed) add(`attr-${a.key}`, "blocker", `Confirm ${a.label.toLowerCase()} (AI-inferred: "${a.value}").`, `attr-${a.key}`);
  }
  for (const a of draft.attributes)
    if (!a.required && a.source === "ai-inferred" && a.value.trim() && !a.confirmed)
      add(`attr-${a.key}`, "warning", `${a.label} "${a.value}" is AI-inferred; confirm or clear it.`, `attr-${a.key}`);

  const c = draft.condition;
  if (!c.grade) add("condition-grade", "blocker", "Choose the item's condition.", "condition");
  if (!c.description.trim()) add("condition-description", "blocker", "Add a condition description (generate one or write your own).", "condition");
  if (!c.defects.trim() && !c.noKnownDefects) add("condition-defects", "blocker", "List any flaws, or confirm there are none you know of.", "condition");
  if (!c.confirmed) add("condition-confirmed", "blocker", "Confirm the condition details are accurate.", "condition");

  const needsIncluded = ["electronics", "instrument", "collectible"].includes(draft.category);
  if (needsIncluded && !draft.includedItems.confirmed)
    add("included", "blocker", "Confirm what's included (write \"Item only\" if nothing else).", "included");
  else if (draft.includedItems.value.trim() && !draft.includedItems.confirmed)
    add("included", "warning", "Included items were inferred by AI; confirm them before listing.", "included");

  const audits = auditDraftText(draft);
  if (!draft.title.value.trim()) add("title", "blocker", "Generate or write a title.", "title");
  if (draft.title.value.length > profile.titleLimit) add("title-length", "blocker", `Shorten the title to ${profile.titleLimit} characters for ${profile.label}.`, "title");
  issues.push(...textIssues("title", "Title", "title", audits.title, draft.title.source === "user-edited"));
  if (!draft.description.value.trim()) add("description", "blocker", "Generate or write a description.", "description");
  if (profile.descriptionLimit && draft.description.value.length > profile.descriptionLimit)
    add("description-length", "blocker", `Shorten the description to ${profile.descriptionLimit.toLocaleString()} characters for ${profile.label}.`, "description");
  issues.push(...textIssues("description", "Description", "description", audits.description, draft.description.source === "user-edited"));
  issues.push(...textIssues("condition-text", "Condition description", "condition", audits.condition, c.descriptionSource === "user-edited"));

  if (!draft.photos.some((p) => p.selected)) add("photos", "blocker", "Select at least one photo.", "photos");

  const p = draft.pricing;
  if (p.price === null || !(p.price > 0)) {
    const supported = p.evidence.some((e) => e.status === "supported");
    add("price", "blocker", supported ? "Choose a price." : "Pricing evidence is insufficient; enter a price manually.", "pricing");
  } else if (p.priceSource !== "manual" && p.priceProvider) {
    const e = p.evidence.find((x) => x.provider === p.priceProvider);
    if (e && conditionFit(e, c.grade) === "mismatch")
      add("price-condition", "blocker", `This price is based on ${e.conditionCohort} listings, but you're listing the item as ${gradeLabel[c.grade] || c.grade}. Enter a price manually.`, "pricing");
    if (e && evidenceStale(e, now))
      add("price-stale", "warning", `Price evidence was retrieved ${e.retrievedAt ? new Date(e.retrievedAt).toLocaleDateString() : "earlier"} and has expired; refresh the analysis or review the price.`, "pricing");
  }

  const s = draft.shipping;
  if (profile.requiresShipping && s.whoPays !== "local-pickup") {
    const missing = [!s.weightLb.trim() && !s.weightOz.trim() && "package weight", !(s.length.trim() && s.width.trim() && s.height.trim()) && "package dimensions", !s.handlingDays.trim() && "handling time", !s.whoPays && "who pays shipping"].filter(Boolean);
    if (missing.length) add("shipping", "blocker", `Add ${missing.join(", ")}.`, "shipping");
    else if (!s.confirmed) add("shipping-confirmed", "blocker", "Confirm the shipping details after weighing and measuring the packed item.", "shipping");
  }

  const blockers = issues.filter((x) => x.severity === "blocker");
  return { publishable: blockers.length === 0, blockers, warnings: issues.filter((x) => x.severity === "warning") };
}
