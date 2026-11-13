"use client";
import { conditionFit, evidenceStale, listingProceeds } from "../../lib/listing/pricing";
import type { ListingDraft, ListingPricing, PriceSource, PricingEvidenceSummary } from "../../lib/listing/types";
import { dollars } from "./listing-bits";

const providerLabel = { ebay: "eBay", mercari: "Mercari" };

function EvidenceCard({ e, draft, onUse }: { e: PricingEvidenceSummary; draft: ListingDraft; onUse: (price: number, source: PriceSource, provider: "ebay" | "mercari") => void }) {
  const fit = conditionFit(e, draft.condition.grade);
  const stale = evidenceStale(e);
  const p = draft.pricing;
  const option = (label: string, price: number | null, source: PriceSource, help: string) =>
    price === null ? null : (
      <button type="button" className="mini-button" title={help} aria-pressed={p.priceProvider === e.provider && p.priceSource === source && p.price === price} disabled={fit === "mismatch"} onClick={() => onUse(price, source, e.provider)}>
        {label} {dollars(price)}
      </button>
    );
  return (
    <div className="evidence-card">
      <strong>{providerLabel[e.provider]} active listings</strong>
      {e.status === "supported" ? (
        <>
          <strong className="big">{dollars(e.suggested)}</strong>
          <div>
            Suggested asking price from {e.count} qualifying active listings ({e.pricingBasis === "exact" ? "exact matches" : "close matches"}) in the <b>{e.conditionCohort || "unspecified"}</b> condition group.
            Observed range {dollars(e.low)}–{dollars(e.high)}.
          </div>
          <div className="price-options">
            {option("Use market", e.suggested, "evidence", "The existing ResellAI recommendation: the robust median of qualifying asks.")}
            {option("Quick sale", e.quickSale, "quick-sale", "Lower quartile of competing asks: priced below most current listings.")}
            {option("Patient", e.patient, "patient", "Upper quartile of competing asks: for sellers willing to wait.")}
          </div>
          {e.quickSale === null && <p className="fine">Quick-sale and patient prices need at least five qualifying listings.</p>}
          {fit === "mismatch" && (
            <div className="warn-box">
              These listings are <b>{e.conditionCohort}</b>, but you're listing the item as <b>{draft.condition.grade}</b>. They can't price this listing; set the price yourself.
            </div>
          )}
          {fit === "unknown" && <p className="fine">Choose the item's condition to check that this evidence applies.</p>}
          {stale && <p className="fine">Retrieved {e.retrievedAt ? new Date(e.retrievedAt).toLocaleString() : "earlier"}; this snapshot has expired. Re-run the analysis for current listings.</p>}
          {!stale && e.retrievedAt && <p className="fine">Retrieved {new Date(e.retrievedAt).toLocaleString()}.</p>}
        </>
      ) : (
        <p>
          <b>{e.status === "insufficient" ? "Not enough evidence for a price." : "No evidence available."}</b> {e.reason}
        </p>
      )}
    </div>
  );
}

export function ListingPricingSection({ draft, onChange }: { draft: ListingDraft; onChange: (pricing: ListingPricing) => void }) {
  const p = draft.pricing;
  const set = (patch: Partial<ListingPricing>) => onChange({ ...p, ...patch });
  const result = listingProceeds(p, draft.category, draft.marketplace);
  const sneakerAllowed = draft.marketplace === "ebay" && draft.category === "footwear";
  const field = (label: string, key: keyof ListingPricing, placeholder = "0.00") => (
    <label className="listing-field">
      {label}
      <input inputMode="decimal" value={String(p[key] ?? "")} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<ListingPricing>)} />
    </label>
  );
  return (
    <section className="listing-panel" id="pricing" aria-labelledby="pricing-h">
      <h2 id="pricing-h">Price & profit</h2>
      <p className="panel-sub">Prices below come from current <b>asking</b> prices on active listings, not completed sales. ResellAI has no sold-price data, so treat them as a starting point.</p>
      <div className="evidence-cards">
        {p.evidence.map((e) => (
          <EvidenceCard key={e.provider} e={e} draft={draft} onUse={(price, source, provider) => set({ price, priceSource: source, priceProvider: provider })} />
        ))}
      </div>
      <label className="listing-field">
        Your listing price (USD)
        <input
          inputMode="decimal"
          aria-describedby="price-src"
          value={p.price === null ? "" : String(p.price)}
          placeholder="Enter a price"
          onChange={(e) => {
            const v = e.target.value.trim();
            const n = Number(v);
            set({ price: v === "" || !Number.isFinite(n) ? null : Math.round(n * 100) / 100, priceSource: "manual", priceProvider: null });
          }}
        />
      </label>
      <p className="fine" id="price-src">
        {p.price === null
          ? "No price set."
          : p.priceSource === "manual"
            ? "Price set by you."
            : `Price from ${providerLabel[p.priceProvider || "ebay"]} evidence (${p.priceSource === "evidence" ? "market" : p.priceSource}). Typing a price makes it your own.`}
      </p>

      <h3 className="block">Fees & proceeds</h3>
      <label className="listing-field">
        Fee profile
        <select value={p.feeMode} onChange={(e) => set({ feeMode: e.target.value as ListingPricing["feeMode"] })}>
          {sneakerAllowed && <option value="ebay-athletic-sneakers">eBay US athletic sneakers (non-Store seller)</option>}
          <option value="custom">Enter my marketplace fee</option>
        </select>
      </label>
      <div className="money-grid">
        {p.feeMode === "custom" && field("Fee % of sale + shipping", "feePercent", "e.g. 13.25")}
        {p.feeMode === "custom" && field("Fixed fee per order ($)", "fixedFee")}
        {field("Shipping charged to buyer ($)", "buyerShipping")}
        {p.feeMode === "ebay-athletic-sneakers" && field("Sales tax collected ($)", "salesTax")}
        {field("Your shipping cost ($)", "sellerShipping")}
        {field("Other selling costs ($)", "extras")}
        {field("What you paid ($)", "purchaseCost", "optional")}
      </div>
      {p.feeMode === "custom" && <p className="fine">Fees differ by marketplace, category and account. ResellAI doesn't assume a rate; enter the one that applies to you.</p>}
      {result.ok ? (
        <>
          <div className="proceeds" aria-live="polite">
            <div>
              <span>Listing price</span>
              <strong>{dollars(p.price)}</strong>
            </div>
            <div>
              <span>{result.feeLabel}</span>
              <strong>−{dollars(result.fee)}</strong>
            </div>
            <div>
              <span>Net proceeds</span>
              <strong>{dollars(result.proceeds)}</strong>
            </div>
            <div>
              <span>Profit{result.roi !== null ? ` · ${result.roi}% ROI` : ""}</span>
              <strong>{result.profit === null ? "Add cost" : dollars(result.profit)}</strong>
            </div>
          </div>
          {result.tip && <div className="tip">{result.tip}</div>}
          {!!result.assumptions.length && <p className="fine">{result.assumptions.join(" ")}</p>}
          <p className="fine">
            If it sells at this price. Excludes promotions, Store subscriptions, international and optional fees.
            {result.feeSource && (
              <>
                {" "}
                <a href={result.feeSource} target="_blank" rel="noopener noreferrer">
                  eBay fee source ↗
                </a>
              </>
            )}
          </p>
        </>
      ) : (
        <p className="fine">{result.reason}</p>
      )}
    </section>
  );
}
