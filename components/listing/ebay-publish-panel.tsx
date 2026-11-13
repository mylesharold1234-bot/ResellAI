"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Link2, Search, Send, XCircle } from "lucide-react";
import { buildAspects, ebayCondition, ebayPublishIssues } from "../../lib/ebay-seller/payload";
import type { assessListing } from "../../lib/listing/readiness";
import type { ListingDraft } from "../../lib/listing/types";
import { dollars } from "./listing-bits";

type Status = { environment: "production" | "sandbox"; configured: boolean; missing: string[]; publishingEnabled: boolean; connected: boolean; connectedAt: string | null };
type Option = { id: string; name: string };
type Setup = { policies: { fulfillment: Option[]; payment: Option[]; return: Option[] }; locations: { key: string; name: string }[] };

const connectMessages: Record<string, string> = {
  connected: "eBay account connected.",
  declined: "eBay sign-in was cancelled.",
  "state-mismatch": "The eBay sign-in couldn't be verified. Try connecting again.",
  failed: "eBay sign-in failed. Try again.",
  "not-configured": "eBay seller access isn't configured on this server yet.",
};

export function EbayPublishPanel({ draft, readiness, onChange }: { draft: ListingDraft; readiness: ReturnType<typeof assessListing>; onChange: (fn: (d: ListingDraft) => ListingDraft) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState("");
  const [query, setQuery] = useState(draft.identification.productName || "");
  const [categories, setCategories] = useState<{ id: string; name: string; path: string }[]>([]);
  const [required, setRequired] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; issues?: string[] } | null>(null);
  const [flash, setFlash] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("ebay");
    if (param && connectMessages[param]) setFlash(connectMessages[param]);
    fetch("/api/ebay/seller/status", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus, () => setStatusError("Couldn't check eBay connection status."));
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    fetch("/api/ebay/seller/setup", { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        setSetup(b);
      })
      .catch((e) => setSetupError(e instanceof Error ? e.message : "Couldn't load your eBay policies."));
  }, [status?.connected]);

  useEffect(() => {
    const id = draft.ebay.categoryId;
    if (!status?.connected || !/^\d+$/.test(id)) return setRequired([]);
    fetch(`/api/ebay/seller/setup?categoryId=${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => setRequired(Array.isArray(b.requiredAspects) ? b.requiredAspects : []), () => setRequired([]));
  }, [status?.connected, draft.ebay.categoryId]);

  const setEbay = (patch: Partial<ListingDraft["ebay"]>) => onChange((d) => ({ ...d, ebay: { ...d.ebay, ...patch } }));
  const issues = ebayPublishIssues(draft, readiness, required);
  const aspects = buildAspects(draft);
  const missingAspects = required.filter((n) => !aspects[n]);
  const published = draft.ebay.publish?.status === "published" ? draft.ebay.publish : null;
  const itemHost = status?.environment === "sandbox" ? "https://www.sandbox.ebay.com" : "https://www.ebay.com";

  async function searchCategories() {
    if (!query.trim()) return;
    const r = await fetch(`/api/ebay/seller/setup?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
    const b = await r.json().catch(() => ({}));
    setCategories(Array.isArray(b.categories) ? b.categories : []);
    if (!r.ok) setSetupError(b.error || "Category search failed.");
  }

  async function publish() {
    if (inFlight.current) return; // duplicate-click guard; the server also locks per SKU
    inFlight.current = true;
    setPublishing(true);
    setResult(null);
    try {
      const r = await fetch("/api/ebay/seller/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, confirm: true, requiredAspects: required }),
      });
      const b = await r.json().catch(() => ({}));
      if (b.record) setEbay({ publish: { sku: b.record.sku, offerId: b.record.offerId, listingId: b.record.listingId, status: b.record.status, lastError: b.record.lastError, updatedAt: b.record.updatedAt } });
      if (!r.ok) setResult({ ok: false, message: b.error || "Publishing failed.", issues: b.issues });
      else setResult({ ok: true, message: b.alreadyPublished ? "This item was already listed; nothing was published twice." : "Published on eBay." });
    } catch {
      setResult({ ok: false, message: "Couldn't reach ResellAI's server. Check your connection; retrying won't create a duplicate listing." });
    } finally {
      inFlight.current = false;
      setPublishing(false);
      setConfirming(false);
    }
  }

  return (
    <section className="listing-panel" id="ebay-publish" aria-labelledby="ebay-h">
      <h2 id="ebay-h">
        Publish to eBay
        {status && <span className={`badge ${status.environment === "sandbox" ? "inferred" : "identified"}`}>{status.environment === "sandbox" ? "Sandbox · test listings" : "Production · live listings"}</span>}
      </h2>
      <p className="panel-sub">Uses eBay's official seller APIs with your permission. Nothing is listed until you review and confirm.</p>
      {flash && <p className="tip" role="status">{flash}</p>}
      {statusError && <p className="error">{statusError}</p>}
      {status && !status.configured && (
        <div className="warn-box">
          <b>Direct publishing isn't set up on this server.</b> Your draft and the copy/export tools above work without it. To enable it, the server needs:
          <ul>{status.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          See <code>docs/LISTING-GENERATOR.md</code> for the eBay developer setup.
        </div>
      )}
      {status?.configured && !status.connected && (
        <p className="block">
          <a className="button" href={`/api/ebay/seller/connect?return=${encodeURIComponent(`/listings/${draft.id}`)}`}>
            <Link2 size={17} /> Connect eBay seller account
          </a>
        </p>
      )}
      {status?.connected && (
        <>
          <p className="fine">
            eBay account connected{status.connectedAt ? ` on ${new Date(status.connectedAt).toLocaleDateString()}` : ""}.{" "}
            <button
              type="button"
              className="text-link"
              onClick={async () => {
                await fetch("/api/ebay/seller/disconnect", { method: "POST" });
                setStatus({ ...status, connected: false });
              }}
            >
              Disconnect
            </button>
          </p>
          {setupError && <p className="error">{setupError}</p>}
          <label className="listing-field">
            eBay category
            <span style={{ display: "flex", gap: 8 }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search categories" />
              <button type="button" className="mini-button" onClick={() => void searchCategories()}><Search size={14} /> Find</button>
            </span>
          </label>
          {!!categories.length && (
            <div className="price-options">
              {categories.map((c) => (
                <button type="button" key={c.id} className="mini-button" aria-pressed={draft.ebay.categoryId === c.id} onClick={() => setEbay({ categoryId: c.id })}>
                  {c.path} ({c.id})
                </button>
              ))}
            </div>
          )}
          <p className="fine">Selected category ID: {draft.ebay.categoryId || "none"}</p>
          {missingAspects.map((name) => (
            <label className="listing-field" key={name}>
              {name} <span className="req">* required by eBay for this category</span>
              <input value={draft.ebay.extraAspects?.[name] || ""} onChange={(e) => setEbay({ extraAspects: { ...(draft.ebay.extraAspects || {}), [name]: e.target.value } })} />
            </label>
          ))}
          {setup && (
            <div className="money-grid">
              {(
                [
                  ["fulfillmentPolicyId", "Shipping policy", setup.policies.fulfillment],
                  ["paymentPolicyId", "Payment policy", setup.policies.payment],
                  ["returnPolicyId", "Return policy", setup.policies.return],
                ] as const
              ).map(([key, label, options]) => (
                <label className="listing-field" key={key}>
                  {label}
                  <select value={draft.ebay[key]} onChange={(e) => setEbay({ [key]: e.target.value })}>
                    <option value="">Choose…</option>
                    {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
              ))}
              <label className="listing-field">
                Ships from
                <select value={draft.ebay.merchantLocationKey} onChange={(e) => setEbay({ merchantLocationKey: e.target.value })}>
                  <option value="">Choose…</option>
                  {setup.locations.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
                </select>
              </label>
            </div>
          )}
          {setup && (!setup.policies.fulfillment.length || !setup.locations.length) && (
            <p className="fine">Create business policies and an inventory location in your eBay seller account if none appear here.</p>
          )}
        </>
      )}
      <label className="listing-field">
        Hosted photo URLs for eBay (one per line, https://)
        <textarea rows={3} value={draft.ebay.imageUrls.join("\n")} placeholder="https://…" onChange={(e) => setEbay({ imageUrls: e.target.value.split(/\s+/).map((u) => u.trim()).filter(Boolean) })} />
      </label>
      <p className="fine">eBay downloads listing photos from public URLs. Photos in your draft stay in this browser, so upload them to an image host (or eBay's listing form) and paste the links here. Direct photo upload is planned.</p>

      {published ? (
        <div className="ready-banner" style={{ marginTop: 16 }}>
          Listed on eBay · listing {published.listingId}{" "}
          <a href={`${itemHost}/itm/${published.listingId}`} target="_blank" rel="noopener noreferrer" className="text-link">
            View <ExternalLink size={13} />
          </a>
        </div>
      ) : (
        <>
          {!!issues.length && (
            <ul className="checklist">
              {issues.map((i) => <li key={i}><XCircle size={15} className="block-icon" /> <span>{i}</span></li>)}
            </ul>
          )}
          <p className="block">
            <button type="button" className="button" disabled={!status?.connected || !status.publishingEnabled || !!issues.length || publishing} onClick={() => setConfirming(true)}>
              <Send size={17} /> Review & publish
            </button>
          </p>
          {status?.connected && !status.publishingEnabled && <p className="fine">Publishing is switched off on this server (EBAY_SELLER_PUBLISHING_ENABLED).</p>}
          {draft.ebay.publish?.status === "failed" && <p className="fine">Last attempt: {draft.ebay.publish.lastError}</p>}
        </>
      )}
      {result && (
        <div className={result.ok ? "tip" : "warn-box"} role="status">
          {result.message}
          {!!result.issues?.length && <ul>{result.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        </div>
      )}

      {confirming && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-h">
          <div className="dialog">
            <h2 id="confirm-h">{status?.environment === "production" ? "Publish a live eBay listing?" : "Publish a sandbox test listing?"}</h2>
            <p className="panel-sub">
              {status?.environment === "production"
                ? "This creates a real listing that buyers can purchase immediately, using your eBay account and policies."
                : "This creates a listing in eBay's sandbox (test) environment. It isn't visible to real buyers."}
            </p>
            <dl>
              <dt>Title</dt><dd>{draft.title.value}</dd>
              <dt>Price</dt><dd>{dollars(draft.pricing.price)} · quantity 1</dd>
              <dt>Condition</dt><dd>{ebayCondition(draft)}</dd>
              <dt>Category</dt><dd>{draft.ebay.categoryId}</dd>
              <dt>Photos</dt><dd>{draft.ebay.imageUrls.length}</dd>
            </dl>
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={publishing}>Cancel</button>
              <button type="button" className="button" onClick={() => void publish()} disabled={publishing} aria-busy={publishing}>
                {publishing ? "Publishing…" : "Yes, publish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
