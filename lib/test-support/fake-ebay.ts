// Simulated eBay Sell/Media/Taxonomy/Metadata APIs for tests. Response shapes follow eBay's official OpenAPI contracts.
// Nothing here contacts eBay.
/** A fake eBay Sell API that records calls and can be told to fail a step. Shapes follow eBay's OpenAPI contracts. */
export function fakeEbay(options: { failPublishOnce?: boolean; existingPublished?: boolean; requiredAspects?: string[]; noPolicies?: boolean; failImage?: boolean } = {}) {
  const calls: { method: string; path: string; host: string; body?: unknown; auth?: string }[] = [];
  let offers: { offerId: string; status: string; listing?: { listingId: string; listingStatus?: string } }[] = options.existingPublished ? [{ offerId: "O-1", status: "PUBLISHED", listing: { listingId: "L-1", listingStatus: "ACTIVE" } }] : [];
  let failPublish = !!options.failPublishOnce;
  let images = 0;
  const required = options.requiredAspects ?? ["Brand", "US Shoe Size"];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method || "GET";
    const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    calls.push({ method, path: u.pathname + u.search, host: u.host, body, auth: (init?.headers as Record<string, string>)?.Authorization });
    if (u.pathname === "/identity/v1/oauth2/token") {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "authorization_code" && p.get("code") === "good-code")
        return Response.json({ access_token: "user-access", expires_in: 7200, refresh_token: "user-refresh", refresh_token_expires_in: 47304000, token_type: "User Access Token" });
      if (p.get("grant_type") === "refresh_token") return Response.json({ access_token: "user-access-2", expires_in: 7200 });
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (u.pathname === "/commerce/media/v1_beta/image/create_image_from_file") {
      if (options.failImage) return Response.json({ errors: [{ errorId: 190001, message: "The image is too small." }] }, { status: 400 });
      images++;
      return new Response(null, { status: 201, headers: { Location: `https://${u.host}/commerce/media/v1_beta/image/IMG${images}` } });
    }
    if (u.pathname.startsWith("/commerce/media/v1_beta/image/IMG"))
      return Response.json({ imageUrl: `https://i.ebayimg.com/images/g/${u.pathname.split("/").pop()}/s-l1600.jpg`, expirationDate: "2026-12-13T00:00:00.000Z" });
    if (u.pathname === "/commerce/taxonomy/v1/get_default_category_tree_id") return Response.json({ categoryTreeId: "0", categoryTreeVersion: "130" });
    if (u.pathname.endsWith("/get_category_suggestions"))
      return Response.json({ categorySuggestions: [{ category: { categoryId: "15709", categoryName: "Athletic Shoes" }, categoryTreeNodeAncestors: [{ categoryName: "Men's Shoes" }, { categoryName: "Men" }, { categoryName: "Clothing, Shoes & Accessories" }] }] });
    if (u.pathname.endsWith("/get_item_aspects_for_category"))
      return Response.json({
        aspects: [
          ...required.map((n) => ({ localizedAspectName: n, aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT" } })),
          { localizedAspectName: "Department", aspectConstraint: { aspectRequired: false, aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Men" }, { localizedValue: "Women" }] },
          { localizedAspectName: "Width", aspectConstraint: { aspectRequired: false, aspectUsage: "OPTIONAL" } },
        ],
      });
    if (u.pathname === "/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies")
      return Response.json({ itemConditionPolicies: [{ categoryId: "15709", itemConditionRequired: true, itemConditions: [{ conditionId: "1000", conditionDescription: "New with box" }, { conditionId: "1500", conditionDescription: "New without box" }, { conditionId: "3000", conditionDescription: "Pre-owned" }] }] });
    if (u.pathname === "/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services")
      return Response.json({ shippingServices: [{ shippingService: "USPSGroundAdvantage", description: "USPS Ground Advantage", validForSellingFlow: true, internationalService: false, shippingCarrier: "USPS" }, { shippingService: "USPSPriorityMailInternational", description: "Intl", validForSellingFlow: true, internationalService: true }, { shippingService: "Old", validForSellingFlow: false }] });
    if (u.pathname.startsWith("/sell/inventory/v1/inventory_item/")) return new Response(null, { status: 204 });
    if (u.pathname === "/sell/inventory/v1/offer" && method === "GET") return offers.length ? Response.json({ offers }) : Response.json({ errors: [{ errorId: 25713, message: "This Offer is not available." }] }, { status: 404 });
    if (u.pathname === "/sell/inventory/v1/offer" && method === "POST") {
      offers = [{ offerId: "O-9", status: "UNPUBLISHED" }];
      return Response.json({ offerId: "O-9" }, { status: 201 });
    }
    if (/^\/sell\/inventory\/v1\/offer\/[^/]+$/.test(u.pathname) && method === "PUT") return new Response(null, { status: 204 });
    if (u.pathname.endsWith("/publish")) {
      if (failPublish) {
        failPublish = false;
        return Response.json({ errors: [{ errorId: 25002, message: "A user error has occurred.", longMessage: "Item specific Brand is missing." }] }, { status: 400 });
      }
      offers = offers.map((o) => ({ ...o, status: "PUBLISHED", listing: { listingId: "L-77", listingStatus: "ACTIVE" } }));
      return Response.json({ listingId: "L-77" });
    }
    if (u.pathname.startsWith("/sell/account/v1/fulfillment_policy") && method === "POST") return Response.json({ fulfillmentPolicyId: "F-new", marketplaceId: "EBAY_US" }, { status: 201 });
    if (u.pathname === "/sell/account/v1/payment_policy" && method === "POST") return Response.json({ paymentPolicyId: "P-new" }, { status: 201 });
    if (u.pathname === "/sell/account/v1/return_policy" && method === "POST") return Response.json({ returnPolicyId: "R-new" }, { status: 201 });
    if (u.pathname.startsWith("/sell/inventory/v1/location/") && method === "POST") return new Response(null, { status: 204 });
    if (u.pathname.startsWith("/sell/account/v1/fulfillment_policy")) return Response.json({ fulfillmentPolicies: options.noPolicies ? [] : [{ fulfillmentPolicyId: "F1", name: "Ground" }] });
    if (u.pathname.startsWith("/sell/account/v1/payment_policy")) return Response.json({ paymentPolicies: options.noPolicies ? [] : [{ paymentPolicyId: "P1", name: "Managed" }] });
    if (u.pathname.startsWith("/sell/account/v1/return_policy")) return Response.json({ returnPolicies: options.noPolicies ? [] : [{ returnPolicyId: "R1", name: "30 days" }] });
    if (u.pathname === "/sell/inventory/v1/location") return Response.json({ locations: options.noPolicies ? [] : [{ merchantLocationKey: "home", name: "Home" }] });
    return Response.json({ errors: [{ message: "unexpected " + u.pathname }] }, { status: 500 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

