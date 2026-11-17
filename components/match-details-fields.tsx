"use client";
import type { Identification } from "../lib/identification";
import { productProfile } from "../lib/product-profile";
import type { MatchDetails } from "../lib/marketplaces";
import { canonicalStyleCode } from "../lib/style-codes";

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
  const footwear = !!identification && productProfile(identification).kind === "footwear";
  // Sneakers: the style code is the single most precise detail, so it sits with size and condition.
  // A code the seller types in the standard format counts as checked; one read from the photo needs a tick.
  const setStyleCode = (text: string) => {
    const code = canonicalStyleCode(text);
    onChange({ ...value, productIdentifier: code || text, productIdentifierVerified: !!code });
  };
  const styleCodeInvalid = footwear && !!value.productIdentifier.trim() && !canonicalStyleCode(value.productIdentifier);
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
      {essential && footwear && (
        <div className="field span-2 style-code-field">
          <label htmlFor="style-code">Style code <span className="muted">(optional)</span></label>
          <input id="style-code" disabled={disabled} maxLength={40} value={value.productIdentifier} onChange={(e) => setStyleCode(e.target.value)} placeholder="e.g. DD1391-100" autoComplete="off" spellCheck={false} aria-describedby="style-code-help" aria-invalid={styleCodeInvalid} />
          <p id="style-code-help" className="fine">
            {styleCodeInvalid
              ? "Nike and Jordan style codes look like DD1391-100. Other brands: enter it exactly as printed, then tick the box below."
              : value.productIdentifier && !value.productIdentifierVerified
                ? "We read this from your photo. Check it against the box label or the tag inside the tongue."
                : "Printed on the box label and the tag inside the tongue. It makes price matches much more precise."}
          </p>
          {!!value.productIdentifier.trim() && !value.productIdentifierVerified && (
            <label className="check-row">
              <input type="checkbox" disabled={disabled} checked={false} onChange={(e) => onChange({ ...value, productIdentifierVerified: e.target.checked })} />
              <span>This matches the code on my box or tag</span>
            </label>
          )}
        </div>
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
          {!footwear && (
            <>
              <label className="field">
                Style code, SKU or model number
                <input disabled={disabled} maxLength={40} value={value.productIdentifier} onChange={(e) => update("productIdentifier", e.target.value)} placeholder="Only if printed on the item or box" />
              </label>
              <label className="check-row span-2">
                <input type="checkbox" disabled={disabled || !value.productIdentifier} checked={value.productIdentifierVerified === true} onChange={(e) => onChange({ ...value, productIdentifierVerified: e.target.checked })} />
                <span>I checked this code on the item or its box</span>
              </label>
            </>
          )}
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
