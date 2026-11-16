"use client";
import { useMemo, useState } from "react";
import { ExternalLink, ImageOff } from "lucide-react";
import { browserRows, filterRows, type BrowserEvidence, type BrowserFilter } from "../lib/comparable-browser";
import { dollars } from "./pricing-panel";

const PAGE = 20;

/**
 * Every listing ResellAI checked, across marketplaces, with why each was or wasn't used. Read-only: it
 * shows the pricing engine's decisions and never changes them.
 */
export function ComparableBrowser({ sources, size }: { sources: BrowserEvidence[]; size?: string }) {
  const rows = useMemo(() => browserRows(sources), [sources]);
  const anyUsed = rows.some((r) => r.use !== "not-used");
  const providers = [...new Set(rows.map((r) => r.provider))];
  const [filter, setFilter] = useState<BrowserFilter>({ marketplace: "all", show: anyUsed ? "used" : "close", yourSize: false });
  const [limit, setLimit] = useState(PAGE);
  const shown = filterRows(rows, filter, size);
  const set = (patch: Partial<BrowserFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };
  if (!rows.length) return <p className="muted">No listings to show yet.</p>;
  return (
    <div className="comp-browser">
      <div className="comp-filters" role="group" aria-label="Filter listings">
        <label className="comp-filter">
          Show
          <select value={filter.show} onChange={(e) => set({ show: e.target.value as BrowserFilter["show"] })}>
            <option value="used">Used for pricing</option>
            <option value="close">Closest matches</option>
            <option value="all">Everything checked</option>
          </select>
        </label>
        {providers.length > 1 && (
          <label className="comp-filter">
            Marketplace
            <select value={filter.marketplace} onChange={(e) => set({ marketplace: e.target.value as BrowserFilter["marketplace"] })}>
              <option value="all">All</option>
              <option value="ebay">eBay</option>
              <option value="mercari">Mercari</option>
            </select>
          </label>
        )}
        {size?.trim() && (
          <label className="check-row comp-size-toggle">
            <input type="checkbox" checked={filter.yourSize} onChange={(e) => set({ yourSize: e.target.checked })} />
            <span>Only size {size.trim()} in the title</span>
          </label>
        )}
      </div>

      <p className="fine" role="status">
        {shown.length} of {rows.length} listings
        {filter.show === "used" && !anyUsed ? ". None were used for a price, so switch to Closest matches to browse them." : "."}
      </p>

      <ul className="comp-cards">
        {shown.slice(0, limit).map((r) => (
          <li key={r.provider + r.id} className="comp-card">
            <div className="comp-thumb" aria-hidden="true">
              {r.image ? <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <ImageOff size={18} />}
            </div>
            <div className="comp-body">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="comp-title">
                {r.title} <ExternalLink size={12} aria-hidden="true" />
                <span className="sr-only"> (opens on {r.marketplace})</span>
              </a>
              <p className="comp-facts">
                <span>{r.marketplace}</span>
                <span className={r.size.kind === "single" ? undefined : "is-unknown"}>{r.size.label}</span>
                <span>{r.condition}</span>
              </p>
              <p className="comp-use">
                {r.use === "price" ? (
                  <span className="pill success">Used for the price</span>
                ) : r.use === "reference" ? (
                  <span className="pill">Used for the broader reference</span>
                ) : (
                  <span className="comp-why">Not used: {r.why}</span>
                )}
              </p>
            </div>
            <strong className="comp-price">{dollars(r.price)}</strong>
          </li>
        ))}
      </ul>
      {shown.length > limit && (
        <button type="button" className="secondary small" onClick={() => setLimit((n) => n + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      )}
      <p className="fine">
        Current asking prices from active listings, not sold prices. Sizes come from listing titles. Listings can change or end at any time.
      </p>
    </div>
  );
}
