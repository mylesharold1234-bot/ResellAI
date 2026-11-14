"use client";
import { useState } from "react";
import { AlertTriangle, Check, CircleDot, Lightbulb, Sparkles } from "lucide-react";
import { compatibleConditions } from "../../lib/ebay-seller/payload";
import { confirmAttribute, editAttribute } from "../../lib/listing/draft";
import type { ReadinessIssue } from "../../lib/listing/readiness";
import type { AttributeKey, ListingDraft } from "../../lib/listing/types";
import type { GeneratedField } from "../../lib/listing/apply";
import { ConnectEbayButton, PoliciesAndLocation } from "./seller-settings";
import type { EbaySeller } from "./use-ebay-seller";

export type FixContext = {
  draft: ListingDraft;
  update: (fn: (d: ListingDraft) => ListingDraft) => void;
  seller: EbaySeller | null;
  generate: (fields: GeneratedField[], overwrite: boolean) => Promise<void> | void;
  busy: boolean;
  beforeLeave?: () => Promise<void>;
  /** Scroll to and focus part of the page (closing the review if needed). */
  jump: (target: string) => void;
};

const gradeOptions: [ListingDraft["condition"]["grade"], string][] = [
  ["new", "New"],
  ["used", "Used / pre-owned"],
  ["refurbished", "Refurbished"],
  ["parts", "For parts / not working"],
];

/** Commit a condition grade the seller chose (or confirmed): it becomes seller-verified. */
export const setGrade = (d: ListingDraft, grade: ListingDraft["condition"]["grade"]): ListingDraft => ({
  ...d,
  condition: { ...d.condition, grade, gradeSource: grade ? "user-confirmed" : "missing", confirmed: !!grade },
});

function AttrFix({ k, ctx }: { k: AttributeKey; ctx: FixContext }) {
  const a = ctx.draft.attributes.find((x) => x.key === k);
  const [value, setValue] = useState(a?.value || "");
  if (!a) return null;
  const unconfirmed = a.source === "ai-inferred" && !a.confirmed && !!a.value.trim();
  const commit = (v: string) => ctx.update((d) => editAttribute(d, k, v));
  const list = k === "department" ? ["Men", "Women", "Unisex", "Youth"] : [];
  return (
    <div className="lx-fix-row">
      <input
        aria-label={a.label}
        className="lx-input"
        list={list.length ? `fix-list-${k}` : undefined}
        value={value}
        placeholder={a.hint || a.label}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() !== a.value.trim() && commit(value)}
        onKeyDown={(e) => e.key === "Enter" && commit(value)}
      />
      {list.length > 0 && <datalist id={`fix-list-${k}`}>{list.map((v) => <option key={v} value={v} />)}</datalist>}
      {unconfirmed && value.trim() === a.value.trim() ? (
        <button type="button" className="mini-button primary" onClick={() => ctx.update((d) => confirmAttribute(d, k))}><Check size={13} /> Looks right</button>
      ) : (
        <button type="button" className="mini-button primary" disabled={!value.trim()} onClick={() => commit(value)}>Save</button>
      )}
    </div>
  );
}

