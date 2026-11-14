"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, CheckCircle2, Download, ImageUp, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { applyGenerated, editConditionText, editText, generatedFields, refreshPlan, type GeneratedField, type GeneratedListing } from "../../lib/listing/apply";
import { buildAspects } from "../../lib/ebay-seller/payload";
import { categoryLabels, marketplaces } from "../../lib/listing/categories";
import { confirmAttribute, editAttribute, upgradeDraft } from "../../lib/listing/draft";
import { getDraft, getPhotos, saveDraft, storageIsPersistent } from "../../lib/listing/drafts-store";
import { exportListing } from "../../lib/listing/export";
import { assessListing, type ReadinessIssue } from "../../lib/listing/readiness";
import { factsKey, type GeneratedTextField } from "../../lib/listing/template";
import type { ListingAttribute, ListingDraft, ListingMarketplace } from "../../lib/listing/types";
import { CopyButton, dollars } from "./listing-bits";
import { ListingPricingSection } from "./listing-pricing";
import { RequirementFix, RequirementList, setGrade, type FixContext } from "./requirement-fix";
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
        if (!d) return setLoadError("This draft wasn't found in this browser. Drafts are saved on the device where you created them.");
        urls = photos.map((p) => URL.createObjectURL(p.blob));
        setPhotoUrls(Object.fromEntries(photos.map((p, i) => [p.photoId, urls[i]])));
        setPersistent(persists);
        setDraft(upgradeDraft(d));
        setSave("saved");
        loaded.current = true;
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not open this draft.");
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
        <h1 className="page-title">Draft unavailable</h1>
        <p className="error" role="alert">{loadError}</p>
        <p className="block"><Link className="button" href="/listings">Back to listings</Link></p>
      </section>
    );
  if (!draft) return <section className="wrap workspace" aria-busy="true"><p className="muted">Opening draft…</p></section>;
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
  const [reviewOpen, setReviewOpen] = useState(false);
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
        if (!response.ok || !body?.listing) throw new Error(body?.error || "Listing generation failed. Try again.");
        const listing = body.listing;
        // Facts are recorded from the draft that was sent: if the seller changed something meanwhile,
        // the text is detected as out of date and refreshed again.
        setDraft((d) => (d ? applyGenerated(d, listing, fields, { overwriteUserEdits, writtenFrom: sent }) : d));
        setGenNote({ source: listing.source, warnings: listing.warnings });
      } catch (e) {
        setGenError(e instanceof Error && e.name === "TimeoutError" ? "Writing timed out. Try again." : e instanceof Error ? e.message : "Listing generation failed.");
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

  // When confirmed details change, generated text is rewritten automatically (debounced). Text the seller edited
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
  const blockers = useMemo(() => {
    const own = readiness.blockers;
    const fixes = new Set(own.map((b) => b.fix));
    // eBay checks that duplicate a general one (title length, photos, description) are shown once.
    const ebay = isEbay ? seller.requirements.filter((r) => !(r.fix && fixes.has(r.fix) && ["title", "photos", "description"].includes(r.fix))) : [];
    return [...own, ...ebay];
  }, [readiness, seller.requirements, isEbay]);
  const optional = useMemo(() => [...readiness.warnings, ...readiness.suggestions], [readiness]);

  const jump = useCallback((target: string) => {
    setReviewOpen(false);
    requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
    });
  }, []);

  const ctx: FixContext = { draft, update, seller: isEbay ? seller : null, generate, busy: !!busy, beforeLeave: flush, jump };
  const profile = marketplaces[draft.marketplace];
  const selected = draft.photos.filter((p) => p.selected);
  const mainPhoto = selected[0] ? photoUrls[selected[0].id] : undefined;
  const published = draft.ebay.publish?.status === "published";
  const summary = isEbay ? sellerSummary(draft, seller) : "";

  const setMarketplace = (m: ListingMarketplace) =>
    update((d) => ({ ...d, marketplace: m, pricing: { ...d.pricing, feeMode: m === "ebay" && d.category === "footwear" ? d.pricing.feeMode : "custom" } }));

  return (
    <section className="wrap lx-page">
      <div className="lx-top">
        <div className="lx-top-text">
          <Link className="back" href="/listings">← Listings</Link>
          <h1 className="lx-h1">{draft.identification.productName || "Untitled item"}</h1>
          <p className="save-state" role="status">
            {categoryLabels[draft.category]} · {save === "saving" ? "Saving…" : save === "error" ? "Couldn't save. Check browser storage." : `Saved ${persistent ? "in this browser" : "for this tab only"}`}
          </p>
        </div>
        <div className="lx-market" role="group" aria-label="Sell on">
          {(Object.keys(marketplaces) as ListingMarketplace[]).map((m) => (
            <button key={m} type="button" aria-pressed={draft.marketplace === m} onClick={() => setMarketplace(m)}>
              {m === "facebook" ? "Facebook" : m === "other" ? "Other" : marketplaces[m].label}
            </button>
          ))}
        </div>
      </div>

      {seller.flash && isEbay && <p className="tip" role="status">{seller.flash}</p>}
      {seller.error && isEbay && <p className="error" role="alert">{seller.error}</p>}

      <div className="lx-grid">
        <div className="lx-main">
          <ListingPreview draft={draft} update={update} photoUrls={photoUrls} busy={busy} generate={generate} genNote={genNote} genError={genError} needsApproval={plan.needsApproval} jump={jump} />

          <Section id="specifics" title="All item specifics" summary={specificsSummary(draft)}>
            <SpecificsEditor draft={draft} update={update} />
          </Section>

          {isEbay && seller.connected && (
            <Section id="ebay-details" title="eBay listing details" summary={draft.ebay.categoryName ? draft.ebay.categoryName.split(/ [›>] /).slice(-1)[0] : "Choosing a category…"}>
              <EbayDetails draft={draft} seller={seller} ctx={ctx} />
            </Section>
          )}

          <Section id="pricing" title="Price research & profit" summary={draft.pricing.price !== null ? `Listing at ${dollars(draft.pricing.price)}` : "Set a price"}>
            <ListingPricingSection draft={draft} onChange={(pricing) => update((d) => ({ ...d, pricing }))} bare />
          </Section>

          <Section id="photos" title="Photos" summary={`${selected.length} of ${draft.photos.length} selected`}>
            <PhotoManager draft={draft} update={update} photoUrls={photoUrls} />
            {isEbay && seller.connected && seller.pending.length > 0 && (
              <p className="lx-muted" style={{ marginTop: 12 }}>
                {seller.pending.length} photo{seller.pending.length === 1 ? "" : "s"} upload to eBay automatically when you publish.{" "}
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
                  <ImageUp size={13} /> Upload now
                </button>
              </p>
            )}
          </Section>

          <Section id="package" title="Package & shipping details" summary={packageSummary(draft, seller.calculatedShipping)}>
            <PackageEditor draft={draft} update={update} calculated={seller.calculatedShipping} />
          </Section>

          {draft.recommendations.length > 0 && (
            <Section id="tips" title={`Listing tips for ${profile.label}`} summary={`${draft.recommendations.length} tips`}>
              <ul className="lx-tips">{draft.recommendations.map((r) => <li key={r}><Sparkles size={13} /> <span>{r}</span></li>)}</ul>
            </Section>
          )}

          <Section id="export" title="Copy & export" summary={`For ${profile.label}`}>
            <ExportTools draft={draft} />
          </Section>
        </div>

        <aside className="lx-side" aria-label="Publishing">
          <div className="lx-card lx-status">
            {published ? (
              <p className="lx-ready"><CheckCircle2 size={17} /> Published on eBay</p>
            ) : blockers.length ? (
              <h2 className="lx-status-h">{blockers.length} thing{blockers.length === 1 ? "" : "s"} need{blockers.length === 1 ? "s" : ""} you</h2>
            ) : (
              <p className="lx-ready"><CheckCircle2 size={17} /> Ready to {isEbay ? "publish" : "export"}</p>
            )}
            {!published && blockers.length > 0 && <p className="lx-muted">Only what ResellAI can't fill in reliably. Everything else is done.</p>}
            {!published && <RequirementList issues={blockers} ctx={ctx} kind="blocker" />}
            <button type="button" className="button lx-review-btn" onClick={() => setReviewOpen(true)}>
              <Send size={16} /> Review & {isEbay ? "Publish" : "Export"}
            </button>
            {optional.length > 0 && (
              <button type="button" className="text-link lx-small lx-center" onClick={() => setReviewOpen(true)}>
                {optional.length} optional suggestion{optional.length === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {isEbay && (
            <details className="lx-card lx-seller" id="ebay-settings" open={!seller.connected || summary.includes("to choose") || undefined}>
              <summary>
                <span>Shipping & seller settings</span>
                <small>{summary}</small>
              </summary>
              <div className="lx-seller-body">
                <ConnectionRow seller={seller} draftId={draft.id} beforeLeave={flush} />
                {seller.connected && <PoliciesAndLocation draft={draft} seller={seller} />}
                {seller.connected && <p className="lx-muted lx-small">Your choices are remembered for future listings. Nothing is created on eBay unless you click a Create button.</p>}
              </div>
            </details>
          )}
        </aside>
      </div>

      <div className="lx-mobile-bar">
        <span>{published ? "Published" : blockers.length ? `${blockers.length} to complete` : "Ready"}</span>
        <button type="button" className="button" onClick={() => setReviewOpen(true)}><Send size={16} /> Review & {isEbay ? "Publish" : "Export"}</button>
      </div>

      {reviewOpen && <ReviewDialog ctx={ctx} blockers={blockers} optional={optional} mainPhoto={mainPhoto} onClose={() => setReviewOpen(false)} />}
    </section>
  );
}

function Section({ id, title, summary, children }: { id: string; title: string; summary?: string; children: React.ReactNode }) {
  return (
    <details className="lx-card lx-section" id={id}>
      <summary>
        <span className="lx-section-title">{title}</span>
        {summary && <small>{summary}</small>}
      </summary>
      <div className="lx-section-body">{children}</div>
    </details>
  );
}

/** Where a value came from, in a few words. */
function Provenance({ a }: { a: ListingAttribute }) {
  if (a.source === "missing") return a.required ? <span className="lx-prov need">Needed</span> : null;
  if (a.source === "user-confirmed") return <span className="lx-prov ok" title="You entered or confirmed this"><Check size={11} /> You</span>;
  if (a.source === "identified") return <span className="lx-prov id" title="Visible in your photo or stated in your notes">From photo</span>;
  if (a.confirmed)
    return (
      <span className="lx-prov ok" title={a.confirmedVia === "identification" ? "AI-identified; you approved it at Confirm identification" : "AI-inferred; you confirmed it"}>
        <Check size={11} /> {a.confirmedVia === "identification" ? "Identified" : "Checked"}
      </span>
    );
  return <span className="lx-prov ai" title="The AI's guess. Check it.">AI guess</span>;
}

function AttributeProvenance({ a, update }: { a: ListingAttribute; update: Update }) {
  if (a.source === "ai-inferred" && !a.confirmed && a.value.trim())
    return <button type="button" className="lx-prov ai as-btn" onClick={() => update((d) => confirmAttribute(d, a.key))}>AI guess · Looks right?</button>;
  return <Provenance a={a} />;
}

const previewKeys = ["brand", "model", "size", "department", "color", "styleCode", "storage", "functionalStatus", "carrierLock", "subtype", "edition", "dimensions", "quantity"];
const textLabel = (s: string) => (s === "ai-generated" ? "AI-written" : s === "template" ? "From your details" : s === "user-edited" ? "Edited by you" : "");

function ListingPreview({
  draft,
  update,
  photoUrls,
  busy,
  generate,
  genNote,
  genError,
  needsApproval,
  jump,
}: {
  draft: ListingDraft;
  update: Update;
  photoUrls: Record<string, string>;
  busy: GeneratedField[] | null;
  generate: (fields: GeneratedField[], overwrite: boolean) => Promise<void>;
  genNote: { source: string; warnings: string[] } | null;
  genError: string;
  needsApproval: GeneratedTextField[];
  jump: (target: string) => void;
}) {
  const profile = marketplaces[draft.marketplace];
  const selected = draft.photos.filter((p) => p.selected);
  const [active, setActive] = useState(0);
  const main = selected[Math.min(active, Math.max(0, selected.length - 1))];
  const writing = (f: GeneratedField) => !!busy?.includes(f);
  const facts = draft.attributes.filter((a) => previewKeys.includes(a.key) && (a.required || a.value.trim()));
  const c = draft.condition;
  const evidence = draft.pricing.evidence.find((e) => e.provider === (draft.pricing.priceProvider || (draft.marketplace === "mercari" ? "mercari" : "ebay")) && e.status === "supported");
  const rows = Math.min(22, Math.max(8, draft.description.value.split("\n").length + 2));

  return (
    <article className="lx-card lx-preview" aria-label="Listing preview">
      <div className="lx-media">
        <div className="lx-hero">
          {main && photoUrls[main.id] ? <img src={photoUrls[main.id]} alt={`${draft.identification.productName || "Item"} photo`} /> : <div className="lx-hero-empty">No photo selected</div>}
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
        <button type="button" className="text-link lx-small" onClick={() => jump("photos")}>Manage photos</button>
      </div>

      <div className="lx-content">
        <div className="lx-gen-row" aria-live="polite">
          {busy ? (
            <span className="lx-writing"><Loader2 size={14} className="spinner" /> {busy.length > 1 ? "Writing your listing…" : `Updating the ${busy[0] === "condition" ? "condition note" : busy[0]}…`}</span>
          ) : genNote?.source === "template" ? (
            <span className="lx-muted">Written from your confirmed details.</span>
          ) : (
            <span className="lx-muted"><Sparkles size={13} /> Written by AI from your confirmed details. Review before publishing.</span>
          )}
          <button type="button" className="mini-button" disabled={!!busy} onClick={() => void generate(generatedFields, false)} title="Rewrites AI-written text. Your own edits are kept.">
            <RefreshCw size={13} /> Rewrite
          </button>
        </div>
        {genError && <p className="error" role="alert">{genError}</p>}
        {genNote && genNote.warnings.length > 0 && <p className="lx-note">{genNote.warnings.join(" ")}</p>}

        {needsApproval.length > 0 && (
          <div className="lx-stale" role="status">
            <span>Your details changed after you edited the {needsApproval.map((f) => (f === "condition" ? "condition note" : f)).join(" and ")}. Your text is kept as you wrote it.</span>
            <button type="button" className="mini-button" disabled={!!busy} onClick={() => void generate(needsApproval, true)}>
              <RefreshCw size={13} /> Update with new details (replaces my edits)
            </button>
          </div>
        )}

        <div className="lx-field-block" id="title">
          <div className="lx-label-row">
            <label htmlFor="lx-title">Title</label>
            <span className="lx-meta">
              {textLabel(draft.title.source) && <span>{textLabel(draft.title.source)}</span>}
              <span className={draft.title.value.length > profile.titleLimit ? "over" : undefined}>{draft.title.value.length}/{profile.titleLimit}</span>
              <button type="button" className="lx-icon-btn" aria-label="Rewrite title" disabled={!!busy} onClick={() => void generate(["title"], true)}>
                <RefreshCw size={13} className={writing("title") ? "spinner" : undefined} />
              </button>
            </span>
          </div>
          <input id="lx-title" className="lx-title-input" value={draft.title.value} maxLength={200} placeholder={writing("title") ? "Writing…" : "Title"} onChange={(e) => update((d) => editText(d, "title", e.target.value))} />
          {draft.title.warnings.length > 0 && <p className="lx-inline-warn">{draft.title.warnings.join(" ")}</p>}
        </div>

        <div className="lx-price-row" id="price">
          <label className="lx-price">
            <span className="sr-only">Price (USD)</span>
            <span className="lx-currency" aria-hidden="true">$</span>
            <input
              inputMode="decimal"
              value={draft.pricing.price === null ? "" : String(draft.pricing.price)}
              placeholder="0.00"
              aria-describedby="price-note"
              onChange={(e) => {
                const v = e.target.value.trim();
                const n = Number(v);
                update((d) => ({ ...d, pricing: { ...d.pricing, price: v === "" || !Number.isFinite(n) ? null : Math.round(n * 100) / 100, priceSource: "manual", priceProvider: null } }));
              }}
            />
          </label>
          <div id="price-note" className="lx-price-note">
            <span>
              {draft.pricing.priceSource && draft.pricing.priceSource !== "manual" && evidence
                ? `Suggested from ${evidence.count} active ${evidence.provider === "ebay" ? "eBay" : "Mercari"} listings (asking prices)`
                : draft.pricing.priceSource === "manual"
                  ? `Your price${evidence?.suggested ? ` · market suggests ${dollars(evidence.suggested)}` : ""}`
                  : "No market suggestion yet; set your price"}
            </span>
            {evidence && (
              <span className="lx-chips">
                {(
                  [
                    ["Quick sale", evidence.quickSale, "quick-sale"],
                    ["Market", evidence.suggested, "evidence"],
                    ["Patient", evidence.patient, "patient"],
                  ] as const
                )
                  .filter(([, v]) => v !== null)
                  .map(([label, v, source]) => (
                    <button
                      key={label}
                      type="button"
                      className="lx-chip"
                      aria-pressed={draft.pricing.price === v && draft.pricing.priceSource === source}
                      onClick={() => update((d) => ({ ...d, pricing: { ...d.pricing, price: v, priceSource: source, priceProvider: evidence.provider } }))}
                    >
                      {label} {dollars(v)}
                    </button>
                  ))}
              </span>
            )}
          </div>
        </div>

        <div className="lx-facts" id="condition">
          <div className="lx-fact">
            <span className="lx-fact-label">Condition</span>
            <div className="lx-fact-value">
              <select aria-label="Condition" value={c.grade} onChange={(e) => update((d) => setGrade(d, e.target.value as ListingDraft["condition"]["grade"]))}>
                <option value="">Choose…</option>
                <option value="new">New</option>
                <option value="used">Used / pre-owned</option>
                <option value="refurbished">Refurbished</option>
                <option value="parts">For parts / not working</option>
              </select>
              {c.grade === "new" && (
                <select aria-label="Original box" value={c.packaging} onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, packaging: e.target.value as ListingDraft["condition"]["packaging"] } }))}>
                  <option value="">Box?</option>
                  <option value="original">With box</option>
                  <option value="none">No box</option>
                </select>
              )}
            </div>
            {c.gradeSource === "ai-inferred" && !c.confirmed ? (
              <button type="button" className="lx-prov ai as-btn" onClick={() => update((d) => setGrade(d, d.condition.grade))} title="The AI inferred this from your photo">AI guess · Looks right?</button>
            ) : c.grade ? (
              <span className="lx-prov ok"><Check size={11} /> You</span>
            ) : (
              <span className="lx-prov need">Needed</span>
            )}
          </div>
          {facts.map((a) => (
            <div className="lx-fact" key={a.key} id={`attr-${a.key}`}>
              <label className="lx-fact-label" htmlFor={`fact-${a.key}`}>{a.label.replace(/ \/ .*$/, "")}</label>
              <div className="lx-fact-value">
                <input id={`fact-${a.key}`} value={a.value} placeholder={a.required ? "Needed" : "Optional"} onChange={(e) => update((d) => editAttribute(d, a.key, e.target.value))} />
              </div>
              <AttributeProvenance a={a} update={update} />
            </div>
          ))}
        </div>
        {c.grade && c.grade !== "new" && (
          <div className="lx-flaws">
            <label className="lx-fact-label" htmlFor="lx-flaws">Flaws or wear</label>
            <input
              id="lx-flaws"
              value={c.defects}
              placeholder={c.noKnownDefects ? "None known" : draft.category === "footwear" ? "e.g. light creasing on the toe box" : "e.g. light scuffs, small scratch"}
              onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, defects: e.target.value, noKnownDefects: e.target.value.trim() ? false : d.condition.noKnownDefects } }))}
            />
            <label className="check-row lx-small">
              <input type="checkbox" checked={c.noKnownDefects} disabled={!!c.defects.trim()} onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, noKnownDefects: e.target.checked } }))} /> <span>No flaws I know of</span>
            </label>
          </div>
        )}

        <div className="lx-field-block" id="description">
          <div className="lx-label-row">
            <label htmlFor="lx-desc">Description</label>
            <span className="lx-meta">
              {textLabel(draft.description.source) && <span>{textLabel(draft.description.source)}</span>}
              <span className={profile.descriptionLimit && draft.description.value.length > profile.descriptionLimit ? "over" : undefined}>
                {draft.description.value.length.toLocaleString()}
                {profile.descriptionLimit ? `/${profile.descriptionLimit.toLocaleString()}` : ""}
              </span>
              <button type="button" className="lx-icon-btn" aria-label="Rewrite description" disabled={!!busy} onClick={() => void generate(["description"], true)}>
                <RefreshCw size={13} className={writing("description") ? "spinner" : undefined} />
              </button>
            </span>
          </div>
          <textarea id="lx-desc" className="lx-desc" rows={rows} value={draft.description.value} placeholder={writing("description") ? "Writing…" : "Description"} onChange={(e) => update((d) => editText(d, "description", e.target.value))} />
          {draft.description.warnings.length > 0 && <p className="lx-inline-warn">{draft.description.warnings.join(" ")}</p>}
        </div>

        {c.grade && c.grade !== "new" && (
          <details className="lx-subtle">
            <summary>Condition note for buyers ({c.description ? textLabel(c.descriptionSource) || "set" : "written automatically"})</summary>
            <textarea rows={3} className="lx-input" value={c.description} placeholder="Written automatically from the condition and flaws" onChange={(e) => update((d) => editConditionText(d, e.target.value))} />
          </details>
        )}
      </div>
    </article>
  );
}

