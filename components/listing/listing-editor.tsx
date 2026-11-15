"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, ChevronRight, Download, ImageUp, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { applyGenerated, editConditionText, editText, generatedFields, refreshPlan, type GeneratedField, type GeneratedListing } from "../../lib/listing/apply";
import { buildAspects, mergeRequirements } from "../../lib/ebay-seller/payload";
import { marketplaces } from "../../lib/listing/categories";
import { confirmAttribute, editAttribute, upgradeDraft } from "../../lib/listing/draft";
import { getDraft, getPhotos, saveDraft, storageIsPersistent } from "../../lib/listing/drafts-store";
import { exportListing } from "../../lib/listing/export";
import { assessListing, type ReadinessIssue } from "../../lib/listing/readiness";
import { factsKey, type GeneratedTextField } from "../../lib/listing/template";
import type { ListingAttribute, ListingDraft, ListingMarketplace } from "../../lib/listing/types";
import { CopyButton, dollars } from "./listing-bits";
import { ListingPricingSection } from "./listing-pricing";
import { RequirementFix, setGrade, type FixContext } from "./requirement-fix";
import { downloadText, ReviewDialog } from "./review-dialog";
import { ConnectionRow, PoliciesAndLocation, sellerSummary } from "./seller-settings";
import { useEbaySeller, type EbaySeller } from "./use-ebay-seller";

type SaveState = "loading" | "saved" | "saving" | "error";
type Update = (fn: (d: ListingDraft) => ListingDraft) => void;