function ConditionFix({ ctx }: { ctx: FixContext }) {
  const c = ctx.draft.condition;
  return (
    <div className="lx-fix-row wrap">
      <select aria-label="Condition" className="lx-input" value={c.grade} onChange={(e) => ctx.update((d) => setGrade(d, e.target.value as ListingDraft["condition"]["grade"]))}>
        <option value="">Choose condition…</option>
        {gradeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {c.grade === "new" && (
        <select aria-label="Original box" className="lx-input" value={c.packaging} onChange={(e) => ctx.update((d) => ({ ...d, condition: { ...d.condition, packaging: e.target.value as ListingDraft["condition"]["packaging"] } }))}>
          <option value="">Box: not specified</option>
          <option value="original">With original box</option>
          <option value="none">Without box</option>
        </select>
      )}
      {c.grade && c.gradeSource === "ai-inferred" && !c.confirmed && (
        <button type="button" className="mini-button primary" onClick={() => ctx.update((d) => setGrade(d, d.condition.grade))}><Check size={13} /> Looks right</button>
      )}
    </div>
  );
}

function FlawsFix({ ctx }: { ctx: FixContext }) {
  const c = ctx.draft.condition;
  const [text, setText] = useState(c.defects);
  return (
    <div>
      <div className="lx-fix-row">
        <input aria-label="Flaws" className="lx-input" value={text} placeholder={ctx.draft.category === "footwear" ? "e.g. light creasing on the toe box" : "e.g. light scuffs, small scratch"} onChange={(e) => setText(e.target.value)} onBlur={() => ctx.update((d) => ({ ...d, condition: { ...d.condition, defects: text, noKnownDefects: text.trim() ? false : d.condition.noKnownDefects } }))} />
        <button type="button" className="mini-button primary" disabled={!text.trim()} onClick={() => ctx.update((d) => ({ ...d, condition: { ...d.condition, defects: text, noKnownDefects: false } }))}>Save</button>
      </div>
      <button type="button" className="text-link lx-small" onClick={() => ctx.update((d) => ({ ...d, condition: { ...d.condition, defects: "", noKnownDefects: true } }))}>No flaws I know of</button>
    </div>
  );
}

function PriceFix({ ctx }: { ctx: FixContext }) {
  const p = ctx.draft.pricing;
  const [value, setValue] = useState(p.price === null ? "" : String(p.price));
  const commit = (v: string) => {
    const n = Number(v);
    if (v.trim() && Number.isFinite(n) && n > 0) ctx.update((d) => ({ ...d, pricing: { ...d.pricing, price: Math.round(n * 100) / 100, priceSource: "manual", priceProvider: null } }));
  };
  return (
    <div className="lx-fix-row">
      <span className="lx-prefix">$</span>
      <input aria-label="Price" className="lx-input" inputMode="decimal" value={value} placeholder="0.00" onChange={(e) => setValue(e.target.value)} onBlur={() => commit(value)} onKeyDown={(e) => e.key === "Enter" && commit(value)} />
      <button type="button" className="mini-button primary" onClick={() => commit(value)}>Set price</button>
    </div>
  );
}

function IncludedFix({ ctx }: { ctx: FixContext }) {
  const i = ctx.draft.includedItems;
  const [value, setValue] = useState(i.value);
  return (
    <div className="lx-fix-row">
      <input aria-label="Included items" className="lx-input" value={value} placeholder='e.g. "Item only" or "controller, HDMI cable"' onChange={(e) => setValue(e.target.value)} />
      <button type="button" className="mini-button primary" disabled={!value.trim()} onClick={() => ctx.update((d) => ({ ...d, includedItems: { value, source: value === d.includedItems.value ? d.includedItems.source : "user-confirmed", confirmed: true } }))}>
        <Check size={13} /> That's what's included
      </button>
    </div>
  );
}

function PackageFix({ ctx }: { ctx: FixContext }) {
  const s = ctx.draft.shipping;
  const set = (k: keyof ListingDraft["shipping"], v: string) => ctx.update((d) => ({ ...d, shipping: { ...d.shipping, [k]: v } }));
  return (
    <div className="lx-fix-grid">
      {(
        [
          ["weightLb", "lb"],
          ["weightOz", "oz"],
          ["length", "L in"],
          ["width", "W in"],
          ["height", "H in"],
        ] as const
      ).map(([k, l]) => (
        <label key={k} className="lx-mini-field"><span>{l}</span><input inputMode="decimal" value={s[k] as string} onChange={(e) => set(k, e.target.value)} /></label>
      ))}
    </div>
  );
}

function CategoryFix({ ctx }: { ctx: FixContext }) {
  const seller = ctx.seller!;
  const [q, setQ] = useState(ctx.draft.identification.productName || ctx.draft.title.value || "");
  return (
    <div>
      <div className="lx-fix-row">
        <input aria-label="Search eBay categories" className="lx-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void seller.searchCategories(q, false)} />
        <button type="button" className="mini-button" onClick={() => void seller.searchCategories(q, false)}>Find</button>
      </div>
      {seller.categories.length > 0 && (
        <div className="lx-chips">
          {seller.categories.slice(0, 6).map((c) => (
            <button type="button" key={c.id} className="lx-chip" aria-pressed={ctx.draft.ebay.categoryId === c.id} onClick={() => seller.setEbay({ categoryId: c.id, categoryName: c.path })}>{c.path.split(/ [›>] /).slice(-2).join(" › ") || c.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function EbayConditionFix({ ctx }: { ctx: FixContext }) {
  const rules = ctx.seller?.rules;
  if (!rules) return <p className="lx-muted">Loading eBay's conditions for this category…</p>;
  const options = compatibleConditions(ctx.draft, rules.conditions).length ? compatibleConditions(ctx.draft, rules.conditions) : rules.conditions;
  return (
    <select aria-label="eBay condition" className="lx-input" value={ctx.draft.ebay.conditionId || ""} onChange={(e) => ctx.seller!.setEbay({ conditionId: e.target.value })}>
      <option value="">Choose…</option>
      {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function AspectFix({ name, ctx }: { name: string; ctx: FixContext }) {
  const meta = ctx.seller?.rules?.aspects.find((a) => a.name === name);
  const value = ctx.draft.ebay.extraAspects?.[name] || "";
  const set = (v: string) => ctx.seller!.setEbay({ extraAspects: { ...(ctx.draft.ebay.extraAspects || {}), [name]: v } });
  if (meta?.mode === "SELECTION_ONLY" && meta.values.length)
    return (
      <select aria-label={name} className="lx-input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Choose…</option>
        {meta.values.map((v) => <option key={v}>{v}</option>)}
      </select>
    );
  return (
    <>
      <input aria-label={name} className="lx-input" list={`asp-${name}`} value={value} onChange={(e) => set(e.target.value)} />
      <datalist id={`asp-${name}`}>{(meta?.values || []).slice(0, 50).map((v) => <option key={v} value={v} />)}</datalist>
    </>
  );
}

/** The inline control that resolves one requirement, so the seller never has to hunt for the field. */
export function RequirementFix({ issue, ctx }: { issue: ReadinessIssue; ctx: FixContext }) {
  const fix = issue.fix || "";
  if (fix.startsWith("attr:")) return <AttrFix k={fix.slice(5) as AttributeKey} ctx={ctx} />;
  if (fix.startsWith("ebay-aspect:")) return <AspectFix name={fix.slice("ebay-aspect:".length)} ctx={ctx} />;
  switch (fix) {
    case "condition-grade":
      return <ConditionFix ctx={ctx} />;
    case "condition-flaws":
      return <FlawsFix ctx={ctx} />;
    case "price":
      return <PriceFix ctx={ctx} />;
    case "included":
      return <IncludedFix ctx={ctx} />;
    case "package":
      return <PackageFix ctx={ctx} />;
    case "title":
    case "description":
    case "condition-text":
      return (
        <div className="lx-fix-row">
          <button type="button" className="mini-button primary" disabled={ctx.busy} onClick={() => void ctx.generate([fix === "condition-text" ? "condition" : (fix as GeneratedField)], true)}>
            <Sparkles size={13} /> {ctx.busy ? "Writing…" : "Rewrite with AI"}
          </button>
          <button type="button" className="mini-button" onClick={() => ctx.jump(fix === "condition-text" ? "condition" : fix)}>Edit it myself</button>
        </div>
      );
    case "photos":
      return <button type="button" className="mini-button" onClick={() => ctx.jump("photos")}>Choose photos</button>;
    case "ebay-photo-urls":
      return <button type="button" className="mini-button" onClick={() => ctx.jump("ebay-details")}>Fix photo links</button>;
    case "marketplace":
      return <button type="button" className="mini-button primary" onClick={() => ctx.update((d) => ({ ...d, marketplace: "ebay" }))}>Switch to eBay</button>;
    case "ebay-connect":
      return <ConnectEbayButton draftId={ctx.draft.id} beforeLeave={ctx.beforeLeave} compact />;
    case "ebay-category":
      return ctx.seller ? <CategoryFix ctx={ctx} /> : null;
    case "ebay-condition":
      return <EbayConditionFix ctx={ctx} />;
    case "ebay-policies":
      return ctx.seller ? <PoliciesAndLocation draft={ctx.draft} seller={ctx.seller} only="policies" /> : null;
    case "ebay-location":
      return ctx.seller ? <PoliciesAndLocation draft={ctx.draft} seller={ctx.seller} only="location" /> : null;
    default:
      return null;
  }
}

/** A compact checklist of requirements, each with its reason and inline fix. */
export function RequirementList({ issues, ctx, kind }: { issues: ReadinessIssue[]; ctx: FixContext; kind: "blocker" | "optional" }) {
  if (!issues.length) return null;
  return (
    <ul className={`lx-reqs ${kind}`}>
      {issues.map((i) => (
        <li key={i.id} className="lx-req">
          <span className="lx-req-icon" aria-hidden="true">
            {kind === "blocker" ? <CircleDot size={15} /> : i.severity === "warning" ? <AlertTriangle size={15} /> : <Lightbulb size={15} />}
          </span>
          <div className="lx-req-body">
            <p className="lx-req-msg">{i.message}</p>
            {i.why && <p className="lx-req-why">{i.why}</p>}
            <RequirementFix issue={i} ctx={ctx} />
          </div>
        </li>
      ))}
    </ul>
  );
}