function specificsSummary(draft: ListingDraft) {
  const filled = draft.attributes.filter((a) => a.value.trim()).length;
  return `${filled} of ${draft.attributes.length} filled`;
}

function SpecificsEditor({ draft, update }: { draft: ListingDraft; update: Update }) {
  const unconfirmed = draft.attributes.filter((a) => a.source === "ai-inferred" && !a.confirmed && a.value.trim());
  return (
    <div>
      <p className="lx-muted">Filled from your confirmed identification. Unconfirmed AI guesses stay out of the listing until you check them.</p>
      {unconfirmed.length > 1 && (
        <button type="button" className="mini-button" onClick={() => update((d) => unconfirmed.reduce((acc, a) => confirmAttribute(acc, a.key), d))}>
          <Check size={13} /> I&apos;ve checked these AI guesses
        </button>
      )}
      <div className="lx-spec-grid">
        {draft.attributes.map((a) => (
          <div className="lx-spec" key={a.key}>
            <label htmlFor={`spec-${a.key}`}>
              {a.label}
              {a.required && <span className="req" aria-label="required"> *</span>}
            </label>
            <input id={`spec-${a.key}`} value={a.value} placeholder={a.hint || (a.required ? "Needed" : "Optional")} onChange={(e) => update((d) => editAttribute(d, a.key, e.target.value))} />
            <span className="lx-spec-prov"><AttributeProvenance a={a} update={update} /></span>
          </div>
        ))}
      </div>
      <label className="lx-field" style={{ marginTop: 16 }} id="included">
        <span>What&apos;s included {draft.includedItems.confirmed ? "· confirmed" : draft.includedItems.value ? "· AI guess" : ""}</span>
        <input
          value={draft.includedItems.value}
          placeholder='e.g. "Item only" or "controller, HDMI cable"'
          onChange={(e) => update((d) => ({ ...d, includedItems: { value: e.target.value, source: e.target.value.trim() ? "user-confirmed" : "missing", confirmed: !!e.target.value.trim() } }))}
        />
      </label>
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
        <span className="lx-fact-label">Category</span>
        <div>
          <p className="lx-strong">{draft.ebay.categoryName ? draft.ebay.categoryName.split(/ [›>] /).slice(-3).join(" › ") : "Searching…"}</p>
          <p className="lx-muted lx-small">Suggested by eBay from the product name. Search to change it.</p>
          <RequirementFix issue={issue("ebay-category")} ctx={ctx} />
        </div>
      </div>
      <div className="lx-ebay-row">
        <span className="lx-fact-label">eBay condition</span>
        <RequirementFix issue={issue("ebay-condition")} ctx={ctx} />
      </div>
      {seller.rulesState === "loading" && <p className="lx-muted"><Loader2 size={13} className="spinner" /> Loading eBay&apos;s requirements for this category…</p>}
      {required.length > 0 && (
        <div className="lx-ebay-row">
          <span className="lx-fact-label">Required specifics</span>
          <ul className="lx-aspects">
            {required.map((a) => {
              const fromListing = aspects[a.name] && !draft.ebay.extraAspects?.[a.name];
              return (
                <li key={a.name}>
                  <span>{a.name}</span>
                  {fromListing ? (
                    <span className="lx-aspect-val">{aspects[a.name][0]} <span className="lx-prov ok"><Check size={11} /> From your listing</span></span>
                  ) : (
                    <RequirementFix issue={issue(`ebay-aspect:${a.name}`)} ctx={ctx} />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {recommended.length > 0 && (
        <details className="lx-subtle">
          <summary>Optional specifics eBay recommends ({recommended.filter((a) => !aspects[a.name]).length} empty)</summary>
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
      <details className="lx-subtle" id="ebay-photo-urls">
        <summary>Add photos by URL (advanced)</summary>
        <textarea rows={2} className="lx-input" value={draft.ebay.imageUrls.join("\n")} placeholder="https://… one per line" onChange={(e) => seller.setEbay({ imageUrls: e.target.value.split(/\s+/).map((u) => u.trim()).filter(Boolean) })} />
      </details>
    </div>
  );
}

function PhotoManager({ draft, update, photoUrls }: { draft: ListingDraft; update: Update; photoUrls: Record<string, string> }) {
  const selected = draft.photos.filter((p) => p.selected);
  return (
    <div className="photo-select">
      {draft.photos.map((p, index) => (
        <div key={p.id} className={`photo-card${p.selected ? " selected" : ""}`}>
          {photoUrls[p.id] ? <img src={photoUrls[p.id]} alt={p.name} /> : <div className="thumb" aria-label="Photo unavailable" />}
          <div className="row">
            <label className="check-row" style={{ marginTop: 0, fontSize: 12 }}>
              <input type="checkbox" checked={p.selected} onChange={(e) => update((d) => ({ ...d, photos: d.photos.map((x) => (x.id === p.id ? { ...x, selected: e.target.checked } : x)) }))} />
              <span>{p.selected && selected[0]?.id === p.id ? "Main photo" : "Use"}</span>
            </label>
            <span>
              <button type="button" className="mini-button" aria-label="Move photo earlier" disabled={index === 0} onClick={() => update((d) => ({ ...d, photos: move(d.photos, index, -1) }))}><ArrowUp size={12} /></button>{" "}
              <button type="button" className="mini-button" aria-label="Move photo later" disabled={index === draft.photos.length - 1} onClick={() => update((d) => ({ ...d, photos: move(d.photos, index, 1) }))}><ArrowDown size={12} /></button>
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
  return calculated ? "Needed for calculated postage" : "Optional";
}

function PackageEditor({ draft, update, calculated }: { draft: ListingDraft; update: Update; calculated: boolean }) {
  const s = draft.shipping;
  const set = (k: keyof ListingDraft["shipping"], v: string) => update((d) => ({ ...d, shipping: { ...d.shipping, [k]: v } }));
  return (
    <div>
      <p className="lx-muted">
        {draft.marketplace === "ebay"
          ? calculated
            ? "Your shipping policy calculates postage, so eBay needs the packed weight and box size."
            : "Optional: your eBay shipping policy sets postage. If you add them, weigh and measure the packed item; ResellAI never estimates these."
          : "Optional. Mercari uses the packed weight for its prepaid label."}
      </p>
      <div className="lx-field-grid">
        <label className="lx-field">
          <span>Arrangement</span>
          <select value={s.whoPays} onChange={(e) => set("whoPays", e.target.value)}>
            <option value="">Not specified</option>
            <option value="buyer">Buyer pays shipping</option>
            <option value="seller">Free shipping (I pay)</option>
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
          <label className="lx-field" key={k}>
            <span>{label}</span>
            <input inputMode="decimal" value={s[k]} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function ExportTools({ draft }: { draft: ListingDraft }) {
  const exported = exportListing(draft);
  const profile = marketplaces[draft.marketplace];
  return (
    <div>
      <p className="lx-muted">{profile.limitNote}</p>
      <div className="lx-chips">
        <CopyButton text={exported.title} label="Copy title" />
        <CopyButton text={exported.description} label="Copy description" />
        <CopyButton text={exported.price} label="Copy price" />
        <CopyButton text={exported.text} label="Copy everything" />
        <button type="button" className="mini-button" onClick={() => downloadText(`${(draft.title.value || "listing").replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.txt`, exported.text)}>
          <Download size={14} /> Download .txt
        </button>
      </div>
      <div className="export-box" aria-label="Listing export preview">{exported.text}</div>
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