/** Loads the draft (upgrading older saved drafts without touching seller input), then renders the workspace. */
export function ListingEditor({ id }: { id: string }) {
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [save, setSave] = useState<SaveState>("loading");
  const [persistent, setPersistent] = useState(true);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const loaded = useRef(false);

  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    (async () => {
      try {
        const [d, photos, persists] = await Promise.all([getDraft(id), getPhotos(id), storageIsPersistent()]);
        if (cancelled) return;
        if (!d) return setLoadError("This listing wasn't found in this browser. Listings are saved on the device where you created them.");
        urls = photos.map((p) => URL.createObjectURL(p.blob));
        setPhotoUrls(Object.fromEntries(photos.map((p, i) => [p.photoId, urls[i]])));
        setPersistent(persists);
        setDraft(upgradeDraft(d));
        setSave("saved");
        loaded.current = true;
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not open this listing.");
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [id]);

  // Autosave: every change is written to browser storage shortly after the seller stops typing.
  useEffect(() => {
    if (!draft || !loaded.current) return;
    setSave("saving");
    const t = setTimeout(() => saveDraft(draft).then(() => setSave("saved"), () => setSave("error")), 500);
    return () => clearTimeout(t);
  }, [draft]);

  // Save immediately when leaving (e.g. eBay sign-in redirect, tab close) so the last edits aren't lost.
  const latest = useRef<ListingDraft | null>(null);
  latest.current = draft;
  const flush = useCallback(async () => {
    if (latest.current && loaded.current) await saveDraft(latest.current);
  }, []);
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  const update = useCallback<Update>((fn) => setDraft((d) => (d ? { ...fn(d), updatedAt: new Date().toISOString() } : d)), []);

  if (loadError)
    return (
      <section className="wrap workspace narrow">
        <h1 className="page-title">Listing not found</h1>
        <p className="muted">{loadError}</p>
        <p className="block"><Link className="button" href="/listings">Back to listings</Link></p>
      </section>
    );
  if (!draft) return <section className="wrap workspace" aria-busy="true"><p className="muted">Opening listing…</p></section>;
  return <ListingWorkspace draft={draft} update={update} setDraft={setDraft} photoUrls={photoUrls} save={save} persistent={persistent} flush={flush} />;
}

function ListingWorkspace({
  draft,
  update,
  setDraft,
  photoUrls,
  save,
  persistent,
  flush,
}: {
  draft: ListingDraft;
  update: Update;
  setDraft: React.Dispatch<React.SetStateAction<ListingDraft | null>>;
  photoUrls: Record<string, string>;
  save: SaveState;
  persistent: boolean;
  flush: () => Promise<void>;
}) {
  const seller = useEbaySeller({ draft, onChange: update });
  const isEbay = draft.marketplace === "ebay";
  const [busy, setBusy] = useState<GeneratedField[] | null>(null);
  const [genNote, setGenNote] = useState<{ source: string; warnings: string[] } | null>(null);
  const [genError, setGenError] = useState("");
  const [review, setReview] = useState<null | "review" | "fix">(null);
  const latest = useRef(draft);
  latest.current = draft;
  const busyRef = useRef(false);

  const generate = useCallback(
    async (fields: GeneratedField[], overwriteUserEdits: boolean) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(fields);
      setGenError("");
      const sent = latest.current;
      try {
        const response = await fetch("/api/listings/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: sent, fields, marketplace: sent.marketplace }),
          signal: AbortSignal.timeout(50000),
        });
        const body = (await response.json().catch(() => null)) as { listing?: GeneratedListing; error?: string } | null;
        if (!response.ok || !body?.listing) throw new Error(body?.error || "Writing failed. Try again.");
        const listing = body.listing;
        // Facts are recorded from the draft that was sent: if the seller changed something meanwhile,
        // the text is detected as out of date and refreshed again.
        setDraft((d) => (d ? applyGenerated(d, listing, fields, { overwriteUserEdits, writtenFrom: sent }) : d));
        setGenNote({ source: listing.source, warnings: listing.warnings });
      } catch (e) {
        setGenError(e instanceof Error && e.name === "TimeoutError" ? "Writing took too long. Try again." : e instanceof Error ? e.message : "Writing failed.");
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [setDraft],
  );

  // The listing is written for the seller as soon as the draft opens.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (!draft.title.value.trim() && !draft.description.value.trim()) void generate(generatedFields, false);
  }, [draft.title.value, draft.description.value, generate]);

  // When confirmed details change, AI-written text is rewritten automatically (debounced). Text the seller edited
  // is never overwritten; it's flagged instead. Each set of facts is tried once, so a failure can't loop.
  const plan = refreshPlan(draft);
  const attempted = useRef<Record<string, string>>({});
  const autoKey = plan.automatic.map((f) => `${f}=${factsKey(draft, f)}`).join("|");
  useEffect(() => {
    if (!autoKey || busy) return;
    const fields = plan.automatic.filter((f) => attempted.current[f] !== autoKey);
    if (!fields.length) return;
    const t = setTimeout(() => {
      fields.forEach((f) => (attempted.current[f] = autoKey));
      void generate(fields, false);
    }, 1200);
    return () => clearTimeout(t);
    // plan.automatic is derived from autoKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, busy, generate]);

  const readiness = useMemo(() => assessListing(draft), [draft]);
  // Every requirement appears once: a detail both ResellAI and eBay need (e.g. size) is a single item.
  const blockers = useMemo(() => mergeRequirements(readiness.blockers, isEbay ? seller.requirements : []), [readiness, seller.requirements, isEbay]);
  const optional = useMemo(() => [...readiness.warnings, ...readiness.suggestions], [readiness]);

  const jump = useCallback((target: string) => {
    setReview(null);
    requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
    });
  }, []);

  const ctx: FixContext = { draft, update, seller: isEbay ? seller : null, generate, busy: !!busy, beforeLeave: flush, jump };
  const selected = draft.photos.filter((p) => p.selected);
  const mainPhoto = selected[0] ? photoUrls[selected[0].id] : undefined;
  const published = draft.ebay.publish?.status === "published";
  const summary = isEbay ? sellerSummary(draft, seller) : "";

  const setMarketplace = (m: ListingMarketplace) =>
    update((d) => ({ ...d, marketplace: m, pricing: { ...d.pricing, feeMode: m === "ebay" && d.category === "footwear" ? d.pricing.feeMode : "custom" } }));

  return (
    <section className="wrap lx-page">
      <div className="lx-topbar">
        <Link className="back" href="/listings">← Listings</Link>
        <span className="lx-save" role="status">
          {save === "saving" ? "Saving…" : save === "error" ? "Couldn't save" : persistent ? "Saved" : "Saved for this tab"}
        </span>
        <div className="segmented" role="group" aria-label="Sell on">
          {(Object.keys(marketplaces) as ListingMarketplace[]).map((m) => (
            <button key={m} type="button" aria-pressed={draft.marketplace === m} onClick={() => setMarketplace(m)}>
              {m === "other" ? "Other" : marketplaces[m].label}
            </button>
          ))}
        </div>
      </div>

      {seller.flash && isEbay && <p className="tip" role="status">{seller.flash}</p>}
      {seller.error && isEbay && <p className="error" role="alert">{seller.error}</p>}

      <div className="lx-layout">
        <PhotoPanel draft={draft} photoUrls={photoUrls} jump={jump} />

        <div className="lx-sheet">
          <ListingCopy draft={draft} update={update} busy={busy} generate={generate} genNote={genNote} genError={genError} needsApproval={plan.needsApproval} />

          <div className="lx-actionbar">
            {published ? (
              <span className="lx-status-text ok"><Check size={16} aria-hidden="true" /> Published</span>
            ) : blockers.length ? (
              <button type="button" className="lx-needed" onClick={() => setReview("fix")}>
                <span className="lx-dot" aria-hidden="true" /> {blockers.length} detail{blockers.length === 1 ? "" : "s"} needed <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <span className="lx-status-text ok"><Check size={16} aria-hidden="true" /> Ready</span>
            )}
            <button type="button" className="button lx-publish" onClick={() => setReview("review")}>
              <Send size={16} aria-hidden="true" /> Review &amp; {isEbay ? "Publish" : "Export"}
            </button>
          </div>

          <div className="lx-more">
            <details className="disclosure" id="specifics">
              <summary>Item details <small>{specificsSummary(draft)}</small></summary>
              <div className="disclosure-body"><SpecificsEditor draft={draft} update={update} /></div>
            </details>
            <details className="disclosure" id="pricing">
              <summary>Price research &amp; profit <small>{draft.pricing.price !== null ? `Listing at ${dollars(draft.pricing.price)}` : "Set a price"}</small></summary>
              <div className="disclosure-body"><ListingPricingSection draft={draft} onChange={(pricing) => update((d) => ({ ...d, pricing }))} bare /></div>
            </details>
            <details className="disclosure" id="photos">
              <summary>Photos <small>{selected.length} of {draft.photos.length} used</small></summary>
              <div className="disclosure-body">
                <PhotoManager draft={draft} update={update} photoUrls={photoUrls} />
                {isEbay && seller.connected && seller.pending.length > 0 && (
                  <p className="fine">
                    {seller.pending.length} photo{seller.pending.length === 1 ? "" : "s"} upload to eBay when you publish.{" "}
                    <button
                      type="button"
                      className="text-link"
                      disabled={seller.phase !== "idle" || !seller.status?.publishingEnabled}
                      onClick={async () => {
                        try {
                          await seller.uploadPhotos(draft);
                        } catch (e) {
                          seller.setError(e instanceof Error ? e.message : "Upload failed.");
                        }
                      }}
                    >
                      <ImageUp size={13} aria-hidden="true" /> Upload now
                    </button>
                  </p>
                )}
              </div>
            </details>
            {isEbay && (
              <details className="disclosure" id="ebay-settings" open={!seller.connected && !!seller.status?.configured ? true : undefined}>
                <summary>Shipping &amp; seller settings <small>{summary}</small></summary>
                <div className="disclosure-body">
                  <ConnectionRow seller={seller} draftId={draft.id} beforeLeave={flush} />
                  {seller.connected && <PoliciesAndLocation draft={draft} seller={seller} />}
                  {seller.connected && <p className="fine">Your choices are remembered for future listings. Nothing is created on eBay unless you click a Create button.</p>}
                </div>
              </details>
            )}
            {isEbay && seller.connected && (
              <details className="disclosure" id="ebay-details">
                <summary>eBay category &amp; specifics <small>{draft.ebay.categoryName ? draft.ebay.categoryName.split(/ [›>] /).slice(-1)[0] : "Choosing…"}</small></summary>
                <div className="disclosure-body"><EbayDetails draft={draft} seller={seller} ctx={ctx} /></div>
              </details>
            )}
            <details className="disclosure" id="package">
              <summary>Package size <small>{packageSummary(draft, seller.calculatedShipping)}</small></summary>
              <div className="disclosure-body"><PackageEditor draft={draft} update={update} calculated={seller.calculatedShipping} /></div>
            </details>
            <details className="disclosure" id="export">
              <summary>Copy &amp; export <small>Paste anywhere</small></summary>
              <div className="disclosure-body"><ExportTools draft={draft} /></div>
            </details>
            {draft.recommendations.length > 0 && (
              <details className="disclosure" id="tips">
                <summary>Selling tips <small>{draft.recommendations.length}</small></summary>
                <div className="disclosure-body">
                  <ul className="lx-tips">{draft.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              </details>
            )}
          </div>
        </div>
      </div>

      {review && <ReviewDialog ctx={ctx} blockers={blockers} optional={optional} mainPhoto={mainPhoto} focus={review} onClose={() => setReview(null)} />}
    </section>
  );
}

function PhotoPanel({ draft, photoUrls, jump }: { draft: ListingDraft; photoUrls: Record<string, string>; jump: (t: string) => void }) {
  const selected = draft.photos.filter((p) => p.selected);
  const [active, setActive] = useState(0);
  const main = selected[Math.min(active, Math.max(0, selected.length - 1))];
  return (
    <div className="lx-photos">
      <div className="lx-hero">
        {main && photoUrls[main.id] ? <img src={photoUrls[main.id]} alt={`${draft.identification.productName || "Item"} photo`} /> : <button type="button" className="lx-hero-empty" onClick={() => jump("photos")}>Choose a photo</button>}
      </div>
      {selected.length > 1 && (
        <div className="lx-thumbs" role="group" aria-label="Photos">
          {selected.map((p, i) => (
            <button key={p.id} type="button" className="lx-thumb" aria-pressed={main?.id === p.id} aria-label={`Show photo ${i + 1}`} onClick={() => setActive(i)}>
              {photoUrls[p.id] ? <img src={photoUrls[p.id]} alt="" /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Where a value came from, as a quiet marker. Only AI guesses ask for attention. */
function Provenance({ a, update }: { a: ListingAttribute; update: Update }) {
  if (a.source === "ai-inferred" && !a.confirmed && a.value.trim())
    return <button type="button" className="lx-verify" onClick={() => update((d) => confirmAttribute(d, a.key))} title="The AI guessed this from your photo">Check</button>;
  if (a.source === "missing") return a.required ? <span className="lx-flag need">Needed</span> : null;
  const title = a.source === "user-confirmed" ? "Entered or confirmed by you" : a.source === "identified" ? "Seen in your photo or notes" : "Identified by AI and approved by you";
  return <span className="lx-tick" title={title} aria-label={title}><Check size={13} /></span>;
}

const keyFacts = ["brand", "model", "size", "department", "color", "storage", "functionalStatus", "carrierLock", "subtype", "edition", "dimensions", "quantity"];

function ListingCopy({
  draft,
  update,
  busy,
  generate,
  genNote,
  genError,
  needsApproval,
}: {
  draft: ListingDraft;
  update: Update;
  busy: GeneratedField[] | null;
  generate: (fields: GeneratedField[], overwrite: boolean) => Promise<void>;
  genNote: { source: string; warnings: string[] } | null;
  genError: string;
  needsApproval: GeneratedTextField[];
}) {
  const profile = marketplaces[draft.marketplace];
  const writing = (f: GeneratedField) => !!busy?.includes(f);
  const facts = draft.attributes.filter((a) => keyFacts.includes(a.key) && (a.required || a.value.trim())).slice(0, 6);
  const c = draft.condition;
  const p = draft.pricing;
  const evidence = p.evidence.find((e) => e.provider === (p.priceProvider || (draft.marketplace === "mercari" ? "mercari" : "ebay")) && e.status === "supported");
  const titleRef = useAutoGrow(draft.title.value);
  const descRef = useAutoGrow(draft.description.value);

  return (
    <div className="lx-copy">
      <div className="lx-ai" aria-live="polite">
        {busy ? (
          <span className="lx-writing"><Loader2 size={14} className="spinner" aria-hidden="true" /> {busy.length > 1 ? "Writing your listing…" : `Updating the ${busy[0] === "condition" ? "condition note" : busy[0]}…`}</span>
        ) : (
          <span><Sparkles size={13} aria-hidden="true" /> {genNote?.source === "template" ? "Written from your details" : "Written by AI from your details"}</span>
        )}
        <button type="button" className="text-link" disabled={!!busy} onClick={() => void generate(generatedFields, false)} title="Rewrites AI-written text. Your own edits are kept.">
          <RefreshCw size={13} aria-hidden="true" /> Rewrite
        </button>
      </div>
      {genError && <p className="error" role="alert">{genError}</p>}
      {needsApproval.length > 0 && (
        <div className="lx-stale" role="status">
          <span>Details changed since you edited the {needsApproval.map((f) => (f === "condition" ? "condition note" : f)).join(" and ")}. Your words are kept.</span>
          <button type="button" className="text-link" disabled={!!busy} onClick={() => void generate(needsApproval, true)}>Update it for me</button>
        </div>
      )}

      <div className="lx-field-title" id="title">
        <label htmlFor="lx-title" className="sr-only">Title</label>
        <textarea
          id="lx-title"
          ref={titleRef}
          rows={1}
          className="lx-title"
          value={draft.title.value}
          maxLength={200}
          placeholder={writing("title") ? "Writing…" : "Title"}
          onChange={(e) => update((d) => editText(d, "title", e.target.value.replace(/\n/g, " ")))}
        />
        <span className={`lx-chars ${draft.title.value.length > profile.titleLimit ? "over" : ""}`}>{draft.title.value.length}/{profile.titleLimit}</span>
      </div>
      {draft.title.warnings.length > 0 && <p className="lx-warn">{draft.title.warnings.join(" ")}</p>}

      <div className="lx-price" id="price">
        <label className="lx-price-input">
          <span className="sr-only">Price in US dollars</span>
          <span aria-hidden="true">$</span>
          <input
            inputMode="decimal"
            value={p.price === null ? "" : String(p.price)}
            placeholder="0"
            aria-describedby="price-note"
            onChange={(e) => {
              const v = e.target.value.trim();
              const n = Number(v);
              update((d) => ({ ...d, pricing: { ...d.pricing, price: v === "" || !Number.isFinite(n) ? null : Math.round(n * 100) / 100, priceSource: "manual", priceProvider: null } }));
            }}
          />
        </label>
        <p id="price-note" className="lx-price-note">
          {p.priceSource && p.priceSource !== "manual" && evidence
            ? `Recommended from ${evidence.count} similar ${evidence.provider === "ebay" ? "eBay" : "Mercari"} listings`
            : p.priceSource === "manual"
              ? evidence?.suggested
                ? <>Your price · <button type="button" className="text-link" onClick={() => update((d) => ({ ...d, pricing: { ...d.pricing, price: evidence.suggested, priceSource: "evidence", priceProvider: evidence.provider } }))}>use recommended {dollars(evidence.suggested)}</button></>
                : "Your price"
              : "Set your price"}
        </p>
      </div>

      <dl className="lx-facts" id="condition">
        <div className="lx-fact">
          <dt>Condition</dt>
          <dd>
            <select aria-label="Condition" value={c.grade} onChange={(e) => update((d) => setGrade(d, e.target.value as ListingDraft["condition"]["grade"]))}>
              <option value="">Choose…</option>
              <option value="new">New</option>
              <option value="used">Used</option>
              <option value="refurbished">Refurbished</option>
              <option value="parts">For parts</option>
            </select>
            {c.grade === "new" && (
              <select aria-label="Original box" value={c.packaging} onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, packaging: e.target.value as ListingDraft["condition"]["packaging"] } }))}>
                <option value="">Box?</option>
                <option value="original">With box</option>
                <option value="none">No box</option>
              </select>
            )}
            {c.gradeSource === "ai-inferred" && !c.confirmed ? (
              <button type="button" className="lx-verify" onClick={() => update((d) => setGrade(d, d.condition.grade))}>Check</button>
            ) : c.grade ? (
              <span className="lx-tick" title="Confirmed by you" aria-label="Confirmed by you"><Check size={13} /></span>
            ) : (
              <span className="lx-flag need">Needed</span>
            )}
          </dd>
        </div>
        {facts.map((a) => (
          <div className="lx-fact" key={a.key} id={`attr-${a.key}`}>
            <dt><label htmlFor={`fact-${a.key}`}>{a.label.replace(/ \/ .*$/, "")}</label></dt>
            <dd>
              <input id={`fact-${a.key}`} value={a.value} placeholder={a.required ? "Add" : "Optional"} onChange={(e) => update((d) => editAttribute(d, a.key, e.target.value))} />
              <Provenance a={a} update={update} />
            </dd>
          </div>
        ))}
        {c.grade && c.grade !== "new" && (
          <div className="lx-fact lx-fact-wide">
            <dt><label htmlFor="lx-flaws">Flaws</label></dt>
            <dd>
              <input
                id="lx-flaws"
                value={c.defects}
                placeholder={c.noKnownDefects ? "None I know of" : draft.category === "footwear" ? "e.g. light creasing on the toe box" : "e.g. light scuffs, small scratch"}
                onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, defects: e.target.value, noKnownDefects: e.target.value.trim() ? false : d.condition.noKnownDefects } }))}
              />
              {!c.defects.trim() && (
                <label className="lx-none">
                  <input type="checkbox" checked={c.noKnownDefects} onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, noKnownDefects: e.target.checked } }))} /> None
                </label>
              )}
            </dd>
          </div>
        )}
      </dl>

      <div className="lx-field-desc" id="description">
        <label htmlFor="lx-desc" className="sr-only">Description</label>
        <textarea id="lx-desc" ref={descRef} className="lx-desc" rows={6} value={draft.description.value} placeholder={writing("description") ? "Writing…" : "Description"} onChange={(e) => update((d) => editText(d, "description", e.target.value))} />
        {profile.descriptionLimit && <span className={`lx-chars ${draft.description.value.length > profile.descriptionLimit ? "over" : ""}`}>{draft.description.value.length}/{profile.descriptionLimit}</span>}
      </div>
      {draft.description.warnings.length > 0 && <p className="lx-warn">{draft.description.warnings.join(" ")}</p>}
      {genNote && genNote.warnings.length > 0 && genNote.source === "ai" && <p className="fine">{genNote.warnings.join(" ")}</p>}

      {c.grade && c.grade !== "new" && (
        <details className="details-link">
          <summary>Condition note for buyers</summary>
          <textarea rows={3} value={c.description} placeholder="Written automatically from the condition and flaws" onChange={(e) => update((d) => editConditionText(d, e.target.value))} />
        </details>
      )}
    </div>
  );
}

