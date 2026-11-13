"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, ImageUp, Link2, RefreshCw, Search, Send, XCircle } from "lucide-react";
import type { AllowedCondition, CategoryAspect, ShippingServiceOption } from "../../lib/ebay-seller/client";
import { buildAspects, compatibleConditions, conditionEnumById, chosenConditionId, ebayPublishIssues, photosNeedingUpload, suggestedConditionId } from "../../lib/ebay-seller/payload";
import { getPhotos } from "../../lib/listing/drafts-store";
import type { assessListing } from "../../lib/listing/readiness";
import type { EbayHostedImage, ListingDraft } from "../../lib/listing/types";
import { dollars } from "./listing-bits";

type Status = { environment: "production" | "sandbox"; configured: boolean; missing: string[]; publishingEnabled: boolean; testEndpoints: boolean; connected: boolean; connectedAt: string | null };
type Option = { id: string; name: string };
type Setup = { policies: { fulfillment: Option[]; payment: Option[]; return: Option[] }; locations: { key: string; name: string }[] };
type Rules = { aspects: CategoryAspect[]; conditions: AllowedCondition[]; conditionRequired: boolean };
type ListingState = { listingId: string | null; listingStatus: string | null; offerStatus: string | null; url: string | null };

const connectMessages: Record<string, string> = {
  connected: "eBay account connected.",
  declined: "eBay sign-in was cancelled.",
  "state-mismatch": "The eBay sign-in couldn't be verified. Try connecting again.",
  failed: "eBay sign-in failed. Try again.",
  "not-configured": "eBay seller access isn't configured on this server yet.",
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || "eBay request failed.");
  return b as T;
}
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error || "eBay request failed."), { body: b, status: r.status });
  return b as T;
}

