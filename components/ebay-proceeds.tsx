"use client";
import { useState } from "react";
import {
  EBAY_FEE_SOURCE,
  EBAY_FEE_CHECKED,
  sneakerProceeds,
} from "../lib/ebay-fees";
export function EbayProceeds({
  askingPrice,
  isSneaker,
}: {
  askingPrice: number | null;
  isSneaker: boolean;
}) {
  const [profile, setProfile] = useState("");
  const [amounts, setAmounts] = useState(["", "", "", ""]);
  const labels = [
    "Shipping charged to buyer ($)",
    "Sales tax collected ($)",
    "Your shipping / handling cost ($)",
    "Other selling costs ($)",
  ];
  let estimate;
  try {
    if (
      profile === "us-sneaker" &&
      isSneaker &&
      askingPrice !== null &&
      amounts.every((x) => x.trim() !== "")
    )
      estimate = sneakerProceeds({
        price: askingPrice,
        buyerShipping: Number(amounts[0]),
        salesTax: Number(amounts[1]),
        sellerShipping: Number(amounts[2]),
        extras: Number(amounts[3]),
      });
  } catch {}
  return (
    <div className="panel block">
      <h2>Seller proceeds scenario</h2>
      <p className="muted">
        Conditional on a sale at the suggested asking price. Not a predicted
        sale or profit.
      </p>
      <label className="notes-label">
        Applicable fee profile
        <select value={profile} onChange={(e) => setProfile(e.target.value)}>
          <option value="">Choose only if applicable to your account</option>
          {isSneaker && (
            <option value="us-sneaker">
              US non-Store seller · adult Athletic Shoes categories
            </option>
          )}
        </select>
      </label>
      <p className="fine">
        For a US seller meeting standard performance, domestic sale in Men’s or
        Women’s Athletic Shoes. Excludes Store pricing, special promotions,
        advertising, insertion fees, international fees and additional seller
        charges. Do not select for children’s shoes or other categories.
      </p>
      {profile && (
        <>
          <div className="calculator-inputs block">
            {labels.map((label, i) => (
              <label key={label}>
                {label}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amounts[i]}
                  onChange={(e) =>
                    setAmounts(
                      amounts.map((v, j) => (i === j ? e.target.value : v)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <p className="fine">
            Enter zero explicitly for costs that do not apply. Buyer shipping
            must be only the amount subject to final-value fees; do not include
            eBay’s exempt Authenticity Guarantee shipping charge. Sales tax is
            included in the fee base but is not your revenue.
          </p>
          {estimate ? (
            <div className="calc-results">
              <div>
                <span>Hypothetical listing price</span>
                <strong>${askingPrice!.toFixed(2)}</strong>
              </div>
              <div>
                <span>Final value fee scenario</span>
                <strong>${estimate.fee.toFixed(2)}</strong>
              </div>
              <div>
                <span>Proceeds after specified costs</span>
                <strong>${estimate.proceeds.toFixed(2)}</strong>
              </div>
            </div>
          ) : (
            <div className="info-card">
              <p>
                {askingPrice === null
                  ? "A supported asking-price recommendation is required before computing proceeds."
                  : "Enter all four nonnegative amounts to calculate this scenario."}
              </p>
            </div>
          )}
        </>
      )}
      {!profile && (
        <p className="fine block">
          Proceeds unavailable until an applicable documented fee profile is
          selected. Other categories and seller accounts need their applicable
          fee rules.
        </p>
      )}
      <p className="fine block">
        <a href={EBAY_FEE_SOURCE} target="_blank" rel="noopener noreferrer">
          eBay’s published US non-Store selling fees ↗
        </a>{" "}
        · Reviewed {EBAY_FEE_CHECKED}. Under $150 total sale: 13.6% plus the
        applicable per-order fee; at $150 or more: 8% and no per-order fee.
        Verify current fees for your account. Purchase cost is not deducted
        here.
      </p>
    </div>
  );
}