/** Grow a textarea with its content so text never hides behind a scrollbar. */
function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return ref;
}

function specificsSummary(draft: ListingDraft) {
  const filled = draft.attributes.filter((a) => a.value.trim()).length;
  return `${filled} of ${draft.attributes.length} filled`;
}

function SpecificsEditor({ draft, update }: { draft: ListingDraft; update: Update }) {
  const unconfirmed = draft.attributes.filter((a) => a.source === "ai-inferred" && !a.confirmed && a.value.trim());
  return (
    <div>
      <p className="fine">Filled from your item. AI guesses stay out of the listing until you check them.</p>
      {unconfirmed.length > 1 && (
        <button type="button" className="mini-button block" onClick={() => update((d) => unconfirmed.reduce((acc, a) => confirmAttribute(acc, a.key), d))}>
          <Check size={13} aria-hidden="true" /> These AI guesses are right
        </button>
      )}
      <div className="lx-spec-grid">
        {draft.attributes.map((a) => (
          <label className="field" key={a.key}>
            <span className="lx-spec-label">{a.label}{a.required ? "" : <small> · optional</small>}<Provenance a={a} update={update} /></span>
            <input value={a.value} placeholder={a.hint || ""} onChange={(e) => update((d) => editAttribute(d, a.key, e.target.value))} />
          </label>
        ))}
        <label className="field" id="included">
          <span className="lx-spec-label">What&apos;s included{draft.includedItems.value && !draft.includedItems.confirmed ? <small> · AI guess</small> : ""}</span>
          <input
            value={draft.includedItems.value}
            placeholder='e.g. "Item only" or "controller, HDMI cable"'
            onChange={(e) => update((d) => ({ ...d, includedItems: { value: e.target.value, source: e.target.value.trim() ? "user-confirmed" : "missing", confirmed: !!e.target.value.trim() } }))}
          />
        </label>
      </div>
    </div>
  );
}