export function EbayPublishPanel({ draft, readiness, onChange, beforeLeave }: { draft: ListingDraft; readiness: ReturnType<typeof assessListing>; onChange: (fn: (d: ListingDraft) => ListingDraft) => void; beforeLeave?: () => Promise<void> }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [rulesFor, setRulesFor] = useState("");
  const [query, setQuery] = useState(draft.title.value || draft.identification.productName || "");
  const [categories, setCategories] = useState<{ id: string; name: string; path: string }[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploadState, setUploadState] = useState<Record<string, "uploading" | "error">>({});
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "publishing">("idle");
  const [result, setResult] = useState<{ ok: boolean; message: string; issues?: string[] } | null>(null);
  const [listing, setListing] = useState<ListingState | null>(null);
  const [flash, setFlash] = useState("");
  const inFlight = useRef(false);
  const autoCategory = useRef(false);
  const setEbay = useCallback((patch: Partial<ListingDraft["ebay"]>) => onChange((d) => ({ ...d, ebay: { ...d.ebay, ...patch } })), [onChange]);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("ebay");
    if (param && connectMessages[param]) setFlash(connectMessages[param]);
    getJson<Status>("/api/ebay/seller/status").then(setStatus, () => setError("Couldn't check eBay connection status."));
  }, []);

  useEffect(() => {
    let urls: string[] = [];
    getPhotos(draft.id).then((photos) => {
      urls = photos.map((p) => URL.createObjectURL(p.blob));
      setThumbs(Object.fromEntries(photos.map((p, i) => [p.photoId, urls[i]])));
    }, () => undefined);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [draft.id]);

  const connected = !!status?.connected;

  // Account data: policies and locations. A single option of a kind is selected automatically.
  const loadSetup = useCallback(async () => {
    try {
      const s = await getJson<Setup>("/api/ebay/seller/setup");
      setSetup(s);
      onChange((d) => {
        const pick = (current: string, options: { id?: string; key?: string }[]) => current || (options.length === 1 ? String(options[0].id ?? options[0].key) : "");
        return {
          ...d,
          ebay: {
            ...d.ebay,
            fulfillmentPolicyId: pick(d.ebay.fulfillmentPolicyId, s.policies.fulfillment),
            paymentPolicyId: pick(d.ebay.paymentPolicyId, s.policies.payment),
            returnPolicyId: pick(d.ebay.returnPolicyId, s.policies.return),
            merchantLocationKey: pick(d.ebay.merchantLocationKey, s.locations),
          },
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your eBay account settings.");
    }
  }, [onChange]);
  useEffect(() => {
    if (connected) void loadSetup();
  }, [connected, loadSetup]);

  // Category: suggest from the title once; the seller can change it.
  const searchCategories = useCallback(
    async (text: string, autoSelect: boolean) => {
      if (!text.trim()) return;
      try {
        const { categories: found } = await getJson<{ categories: { id: string; name: string; path: string }[] }>(`/api/ebay/seller/setup?q=${encodeURIComponent(text.trim().slice(0, 100))}`);
        setCategories(found);
        if (autoSelect && found[0]) setEbay({ categoryId: found[0].id, categoryName: found[0].path });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Category search failed.");
      }
    },
    [setEbay],
  );
  useEffect(() => {
    if (!connected || autoCategory.current || draft.ebay.categoryId) return;
    autoCategory.current = true;
    void searchCategories(draft.title.value || draft.identification.productName || "", true);
  }, [connected, draft.ebay.categoryId, draft.title.value, draft.identification.productName, searchCategories]);

  // Category rules: required item specifics and allowed conditions, straight from eBay.
  useEffect(() => {
    const id = draft.ebay.categoryId;
    if (!connected || !/^\d+$/.test(id) || rulesFor === id) return;
    setRulesFor(id);
    setRules(null);
    getJson<Rules>(`/api/ebay/seller/setup?categoryId=${id}`).then(
      (r) => {
        setRules(r);
        onChange((d) => {
          const current = d.ebay.conditionId;
          if (current && r.conditions.some((c) => c.id === current)) return d;
          return { ...d, ebay: { ...d.ebay, conditionId: suggestedConditionId(d, r.conditions) ?? "" } };
        });
      },
      (e) => setError(e instanceof Error ? e.message : "Couldn't load eBay's requirements for this category."),
    );
  }, [connected, draft.ebay.categoryId, rulesFor, onChange]);

  const publishedRecord = draft.ebay.publish?.status === "published" ? draft.ebay.publish : null;
  const pending = status ? photosNeedingUpload(draft, status.environment) : [];
  const issues = ebayPublishIssues(draft, readiness, rules ?? undefined, { photosPending: connected });
  const aspects = useMemo(() => buildAspects(draft, rules?.aspects), [draft, rules]);
  const requiredAspects = (rules?.aspects || []).filter((a) => a.required);
  const recommendedMissing = (rules?.aspects || []).filter((a) => !a.required && a.recommended && !aspects[a.name]).slice(0, 12);
  const conditionOptions = rules ? (compatibleConditions(draft, rules.conditions).length ? compatibleConditions(draft, rules.conditions) : rules.conditions) : [];
  const conditionName = (id: string | null) => rules?.conditions.find((c) => c.id === id)?.name || (id ? conditionEnumById[id] : "") || "—";

  async function uploadPhotos(current: ListingDraft): Promise<ListingDraft> {
    const env = status!.environment;
    const needed = photosNeedingUpload(current, env);
    if (!needed.length) return current;
    const blobs = await getPhotos(current.id);
    let hosted = { ...(current.ebay.hostedImages || {}) };
    for (const photo of needed) {
      const blob = blobs.find((b) => b.photoId === photo.id);
      if (!blob) throw new Error(`Photo "${photo.name}" is no longer saved in this browser.`);
      setUploadState((s) => ({ ...s, [photo.id]: "uploading" }));
      const form = new FormData();
      form.append("image", new File([blob.blob], blob.name || "photo.jpg", { type: blob.blob.type }));
      const r = await fetch("/api/ebay/seller/images", { method: "POST", body: form });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setUploadState((s) => ({ ...s, [photo.id]: "error" }));
        throw new Error(b.error || "eBay didn't accept a photo.");
      }
      const image: EbayHostedImage = { url: b.url, expiresAt: b.expiresAt ?? null, environment: env, uploadedAt: new Date().toISOString() };
      hosted = { ...hosted, [photo.id]: image };
      setUploadState((s) => {
        const next = { ...s };
        delete next[photo.id];
        return next;
      });
      onChange((d) => ({ ...d, ebay: { ...d.ebay, hostedImages: { ...(d.ebay.hostedImages || {}), [photo.id]: image } } }));
    }
    return { ...current, ebay: { ...current.ebay, hostedImages: hosted } };
  }

  async function publish() {
    if (inFlight.current || !status) return; // duplicate-click guard; the server also locks per SKU
    inFlight.current = true;
    setResult(null);
    try {
      setPhase("uploading");
      const ready = await uploadPhotos(draft);
      setPhase("publishing");
      const b = await postJson<{ record: NonNullable<ListingDraft["ebay"]["publish"]>; alreadyPublished: boolean; url: string | null }>("/api/ebay/seller/publish", { draft: ready, confirm: true });
      setEbay({ publish: b.record });
      setListing({ listingId: b.record.listingId, listingStatus: null, offerStatus: "PUBLISHED", url: b.url });
      setResult({ ok: true, message: b.alreadyPublished ? "This item was already listed; nothing was published twice." : "Published on eBay." });
    } catch (e) {
      const body = (e as { body?: { record?: ListingDraft["ebay"]["publish"]; issues?: string[] } }).body;
      if (body?.record) setEbay({ publish: body.record });
      setResult({ ok: false, message: e instanceof Error ? e.message : "Publishing failed. Retrying won't create a duplicate listing.", issues: body?.issues });
    } finally {
      inFlight.current = false;
      setPhase("idle");
      setConfirming(false);
    }
  }

  async function refreshListing() {
    try {
      const s = await getJson<ListingState & { listingId: string | null }>(`/api/ebay/seller/listing?draftId=${encodeURIComponent(draft.id)}`);
      setListing(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the listing status.");
    }
  }

  const step = (n: number, title: string, done: boolean) => (
    <h3 className="block" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {done ? <CheckCircle2 size={18} color="#1d7a4a" /> : <span className="badge neutral">{n}</span>} {title}
    </h3>
  );

  return (
    <section className="listing-panel" id="ebay-publish" aria-labelledby="ebay-h">
      <h2 id="ebay-h">
        Publish to eBay
        {status && (
          <span className={`badge ${status.environment === "sandbox" ? "inferred" : "identified"}`}>
            {status.testEndpoints ? "Test endpoints · simulated" : status.environment === "sandbox" ? "Sandbox · test listings" : "Production · live listings"}
          </span>
        )}
      </h2>
      <p className="panel-sub">Uses eBay's official seller APIs with your permission. Photos, item specifics and pricing come from this draft. Nothing is listed until you confirm.</p>
      {flash && <p className="tip" role="status">{flash}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {status && !status.configured && (
        <div className="warn-box">
          <b>Direct publishing isn't set up on this server.</b> Your draft and the copy/export tools above work without it. The server needs:
          <ul>{status.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          See <code>docs/LISTING-GENERATOR.md</code> for the eBay developer setup.
        </div>
      )}

      {status?.configured && (
        <>
          {step(1, "Connect your eBay seller account", connected)}
          {!connected ? (
            <p>
              <a
                className="button"
                href={`/api/ebay/seller/connect?return=${encodeURIComponent(`/listings/${draft.id}`)}`}
                onClick={async (e) => {
                  // Save the draft before leaving for eBay's sign-in page.
                  e.preventDefault();
                  const href = e.currentTarget.href;
                  await beforeLeave?.().catch(() => undefined);
                  window.location.assign(href);
                }}
              >
                <Link2 size={17} /> Connect eBay seller account
              </a>
            </p>
          ) : (
            <p className="fine" style={{ marginTop: 0 }}>
              Connected{status.connectedAt ? ` on ${new Date(status.connectedAt).toLocaleDateString()}` : ""}.{" "}
              <button type="button" className="text-link" onClick={async () => { await fetch("/api/ebay/seller/disconnect", { method: "POST" }); setStatus({ ...status, connected: false }); setSetup(null); }}>
                Disconnect
              </button>
            </p>
          )}
        </>
      )}

      {connected && status && (
        <>
          {step(2, "Category & item specifics", !!draft.ebay.categoryId && !!rules && requiredAspects.every((a) => aspects[a.name]))}
          <p className="fine" style={{ marginTop: 0 }}>
            {draft.ebay.categoryName ? <>Category: <b>{draft.ebay.categoryName}</b> ({draft.ebay.categoryId}). Suggested by eBay from your title; change it if it's wrong.</> : "Searching eBay categories…"}
          </p>
          <label className="listing-field">
            Find a different category
            <span style={{ display: "flex", gap: 8 }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search eBay categories" />
              <button type="button" className="mini-button" onClick={() => void searchCategories(query, false)}><Search size={14} /> Find</button>
            </span>
          </label>
          {categories.length > 1 && (
            <div className="price-options">
              {categories.map((c) => (
                <button type="button" key={c.id} className="mini-button" aria-pressed={draft.ebay.categoryId === c.id} onClick={() => setEbay({ categoryId: c.id, categoryName: c.path })}>
                  {c.path}
                </button>
              ))}
            </div>
          )}
          {rules && (
            <div className="spec-rows" style={{ marginTop: 12 }}>
              {requiredAspects.map((a) => {
                const filled = aspects[a.name]?.[0];
                const fromDraft = filled && !draft.ebay.extraAspects?.[a.name];
                return (
                  <div className="spec-row" key={a.name}>
                    <label htmlFor={`asp-${a.name}`}>{a.name} <span className="req">*</span><small>Required by eBay for this category</small></label>
                    {fromDraft ? (
                      <span>{filled}</span>
                    ) : a.mode === "SELECTION_ONLY" && a.values.length ? (
                      <select id={`asp-${a.name}`} className="listing-input" value={draft.ebay.extraAspects?.[a.name] || ""} onChange={(e) => setEbay({ extraAspects: { ...(draft.ebay.extraAspects || {}), [a.name]: e.target.value } })}>
                        <option value="">Choose…</option>
                        {a.values.map((v) => <option key={v}>{v}</option>)}
                      </select>
                    ) : (
                      <>
                        <input id={`asp-${a.name}`} className="listing-input" list={`asp-list-${a.name}`} value={draft.ebay.extraAspects?.[a.name] || ""} onChange={(e) => setEbay({ extraAspects: { ...(draft.ebay.extraAspects || {}), [a.name]: e.target.value } })} />
                        <datalist id={`asp-list-${a.name}`}>{a.values.slice(0, 50).map((v) => <option key={v} value={v} />)}</datalist>
                      </>
                    )}
                    <div className="spec-actions">{fromDraft ? <span className="badge confirmed">From your listing</span> : filled ? <span className="badge confirmed">Entered by you</span> : <span className="badge missing">Needed</span>}</div>
                  </div>
                );
              })}
            </div>
          )}
          {!!recommendedMissing.length && (
            <details className="block">
              <summary className="fine">Optional details eBay recommends ({recommendedMissing.length})</summary>
              <div className="money-grid">
                {recommendedMissing.map((a) => (
                  <label className="listing-field" key={a.name}>
                    {a.name}
                    <input list={`rec-${a.name}`} value={draft.ebay.extraAspects?.[a.name] || ""} onChange={(e) => setEbay({ extraAspects: { ...(draft.ebay.extraAspects || {}), [a.name]: e.target.value } })} />
                    <datalist id={`rec-${a.name}`}>{a.values.slice(0, 50).map((v) => <option key={v} value={v} />)}</datalist>
                  </label>
                ))}
              </div>
            </details>
          )}
          {rules && (
            <label className="listing-field">
              eBay condition
              <select value={draft.ebay.conditionId || ""} onChange={(e) => setEbay({ conditionId: e.target.value })}>
                <option value="">Choose…</option>
                {conditionOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}

          {step(3, "Shipping, payment & returns", !!(draft.ebay.fulfillmentPolicyId && draft.ebay.paymentPolicyId && draft.ebay.returnPolicyId && draft.ebay.merchantLocationKey))}
          {setup ? (
            <PoliciesAndLocation draft={draft} setup={setup} onSetup={setSetup} setEbay={setEbay} />
          ) : (
            <p className="fine" style={{ marginTop: 0 }}>Loading your eBay policies…</p>
          )}

          {step(4, "Photos", !pending.length)}
          <div className="photo-select">
            {draft.photos.filter((p) => p.selected).map((p) => {
              const hosted = draft.ebay.hostedImages?.[p.id];
              const state = uploadState[p.id];
              const done = hosted && !pending.some((x) => x.id === p.id);
              return (
                <div className={`photo-card${done ? " selected" : ""}`} key={p.id}>
                  {thumbs[p.id] ? <img src={thumbs[p.id]} alt={p.name} /> : <div className="thumb" />}
                  <span className="fine" style={{ marginTop: 0 }}>{state === "uploading" ? "Uploading to eBay…" : state === "error" ? "Upload failed" : done ? "On eBay ✓" : "Uploads when you publish"}</span>
                </div>
              );
            })}
          </div>
          {!!pending.length && (
            <p>
              <button type="button" className="mini-button" disabled={phase !== "idle" || !status.publishingEnabled} onClick={async () => { try { setPhase("uploading"); await uploadPhotos(draft); } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); } finally { setPhase("idle"); } }}>
                <ImageUp size={14} /> Upload photos to eBay now
              </button>
            </p>
          )}
          <details>
            <summary className="fine">Add photos by URL instead (advanced)</summary>
            <label className="listing-field">
              Hosted photo URLs (one per line, https://)
              <textarea rows={2} value={draft.ebay.imageUrls.join("\n")} onChange={(e) => setEbay({ imageUrls: e.target.value.split(/\s+/).map((u) => u.trim()).filter(Boolean) })} />
            </label>
          </details>
        </>
      )}

      {publishedRecord || listing?.listingId ? (
        <div className="ready-banner" style={{ marginTop: 16, flexWrap: "wrap" }}>
          <CheckCircle2 size={18} /> Listed on eBay · #{listing?.listingId || publishedRecord?.listingId}
          {listing?.listingStatus && <span className="badge identified">{listing.listingStatus}</span>}
          <a href={listing?.url || `${status?.environment === "sandbox" ? "https://sandbox.ebay.com" : "https://www.ebay.com"}/itm/${listing?.listingId || publishedRecord?.listingId}`} target="_blank" rel="noopener noreferrer" className="text-link">
            View on eBay <ExternalLink size={13} />
          </a>
          {connected && <button type="button" className="mini-button" onClick={() => void refreshListing()}><RefreshCw size={13} /> Check status</button>}
        </div>
      ) : (
        connected && (
          <>
            {step(5, "Review & publish", false)}
            {!!issues.length && (
              <ul className="checklist">
                {issues.map((i) => <li key={i}><XCircle size={15} className="block-icon" /> <span>{i}</span></li>)}
              </ul>
            )}
            <p className="block">
              <button type="button" className="button" disabled={!status?.publishingEnabled || !!issues.length || phase !== "idle"} onClick={() => setConfirming(true)}>
                <Send size={17} /> Review & publish
              </button>
            </p>
            {!status?.publishingEnabled && <p className="fine">Changes to eBay are switched off on this server (EBAY_SELLER_PUBLISHING_ENABLED).</p>}
            {draft.ebay.publish?.status === "failed" && <p className="fine">Last attempt: {draft.ebay.publish.lastError}</p>}
          </>
        )
      )}
      {result && (
        <div className={result.ok ? "tip" : "warn-box"} role="status">
          {result.message}
          {!!result.issues?.length && <ul>{result.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        </div>
      )}

      {confirming && status && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-h">
          <div className="dialog">
            <h2 id="confirm-h">{status.environment === "production" && !status.testEndpoints ? "Publish a live eBay listing?" : "Publish a test listing?"}</h2>
            <p className="panel-sub">
              {status.environment === "production" && !status.testEndpoints
                ? "This creates a real listing that buyers can purchase immediately, using your eBay account and policies."
                : "This creates a listing in eBay's sandbox or a local test server. Real buyers won't see it."}
            </p>
            <dl>
              <dt>Title</dt><dd>{draft.title.value}</dd>
              <dt>Price</dt><dd>{dollars(draft.pricing.price)} · quantity 1</dd>
              <dt>Condition</dt><dd>{conditionName(chosenConditionId(draft))}</dd>
              <dt>Category</dt><dd>{draft.ebay.categoryName || draft.ebay.categoryId}</dd>
              <dt>Policies</dt>
              <dd>
                {[
                  setup?.policies.fulfillment.find((p) => p.id === draft.ebay.fulfillmentPolicyId)?.name,
                  setup?.policies.payment.find((p) => p.id === draft.ebay.paymentPolicyId)?.name,
                  setup?.policies.return.find((p) => p.id === draft.ebay.returnPolicyId)?.name,
                ].filter(Boolean).join(" · ")}
              </dd>
              <dt>Ships from</dt><dd>{setup?.locations.find((l) => l.key === draft.ebay.merchantLocationKey)?.name || draft.ebay.merchantLocationKey}</dd>
              <dt>Photos</dt><dd>{draft.photos.filter((p) => p.selected).length + draft.ebay.imageUrls.length}{pending.length ? ` (${pending.length} will upload to eBay first)` : ""}</dd>
              <dt>Specifics</dt><dd>{Object.entries(aspects).map(([k, v]) => `${k}: ${v[0]}`).join(" · ")}</dd>
            </dl>
            {phase !== "idle" && <p className="fine" role="status">{phase === "uploading" ? "Uploading photos to eBay…" : "Creating the listing on eBay…"}</p>}
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={phase !== "idle"}>Cancel</button>
              <button type="button" className="button" onClick={() => void publish()} disabled={phase !== "idle"} aria-busy={phase !== "idle"}>
                {phase === "idle" ? "Yes, publish" : "Publishing…"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PoliciesAndLocation({ draft, setup, onSetup, setEbay }: { draft: ListingDraft; setup: Setup; onSetup: (s: Setup) => void; setEbay: (p: Partial<ListingDraft["ebay"]>) => void }) {
  const [creating, setCreating] = useState<string>("");
  const [message, setMessage] = useState("");
  const [returns, setReturns] = useState({ returnsAccepted: true, days: 30 as 30 | 60, payer: "BUYER" as "BUYER" | "SELLER" });
  const [shipping, setShipping] = useState({ handlingDays: draft.shipping.handlingDays || "1", serviceCode: "", freeShipping: draft.shipping.whoPays === "seller", cost: "" });
  const [services, setServices] = useState<ShippingServiceOption[] | null>(null);
  const [location, setLocation] = useState({ name: "Home", city: "", stateOrProvince: "", postalCode: "" });

  useEffect(() => {
    if (setup.policies.fulfillment.length || services) return;
    getJson<{ shippingServices: ShippingServiceOption[] }>("/api/ebay/seller/setup?shippingServices=1").then((r) => setServices(r.shippingServices), () => setServices([]));
  }, [setup.policies.fulfillment.length, services]);

  async function create(kind: "fulfillment" | "payment" | "return" | "location", body: Record<string, unknown>) {
    setCreating(kind);
    setMessage("");
    try {
      if (kind === "location") {
        const r = await postJson<{ key: string; name: string }>("/api/ebay/seller/location", { ...body, confirm: true });
        onSetup({ ...setup, locations: [...setup.locations, { key: r.key, name: r.name }] });
        setEbay({ merchantLocationKey: r.key });
      } else {
        const r = await postJson<{ id: string; name: string }>("/api/ebay/seller/policies", { type: kind, ...body, confirm: true });
        onSetup({ ...setup, policies: { ...setup.policies, [kind]: [...setup.policies[kind], { id: r.id, name: r.name }] } });
        setEbay({ [`${kind}PolicyId`]: r.id } as Partial<ListingDraft["ebay"]>);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "eBay couldn't save that.");
    } finally {
      setCreating("");
    }
  }

  const select = (key: "fulfillmentPolicyId" | "paymentPolicyId" | "returnPolicyId", label: string, options: Option[]) => (
    <label className="listing-field">
      {label}
      <select value={draft.ebay[key]} onChange={(e) => setEbay({ [key]: e.target.value })}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );

  return (
    <div>
      {message && <p className="error" role="alert">{message}</p>}
      <div className="money-grid">
        {setup.policies.fulfillment.length ? select("fulfillmentPolicyId", "Shipping policy", setup.policies.fulfillment) : null}
        {setup.policies.payment.length ? select("paymentPolicyId", "Payment policy", setup.policies.payment) : null}
        {setup.policies.return.length ? select("returnPolicyId", "Return policy", setup.policies.return) : null}
        {setup.locations.length ? (
          <label className="listing-field">
            Ships from
            <select value={draft.ebay.merchantLocationKey} onChange={(e) => setEbay({ merchantLocationKey: e.target.value })}>
              <option value="">Choose…</option>
              {setup.locations.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {!setup.policies.fulfillment.length && (
        <div className="evidence-card block">
          <b>No shipping policy yet.</b> Create one on your eBay account:
          <div className="money-grid">
            <label className="listing-field">
              Shipping service
              <select value={shipping.serviceCode} onChange={(e) => setShipping({ ...shipping, serviceCode: e.target.value })}>
                <option value="">{services === null ? "Loading…" : "Choose…"}</option>
                {(services || []).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
            <label className="listing-field">
              Handling time (days)
              <input inputMode="numeric" value={shipping.handlingDays} onChange={(e) => setShipping({ ...shipping, handlingDays: e.target.value })} />
            </label>
            <label className="listing-field">
              Buyer pays ($)
              <input inputMode="decimal" disabled={shipping.freeShipping} value={shipping.cost} placeholder={shipping.freeShipping ? "Free" : "e.g. 12.00"} onChange={(e) => setShipping({ ...shipping, cost: e.target.value })} />
            </label>
          </div>
          <label className="check-row"><input type="checkbox" checked={shipping.freeShipping} onChange={(e) => setShipping({ ...shipping, freeShipping: e.target.checked })} /> <span>Offer free shipping</span></label>
          <button type="button" className="mini-button primary" disabled={!!creating} onClick={() => void create("fulfillment", { handlingDays: Number(shipping.handlingDays), serviceCode: shipping.serviceCode, freeShipping: shipping.freeShipping, cost: Number(shipping.cost) })}>
            {creating === "fulfillment" ? "Creating…" : "Create shipping policy"}
          </button>
        </div>
      )}
      {!setup.policies.payment.length && (
        <div className="evidence-card block">
          <b>No payment policy yet.</b> eBay manages buyer payments; this policy requires immediate payment.
          <p><button type="button" className="mini-button primary" disabled={!!creating} onClick={() => void create("payment", {})}>{creating === "payment" ? "Creating…" : "Create payment policy"}</button></p>
        </div>
      )}
      {!setup.policies.return.length && (
        <div className="evidence-card block">
          <b>No return policy yet.</b>
          <label className="check-row"><input type="checkbox" checked={returns.returnsAccepted} onChange={(e) => setReturns({ ...returns, returnsAccepted: e.target.checked })} /> <span>Accept returns</span></label>
          {returns.returnsAccepted && (
            <div className="money-grid">
              <label className="listing-field">
                Return window
                <select value={returns.days} onChange={(e) => setReturns({ ...returns, days: Number(e.target.value) as 30 | 60 })}>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                </select>
              </label>
              <label className="listing-field">
                Return shipping paid by
                <select value={returns.payer} onChange={(e) => setReturns({ ...returns, payer: e.target.value as "BUYER" | "SELLER" })}>
                  <option value="BUYER">Buyer</option>
                  <option value="SELLER">Seller (you)</option>
                </select>
              </label>
            </div>
          )}
          <button type="button" className="mini-button primary" disabled={!!creating} onClick={() => void create("return", returns)}>{creating === "return" ? "Creating…" : "Create return policy"}</button>
        </div>
      )}
      {!setup.locations.length && (
        <div className="evidence-card block">
          <b>Where does the item ship from?</b> eBay needs a ship-from location (city, state and ZIP; no street address).
          <div className="money-grid">
            <label className="listing-field">City<input value={location.city} onChange={(e) => setLocation({ ...location, city: e.target.value })} /></label>
            <label className="listing-field">State<input maxLength={2} value={location.stateOrProvince} placeholder="e.g. NY" onChange={(e) => setLocation({ ...location, stateOrProvince: e.target.value })} /></label>
            <label className="listing-field">ZIP<input inputMode="numeric" value={location.postalCode} onChange={(e) => setLocation({ ...location, postalCode: e.target.value })} /></label>
          </div>
          <button type="button" className="mini-button primary" disabled={!!creating} onClick={() => void create("location", location)}>{creating === "location" ? "Saving…" : "Save ship-from location"}</button>
        </div>
      )}
    </div>
  );
}
