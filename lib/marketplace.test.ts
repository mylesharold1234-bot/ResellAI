import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IdentificationProvider } from "../components/identification-context";
import { LiveReport } from "../components/live-report";
import { buildEbayQuery, matchComparable } from "./product-matching";
import {
  emptyMatchDetails,
  parseMatchDetails,
  type Comparable,
  type ProductQuery,
  type MarketplaceResult,
} from "./marketplaces";
import { askingStatistics, recommend } from "./valuation";
import { sneakerProceeds } from "./ebay-fees";
import {
  createEbayProvider,
  normalizeEbaySearch,
} from "./marketplace-providers/ebay";
import { createMarketplaceHandler } from "./marketplace-server";
const stamp = "2026-10-18T12:00:00.000Z";
const query: ProductQuery = {
  identification: {
    brand: "Jordan",
    productName: "Air Jordan 1 Mid",
    category: "Sneakers",
    model: "Air Jordan 1 Mid",
    colorway: "Black and white",
    visibleCondition: "Some wear",
    identifyingInformation: null,
    confidence: "medium",
    uncertainties: [],
    additionalEvidence: [],
  },
  details: {
    ...emptyMatchDetails,
    size: "9.5",
    sizeSystem: "US Men",
    condition: "used",
    packaging: "original",
  },
};
function listing(overrides: Partial<Comparable> = {}): Comparable {
  return {
    id: "v1|123|0",
    title:
      "Nike Air Jordan 1 Mid Black White US Mens Size 9.5 with original box",
    price: 100,
    currency: "USD",
    status: "asking",
    condition: "Pre-owned",
    conditionId: "3000",
    url: "https://www.ebay.com/itm/123",
    observedAt: stamp,
    shipping: 10,
    seller: "seller-1",
    categories: ["Athletic Shoes"],
    matchReasons: [],
    warnings: [],
    ...overrides,
  };
}
function row(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "v1|123|0",
    title: listing().title,
    price: { value: "100.00", currency: "USD" },
    condition: "Pre-owned",
    conditionId: "3000",
    itemWebUrl: "https://www.ebay.com/itm/123",
    buyingOptions: ["FIXED_PRICE"],
    shippingOptions: [{ shippingCost: { value: "10", currency: "USD" } }],
    seller: { username: "seller-1" },
    ...overrides,
  };
}
function result(
  items: Comparable[],
  overrides: Partial<MarketplaceResult> = {},
): MarketplaceResult {
  return {
    provider: "ebay",
    environment: "production",
    status: items.length ? "available" : "no_matches",
    query: "Jordan 1 Mid",
    comparables: items,
    retrievedAt: stamp,
    expiresAt: new Date(Date.now()+300000).toISOString(),
    cached: false,
    examined: items.length,
    excluded: 0,
    invalid: 0,
    warnings: [],
    ...overrides,
  };
}
const fixture = (prices = [90, 95, 100, 105, 110]) =>
  prices.map((price, i) =>
    listing({ id: String(i), price, seller: `seller-${i}` }),
  );
