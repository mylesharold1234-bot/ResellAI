"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Sparkles, XCircle, ArrowUp, ArrowDown } from "lucide-react";
import { applyGenerated, editText, type GeneratedField, type GeneratedListing } from "../../lib/listing/apply";
import { categoryLabels, marketplaces } from "../../lib/listing/categories";
import { confirmAttribute, editAttribute } from "../../lib/listing/draft";
import { getDraft, getPhotos, saveDraft, storageIsPersistent } from "../../lib/listing/drafts-store";
import { exportListing } from "../../lib/listing/export";
import { assessListing } from "../../lib/listing/readiness";
import type { ListingDraft, ListingMarketplace } from "../../lib/listing/types";
import { CopyButton, ProvenanceBadge, TextSourceBadge } from "./listing-bits";
import { ListingPricingSection } from "./listing-pricing";
import { EbayPublishPanel } from "./ebay-publish-panel";

type SaveState = "loading" | "saved" | "saving" | "error";

export function ListingEditor({ id }: { id: string }) {
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [save, setSave] = useState<SaveState>("loading");
  const [persistent, setPersistent] = useState(true);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<GeneratedField[] | null>(null);
  const [notes, setNotes] = useState<{ source: string; warnings: string[] } | null>(null);
  const [genError, setGenError] = useState("");
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
        setDraft(d);
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
    const t = setTimeout(() => {
      saveDraft(draft).then(
        () => setSave("saved"),
        () => setSave("error"),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [draft]);

  const update = useCallback((fn: (d: ListingDraft) => ListingDraft) => setDraft((d) => (d ? { ...fn(d), updatedAt: new Date().toISOString() } : d)), []);
  const readiness = useMemo(() => (draft ? assessListing(draft) : null), [draft]);

  async function generate(fields: GeneratedField[], overwriteUserEdits: boolean) {
    if (!draft || busy) return;
    setBusy(fields);
    setGenError("");
    try {
      const response = await fetch("/api/listings/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, fields, marketplace: draft.marketplace }),
        signal: AbortSignal.timeout(45000),
      });
      const body = (await response.json().catch(() => null)) as { listing?: GeneratedListing; error?: string } | null;
      if (!response.ok || !body?.listing) throw new Error(body?.error || "Listing generation failed. Try again.");
      const listing = body.listing;
      setDraft((d) => (d ? applyGenerated(d, listing, fields, { overwriteUserEdits }) : d));
      setNotes({ source: listing.source, warnings: listing.warnings });
    } catch (e) {
      setGenError(e instanceof Error && e.name === "TimeoutError" ? "Generation timed out. Try again." : e instanceof Error ? e.message : "Listing generation failed.");
    } finally {
      setBusy(null);
    }
  }

  if (loadError)
    return (
      <section className="wrap workspace narrow">
        <h1 className="page-title">Draft unavailable</h1>
        <p className="error" role="alert">{loadError}</p>
        <p className="block">
          <Link className="button" href="/listings">Back to listings</Link>
        </p>
      </section>
    );
  if (!draft || !readiness) return <section className="wrap workspace" aria-busy="true"><p className="muted">Opening draft…</p></section>;

  const profile = marketplaces[draft.marketplace];
  const isBusy = (f: GeneratedField) => !!busy?.includes(f);
  const selectedPhotos = draft.photos.filter((p) => p.selected);
  const exported = exportListing(draft);
  const hasText = !!(draft.title.value || draft.description.value);
  const regen = (f: GeneratedField, label: string) => (
    <button type="button" className="mini-button" disabled={!!busy} onClick={() => void generate([f], true)} aria-label={`Regenerate ${label}`}>
      <RefreshCw size={13} className={isBusy(f) ? "spinner" : undefined} /> {isBusy(f) ? "Writing…" : "Regenerate"}
    </button>
  );
  const setMarketplace = (m: ListingMarketplace) =>
    update((d) => ({ ...d, marketplace: m, pricing: { ...d.pricing, feeMode: m === "ebay" && d.category === "footwear" ? d.pricing.feeMode : "custom" } }));

  return (
    <section className="wrap workspace">
      <div className="section-heading">
        <div>
          <Link className="back" href="/listings">← Listings</Link>
          <div className="eyebrow block">LISTING DRAFT · {categoryLabels[draft.category].toUpperCase()}</div>
          <h1 className="page-title">{draft.identification.productName || "Untitled item"}</h1>
          <p className="save-state" role="status">
            {save === "saving" ? "Saving…" : save === "error" ? "Couldn't save. Check browser storage." : `Saved ${persistent ? "in this browser" : "for this tab only (browser storage unavailable)"} · ${new Date(draft.updatedAt).toLocaleTimeString()}`}
          </p>
        </div>
        <div>
          <p className="fine" style={{ marginTop: 0 }}>Sell on</p>
          <div className="marketplace-tabs" role="group" aria-label="Marketplace">
            {(Object.keys(marketplaces) as ListingMarketplace[]).map((m) => (
              <button key={m} type="button" aria-pressed={draft.marketplace === m} onClick={() => setMarketplace(m)}>
                {marketplaces[m].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="listing-layout">
        <div className="listing-main">
          <section className="listing-panel" aria-labelledby="gen-h">
            <h2 id="gen-h">
              Write the listing
              <button type="button" className="button" disabled={!!busy} onClick={() => void generate(["title", "description", "condition", "recommendations"], false)}>
                <Sparkles size={17} /> {busy?.length === 4 ? "Writing listing…" : hasText ? "Regenerate listing" : "Generate listing"}
              </button>
            </h2>
            <p className="panel-sub">
              Uses your confirmed details only, with no new photo analysis. AI-inferred details stay out until you confirm them below. {hasText && "Text you've edited yourself is kept; use a field's Regenerate button to replace it."}
            </p>
            {genError && <p className="error" role="alert">{genError}</p>}
            {notes && (
              <div className={notes.warnings.length ? "warn-box" : "tip"} role="status">
                {notes.source === "ai" ? "Written by AI from your confirmed details. Review before listing." : "Built from your confirmed details with a template."}
                {!!notes.warnings.length && <ul>{notes.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
              </div>
            )}
          </section>

          <section className="listing-panel" id="title" aria-labelledby="title-h">
            <h2 id="title-h">
              Title <span className="spec-actions"><TextSourceBadge source={draft.title.source} />{regen("title", "title")}</span>
            </h2>
            <label className="listing-field">
              <span className="sr-only">Listing title</span>
              <input value={draft.title.value} maxLength={200} placeholder="Generate or type a title" onChange={(e) => update((d) => editText(d, "title", e.target.value))} />
            </label>
            <div className="field-meta">
              <span className={draft.title.value.length > profile.titleLimit ? "over" : undefined}>{draft.title.value.length}/{profile.titleLimit} characters</span>
              <CopyButton text={draft.title.value} label="Copy title" />
            </div>
            {!!draft.title.warnings.length && <div className="warn-box"><ul>{draft.title.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          </section>

          <section className="listing-panel" id="description" aria-labelledby="desc-h">
            <h2 id="desc-h">
              Description <span className="spec-actions"><TextSourceBadge source={draft.description.source} />{regen("description", "description")}</span>
            </h2>
            <label className="listing-field">
              <span className="sr-only">Listing description</span>
              <textarea rows={12} value={draft.description.value} placeholder="Generate or write a description" onChange={(e) => update((d) => editText(d, "description", e.target.value))} />
            </label>
            <div className="field-meta">
              <span className={profile.descriptionLimit && draft.description.value.length > profile.descriptionLimit ? "over" : undefined}>
                {draft.description.value.length.toLocaleString()}
                {profile.descriptionLimit ? `/${profile.descriptionLimit.toLocaleString()}` : ""} characters
              </span>
              <CopyButton text={draft.description.value} label="Copy description" />
            </div>
            {!!draft.description.warnings.length && <div className="warn-box"><ul>{draft.description.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          </section>

          <section className="listing-panel" id="specifics" aria-labelledby="spec-h">
            <h2 id="spec-h">
              Item specifics
              {draft.attributes.some((a) => a.source === "ai-inferred" && !a.confirmed && a.value.trim()) && (
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => update((d) => d.attributes.reduce((acc, a) => (a.source === "ai-inferred" && !a.confirmed ? confirmAttribute(acc, a.key) : acc), d))}
                >
                  <CheckCircle2 size={13} /> I've checked these — confirm all AI-inferred
                </button>
              )}
            </h2>
            <p className="panel-sub">Carried over from your confirmed identification. <span className="req">*</span> marks details {categoryLabels[draft.category].toLowerCase()} listings need. Confirm anything the AI inferred, or correct it.</p>
            <div className="spec-rows">
              {draft.attributes.map((a) => (
                <div className="spec-row" key={a.key} id={`attr-${a.key}`}>
                  <label htmlFor={`in-${a.key}`}>
                    {a.label} {a.required && <span className="req" aria-label="required">*</span>}
                    {a.hint && <small>{a.hint}</small>}
                  </label>
                  <input id={`in-${a.key}`} className="listing-input" value={a.value} placeholder={a.required ? "Required" : "Optional"} onChange={(e) => update((d) => editAttribute(d, a.key, e.target.value))} />
                  <div className="spec-actions">
                    <ProvenanceBadge source={a.source} confirmed={a.confirmed} required={a.required} />
                    {a.source === "ai-inferred" && !a.confirmed && a.value.trim() && (
                      <button type="button" className="mini-button" onClick={() => update((d) => confirmAttribute(d, a.key))}>
                        <CheckCircle2 size={13} /> Confirm
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="listing-panel" id="condition" aria-labelledby="cond-h">
            <h2 id="cond-h">
              Condition <span className="spec-actions"><TextSourceBadge source={draft.condition.descriptionSource} />{regen("condition", "condition description")}</span>
            </h2>
            {draft.identification.visibleCondition && (
              <p className="panel-sub">
                From your photos, the AI noted: “{draft.identification.visibleCondition}”. <ProvenanceBadge source="ai-inferred" confirmed={false} /> It isn't used in the listing unless you write it in.
              </p>
            )}
            <div className="money-grid">
              <label className="listing-field">
                Condition {draft.condition.gradeSource === "ai-inferred" && !draft.condition.confirmed && <ProvenanceBadge source="ai-inferred" confirmed={false} />}
                <select value={draft.condition.grade} onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, grade: e.target.value as ListingDraft["condition"]["grade"], gradeSource: "user-confirmed", confirmed: false } }))}>
                  <option value="">Choose…</option>
                  <option value="new">New</option>
                  <option value="used">Used / pre-owned</option>
                  <option value="refurbished">Refurbished</option>
                  <option value="parts">For parts / not working</option>
                </select>
              </label>
              <label className="listing-field">
                Original packaging
                <select value={draft.condition.packaging} onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, packaging: e.target.value as ListingDraft["condition"]["packaging"], confirmed: false } }))}>
                  <option value="">Not specified</option>
                  <option value="original">Included</option>
                  <option value="none">Not included</option>
                </select>
              </label>
            </div>
            <label className="listing-field">
              Flaws or wear buyers should know about
              <textarea rows={3} value={draft.condition.defects} placeholder="e.g. light creasing on both toe boxes, small scuff on left heel" onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, defects: e.target.value, noKnownDefects: e.target.value.trim() ? false : d.condition.noKnownDefects, confirmed: false } }))} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={draft.condition.noKnownDefects} disabled={!!draft.condition.defects.trim()} onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, noKnownDefects: e.target.checked, confirmed: false } }))} />
              <span>I don't know of any other flaws</span>
            </label>
            <label className="listing-field">
              Condition description
              <textarea rows={3} value={draft.condition.description} placeholder="Generate or write a condition description" onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, description: e.target.value, descriptionSource: e.target.value ? "user-edited" : "empty", confirmed: false } }))} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={draft.condition.confirmed} onChange={(e) => update((d) => ({ ...d, condition: { ...d.condition, confirmed: e.target.checked, gradeSource: e.target.checked && d.condition.grade ? "user-confirmed" : d.condition.gradeSource } }))} />
              <span>I've checked the item; the condition, packaging and flaws above are accurate.</span>
            </label>
          </section>

          <section className="listing-panel" id="included" aria-labelledby="inc-h">
            <h2 id="inc-h">
              What's included <ProvenanceBadge source={draft.includedItems.source} confirmed={draft.includedItems.confirmed} />
            </h2>
            <label className="listing-field">
              Items the buyer receives
              <input value={draft.includedItems.value} placeholder="e.g. Item only · or · controller, HDMI cable, power cord" onChange={(e) => update((d) => ({ ...d, includedItems: { value: e.target.value, source: e.target.value.trim() ? "user-confirmed" : "missing", confirmed: false } }))} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={draft.includedItems.confirmed} disabled={!draft.includedItems.value.trim()} onChange={(e) => update((d) => ({ ...d, includedItems: { ...d.includedItems, confirmed: e.target.checked } }))} />
              <span>This is exactly what the buyer will receive.</span>
            </label>
          </section>

          <section className="listing-panel" id="photos" aria-labelledby="ph-h">
            <h2 id="ph-h">Photos</h2>
            <p className="panel-sub">{selectedPhotos.length} of {draft.photos.length} selected. The first selected photo is the main image. Add more angles from your analysis upload if the marketplace allows.</p>
            <div className="photo-select">
              {draft.photos.map((p, index) => (
                <div key={p.id} className={`photo-card${p.selected ? " selected" : ""}`}>
                  {photoUrls[p.id] ? <img src={photoUrls[p.id]} alt={p.name} /> : <div className="thumb" aria-label="Photo unavailable" />}
                  <div className="row">
                    <label className="check-row" style={{ marginTop: 0, fontSize: 12 }}>
                      <input type="checkbox" checked={p.selected} onChange={(e) => update((d) => ({ ...d, photos: d.photos.map((x) => (x.id === p.id ? { ...x, selected: e.target.checked } : x)) }))} />
                      <span>{p.selected && selectedPhotos[0]?.id === p.id ? "Main photo" : "Use"}</span>
                    </label>
                    <span>
                      <button type="button" className="mini-button" aria-label="Move photo earlier" disabled={index === 0} onClick={() => update((d) => ({ ...d, photos: move(d.photos, index, -1) }))}><ArrowUp size={12} /></button>{" "}
                      <button type="button" className="mini-button" aria-label="Move photo later" disabled={index === draft.photos.length - 1} onClick={() => update((d) => ({ ...d, photos: move(d.photos, index, 1) }))}><ArrowDown size={12} /></button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <ListingPricingSection draft={draft} onChange={(pricing) => update((d) => ({ ...d, pricing }))} />

          <section className="listing-panel" id="shipping" aria-labelledby="ship-h">
            <h2 id="ship-h">Shipping</h2>
            <p className="panel-sub">Weigh and measure the packed item; these are never estimated for you. {!profile.requiresShipping && "Optional for local pickup."}</p>
            <label className="listing-field">
              Shipping arrangement
              <select value={draft.shipping.whoPays} onChange={(e) => update((d) => ({ ...d, shipping: { ...d.shipping, whoPays: e.target.value as ListingDraft["shipping"]["whoPays"], confirmed: false } }))}>
                <option value="">Choose…</option>
                <option value="buyer">Buyer pays shipping</option>
                <option value="seller">Free shipping (I pay)</option>
                <option value="local-pickup">Local pickup only</option>
              </select>
            </label>
            {draft.shipping.whoPays !== "local-pickup" && (
              <div className="money-grid">
                {(
                  [
                    ["weightLb", "Weight (lb)"],
                    ["weightOz", "Weight (oz)"],
                    ["handlingDays", "Handling time (business days)"],
                    ["length", "Length (in)"],
                    ["width", "Width (in)"],
                    ["height", "Height (in)"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="listing-field" key={key}>
                    {label}
                    <input inputMode="decimal" value={draft.shipping[key]} onChange={(e) => update((d) => ({ ...d, shipping: { ...d.shipping, [key]: e.target.value, confirmed: false } }))} />
                  </label>
                ))}
                <label className="listing-field" style={{ gridColumn: "1 / -1" }}>
                  Shipping service (optional)
                  <input value={draft.shipping.service} placeholder="e.g. USPS Ground Advantage" onChange={(e) => update((d) => ({ ...d, shipping: { ...d.shipping, service: e.target.value, confirmed: false } }))} />
                </label>
              </div>
            )}
            <label className="check-row">
              <input type="checkbox" checked={draft.shipping.confirmed} onChange={(e) => update((d) => ({ ...d, shipping: { ...d.shipping, confirmed: e.target.checked } }))} />
              <span>I've weighed and measured the packed item; these shipping details are accurate.</span>
            </label>
          </section>

          {!!draft.recommendations.length && (
            <section className="listing-panel" aria-labelledby="rec-h">
              <h2 id="rec-h">Tips for {profile.label}</h2>
              <ul className="checklist">
                {draft.recommendations.map((r) => (
                  <li key={r}><Sparkles size={14} /> <span>{r}</span></li>
                ))}
              </ul>
            </section>
          )}

          <section className="listing-panel" id="export" aria-labelledby="exp-h">
            <h2 id="exp-h">Copy to {profile.label}</h2>
            <p className="panel-sub">{profile.limitNote} {draft.marketplace !== "ebay" && `ResellAI doesn't post to ${profile.label} for you; paste these into the ${profile.label} listing form.`}</p>
            <div className="spec-actions" style={{ justifyContent: "flex-start" }}>
              <CopyButton text={exported.title} label="Copy title" />
              <CopyButton text={exported.description} label="Copy description" />
              <CopyButton text={exported.price} label="Copy price" />
              <CopyButton text={exported.text} label="Copy everything" />
              <button type="button" className="mini-button" onClick={() => download(`${(draft.title.value || "listing").replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.txt`, exported.text)}>
                <Download size={14} /> Download .txt
              </button>
            </div>
            <div className="export-box" aria-label="Listing export preview">{exported.text}</div>
          </section>

          {draft.marketplace === "ebay" && <EbayPublishPanel draft={draft} readiness={readiness} onChange={(fn) => update(fn)} />}
        </div>

        <aside className="listing-aside" aria-label="Listing readiness">
          <div className="listing-panel">
            <h2 style={{ fontSize: 18 }}>Before you list</h2>
            {readiness.publishable ? (
              <div className="ready-banner"><CheckCircle2 size={18} /> Ready for {profile.label}</div>
            ) : (
              <p className="panel-sub" style={{ marginBottom: 0 }}>{readiness.blockers.length} item{readiness.blockers.length === 1 ? "" : "s"} to complete for {profile.label}.</p>
            )}
            <ul className="checklist">
              {readiness.blockers.map((b) => (
                <li key={b.id}><XCircle size={15} className="block-icon" /> <a href={`#${b.target}`}>{b.message}</a></li>
              ))}
              {readiness.warnings.map((w) => (
                <li key={w.id} className="warn"><AlertTriangle size={15} /> <a href={`#${w.target}`}>{w.message}</a></li>
              ))}
            </ul>
          </div>
          <div className="listing-panel">
            <p className="fine" style={{ marginTop: 0 }}>
              Drafts and photo copies are stored only in this browser. Prices are based on active asking prices, never sold prices. ResellAI never claims authenticity.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function move<T>(list: T[], index: number, delta: number) {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
