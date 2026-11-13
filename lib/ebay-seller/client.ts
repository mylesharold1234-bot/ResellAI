import { CATEGORY_TREE_ID, MARKETPLACE_ID, hosts, type EbayEnv } from "./config";

export class EbaySellerError extends Error {
  constructor(
    message: string,
    public status: number,
    public errorIds: number[] = [],
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Thin client for the eBay Sell APIs used by listing publishing. Errors carry eBay's messages, never tokens. */
export function createSellerClient({ environment, accessToken, fetcher = fetch }: { environment: EbayEnv; accessToken: () => Promise<string>; fetcher?: typeof fetch }) {
  const base = hosts[environment].api;
  async function call(method: string, path: string, body?: unknown, { allow404 = false } = {}): Promise<Json | null> {
    const token = await accessToken();
    let response: Response;
    try {
      response = await fetcher(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Language": "en-US",
          "Accept-Language": "en-US",
          "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw new EbaySellerError(e instanceof Error && e.name === "TimeoutError" ? "eBay didn't respond in time." : "Couldn't reach eBay.", 504);
    }
    if (allow404 && response.status === 404) return null;
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body */
    }
    if (!response.ok) {
      const errors = obj(json) && Array.isArray(json.errors) ? (json.errors as Json[]) : [];
      const messages = errors.map((e) => String(e.longMessage || e.message || "")).filter(Boolean).slice(0, 3);
      const ids = errors.map((e) => Number(e.errorId)).filter(Number.isFinite);
      throw new EbaySellerError(
        response.status === 401
          ? "eBay rejected the seller authorization. Reconnect your eBay account."
          : response.status === 429
            ? "eBay rate limit reached. Wait a minute and retry."
            : messages.length
              ? `eBay: ${messages.join(" ")}`
              : `eBay returned an error (${response.status}).`,
        response.status,
        ids,
      );
    }
    return obj(json) ? json : {};
  }
  const list = <T>(json: Json | null, key: string): T[] => (json && Array.isArray(json[key]) ? (json[key] as T[]) : []);
  return {
    async policies() {
      const q = `?marketplace_id=${MARKETPLACE_ID}`;
      const [f, p, r] = await Promise.all([
        call("GET", `/sell/account/v1/fulfillment_policy${q}`),
        call("GET", `/sell/account/v1/payment_policy${q}`),
        call("GET", `/sell/account/v1/return_policy${q}`),
      ]);
      return {
        fulfillment: list<Json>(f, "fulfillmentPolicies").map((x) => ({ id: String(x.fulfillmentPolicyId), name: String(x.name || x.fulfillmentPolicyId) })),
        payment: list<Json>(p, "paymentPolicies").map((x) => ({ id: String(x.paymentPolicyId), name: String(x.name || x.paymentPolicyId) })),
        return: list<Json>(r, "returnPolicies").map((x) => ({ id: String(x.returnPolicyId), name: String(x.name || x.returnPolicyId) })),
      };
    },
    async locations() {
      return list<Json>(await call("GET", "/sell/inventory/v1/location?limit=100"), "locations").map((x) => ({ key: String(x.merchantLocationKey), name: String(x.name || x.merchantLocationKey) }));
    },
    async categorySuggestions(q: string) {
      const json = await call("GET", `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_suggestions?q=${encodeURIComponent(q)}`);
      return list<Json>(json, "categorySuggestions").slice(0, 8).map((s) => {
        const c = obj(s.category) ? s.category : {};
        const path = list<Json>(s, "categoryTreeNodeAncestors").map((a) => String(a.categoryName)).reverse();
        return { id: String(c.categoryId), name: String(c.categoryName), path: [...path, String(c.categoryName)].join(" › ") };
      });
    },
    async requiredAspects(categoryId: string) {
      const json = await call("GET", `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`);
      return list<Json>(json, "aspects")
        .filter((a) => obj(a.aspectConstraint) && a.aspectConstraint.aspectRequired === true)
        .map((a) => String(a.localizedAspectName));
    },
    async putInventoryItem(sku: string, item: unknown) {
      await call("PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, item);
    },
    async offersForSku(sku: string) {
      const json = await call("GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE_ID}`, undefined, { allow404: true });
      return list<Json>(json, "offers").map((o) => ({
        offerId: String(o.offerId),
        status: String(o.status || ""),
        listingId: obj(o.listing) && o.listing.listingId ? String(o.listing.listingId) : null,
      }));
    },
    async createOffer(offer: unknown) {
      const json = await call("POST", "/sell/inventory/v1/offer", offer);
      if (!json?.offerId) throw new EbaySellerError("eBay didn't return an offer ID.", 502);
      return String(json.offerId);
    },
    async updateOffer(offerId: string, offer: unknown) {
      await call("PUT", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, offer);
    },
    async publishOffer(offerId: string) {
      const json = await call("POST", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`);
      if (!json?.listingId) throw new EbaySellerError("eBay didn't return a listing ID.", 502);
      return String(json.listingId);
    },
  };
}
export type SellerClient = ReturnType<typeof createSellerClient>;