test("query uses confirmed model, colors, size and explicitly reviewed identifier", () => {
  const q = buildEbayQuery({
    ...query,
    details: { ...query.details, productIdentifier: "554724-074" },
  });
  assert.match(q, /jordan 1 mid/);
  assert.match(q, /Black and white/);
  assert.match(q, /554724-074/);
  assert.ok(q.length <= 100);
  assert.ok(
    !buildEbayQuery({
      ...query,
      identification: {
        ...query.identification,
        identifyingInformation: "invented prose",
      },
    }).includes("invented"),
  );
});
test("matching accepts relevant item and explains its evidence", () => {
  const m = matchComparable(listing(), query);
  assert.equal(m.matches, true);
  assert.ok(m.reasons.some((x) => x.includes("Size")));
});
test("rejects different silhouette, color, generation, accessory, replica and bundles", () => {
  for (const title of [
    "Nike Air Jordan 1 Low Black White US Mens Size 9.5 with original box",
    "Nike Air Jordan 11 Mid Black White US Mens Size 9.5 with original box",
    "Nike Air Jordan 1 Mid Black Red US Mens Size 9.5 with original box",
    "Nike Air Jordan 1 Mid Black White Red US Mens Size 9.5 with original box",
    "Nike Air Jordan 1 Mid Black White US Mens Size 9.5 replacement laces with original box",
    "Nike Air Jordan 1 Mid Black White US Mens Size 9.5 replica with original box",
    "Nike Air Jordan 1 Mid Black White US Mens Size 9.5 bundle of shoes with original box",
  ])
    assert.equal(
      matchComparable(listing({ title }), query).matches,
      false,
      title,
    );
});
test("size matching rejects neighboring, decimal, alternate system and gender sizes", () => {
  for (const title of [
    listing().title.replace("9.5", "9"),
    listing().title.replace("9.5", "9.50"),
    listing().title.replace("US Mens", "UK Mens"),
    listing().title.replace("US Mens", "US Womens"),
    listing().title.replace("Size 9.5", "Sizes 8-12"),
    listing().title.replace("US Mens", "Mens"),
  ])
    assert.equal(
      matchComparable(listing({ title }), query).matches,
      false,
      title,
    );
});
test("specified packaging, condition and exact identifier must be evidenced", () => {
  assert.equal(
    matchComparable(
      listing({
        title: listing().title.replace("with original box", "no box"),
      }),
      query,
    ).matches,
    false,
  );
  assert.equal(
    matchComparable(listing({ conditionId: "1000" }), query).matches,
    false,
  );
  const exact = {
    ...query,
    details: { ...query.details, productIdentifier: "554724-074" },
  };
  assert.equal(matchComparable(listing(), exact).matches, false);
  assert.equal(
    matchComparable(listing({ title: listing().title + " 554724-074" }), exact)
      .matches,
    true,
  );
  assert.equal(
    matchComparable(listing({ title: listing().title + " 554724-0749" }), exact)
      .matches,
    false,
  );
});
test("optional fields stay optional and unrelated categories work without shoe assumptions", () => {
  const camera: ProductQuery = {
    identification: {
      ...query.identification,
      brand: "Canon",
      productName: "Canon EOS R6",
      model: "EOS R6",
      category: "Cameras",
      colorway: "Black",
    },
    details: { ...emptyMatchDetails },
  };
  assert.equal(
    matchComparable(
      listing({ title: "Canon EOS R6 Black Mirrorless Camera" }),
      camera,
    ).matches,
    true,
  );
  assert.equal(
    matchComparable(listing({ title: "Case for Canon EOS R6 Black" }), camera)
      .matches,
    false,
  );
});
test("matching details reject inconsistent sizes, regex payloads and bad options", () => {
  assert.throws(() => parseMatchDetails({ ...emptyMatchDetails, size: "9" }));
  assert.throws(() =>
    parseMatchDetails({
      ...emptyMatchDetails,
      size: "(a+)+$",
      sizeSystem: "Clothing",
    }),
  );
  assert.throws(() =>
    parseMatchDetails({ ...emptyMatchDetails, condition: "excellent" }),
  );
  assert.deepEqual(parseMatchDetails(emptyMatchDetails), emptyMatchDetails);
});
test("price statistics compute deterministic median average range and deduplicate", () => {
  assert.deepEqual(askingStatistics(fixture([90, 100, 120, 150])), {
    count: 4,
    median: 110,
    average: 115,
    lowest: 90,
    highest: 150,
  });
  assert.equal(
    askingStatistics([
      ...fixture([90, 100, 110]),
      listing({ id: "0", price: 9999 }),
    ])?.median,
    100,
  );
  assert.equal(askingStatistics(fixture([0, -1, NaN, Infinity])), null);
  assert.equal(askingStatistics(fixture([10.01, 10.02]))?.median, 10.02);
});
test("recommendation uses asking median with thresholds and never invents sold evidence", () => {
  const rec = recommend(result(fixture()), {...query, details: {...query.details, productIdentifier: "554724-074"}});
  assert.equal(rec.suggestedListingPrice, 100);
  assert.equal(rec.expectedSellingPrice, null);
  assert.equal(rec.dataQuality, "moderate");
  assert.match(rec.sellNow, /Not assessed/);
  assert.match(rec.marketplaceChoice, /No cross-marketplace/);
  for (const r of [

    result(fixture(), { environment: "sandbox" }),
    result(fixture([20, 100, 120, 150, 200])),
    result(fixture().map((c) => ({ ...c, seller: "same-seller" }))),
  ])
    assert.equal(recommend(r, query).suggestedListingPrice, null);
  const estimated = recommend(result(fixture()), { ...query, details: emptyMatchDetails });
  assert.equal(estimated.suggestedListingPrice, 100);
  assert.equal(estimated.provisional, true);
  assert.equal(recommend(result([]), query).statistics, null);
});
test("published US adult athletic shoe fee scenario handles tier, per order fee and tax", () => {
  assert.deepEqual(
    sneakerProceeds({
      price: 100,
      buyerShipping: 0,
      salesTax: 0,
      sellerShipping: 8,
      extras: 2,
    }),
    { fee: 14, proceeds: 76, rate: 0.136, perOrder: 0.4, base: 100 },
  );
  assert.equal(
    sneakerProceeds({
      price: 150,
      buyerShipping: 0,
      salesTax: 0,
      sellerShipping: 0,
      extras: 0,
    }).fee,
    12,
  );
  assert.equal(
    sneakerProceeds({
      price: 9,
      buyerShipping: 0,
      salesTax: 0,
      sellerShipping: 0,
      extras: 0,
    }).fee,
    1.52,
  );
  const tax = sneakerProceeds({
    price: 100,
    buyerShipping: 10,
    salesTax: 10,
    sellerShipping: 8,
    extras: 0,
  });
  assert.equal(tax.fee, 16.72);
  assert.equal(tax.proceeds, 85.28);
  assert.throws(() =>
    sneakerProceeds({
      price: 100,
      buyerShipping: -1,
      salesTax: 0,
      sellerShipping: 0,
      extras: 0,
    }),
  );
});
test("validates upstream data and rejects unsafe URLs, foreign currency, auctions and ended listings; retains warned variations", () => {
  const body = {
    itemSummaries: [
      row(),
      row({ itemId: "foreign", price: { value: "100", currency: "EUR" } }),
      row({
        itemId: "bad",
        itemWebUrl: "https://ebay.com.evil.example/itm/123",
      }),
      row({ itemId: "js", itemWebUrl: "javascript:alert(1)" }),
      row({ itemId: "auction", buyingOptions: ["AUCTION"] }),
      row({ itemId: "group", itemGroupType: "SELLER_DEFINED_VARIATIONS" }),
      row({ itemId: "ended", itemEndDate: "2020-01-01T00:00:00Z" }),
      row(),
    ],
  };
  const v = normalizeEbaySearch(body, "production", stamp);
  assert.equal(v.items.length, 2);
  assert.equal(v.invalid, 6);
  assert.ok(v.items[1].warnings.some(w => w.includes("Variation")));
  assert.equal(v.items[0].shipping, 10);
  assert.throws(() => normalizeEbaySearch({}, "production", stamp));
  assert.deepEqual(
    normalizeEbaySearch({ total: 0 }, "production", stamp).items,
    [],
  );
});
test("missing credentials and unapproved production never call eBay", async () => {
  const fetcher: typeof fetch = async () => {
    throw Error("unexpected network call");
  };
  const missing = await createEbayProvider({ fetcher }).search(query);
  assert.equal(missing.status, "unavailable");
  assert.match(missing.reason!, /EBAY_CLIENT_ID/);
  const blocked = await createEbayProvider({
    clientId: "test",
    clientSecret: "test",
    environment: "production",
    fetcher,
  }).search(query);
  assert.match(blocked.reason!, /approval/);
});
test("official OAuth/search requests, cache, deduplication and expiry work", async () => {
  let current = Date.parse(stamp),
    auth = 0,
    search = 0;
  const fetcher: typeof fetch = async (url, init) => {
    assert.ok(String(url).startsWith("https://api.ebay.com/"));
    if (String(url).includes("/oauth2/token")) {
      auth++;
      assert.match(String(init?.body), /grant_type=client_credentials/);
      return Response.json({ access_token: "test-token", expires_in: 7200 });
    }
    search++;
    assert.match(String(url), /buyingOptions/);
    assert.match(String(url), /limit=100/);
    assert.equal(
      (init?.headers as Record<string, string>)["X-EBAY-C-MARKETPLACE-ID"],
      "EBAY_US",
    );
    return Response.json({ itemSummaries: [row()] });
  };
  const provider = createEbayProvider({
    clientId: "test-id",
    clientSecret: "test-secret",
    environment: "production",
    productionApproved: true,
    fetcher,
    now: () => current,
  });
  const [a, b] = await Promise.all([
    provider.search(query),
    provider.search(query),
  ]);
  assert.equal(a.status, "available");
  assert.equal(b.comparables.length, 1);
  assert.equal(search, 3);
  assert.equal((await provider.search(query)).cached, true);
  current += 300001;
  assert.equal((await provider.search(query)).cached, false);
  assert.equal(search, 6);
  assert.equal(auth, 1);
  current += 7200000;
  await provider.search(query);
  assert.equal(auth, 2);
});
test("rate limit retry-after triggers shared cooldown and no fake prices", async () => {
  let calls = 0;
  const provider = createEbayProvider({
    clientId: "test",
    clientSecret: "test",
    environment: "production",
    productionApproved: true,
    fetcher: async () => {
      calls++;
      return new Response("private upstream body", {
        status: 429,
        headers: { "Retry-After": "120" },
      });
    },
  });
  const a = await provider.search(query);
  assert.equal(a.status, "unavailable");
  assert.equal(a.retryAfterSeconds, 120);
  assert.deepEqual(a.comparables, []);
  await provider.search(query);
  assert.equal(calls, 1);
});
test("permission errors and malformed responses are sanitized", async () => {
  for (const status of [401, 403, 500]) {
    const r = await createEbayProvider({
      clientId: "private-id",
      clientSecret: "private-secret",
      fetcher: async () => new Response("private-secret", { status }),
    }).search(query);
    assert.equal(r.status, "unavailable");
    assert.ok(!JSON.stringify(r).includes("private-secret"));
  }
});
test("sandbox is isolated and cannot generate a market recommendation", async () => {
  const provider = createEbayProvider({
    clientId: "test",
    clientSecret: "test",
    fetcher: async (url) =>
      String(url).includes("oauth2")
        ? Response.json({ access_token: "token", expires_in: 7200 })
        : Response.json({
            itemSummaries: [
              row({ itemWebUrl: "https://www.sandbox.ebay.com/itm/123" }),
            ],
          }),
  });
  const r = await provider.search(query);
  assert.equal(r.environment, "sandbox");
  assert.equal(r.comparables.length, 1);
  assert.equal(recommend(r, query).suggestedListingPrice, null);
  assert.ok(r.warnings.some((w) => w.includes("Sandbox")));
});
test("marketplace endpoint validates confirmed product, request size and origin", async () => {
  let calls = 0;
  const handler = createMarketplaceHandler({
    id: "ebay",
    search: async () => {
      calls++;
      return result(fixture());
    },
  });
  const req = (body: unknown, origin = "http://localhost:3001") =>
    new Request("http://localhost:3001/api/marketplaces/ebay", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin },
      body: JSON.stringify(body),
    });
  assert.equal((await handler(req(query))).status, 200);
  assert.equal(calls, 1);
  assert.equal(
    (
      await handler(
        req({
          ...query,
          identification: { ...query.identification, productName:null, model: null, category:null },
        }),
      )
    ).status,
    400,
  );
  assert.equal((await handler(req(query, "https://evil.example"))).status, 403);
  assert.equal((await handler(req({ huge: "x".repeat(25000) }))).status, 413);
});
test("live report with no confirmed item never shows a demo product or price", () => {
  const html = renderToStaticMarkup(
    createElement(IdentificationProvider, {
      children: createElement(LiveReport),
    }),
  );
  assert.match(html, /Confirm an item/);
  assert.ok(!html.includes("Nike Dunk"));
  assert.ok(!html.includes("$85"));
  assert.match(html, /No fictional prices/);
});

