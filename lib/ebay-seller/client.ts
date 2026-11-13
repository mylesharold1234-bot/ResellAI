import { MARKETPLACE_ID, type Endpoints } from "./config";

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
const list = <T = Json>(json: unknown, key: string): T[] => (obj(json) && Array.isArray(json[key]) ? (json[key] as T[]) : []);

export type CategoryAspect = { name: string; required: boolean; recommended: boolean; mode: string; values: string[]; multiple: boolean; maxLength: number | null };
export type AllowedCondition = { id: string; name: string };
export type ShippingServiceOption = { code: string; name: string; carrier: string; category: string };

/**
 * Client for the eBay Sell APIs used to publish a listing. Paths and fields follow eBay's official
 * OpenAPI contracts (see config.ts). Error messages carry eBay's text, never tokens.
 */
export function createSellerClient({ endpoints, accessToken, fetcher = fetch }: { endpoints: Endpoints; accessToken: () => Promise<string>; fetcher?: typeof fetch }) {
  const base = endpoints.api;
  async function send(url: string, init: RequestInit & { allow404?: boolean }) {
    const token = await accessToken();
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Accept-Language": "en-US", "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID, ...(init.headers as Record<string, string>) },
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new EbaySellerError(e instanceof Error && e.name === "TimeoutError" ? "eBay didn't respond in time." : "Couldn't reach eBay.", 504);
    }
    if (init.allow404 && response.status === 404) return { response, json: null as Json | null };
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (!response.ok) {
      const errors = list(json, "errors");
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
    return { response, json: obj(json) ? json : ({} as Json) };
  }
  const call = async (method: string, path: string, body?: unknown, opts: { allow404?: boolean } = {}) =>
    (
      await send(base + path, {
        method,
        allow404: opts.allow404,
        headers: { "Content-Language": "en-US", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    ).json;

  let treeId: string | null = null;
  async function categoryTreeId() {
    if (treeId) return treeId;
    const json = await call("GET", `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${MARKETPLACE_ID}`);
    if (!json?.categoryTreeId) throw new EbaySellerError("eBay didn't return a category tree.", 502);
    return (treeId = String(json.categoryTreeId));
  }
  const q = `?marketplace_id=${MARKETPLACE_ID}`;

  return {
    async policies() {
      const [f, p, r] = await Promise.all([call("GET", `/sell/account/v1/fulfillment_policy${q}`), call("GET", `/sell/account/v1/payment_policy${q}`), call("GET", `/sell/account/v1/return_policy${q}`)]);
      return {
        fulfillment: list(f, "fulfillmentPolicies").map((x) => ({ id: String(x.fulfillmentPolicyId), name: String(x.name || x.fulfillmentPolicyId) })),
        payment: list(p, "paymentPolicies").map((x) => ({ id: String(x.paymentPolicyId), name: String(x.name || x.paymentPolicyId) })),
        return: list(r, "returnPolicies").map((x) => ({ id: String(x.returnPolicyId), name: String(x.name || x.returnPolicyId) })),
      };
    },
    async createPolicy(type: "fulfillment" | "payment" | "return", body: unknown) {
      const json = await call("POST", type === "fulfillment" ? "/sell/account/v1/fulfillment_policy/" : `/sell/account/v1/${type}_policy`, body);
      const id = json?.[`${type}PolicyId`];
      if (!id) throw new EbaySellerError("eBay didn't return the new policy's ID.", 502);
      return String(id);
    },
    async locations() {
      return list(await call("GET", "/sell/inventory/v1/location?limit=100"), "locations").map((x) => ({ key: String(x.merchantLocationKey), name: String(x.name || x.merchantLocationKey) }));
    },
    async createLocation(key: string, body: unknown) {
      await call("POST", `/sell/inventory/v1/location/${encodeURIComponent(key)}`, body);
    },
    async shippingServices(): Promise<ShippingServiceOption[]> {
      const json = await call("GET", `/sell/metadata/v1/shipping/marketplace/${MARKETPLACE_ID}/get_shipping_services`);
      return list(json, "shippingServices")
        .filter((s) => s.validForSellingFlow === true && s.internationalService !== true && typeof s.shippingService === "string")
        .map((s) => ({ code: String(s.shippingService), name: String(s.description || s.shippingService), carrier: String(s.shippingCarrier || ""), category: String(s.shippingCategory || "") }));
    },
    async categorySuggestions(text: string) {
      const json = await call("GET", `/commerce/taxonomy/v1/category_tree/${await categoryTreeId()}/get_category_suggestions?q=${encodeURIComponent(text)}`);
      return list(json, "categorySuggestions")
        .slice(0, 8)
        .map((s) => {
          const c = obj(s.category) ? s.category : {};
          const path = list(s, "categoryTreeNodeAncestors").map((a) => String(a.categoryName)).reverse();
          return { id: String(c.categoryId), name: String(c.categoryName), path: [...path, String(c.categoryName)].join(" › ") };
        })
        .filter((c) => /^\d+$/.test(c.id));
    },
    async categoryAspects(categoryId: string): Promise<CategoryAspect[]> {
      const json = await call("GET", `/commerce/taxonomy/v1/category_tree/${await categoryTreeId()}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`);
      return list(json, "aspects").map((a) => {
        const c = obj(a.aspectConstraint) ? a.aspectConstraint : {};
        return {
          name: String(a.localizedAspectName),
          required: c.aspectRequired === true,
          recommended: c.aspectUsage === "RECOMMENDED",
          mode: String(c.aspectMode || "FREE_TEXT"),
          values: list(a, "aspectValues").map((v) => String(v.localizedValue)).slice(0, 200),
          multiple: c.itemToAspectCardinality === "MULTI",
          maxLength: typeof c.aspectMaxLength === "number" ? c.aspectMaxLength : null,
        };
      });
    },
    async conditionPolicy(categoryId: string): Promise<{ required: boolean; conditions: AllowedCondition[] }> {
      const filter = encodeURIComponent(`categoryIds:{${categoryId}}`);
      const json = await call("GET", `/sell/metadata/v1/marketplace/${MARKETPLACE_ID}/get_item_condition_policies?filter=${filter}`);
      const policy = list(json, "itemConditionPolicies").find((p) => String(p.categoryId) === categoryId) ?? list(json, "itemConditionPolicies")[0];
      return {
        required: policy?.itemConditionRequired === true,
        conditions: list(policy, "itemConditions").map((c) => ({ id: String(c.conditionId), name: String(c.conditionDescription || c.conditionId) })),
      };
    },
    /** Media API: upload a file to eBay Picture Services, then read back its EPS URL. */
    async uploadImage(file: Blob, filename: string) {
      const form = new FormData();
      form.append("image", file, filename);
      const created = await send(`${endpoints.media}/commerce/media/v1_beta/image/create_image_from_file`, { method: "POST", body: form });
      const location = created.response.headers.get("location") || "";
      const imageId = location.split("?")[0].split("/").filter(Boolean).pop();
      let image = created.json;
      if (!image?.imageUrl) {
        if (!imageId) throw new EbaySellerError("eBay didn't return an image reference.", 502);
        image = (await send(`${endpoints.media}/commerce/media/v1_beta/image/${encodeURIComponent(imageId)}`, { method: "GET" })).json;
      }
      const url = String(image?.imageUrl || "");
      if (!/^https:\/\//.test(url)) throw new EbaySellerError("eBay didn't return a usable image URL.", 502);
      return { url, expiresAt: typeof image?.expirationDate === "string" ? image.expirationDate : null };
    },
    async putInventoryItem(sku: string, item: unknown) {
      await call("PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, item);
    },
    async offersForSku(sku: string) {
      const json = await call("GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE_ID}`, undefined, { allow404: true });
      return list(json, "offers").map((o) => {
        const listing = obj(o.listing) ? o.listing : {};
        return {
          offerId: String(o.offerId),
          status: String(o.status || ""),
          listingId: listing.listingId ? String(listing.listingId) : null,
          listingStatus: listing.listingStatus ? String(listing.listingStatus) : null,
          soldQuantity: typeof listing.soldQuantity === "number" ? listing.soldQuantity : null,
        };
      });
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
