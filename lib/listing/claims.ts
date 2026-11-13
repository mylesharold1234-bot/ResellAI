import type { ListingDraft } from "./types";

export type ClaimIssue = { severity: "error" | "warning"; code: string; message: string };

export type ListingFacts = {
  /** Lower-cased concatenation of every confirmed or identified value; used to check that specs are grounded. */
  corpus: string;
  size: string;
  grade: ListingDraft["condition"]["grade"];
  packaging: ListingDraft["condition"]["packaging"];
  defects: string;
  functionalStatus: string;
  includedItems: string;
};

export function listingFacts(draft: ListingDraft): ListingFacts {
  const i = draft.identification;
  const attr = (key: string) => draft.attributes.find((a) => a.key === key)?.value || "";
  const corpus = [
    ...draft.attributes.map((a) => a.value),
    i.brand,
    i.model,
    i.productName,
    i.category,
    i.colorway,
    i.identifyingInformation,
    draft.details.variant,
    draft.details.productIdentifier,
    draft.includedItems.value,
    draft.condition.defects,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    corpus,
    size: attr("size").trim().toLowerCase(),
    grade: draft.condition.grade,
    packaging: draft.condition.packaging,
    defects: draft.condition.defects.trim(),
    functionalStatus: attr("functionalStatus"),
    includedItems: draft.includedItems.value.toLowerCase(),
  };
}

const sizeToken = (v: string) => v.toLowerCase().replace(/^0+(?=\d)/, "").replace(/\.0$/, "");

/**
 * Check generated or edited listing text against the facts the seller has confirmed.
 * Errors are claims a buyer could rely on that nothing in the draft supports.
 */
export function auditText(text: string, facts: ListingFacts): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  const add = (severity: ClaimIssue["severity"], code: string, message: string) => {
    if (!issues.some((x) => x.code === code)) issues.push({ severity, code, message });
  };
  const t = text.toLowerCase();
  if (!t.trim()) return issues;

  if (/\b(authentic|authenticity|genuine|legit|100%\s*real|not fake|certified)\b/.test(t))
    add("error", "authenticity", "Mentions authenticity. ResellAI can't verify authenticity from photos; remove the claim (eBay's Authenticity Guarantee is applied by eBay, not the seller).");

  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/|www\.|\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}|\b(venmo|cash ?app|zelle|text me|call me)\b/.test(t))
    add("error", "off-platform", "Contains contact details, links or off-platform payment wording, which marketplaces prohibit.");

  const sizes = [
    ...t.matchAll(/\b(?:size|sz)\s*:?\s*(\d{1,2}(?:\.5)?|xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl)\b/g),
    ...t.matchAll(/\b(?:men'?s|women'?s|mens|womens|youth)\s+(\d{1,2}(?:\.5)?)\b/g),
  ].map((m) => sizeToken(m[1]));
  if (sizes.length) {
    if (!facts.size) add("error", "size-unconfirmed", "States a size, but no size has been confirmed.");
    else if (sizes.some((s) => s !== sizeToken(facts.size))) add("error", "size-mismatch", `States a size that differs from the confirmed size (${facts.size}).`);
  }

  const newClaim = /\b(brand new|new with box|new with tags|new in box|nwt|nib|bnib|nwob|deadstock|unworn|never worn|never used|factory sealed|sealed)\b/.test(t) || /\bds\b/.test(t);
  if (newClaim && facts.grade !== "new")
    add("error", "condition-contradiction", "Describes the item as new or unused, but the confirmed condition is not new.");
  if (/\b(flawless|perfect condition|no flaws|mint condition|no signs of wear)\b/.test(t) && (facts.defects || facts.grade !== "new"))
    add("error", "condition-overstated", "Overstates condition (e.g. flawless or mint) relative to the confirmed condition or listed flaws.");

  if (/\b(with (the )?(original )?box|original box|og box|og all|new in box|nib|bnib|comes with box|in box)\b/.test(t) && facts.packaging !== "original")
    add("error", "packaging", "Mentions the original box, but original packaging hasn't been confirmed.");
  if (/\b(no box|without (the )?(original )?box|missing box)\b/.test(t) && facts.packaging === "original")
    add("error", "packaging", "Says there is no box, but original packaging was confirmed.");

  if (/\b((?<!un)tested|fully functional|fully working|works (perfectly|great|fine|as it should)|in working (order|condition)|powers on|turns on)\b/.test(t) && !/(?<!un)tested|working|works|functional/i.test(facts.functionalStatus))
    add("error", "functional-claim", "Claims the item was tested or works, but no functional status has been confirmed.");

  for (const m of t.matchAll(/\b(\d+)\s?(gb|tb)\b/g))
    if (!new RegExp(`\\b${m[1]}\\s?${m[2]}\\b`).test(facts.corpus))
      add("error", "spec-unsupported", `States ${m[1]} ${m[2].toUpperCase()} storage, which isn't in the confirmed details.`);

  for (const m of text.matchAll(/\b[A-Z0-9]{2,6}-\d{3}\b/g))
    if (!facts.corpus.includes(m[0].toLowerCase()))
      add("error", "identifier-unsupported", `States identifier ${m[0]}, which isn't in the confirmed details.`);

  for (const m of t.matchAll(/\b(receipt|original tags|dust ?bag|charger|charging cable|controllers?|carrying case|hard case|manual|extra laces|remote)\b/g))
    if (!facts.includedItems.includes(m[1].replace(/s$/, "")))
      add("warning", "accessory-unlisted", `Mentions "${m[1]}", which isn't in the confirmed included items.`);

  for (const m of t.matchAll(/\b(19[5-9]\d|20[0-3]\d)\b/g))
    if (!facts.corpus.includes(m[1])) add("warning", "year-unsupported", `Mentions ${m[1]}, which isn't in the confirmed details.`);

  return issues;
}

export function auditDraftText(draft: ListingDraft) {
  const facts = listingFacts(draft);
  return {
    title: auditText(draft.title.value, facts),
    description: auditText(draft.description.value, facts),
    condition: auditText(draft.condition.description, facts),
  };
}