test("matching details survive confirmation and are cleared for a different photo", async () => {
  const { identificationReducer, emptyIdentificationState } =
    await import("./identification-workflow");
  let state = identificationReducer(emptyIdentificationState, {
    type: "photos",
    photos: [{ id: "photo", url: "blob:actual", name: "actual.png" }],
  });
  state = identificationReducer(state, {
    type: "identified",
    identification: query.identification,
  });
  state = identificationReducer(state, {
    type: "details",
    details: query.details,
  });
  state = identificationReducer(state, { type: "confirm" });
  assert.deepEqual(state.details, query.details);
  assert.equal(state.confirmed?.model, "Air Jordan 1 Mid");
  state = identificationReducer(state, { type: "photos", photos: [] });
  assert.deepEqual(state.details, emptyMatchDetails);
  assert.equal(state.confirmed, null);
});
test("clothing size matching respects plain alpha sizes", () => {
  const clothing: ProductQuery = {
    identification: {
      ...query.identification,
      brand: "Patagonia",
      productName: "Better Sweater",
      model: "Better Sweater",
      category: "Clothing",
      colorway: "Black",
    },
    details: {
      ...emptyMatchDetails,
      size: "M",
      sizeSystem: "Clothing",
      condition: "used",
    },
  };
  assert.equal(
    matchComparable(
      listing({ title: "Patagonia Better Sweater Black Jacket Size M" }),
      clothing,
    ).matches,
    true,
  );
  assert.equal(
    matchComparable(
      listing({ title: "Patagonia Better Sweater Black Jacket Size XL" }),
      clothing,
    ).matches,
    false,
  );
});

