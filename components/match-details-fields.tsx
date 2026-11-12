"use client";
import type {Identification} from "../lib/identification";
import {productProfile} from "../lib/product-profile";
import type { MatchDetails } from "../lib/marketplaces";
export function MatchDetailsFields({
  value,
  identification,
  onChange,
  disabled = false,
}: {
  value: MatchDetails;
  identification?: Identification;
  onChange: (value: MatchDetails) => void;
  disabled?: boolean;
}) {
  const footwear = !identification || productProfile(identification).kind === "footwear" || /clothing|apparel/i.test(identification.category||"");
  const update = (key: keyof MatchDetails, text: string) =>
    onChange({ ...value, [key]: text, ...(key === "productIdentifier" ? {productIdentifierVerified: false} : {}) });
  return (
    <div className="identity-fields match-fields">
      {footwear && <> <label>
        Size (optional)
        <input
          disabled={disabled}
          maxLength={20}
          value={value.size}
          onChange={(e) => update("size", e.target.value)}
          placeholder="9.5 or M"
        />
      </label>
      <label>
        Sizing system
        <select
          disabled={disabled}
          value={value.sizeSystem}
          onChange={(e) => update("sizeSystem", e.target.value)}
        >
          <option value="">Not specified</option>
          {["US Men", "US Women", "US Youth", "UK", "EU", "Clothing"].map(
            (x) => (
              <option key={x}>{x}</option>
            ),
          )}
        </select>
      </label>
      </>}
      <label>
        Marketplace condition
        <select
          disabled={disabled}
          value={value.condition}
          onChange={(e) => update("condition", e.target.value)}
        >
          <option value="">Not specified</option>
          <option value="new">New</option>
          <option value="used">Used / pre-owned</option>
          <option value="refurbished">Refurbished</option>
          <option value="parts">For parts / not working</option>
        </select>
      </label>
      <label>
        Original packaging
        <select
          disabled={disabled}
          value={value.packaging}
          onChange={(e) => update("packaging", e.target.value)}
        >
          <option value="">Not specified</option>
          <option value="original">Original packaging included</option>
          <option value="none">No original packaging</option>
        </select>
      </label>
      <label>
        Relevant variant (optional)
        <input
          disabled={disabled}
          maxLength={100}
          value={value.variant}
          onChange={(e) => update("variant", e.target.value)}
          placeholder="Exact edition, storage, or variant words"
        />
      </label>
      <label>
        Exact identifier (optional, verified by you)
        <input
          disabled={disabled}
          maxLength={40}
          value={value.productIdentifier}
          onChange={(e) => update("productIdentifier", e.target.value)}
          placeholder="Only a visible SKU / GTIN / model code"
        />
      </label>
      {identification && <p className="fine">Useful for this item: {productProfile(identification).fields.join(", ")}. All optional.</p>}
      {([ ["subtype","Item subtype / configuration"], ["material","Material / pattern / collection"], ["dimensions","Dimensions / diameter / quantity"], ["includedAccessories","Included accessories (optional)"], ["additionalDetails","Additional identifying details"]] as const).map(([key,label]) => <label key={key}>{label}<input maxLength={300} disabled={disabled} value={value[key]||""} onChange={e=>onChange({...value,[key]:e.target.value})} /></label>)}
      <label><span><input style={{width:"auto",marginRight:8}} type="checkbox" disabled={disabled || !value.productIdentifier} checked={value.productIdentifierVerified === true} onChange={e => onChange({...value, productIdentifierVerified: e.target.checked})} /> I verified this identifier on the item or packaging</span></label>
    </div>
  );
}