function EbayDetails({ draft, seller, ctx }: { draft: ListingDraft; seller: EbaySeller; ctx: FixContext }) {
  const issue = (fix: string): ReadinessIssue => ({ id: fix, severity: "suggestion", message: "", target: "", fix });
  const aspects = buildAspects(draft, seller.rules?.aspects);
  const required = (seller.rules?.aspects || []).filter((a) => a.required);
  const recommended = (seller.rules?.aspects || []).filter((a) => !a.required && a.recommended).slice(0, 16);
  return (
    <div className="lx-ebay">
      <div className="lx-ebay-row">
        <span className="lx-ebay-label">Category</span>
        <div className="stack-sm">
          <p>{draft.ebay.categoryName ? draft.ebay.categoryName.split(/ [›>] /).slice(-3).join(" › ") : "Searching…"}</p>
          <RequirementFix issue={issue("ebay-category")} ctx={ctx} />
        </div>
      </div>
      <div className="lx-ebay-row">
        <span className="lx-ebay-label">eBay condition</span>
        <RequirementFix issue={issue("ebay-condition")} ctx={ctx} />
      </div>
      {seller.rulesState === "loading" && <p className="fine"><Loader2 size={13} className="spinner" aria-hidden="true" /> Checking eBay&apos;s requirements…</p>}
      {required.length > 0 && (
        <div className="lx-ebay-row">
          <span className="lx-ebay-label">Required by eBay</span>
          <ul className="lx-aspects">
            {required.map((a) => (
              <li key={a.name}>
                <span>{a.name}</span>
                {aspects[a.name] && !draft.ebay.extraAspects?.[a.name] ? <span className="lx-aspect-val">{aspects[a.name][0]} <Check size={13} aria-label="From your listing" /></span> : <RequirementFix issue={issue(`ebay-aspect:${a.name}`)} ctx={ctx} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {recommended.length > 0 && (
        <details className="details-link">
          <summary>Optional specifics ({recommended.filter((a) => !aspects[a.name]).length} empty)</summary>
          <ul className="lx-aspects">
            {recommended.map((a) => (
              <li key={a.name}>
                <span>{a.name}</span>
                {aspects[a.name] && !draft.ebay.extraAspects?.[a.name] ? <span className="lx-aspect-val">{aspects[a.name][0]}</span> : <RequirementFix issue={issue(`ebay-aspect:${a.name}`)} ctx={ctx} />}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="details-link" id="ebay-photo-urls">
        <summary>Add photos by link</summary>
        <textarea rows={2} value={draft.ebay.imageUrls.join("\n")} placeholder="https://… one per line" onChange={(e) => seller.setEbay({ imageUrls: e.target.value.split(/\s+/).map((u) => u.trim()).filter(Boolean) })} />
      </details>
    </div>
  );
}

function PhotoManager({ draft, update, photoUrls }: { draft: ListingDraft; update: Update; photoUrls: Record<string, string> }) {
  const selected = draft.photos.filter((p) => p.selected);
  return (
    <div className="lx-photo-grid">
      {draft.photos.map((p, index) => (
        <div key={p.id} className={`lx-photo${p.selected ? " is-on" : ""}`}>
          {photoUrls[p.id] ? <img src={photoUrls[p.id]} alt={p.name} /> : <div className="lx-photo-empty" aria-label="Photo unavailable" />}
          <div className="lx-photo-bar">
            <label className="lx-photo-use">
              <input type="checkbox" checked={p.selected} onChange={(e) => update((d) => ({ ...d, photos: d.photos.map((x) => (x.id === p.id ? { ...x, selected: e.target.checked } : x)) }))} />
              {p.selected && selected[0]?.id === p.id ? "Cover" : "Use"}
            </label>
            <span>
              <button type="button" className="icon-button" aria-label="Move photo earlier" disabled={index === 0} onClick={() => update((d) => ({ ...d, photos: move(d.photos, index, -1) }))}><ArrowUp size={14} /></button>
              <button type="button" className="icon-button" aria-label="Move photo later" disabled={index === draft.photos.length - 1} onClick={() => update((d) => ({ ...d, photos: move(d.photos, index, 1) }))}><ArrowDown size={14} /></button>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function packageSummary(draft: ListingDraft, calculated: boolean) {
  const s = draft.shipping;
  if (s.whoPays === "local-pickup") return "Local pickup";
  const w = Number(s.weightLb || 0) + Number(s.weightOz || 0) / 16;
  if (w > 0) return `${Math.round(w * 100) / 100} lb packed`;
  return calculated ? "Needed for your shipping policy" : "Optional";
}

function PackageEditor({ draft, update, calculated }: { draft: ListingDraft; update: Update; calculated: boolean }) {
  const s = draft.shipping;
  const set = (k: keyof ListingDraft["shipping"], v: string) => update((d) => ({ ...d, shipping: { ...d.shipping, [k]: v } }));
  return (
    <div className="stack-sm">
      <p className="fine">
        {draft.marketplace === "ebay"
          ? calculated
            ? "Your shipping policy calculates postage, so eBay needs the packed weight and box size."
            : "Optional. Your eBay shipping policy sets the postage."
          : "Optional. Mercari uses the packed weight for its prepaid label."}
      </p>
      <div className="lx-field-grid">
        <label className="field">
          Shipping
          <select value={s.whoPays} onChange={(e) => set("whoPays", e.target.value)}>
            <option value="">Not specified</option>
            <option value="buyer">Buyer pays</option>
            <option value="seller">Free shipping</option>
            <option value="local-pickup">Local pickup only</option>
          </select>
        </label>
        {(
          [
            ["weightLb", "Weight (lb)"],
            ["weightOz", "Weight (oz)"],
            ["length", "Length (in)"],
            ["width", "Width (in)"],
            ["height", "Height (in)"],
            ["handlingDays", "Handling (days)"],
          ] as const
        ).map(([k, label]) => (
          <label className="field" key={k}>
            {label}
            <input inputMode="decimal" value={s[k]} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function ExportTools({ draft }: { draft: ListingDraft }) {
  const exported = exportListing(draft);
  return (
    <div className="stack-sm">
      <div className="lx-export-actions">
        <CopyButton text={exported.title} label="Copy title" />
        <CopyButton text={exported.description} label="Copy description" />
        <CopyButton text={exported.price} label="Copy price" />
        <CopyButton text={exported.text} label="Copy everything" />
        <button type="button" className="mini-button" onClick={() => downloadText(`${(draft.title.value || "listing").replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.txt`, exported.text)}>
          <Download size={14} aria-hidden="true" /> Download
        </button>
      </div>
      <pre className="lx-export">{exported.text}</pre>
    </div>
  );
}

function move<T>(list: T[], index: number, delta: number) {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
