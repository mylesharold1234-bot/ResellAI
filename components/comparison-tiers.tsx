"use client";
import { useState } from "react";
import { ExternalLink, ImageOff } from "lucide-react";
import type { ComparisonTier, ComparisonTiers, TierListing } from "../lib/comparison-tiers";
import type { recommend } from "../lib/valuation";
import { BroaderReference, dollars } from "./pricing-panel";

const SHOWN = 6;
const BOX: Record<TierListing["box"], string> = { stated: "Box included", "no box": "No box", "not mentioned": "Box not mentioned" };

/**
 * One marketplace's evidence, grouped by how closely each listing matches the seller's item. Asking
 * prices only. It never shows a price recommendation: that stays with the pricing engine and its
 * three-listing minimum.
 */
export function ComparisonTiersView({
  tiers,
  marketplace,
  reference,
}: {
  tiers: ComparisonTiers;
  marketplace: "eBay" | "Mercari";
  reference?: ReturnType<typeof recommend>["marketReference"];
}) {
  const size = tiers.size.replace(/^(\S+) US Men$/, "$1 (US men's)").replace(/^(\S+) US Women$/, "$1 (US women's)");
  return (
    <div className="tiers">
      <p className="muted">
        Your item: size {size}, {tiers.condition}. These are current {marketplace} asking prices, not sales, grouped by how closely each listing matches.
      </p>
      <Tier n={1} title="Same size and condition" detail={`Size ${size} · ${tiers.condition}`} tier={tiers.exact} marketplace={marketplace} exact />
      <Tier n={2} title="Same size, other conditions" detail={`Size ${size} · not ${tiers.condition}`} tier={tiers.sameSizeOtherCondition} marketplace={marketplace} />
      <Tier n={3} title="Same condition, other sizes" detail={`${cap(tiers.condition)} · other or unstated sizes`} tier={tiers.sameConditionOtherSize} marketplace={marketplace} />
      <section className="tier" aria-labelledby={`tier-4-${marketplace}`}>
        <h3 id={`tier-4-${marketplace}`} className="tier-title"><span className="tier-n">4</span> Broader market reference</h3>
        {reference ? (
          <BroaderReference reference={reference} marketplace={marketplace} size={tiers.size.split(" ")[0]} />
        ) : (
          <p className="tier-empty">Not available. It needs at least 3 matching listings from 2 sellers, across sizes, whose asking prices agree.</p>
        )}
      </section>
      {tiers.unplaced > 0 && (
        <p className="fine">
          {tiers.unplaced} other matching {tiers.unplaced === 1 ? "listing differs" : "listings differ"} in both size and condition, so {tiers.unplaced === 1 ? "it isn't" : "they aren't"} shown here. All are under Listings we compared.
        </p>
      )}
    </div>
  );
}

function Tier({ n, title, detail, tier, marketplace, exact = false }: { n: number; title: string; detail: string; tier: ComparisonTier; marketplace: string; exact?: boolean }) {
  const [all, setAll] = useState(false);
  const count = tier.listings.length;
  const used = tier.listings.filter((l) => l.usedForPrice).length;
  return (
    <section className="tier" aria-labelledby={`tier-${n}-${marketplace}`}>
      <h3 id={`tier-${n}-${marketplace}`} className="tier-title">
        <span className="tier-n">{n}</span> {title}
      </h3>
      <p className="tier-summary">
        <span>{detail}</span>
        {count ? (
          <span>
            {count} {count === 1 ? "listing" : "listings"} · {tier.sellers} {tier.sellers === 1 ? "seller" : "sellers"} · asking {tier.low === tier.high ? dollars(tier.low!) : `${dollars(tier.low!)}–${dollars(tier.high!)}`}
          </span>
        ) : null}
      </p>
      {exact && count > 0 && (
        <p className="fine tier-note">
          {used
            ? `${used} of these ${used === 1 ? "is" : "are"} used for the ${marketplace} price.`
            : count < 3
              ? `Fewer than 3, so ${marketplace} can't recommend a price from these. They're shown as evidence only.`
              : `No price from these: they don't all confirm the box, or their prices or sellers don't meet the checks.`}
        </p>
      )}
      {count === 0 ? (
        <p className="tier-empty">None in this search.</p>
      ) : (
        <>
          <ul className="comp-cards">
            {(all ? tier.listings : tier.listings.slice(0, SHOWN)).map((l) => (
              <li key={l.id} className="comp-card">
                <div className="comp-thumb" aria-hidden="true">
                  {l.image ? <img src={l.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <ImageOff size={18} />}
                </div>
                <div className="comp-body">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="comp-title">
                    {l.title} <ExternalLink size={12} aria-hidden="true" />
                    <span className="sr-only"> (opens on {marketplace})</span>
                  </a>
                  <p className="comp-facts">
                    <span className={l.sizeSource === "not stated" ? "is-unknown" : undefined} title={l.sizeSource === "listing details" ? `From ${marketplace}'s listing details` : l.sizeSource === "title" ? "From the listing title" : undefined}>
                      {l.size}
                    </span>
                    <span>{l.condition}</span>
                    <span className={l.box === "not mentioned" ? "is-unknown" : undefined}>{BOX[l.box]}</span>
                    <span className={l.listed === "Listing date unknown" ? "is-unknown" : undefined}>{l.listed}</span>
                  </p>
                  {l.usedForPrice && <p className="comp-use"><span className="pill success">Used for the price</span></p>}
                </div>
                <strong className="comp-price">{dollars(l.price)}</strong>
              </li>
            ))}
          </ul>
          {count > SHOWN && (
            <button type="button" className="text-link tier-more" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${count}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