test("OAuth trims only outer whitespace and encodes the expected credential pair", async () => {
  let authCalls = 0;
  const provider = createEbayProvider({
    clientId: " test-id ",
    clientSecret: " test-secret ",
    environment: "production",
    productionApproved: true,
    fetcher: async (url, init) => {
      if (String(url).includes("oauth2/token")) {
        authCalls++;
        assert.equal(
          (init!.headers as Record<string, string>).Authorization,
          "Basic " + Buffer.from("test-id:test-secret").toString("base64"),
        );
        assert.equal(
          (init!.headers as Record<string, string>)["Content-Type"],
          "application/x-www-form-urlencoded",
        );
        const params = new URLSearchParams(init!.body as string);
        assert.equal(params.get("grant_type"), "client_credentials");
        assert.equal(
          params.get("scope"),
          "https://api.ebay.com/oauth/api_scope",
        );
        return Response.json({ access_token: "test-token", expires_in: 7200 });
      }
      return Response.json({ total: 0 });
    },
  });
  await provider.search(query);
  assert.equal(authCalls, 1);
});
test("embedded credential line breaks fail locally without an OAuth request", async () => {
  let called = false;
  const provider = createEbayProvider({
    clientId: "test-id",
    clientSecret: "test" + String.fromCharCode(10) + "secret",
    environment: "production",
    productionApproved: true,
    fetcher: async () => {
      called = true;
      throw Error();
    },
  });
  const r = await provider.search(query);
  assert.match(r.reason!, /embedded whitespace/);
  assert.equal(called, false);
});
test("OAuth invalid_client is distinguished from Browse and raw provider text stays private", async () => {
  let calls = 0;
  const provider = createEbayProvider({
    clientId: "test-id",
    clientSecret: "test-secret",
    environment: "production",
    productionApproved: true,
    fetcher: async () => {
      calls++;
      return Response.json(
        {
          error: "invalid_client",
          error_description: "raw private diagnostic test-secret",
        },
        { status: 401 },
      );
    },
  });
  const r = await provider.search(query);
  assert.ok(
    r.reason!.includes(
      "production OAuth client authentication failed (invalid_client)",
    ),
  );
  assert.ok(!r.reason!.includes("test-secret"));
  assert.ok(!r.reason!.includes("raw private"));
  assert.equal(calls, 1);
});

 test("Jordan title aliases, condition grades and missing optional fields remain comparable", () => {
 const q = {...query, details: {...emptyMatchDetails, condition: "used" as const}};
 for (const title of ["Jordan 1 Mid Black White", "Air Jordan 1 Mid Black White", "Nike AJ1 Mid Black White"]) {
 const normalized = normalizeEbaySearch({itemSummaries:[row({title, conditionId:"2990", condition:"Pre-owned - Excellent", seller:undefined})]}, "production", stamp);
 assert.equal(normalized.items.length,1);
 assert.equal(normalized.items[0].seller,null);
 assert.equal(matchComparable(normalized.items[0],q).matches,true);
 }
 assert.equal(matchComparable(listing({conditionId:"3010"}),query).matches,true);
 assert.equal(matchComparable(listing({title:"Jordan 1 Low Black White"}),q).matches,false);
 assert.equal(matchComparable(listing({title:"Jordan 1 Mid Black White Gold"}),q).matches,false);
 });
 test("duplicates and all excluded rows have explicit diagnostics", () => {
 const n=normalizeEbaySearch({itemSummaries:[row(),row(),row({itemId:"ended",itemEndDate:"2020-01-01"}),row({itemId:"url",itemWebUrl:"invalid"})]},"production",stamp);
 assert.equal(n.items.length,1); assert.equal(n.invalid,3);assert.equal(n.diagnostics.length,3);assert.equal(n.exclusions.duplicate_item,1);
 });
 test("relevant variation listings display but cannot supply price evidence", () => {
 const n=normalizeEbaySearch({itemSummaries:[row({itemGroupType:"SELLER_DEFINED_VARIATIONS"})]},"production",stamp);
 assert.equal(n.items.length,1);assert.equal(matchComparable(n.items[0],query).matches,true);
 assert.equal(recommend(result(n.items),query).statistics,null);
 assert.equal(recommend(result(n.items),query).suggestedListingPrice,null);
 });
 test("small samples retain observed statistics without a recommendation", () => {
 const r=recommend(result(fixture().slice(0,2)),query);assert.equal(r.statistics?.count,2);assert.equal(r.suggestedListingPrice,null);
 });

