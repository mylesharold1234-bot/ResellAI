import { MARKETPLACE_ID } from "./config";

/**
 * Minimal business-policy and inventory-location requests for sellers who have none yet.
 * Field names follow the Sell Account v1 and Sell Inventory v1 contracts. Every value comes from the
 * seller's choices in the publish form; nothing is assumed on their behalf.
 */
export type PolicyInput =
  | { type: "return"; returnsAccepted: boolean; days: 30 | 60; payer: "BUYER" | "SELLER" }
  | { type: "payment" }
  | { type: "fulfillment"; handlingDays: number; serviceCode: string; freeShipping: boolean; cost: number };

export type LocationInput = { name: string; city: string; stateOrProvince: string; postalCode: string };

const categoryTypes = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

export function parsePolicyInput(v: unknown): PolicyInput {
  const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (x.type === "payment") return { type: "payment" };
  if (x.type === "return") {
    if (typeof x.returnsAccepted !== "boolean") throw new Error("Choose whether you accept returns.");
    if (!x.returnsAccepted) return { type: "return", returnsAccepted: false, days: 30, payer: "BUYER" };
    if (x.days !== 30 && x.days !== 60) throw new Error("Choose a 30- or 60-day return window.");
    if (x.payer !== "BUYER" && x.payer !== "SELLER") throw new Error("Choose who pays return shipping.");
    return { type: "return", returnsAccepted: true, days: x.days, payer: x.payer };
  }
  if (x.type === "fulfillment") {
    const handlingDays = Number(x.handlingDays);
    if (!Number.isInteger(handlingDays) || handlingDays < 0 || handlingDays > 30) throw new Error("Enter a handling time in business days.");
    if (typeof x.serviceCode !== "string" || !/^[A-Za-z0-9_]{2,60}$/.test(x.serviceCode)) throw new Error("Choose a shipping service.");
    if (typeof x.freeShipping !== "boolean") throw new Error("Choose free or buyer-paid shipping.");
    const cost = x.freeShipping ? 0 : Number(x.cost);
    if (!x.freeShipping && (!Number.isFinite(cost) || cost <= 0 || cost > 1000)) throw new Error("Enter the shipping cost the buyer pays.");
    return { type: "fulfillment", handlingDays, serviceCode: x.serviceCode, freeShipping: x.freeShipping, cost };
  }
  throw new Error("Unknown policy type.");
}

export function policyName(input: PolicyInput) {
  if (input.type === "payment") return "ResellAI payment";
  if (input.type === "return") return input.returnsAccepted ? `ResellAI ${input.days}-day returns (${input.payer === "BUYER" ? "buyer" : "seller"} pays)` : "ResellAI no returns";
  return `ResellAI ${input.serviceCode} ${input.freeShipping ? "free" : "$" + input.cost.toFixed(2)} ${input.handlingDays}d`.slice(0, 64);
}

export function policyBody(input: PolicyInput) {
  const base = { name: policyName(input), marketplaceId: MARKETPLACE_ID, categoryTypes };
  if (input.type === "payment") return { ...base, immediatePay: true };
  if (input.type === "return")
    return input.returnsAccepted
      ? { ...base, returnsAccepted: true, returnPeriod: { value: input.days, unit: "DAY" }, returnShippingCostPayer: input.payer, refundMethod: "MONEY_BACK" }
      : { ...base, returnsAccepted: false };
  return {
    ...base,
    handlingTime: { value: input.handlingDays, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            shippingServiceCode: input.serviceCode,
            freeShipping: input.freeShipping,
            ...(input.freeShipping ? {} : { shippingCost: { value: input.cost.toFixed(2), currency: "USD" } }),
          },
        ],
      },
    ],
  };
}

export function parseLocationInput(v: unknown): LocationInput {
  const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof x[k] === "string" ? (x[k] as string).trim() : "");
  const input = { name: s("name") || "Ships from", city: s("city"), stateOrProvince: s("stateOrProvince").toUpperCase(), postalCode: s("postalCode") };
  if (!input.city || input.city.length > 60) throw new Error("Enter the city you ship from.");
  if (!/^[A-Z]{2}$/.test(input.stateOrProvince)) throw new Error("Enter the two-letter state code.");
  if (!/^\d{5}(-\d{4})?$/.test(input.postalCode)) throw new Error("Enter a US ZIP code.");
  if (input.name.length > 60) throw new Error("Keep the location name under 60 characters.");
  return input;
}

/** createInventoryLocation body: a warehouse-type location needs only city/state/postal code and country. */
export function locationBody(input: LocationInput) {
  return {
    name: input.name,
    location: { address: { city: input.city, stateOrProvince: input.stateOrProvince, postalCode: input.postalCode, country: "US" } },
    locationTypes: ["WAREHOUSE"],
    merchantLocationStatus: "ENABLED",
  };
}
