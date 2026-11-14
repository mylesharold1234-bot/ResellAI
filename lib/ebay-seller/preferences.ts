import type { ListingDraft } from "../listing/types";

/** The seller's reusable eBay settings: business policy IDs and ship-from location key (no secrets). */
export type SellerPrefs = Partial<Pick<ListingDraft["ebay"], "fulfillmentPolicyId" | "paymentPolicyId" | "returnPolicyId" | "merchantLocationKey">>;

export type SellerAccountOptions = {
  policies: { fulfillment: { id: string }[]; payment: { id: string }[]; return: { id: string }[] };
  locations: { key: string }[];
};

/**
 * Pick each policy/location for a draft: keep a valid current choice, else the seller's remembered preference
 * (only while it still exists on their account), else the only option. With several options and no known
 * preference nothing is chosen, so the seller makes a simple choice instead of ResellAI guessing.
 */
export function choosePolicies(current: SellerPrefs, account: SellerAccountOptions, prefs: SellerPrefs): Required<SellerPrefs> {
  const pick = (cur: string | undefined, pref: string | undefined, options: string[]) =>
    cur && options.includes(cur) ? cur : pref && options.includes(pref) ? pref : options.length === 1 ? options[0] : "";
  return {
    fulfillmentPolicyId: pick(current.fulfillmentPolicyId, prefs.fulfillmentPolicyId, account.policies.fulfillment.map((p) => p.id)),
    paymentPolicyId: pick(current.paymentPolicyId, prefs.paymentPolicyId, account.policies.payment.map((p) => p.id)),
    returnPolicyId: pick(current.returnPolicyId, prefs.returnPolicyId, account.policies.return.map((p) => p.id)),
    merchantLocationKey: pick(current.merchantLocationKey, prefs.merchantLocationKey, account.locations.map((l) => l.key)),
  };
}