test("numeric condition IDs normalize without inventing a condition",()=>{const n=normalizeEbaySearch({itemSummaries:[row({conditionId:2990})]},"production",stamp);assert.equal(n.items[0].conditionId,"2990");});

test("provider diagnostics account for every API row and distinguish empty searches", async () => {
 const q={...query,details:{...emptyMatchDetails}};
 const provider=createEbayProvider({clientId:"test",clientSecret:"test",environment:"production",productionApproved:true,fetcher:async(url)=>String(url).includes("oauth2") ? Response.json({access_token:"fixture",expires_in:7200}) : Response.json({itemSummaries:[row(),row(),row({itemId:"wrong",title:"Nike Air Jordan 1 Low Black Red"}),row({itemId:"missing-seller",seller:undefined,conditionId:"2990"})]})});
 const r=await provider.search(q);assert.equal(r.status,"available");assert.equal(r.comparables.length,2);assert.equal(r.diagnostics?.rows.length,12);assert.equal(r.diagnostics?.exclusions.duplicate_item,3);assert.equal(r.examined,r.invalid+r.excluded+r.comparables.length);assert.ok(r.comparables.every(x=>x.price>0&&x.url.startsWith("https://www.ebay.com/itm/")&&x.matchReasons.length));
 const empty=createEbayProvider({clientId:"test",clientSecret:"test",fetcher:async(url)=>String(url).includes("oauth2") ? Response.json({access_token:"fixture",expires_in:7200}) : Response.json({total:0})});const e=await empty.search(q);assert.equal(e.status,"no_matches");assert.equal(e.examined,0);assert.deepEqual(e.diagnostics?.exclusions,{});
});
