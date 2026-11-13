#!/usr/bin/env node
// SIMULATED eBay seller APIs for local end-to-end testing of ResellAI's publish flow.
// Nothing here talks to eBay; listings it "publishes" exist only in this process's memory.
// Response shapes follow eBay's official OpenAPI contracts (Sell Inventory/Account v1, Commerce Media
// v1_beta, Commerce Taxonomy v1, Sell Metadata v1) for the fields ResellAI uses.
//
// Usage:  node scripts/mock-ebay-seller.mjs        (port 4010; MOCK_EBAY_PORT to change)
// Then start ResellAI with sandbox overrides, for example:
//   EBAY_ENVIRONMENT=sandbox EBAY_CLIENT_ID=mock EBAY_CLIENT_SECRET=mock EBAY_SELLER_RUNAME=mock
//   EBAY_SELLER_TOKEN_KEY=<64 hex chars> EBAY_SELLER_PUBLISHING_ENABLED=true
//   EBAY_SELLER_AUTH_BASE=http://localhost:4010 EBAY_SELLER_API_BASE=http://localhost:4010
//   EBAY_MEDIA_API_BASE=http://localhost:4010 npm run dev
import { createServer } from "node:http";

const port = Number(process.env.MOCK_EBAY_PORT || 4010);
const callback = process.env.MOCK_EBAY_CALLBACK || "http://localhost:3001/api/ebay/seller/callback";
const state = { images: 0, offers: new Map(), items: new Map(), policies: { fulfillment: [], payment: [], return: [] }, locations: [], calls: [] };

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const read = (req) => new Promise((resolve) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });
const authed = (req) => /^Bearer mock-user-access/.test(req.headers.authorization || "");

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const p = url.pathname;
  const body = await read(req);
  state.calls.push(`${req.method} ${p}`);
  if (p === "/__calls") return json(res, 200, { calls: state.calls, offers: [...state.offers.values()], items: [...state.items.entries()] });

  if (p === "/oauth2/authorize") {
    const back = `${callback}?state=${encodeURIComponent(url.searchParams.get("state") || "")}&code=mock-code`;
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`<!doctype html><title>Simulated eBay sign-in</title><body style="font-family:sans-serif;max-width:480px;margin:60px auto">
      <h1>Simulated eBay sign-in</h1><p>This local test server stands in for eBay. Scopes requested:</p><pre style="white-space:pre-wrap">${(url.searchParams.get("scope") || "").replace(/</g, "&lt;")}</pre>
      <a id="agree" href="${back}" style="display:inline-block;padding:12px 18px;background:#3665f3;color:#fff;border-radius:20px;text-decoration:none">Agree</a></body>`);
  }
  if (p === "/identity/v1/oauth2/token") {
    const form = new URLSearchParams(body.toString());
    if (form.get("grant_type") === "authorization_code" && form.get("code") === "mock-code")
      return json(res, 200, { access_token: "mock-user-access", expires_in: 7200, refresh_token: "mock-refresh", refresh_token_expires_in: 47304000, token_type: "User Access Token" });
    if (form.get("grant_type") === "refresh_token") return json(res, 200, { access_token: "mock-user-access-2", expires_in: 7200 });
    return json(res, 400, { error: "invalid_grant" });
  }
  if (!authed(req)) return json(res, 401, { errors: [{ errorId: 1001, message: "Invalid access token" }] });

  if (p === "/commerce/media/v1_beta/image/create_image_from_file" && req.method === "POST") {
    if (!/multipart\/form-data/.test(req.headers["content-type"] || "") || !body.includes('name="image"')) return json(res, 400, { errors: [{ errorId: 190000, message: "Missing image part" }] });
    state.images++;
    return json(res, 201, undefined, { Location: `http://localhost:${port}/commerce/media/v1_beta/image/MOCKIMG${state.images}` });
  }
  if (p.startsWith("/commerce/media/v1_beta/image/MOCKIMG"))
    return json(res, 200, { imageUrl: `https://i.ebayimg.com/images/g/${p.split("/").pop()}/s-l1600.jpg`, expirationDate: new Date(Date.now() + 30 * 864e5).toISOString() });

  if (p === "/commerce/taxonomy/v1/get_default_category_tree_id") return json(res, 200, { categoryTreeId: "0", categoryTreeVersion: "mock" });
  if (p.endsWith("/get_category_suggestions"))
    return json(res, 200, { categorySuggestions: [
      { category: { categoryId: "15709", categoryName: "Athletic Shoes" }, categoryTreeNodeAncestors: [{ categoryName: "Men's Shoes" }, { categoryName: "Men" }, { categoryName: "Clothing, Shoes & Accessories" }] },
      { category: { categoryId: "95672", categoryName: "Athletic Shoes" }, categoryTreeNodeAncestors: [{ categoryName: "Women's Shoes" }, { categoryName: "Women" }, { categoryName: "Clothing, Shoes & Accessories" }] },
    ] });
  if (p.endsWith("/get_item_aspects_for_category"))
    return json(res, 200, { aspects: [
      { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT" } },
      { localizedAspectName: "US Shoe Size", aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT" } },
      { localizedAspectName: "Department", aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Men" }, { localizedValue: "Women" }, { localizedValue: "Unisex Adults" }] },
      { localizedAspectName: "Type", aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Athletic" }, { localizedValue: "Sneaker" }] },
      { localizedAspectName: "Style", aspectConstraint: { aspectRequired: false, aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT" }, aspectValues: [{ localizedValue: "Sneaker" }] },
    ] });
  if (p === "/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies")
    return json(res, 200, { itemConditionPolicies: [{ categoryId: "15709", itemConditionRequired: true, itemConditions: [{ conditionId: "1000", conditionDescription: "New with box" }, { conditionId: "1500", conditionDescription: "New without box" }, { conditionId: "1750", conditionDescription: "New with defects" }, { conditionId: "3000", conditionDescription: "Pre-owned" }] }] });
  if (p === "/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services")
    return json(res, 200, { shippingServices: [{ shippingService: "USPSGroundAdvantage", description: "USPS Ground Advantage", validForSellingFlow: true, internationalService: false, shippingCarrier: "USPS" }, { shippingService: "USPSPriority", description: "USPS Priority Mail", validForSellingFlow: true, internationalService: false, shippingCarrier: "USPS" }] });

  for (const kind of ["fulfillment", "payment", "return"]) {
    if (p.replace(/\/$/, "") === `/sell/account/v1/${kind}_policy`) {
      if (req.method === "POST") {
        const b = JSON.parse(body.toString() || "{}");
        const id = `${kind[0].toUpperCase()}-${state.policies[kind].length + 1}`;
        state.policies[kind].push({ [`${kind}PolicyId`]: id, name: b.name, ...b });
        return json(res, 201, { [`${kind}PolicyId`]: id, marketplaceId: "EBAY_US" });
      }
      return json(res, 200, { [`${kind}Policies`]: state.policies[kind], total: state.policies[kind].length });
    }
  }
  if (p === "/sell/inventory/v1/location") return json(res, 200, { locations: state.locations, total: state.locations.length });
  if (p.startsWith("/sell/inventory/v1/location/") && req.method === "POST") {
    const b = JSON.parse(body.toString() || "{}");
    state.locations.push({ merchantLocationKey: decodeURIComponent(p.split("/").pop()), name: b.name, ...b });
    return json(res, 204);
  }
  if (p.startsWith("/sell/inventory/v1/inventory_item/") && req.method === "PUT") {
    if (req.headers["content-language"] !== "en-US") return json(res, 400, { errors: [{ errorId: 25709, message: "Invalid Content-Language" }] });
    state.items.set(decodeURIComponent(p.split("/").pop()), JSON.parse(body.toString()));
    return json(res, 204);
  }
  if (p === "/sell/inventory/v1/offer" && req.method === "GET") {
    const offers = [...state.offers.values()].filter((o) => o.sku === url.searchParams.get("sku"));
    return offers.length ? json(res, 200, { offers, total: offers.length }) : json(res, 404, { errors: [{ errorId: 25713, message: "This Offer is not available." }] });
  }
  if (p === "/sell/inventory/v1/offer" && req.method === "POST") {
    const b = JSON.parse(body.toString());
    const offerId = `MOCK-OFFER-${state.offers.size + 1}`;
    state.offers.set(offerId, { ...b, offerId, status: "UNPUBLISHED" });
    return json(res, 201, { offerId });
  }
  const offerMatch = /^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish)?$/.exec(p);
  if (offerMatch) {
    const offer = state.offers.get(decodeURIComponent(offerMatch[1]));
    if (!offer) return json(res, 404, { errors: [{ errorId: 25713, message: "Offer not found" }] });
    if (req.method === "PUT") { Object.assign(offer, JSON.parse(body.toString())); return json(res, 204); }
    if (offerMatch[2] && req.method === "POST") {
      const item = state.items.get(offer.sku);
      if (!item?.product?.imageUrls?.length) return json(res, 400, { errors: [{ errorId: 25002, message: "A user error has occurred.", longMessage: "At least one image is required." }] });
      offer.status = "PUBLISHED";
      offer.listing = { listingId: `110${String(state.offers.size).padStart(9, "0")}`, listingStatus: "ACTIVE", soldQuantity: 0 };
      return json(res, 200, { listingId: offer.listing.listingId });
    }
  }
  return json(res, 404, { errors: [{ errorId: 2002, message: `Mock has no handler for ${req.method} ${p}` }] });
}).listen(port, () => console.log(`Simulated eBay seller APIs on http://localhost:${port}`));
