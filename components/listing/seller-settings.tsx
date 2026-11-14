"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Link2, Loader2, XCircle } from "lucide-react";
import type { ShippingServiceOption } from "../../lib/ebay-seller/client";
import type { ListingDraft } from "../../lib/listing/types";
import { getJson, type EbaySeller } from "./use-ebay-seller";

/** Starts eBay's sign-in. The draft is saved first because the browser leaves the page. */
export function ConnectEbayButton({ draftId, beforeLeave, compact = false }: { draftId: string; beforeLeave?: () => Promise<void>; compact?: boolean }) {
  const href = `/api/ebay/seller/connect?return=${encodeURIComponent(`/listings/${draftId}`)}`;
  return (
    <a
      className={compact ? "mini-button primary" : "button"}
      href={href}
      onClick={async (e) => {
        e.preventDefault();
        await beforeLeave?.().catch(() => undefined);
        window.location.assign(href);
      }}
    >
      <Link2 size={compact ? 14 : 17} /> Connect eBay account
    </a>
  );
}

/** Connection status with a working, visible connection test. */
export function ConnectionRow({ seller, draftId, beforeLeave }: { seller: EbaySeller; draftId: string; beforeLeave?: () => Promise<void> }) {
  const { status, check } = seller;
  if (!status) return <p className="lx-muted"><Loader2 size={13} className="spinner" /> Checking your eBay connection…</p>;
  if (!status.configured)
    return (
      <div className="warn-box" style={{ marginTop: 0 }}>
        <b>Direct eBay publishing isn't set up on this server.</b> Copy/export works without it. Missing: {status.missing.join(", ")}. See <code>docs/LISTING-GENERATOR.md</code>.
      </div>
    );
  if (!status.connected)
    return (
      <div className="lx-connect">
        <p className="lx-muted">Connect once; ResellAI then reuses your eBay policies for every listing.</p>
        <ConnectEbayButton draftId={draftId} beforeLeave={beforeLeave} compact />
      </div>
    );
  return (
    <div>
      <div className="lx-conn">
        <span className="lx-ok"><CheckCircle2 size={15} /> Connected{status.connectedAt ? ` · ${new Date(status.connectedAt).toLocaleDateString()}` : ""}</span>
        <span className="lx-conn-actions">
          <button type="button" className="text-link" onClick={() => void seller.testConnection()} disabled={check.state === "checking"} aria-busy={check.state === "checking"}>
            {check.state === "checking" ? "Testing…" : "Test connection"}
          </button>
          <button type="button" className="text-link" onClick={() => void seller.disconnect()}>Disconnect</button>
        </span>
      </div>
      {check.state === "done" && (
        <p className={check.ok ? "lx-check ok" : "lx-check bad"} role="status" aria-live="polite">
          {check.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {check.message}
        </p>
      )}
    </div>
  );
}

type PolicyKey = "fulfillmentPolicyId" | "paymentPolicyId" | "returnPolicyId";

/**
 * The seller's eBay business policies and ship-from location. Existing ones are reused (a remembered or single
 * option is selected automatically). Nothing is created on the seller's eBay account unless they click a
 * "Create … on eBay" button, which states exactly what will be created.
 */
export function PoliciesAndLocation({ draft, seller, only }: { draft: ListingDraft; seller: EbaySeller; only?: "policies" | "location" }) {
  const { setup, setupError } = seller;
  const [creating, setCreating] = useState("");
  const [message, setMessage] = useState("");
  const [returns, setReturns] = useState({ returnsAccepted: true, days: 30 as 30 | 60, payer: "BUYER" as "BUYER" | "SELLER" });
  const [shipping, setShipping] = useState({ handlingDays: draft.shipping.handlingDays || "1", serviceCode: "", freeShipping: draft.shipping.whoPays === "seller", cost: "" });
  const [services, setServices] = useState<ShippingServiceOption[] | null>(null);
  const [location, setLocation] = useState({ name: "Home", city: "", stateOrProvince: "", postalCode: "" });

  useEffect(() => {
    if (!setup || setup.policies.fulfillment.length || services) return;
    getJson<{ shippingServices: ShippingServiceOption[] }>("/api/ebay/seller/setup?shippingServices=1").then((r) => setServices(r.shippingServices), () => setServices([]));
  }, [setup, services]);

  if (setupError)
    return (
      <p className="error" role="alert">
        {setupError} <button type="button" className="text-link" onClick={() => void seller.loadSetup()}>Retry</button>
      </p>
    );
  if (!setup) return <p className="lx-muted"><Loader2 size={13} className="spinner" /> Loading your eBay policies…</p>;

  async function run(kind: string, fn: () => Promise<void>) {
    setCreating(kind);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "eBay couldn't save that.");
    } finally {
      setCreating("");
    }
  }

  const select = (key: PolicyKey, label: string, options: { id: string; name: string; calculated?: boolean }[]) => (
    <label className="lx-field" key={key}>
      <span>{label}</span>
      <select value={draft.ebay[key]} onChange={(e) => seller.choose(key, e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.calculated ? " (calculated postage)" : ""}</option>)}
      </select>
    </label>
  );
  const p = setup.policies;
  const showPolicies = only !== "location";
  const showLocation = only !== "policies";

  return (
    <div className="lx-settings">
      {message && <p className="error" role="alert">{message}</p>}
      <div className="lx-field-grid">
        {showPolicies && p.fulfillment.length > 0 && select("fulfillmentPolicyId", "Shipping policy", p.fulfillment)}
        {showPolicies && p.payment.length > 0 && select("paymentPolicyId", "Payment policy", p.payment)}
        {showPolicies && p.return.length > 0 && select("returnPolicyId", "Return policy", p.return)}
        {showLocation && setup.locations.length > 0 && (
          <label className="lx-field">
            <span>Ships from</span>
            <select value={draft.ebay.merchantLocationKey} onChange={(e) => seller.choose("merchantLocationKey", e.target.value)}>
              <option value="">Choose…</option>
              {setup.locations.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {showPolicies && !p.fulfillment.length && (
        <div className="lx-create">
          <b>No shipping policy on your eBay account yet.</b>
          <div className="lx-field-grid">
            <label className="lx-field">
              <span>Shipping service</span>
              <select value={shipping.serviceCode} onChange={(e) => setShipping({ ...shipping, serviceCode: e.target.value })}>
                <option value="">{services === null ? "Loading…" : "Choose…"}</option>
                {(services || []).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
            <label className="lx-field">
              <span>Handling time (days)</span>
              <input inputMode="numeric" value={shipping.handlingDays} onChange={(e) => setShipping({ ...shipping, handlingDays: e.target.value })} />
            </label>
            <label className="lx-field">
              <span>Buyer pays ($)</span>
              <input inputMode="decimal" disabled={shipping.freeShipping} value={shipping.cost} placeholder={shipping.freeShipping ? "Free" : "e.g. 12.00"} onChange={(e) => setShipping({ ...shipping, cost: e.target.value })} />
            </label>
          </div>
          <label className="check-row"><input type="checkbox" checked={shipping.freeShipping} onChange={(e) => setShipping({ ...shipping, freeShipping: e.target.checked })} /> <span>Offer free shipping</span></label>
          <button type="button" className="mini-button primary" disabled={!!creating || !shipping.serviceCode} onClick={() => void run("fulfillment", () => seller.createPolicy("fulfillment", { handlingDays: Number(shipping.handlingDays), serviceCode: shipping.serviceCode, freeShipping: shipping.freeShipping, cost: Number(shipping.cost) }))}>
            {creating === "fulfillment" ? "Creating…" : "Create this shipping policy on eBay"}
          </button>
        </div>
      )}
      {showPolicies && !p.payment.length && (
        <div className="lx-create">
          <b>No payment policy yet.</b> eBay manages buyer payments; this policy simply requires immediate payment.
          <p><button type="button" className="mini-button primary" disabled={!!creating} onClick={() => void run("payment", () => seller.createPolicy("payment", {}))}>{creating === "payment" ? "Creating…" : "Create payment policy on eBay"}</button></p>
        </div>
      )}
      {showPolicies && !p.return.length && (
        <div className="lx-create">
          <b>No return policy yet.</b>
          <label className="check-row"><input type="checkbox" checked={returns.returnsAccepted} onChange={(e) => setReturns({ ...returns, returnsAccepted: e.target.checked })} /> <span>Accept returns</span></label>
          {returns.returnsAccepted && (
            <div className="lx-field-grid">
              <label className="lx-field">
                <span>Return window</span>
                <select value={returns.days} onChange={(e) => setReturns({ ...returns, days: Number(e.target.value) as 30 | 60 })}>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                </select>
              </label>
              <label className="lx-field">
                <span>Return shipping paid by</span>
                <select value={returns.payer} onChange={(e) => setReturns({ ...returns, payer: e.target.value as "BUYER" | "SELLER" })}>
                  <option value="BUYER">Buyer</option>
                  <option value="SELLER">Seller (you)</option>
                </select>
              </label>
            </div>
          )}
          <button type="button" className="mini-button primary" disabled={!!creating} onClick={() => void run("return", () => seller.createPolicy("return", returns))}>{creating === "return" ? "Creating…" : "Create return policy on eBay"}</button>
        </div>
      )}
      {showLocation && !setup.locations.length && (
        <div className="lx-create">
          <b>Where does the item ship from?</b> City, state and ZIP only; no street address.
          <div className="lx-field-grid">
            <label className="lx-field"><span>City</span><input value={location.city} onChange={(e) => setLocation({ ...location, city: e.target.value })} /></label>
            <label className="lx-field"><span>State</span><input maxLength={2} value={location.stateOrProvince} placeholder="e.g. NY" onChange={(e) => setLocation({ ...location, stateOrProvince: e.target.value })} /></label>
            <label className="lx-field"><span>ZIP</span><input inputMode="numeric" value={location.postalCode} onChange={(e) => setLocation({ ...location, postalCode: e.target.value })} /></label>
          </div>
          <button type="button" className="mini-button primary" disabled={!!creating} onClick={() => void run("location", () => seller.createLocation(location))}>{creating === "location" ? "Saving…" : "Save ship-from location on eBay"}</button>
        </div>
      )}
    </div>
  );
}

/** One-line summary of the seller settings in use, for the collapsed section. */
export function sellerSummary(draft: ListingDraft, seller: EbaySeller) {
  const s = seller.setup;
  if (!seller.status) return "Checking…";
  if (!seller.status.configured) return "Not set up on this server";
  if (!seller.connected) return "Not connected";
  if (!s) return "Loading…";
  const name = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name;
  const parts = [name(s.policies.fulfillment, draft.ebay.fulfillmentPolicyId), name(s.policies.payment, draft.ebay.paymentPolicyId), name(s.policies.return, draft.ebay.returnPolicyId), s.locations.find((l) => l.key === draft.ebay.merchantLocationKey)?.name].filter(Boolean);
  return parts.length === 4 ? parts.join(" · ") : `${4 - parts.length} to choose`;
}
