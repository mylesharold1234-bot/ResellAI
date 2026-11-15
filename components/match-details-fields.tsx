"use client";
import type { Identification } from "../lib/identification";
import { productProfile } from "../lib/product-profile";
import type { MatchDetails } from "../lib/marketplaces";

/**
 * Details that narrow price comparisons.
 * - "essential": size (when the item has one), condition and box: the details that change price the most.
 * - "more": everything else (variant, verified identifier, materials…), shown on request.
 */
export function MatchDetailsFields({
  value,
  identification,
  onChange,
  disabled = false,
  part = "all",
}: {
  value: MatchDetails;
  identification?: Identification;
  onChange: (value: MatchDetails) => void;
  disabled?: boolean;
  part?: "essential" | "more" | "all";
}) {
  const sized = !identification || productProfile(identification).kind === "footwear" || /clothing|apparel|shirt|jacket|hoodie|pants|dress/i.test(`${identification.category || ""} ${identification.productName || ""}`);
  const update = (key: keyof MatchDetails, text: string) =>
    onChange({ ...value, [key]: text, ...(key === "productIdentifier" ? { productIdentifierVerified: false } : {}) });
  const essential = part !== "more";
  const more = part !== "essential";
  return (
    <div className="details-grid">
      {essential && sized && (
        <>
          <label className="field">
            Size
            <input disabled={disabled} maxLength={20} value={value.size} onChange={(e) => update("size", e.target.value)} placeholder="e.g. 10 or M" />
          </label>
          <label className="field">
            Size type
            <select disabled={disabled} value={value.sizeSystem} onChange={(e) => update("sizeSystem", e.target.value)}>
              <option value="">Choose…</option>
              <option value="US Men">US Men&apos;s</option>
              <option value="US Women">US Women&apos;s</option>
              <option value="US Youth">US Youth</option>
              <option value="UK">UK</option>
              <option value="EU">EU</option>
              <option value="Clothing">Clothing (S, M, L…)</option>
            </select>
          </label>
        </>
      )}
      {essential && (
        <>
          <label className="field">
            Condition
            <select disabled={disabled} value={value.condition} onChange={(e) => update("condition", e.target.value)}>
              <option value="">Choose…</option>
              <option value="new">New</option>
              <option value="used">Used</option>
              <option value="refurbished">Refurbished</option>
              <option value="parts">For parts / not working</option>
            </select>
          </label>
          <label className="field">
            Original box or packaging
            <select disabled={disabled} value={value.packaging} onChange={(e) => update("packaging", e.target.value)}>
              <option value="">Not sure</option>
              <option value="original">Included</option>
              <option value="none">Not included</option>
            </select>
          </label>
        </>
      )}
      {more && (
        <>
          <label className="field">
            Edition or variant
            <input disabled={disabled} maxLength={100} value={value.variant} onChange={(e) => update("variant", e.target.value)} placeholder="e.g. Panda, 128 GB, Disc edition" />
          </label>
          <label className="field">
            Style code, SKU or model number
            <input disabled={disabled} maxLength={40} value={value.productIdentifier} onChange={(e) => update("productIdentifier", e.target.value)} placeholder="Only if printed on the item or box" />
          </label>
          <label className="check-row span-2">
            <input type="checkbox" disabled={disabled || !value.productIdentifier} checked={value.productIdentifierVerified === true} onChange={(e) => onChange({ ...value, productIdentifierVerified: e.target.checked })} />
            <span>I checked this code on the item or its box</span>
          </label>
          {(
            [
              ["subtype", "Type or configuration"],
              ["material", "Material"],
              ["dimensions", "Dimensions or quantity"],
              ["includedAccessories", "What's included"],
              ["additionalDetails", "Anything else buyers should know"],
            ] as const
          ).map(([key, label]) => (
            <label className="field" key={key}>
              {label}
              <input maxLength={300} disabled={disabled} value={value[key] || ""} onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
            </label>
          ))}
        </>
      )}
    </div>
  );
}
