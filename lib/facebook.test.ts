import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IdentificationProvider } from "../components/identification-context";
import { FacebookMarketplaceSection } from "../components/facebook-marketplace-section";
import {
  createSocialFetchProvider,
  normalizeFacebookResponse,
} from "./marketplace-providers/social-fetch";
import { parseFacebookLocation, type FacebookRequest } from "./facebook";
import { facebookValuation } from "./facebook-valuation";
import { createFacebookHandler } from "./facebook-server";
import { generateFacebookAdvice } from "./facebook-advice";
import { emptyMatchDetails } from "./marketplaces";
import {
  identificationReducer,
  emptyIdentificationState,
} from "./identification-workflow";
const stamp = new Date().toISOString();
const query: FacebookRequest = {
  identification: {
    brand: "Jordan",
    productName: "Air Jordan 1 Mid",
    model: "Air Jordan 1 Mid",
    category: "Sneakers",
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
  },
  location: {
    label: "New York, NY",
    lat: 40.7128,
    lng: -74.006,
    radiusKm: 25,
    condition: "usedGood",
  },
  intentId: "confirmation-00000001",
  trigger: "confirmation",
};
const row = (changes: Record<string, unknown> = {}) => ({
  id: "123",
  title: "Air Jordan 1 Mid Black White US Mens Size 9.5",
  url: "https://www.facebook.com/marketplace/item/123/",
  price: {
    amount: 100,
    formattedAmount: "US$100.00",
    amountWithOffsetInCurrency: 10000,
  },
  location: { displayName: "New York, NY" },
  primaryPhoto: { url: "https://scontent.test.fbcdn.net/photo.jpg" },
  status: { isSold: false, isLive: true, isPending: false, isHidden: false },
  ...changes,
});
const envelope = (rows: unknown[] = [row()], credits = 1) => ({
  data: { listings: rows },
  meta: {
    requestId: "provider-request-test",
    creditsCharged: credits,
    version: "v1",
  },
});
const enabled = (fetcher: typeof fetch, now = Date.now) =>
  createSocialFetchProvider({
    apiKey: "test-only-private-key",
    permittedUseConfirmed: true,
    permissionReference: "TEST FIXTURE — not real permission",
    fetcher,
    now,
  });
test("unverified permission blocks every provider call even with a key", async () => {
  let calls = 0;
  for (const settings of [
    {},
    { permittedUseConfirmed: true },
    { permissionReference: "reference" },
  ]) {
    const provider = createSocialFetchProvider({
      apiKey: "test-key",
      ...settings,
      fetcher: async () => {
        calls++;
        throw Error("must not call");
      },
    });
    const r = await provider.search(query);
    assert.equal(r.status, "disabled");
    assert.equal(r.creditsCharged, 0);
    assert.deepEqual(r.comparables, []);
  }
  assert.equal(calls, 0);
});
test("enabled but missing key returns actionable configuration error with no network", async () => {
  const provider = createSocialFetchProvider({
    permittedUseConfirmed: true,
    permissionReference: "TEST",
    fetcher: async () => {
      throw Error("must not call");
    },
  });
  assert.match((await provider.search(query)).reason!, /SOCIAL_FETCH_API_KEY/);
});
test("location validates coordinate and radius boundaries without geocoding", () => {
  assert.deepEqual(parseFacebookLocation(query.location), query.location);
  for (const changes of [
    { lat: 91 },
    { lng: -181 },
    { radiusKm: 0 },
    { radiusKm: 251 },
    { lat: NaN },
    { condition: "excellent" },
  ])
    assert.throws(() =>
      parseFacebookLocation({ ...query.location, ...changes }),
    );
});
test("normalizes actual API fields including numeric price, source photo and location", () => {
  const v = normalizeFacebookResponse(envelope(), query, stamp);
  assert.equal(v.comparables.length, 1);
  assert.equal(v.comparables[0].price, 100);
  assert.equal(v.comparables[0].location, "New York, NY");
  assert.match(v.comparables[0].photo!, /fbcdn.net/);
  assert.match(v.comparables[0].condition, /search filter/);
  assert.equal(v.creditsCharged, 1);
});
test("rejects sold, pending, unknown status, free, ambiguous currency and mismatches", () => {
  const rows = [
    row(),
    row({
      id: "sold",
      status: { isSold: true, isLive: true, isPending: false, isHidden: false },
    }),
    row({
      id: "unknown",
      status: { isSold: null, isLive: true, isPending: false, isHidden: false },
    }),
    row({
      id: "pending",
      status: { isSold: false, isLive: true, isPending: true, isHidden: false },
    }),
    row({ id: "ambiguous", price: { amount: 100, formattedAmount: "$100" } }),
    row({ id: "free", price: { amount: 0, formattedAmount: "USD 0" } }),
    row({
      id: "wrong",
      title: "Air Jordan 1 Low Black White US Mens Size 9.5",
    }),
  ];
  const v = normalizeFacebookResponse(envelope(rows), query, stamp);
  assert.equal(v.comparables.length, 1);
  assert.equal(v.invalid, 5);
  assert.equal(v.excluded, 1);
});
test("source and photo URLs are constrained and malformed envelope rejected", () => {
  const v = normalizeFacebookResponse(
    envelope([
      row({ url: "https://facebook.com.evil.test/marketplace/item/123/" }),
      row({ primaryPhoto: { url: "http://localhost/private" } }),
    ]),
    query,
    stamp,
  );
  assert.equal(v.invalid, 1);
  assert.equal(v.comparables[0].photo, null);
  assert.throws(() =>
    normalizeFacebookResponse({ data: { listings: [] } }, query, stamp),
  );
});
test("auth uses x-api-key only server-side and one page without sold/search retries", async () => {
  let calls = 0;
  const provider = enabled(async (url, init) => {
    calls++;
    const u = new URL(String(url));
    assert.equal(u.origin, "https://api.socialfetch.dev");
    assert.equal(u.pathname, "/v1/facebook/marketplace/search");
    assert.equal(u.searchParams.get("availability"), "available");
    assert.equal(u.searchParams.get("limit"), "50");
    assert.equal(u.searchParams.get("lat"), String(query.location.lat));
    assert.equal(u.searchParams.get("radiusKm"), "25");
    assert.equal(u.searchParams.get("condition"), "usedGood");
    assert.match(u.searchParams.get("query")!, /jordan 1 mid/);
    assert.equal(
      (init?.headers as Record<string, string>)["x-api-key"],
      "test-only-private-key",
    );
    assert.ok(!String(url).includes("test-only-private-key"));
    return Response.json(envelope());
  });
  const a = await provider.search(query);
  assert.equal(a.status, "available");
  assert.ok(!JSON.stringify(a).includes("test-only-private-key"));
  assert.equal(calls, 1);
});
test("confirmation deduplication, local cache and idempotency avoid repeat charges", async () => {
  let now = Date.now(),
    calls = 0;
  const provider = enabled(
    async () => {
      calls++;
      return Response.json(envelope());
    },
    () => now,
  );
  await Promise.all([provider.search(query), provider.search(query)]);
  assert.equal(calls, 1);
  const second = {
    ...query,
    intentId: "refresh-000000000002",
    trigger: "refresh" as const,
  };
  const cached = await provider.search(second);
  assert.equal(cached.cached, true);
  assert.equal(cached.creditsCharged, 0);
  now += 600001;
  await provider.search(second);
  assert.equal(calls, 1);
  await provider.search({ ...query, intentId: "refresh-000000000003" });
  assert.equal(calls, 2);
  const conflict = await provider.search({
    ...query,
    location: { ...query.location, radiusKm: 50 },
  });
  assert.equal(conflict.status, "unavailable");
  assert.equal(calls, 2);
});
test("429 cooldown, exhausted credits and denied access never automatically retry", async () => {
  for (const status of [429, 402, 401, 403, 500]) {
    let calls = 0;
    const provider = enabled(async () => {
      calls++;
      return new Response("private upstream details", {
        status,
        headers: { "retry-after": "120" },
      });
    });
    const r = await provider.search(query);
    assert.equal(r.status, "unavailable");
    assert.ok(!JSON.stringify(r).includes("private upstream details"));
    await provider.search(query);
    assert.equal(calls, 1);
    if (status === 429) {
      await provider.search({ ...query, intentId: "refresh-000000000002" });
      assert.equal(calls, 1);
      assert.equal(r.retryAfterSeconds, 120);
    }
  }
});
test("local hourly credit budget prevents a sixth distinct billed search", async () => {
  let calls = 0;
  const provider = enabled(async () => {
    calls++;
    return Response.json(envelope());
  });
  for (let i = 0; i < 6; i++)
    await provider.search({
      ...query,
      intentId: `refresh-00000000000${i}`,
      location: { ...query.location, radiusKm: 20 + i },
    });
  assert.equal(calls, 5);
});
test("asking statistics do not become invented sold prices or arbitrary discounts", async () => {
  const rows = [80, 90, 100, 110, 120].map((price, i) =>
    row({
      id: String(i),
      price: { amount: price, formattedAmount: `USD ${price}` },
    }),
  );
  const r = await enabled(async () => Response.json(envelope(rows))).search(
    query,
  );
  const valuation = facebookValuation(r, query);
  assert.equal(valuation.statistics?.median, 100);
  assert.deepEqual(valuation.askingRange, { low: 80, high: 120 });
  assert.equal(valuation.suggestedListingPrice, 100);
  assert.equal(valuation.estimatedSellingRange, null);
  assert.match(valuation.sellingRangeExplanation, /cannot be inferred/);
  assert.equal(valuation.evidenceQuality, "moderate");
});
test("Facebook endpoint validates action, location and condition before searching", async () => {
  const provider = enabled(async () => {
    throw Error("unexpected call");
  });
  const handler = createFacebookHandler(provider);
  const request = (body: unknown, origin = "http://localhost:3001") =>
    new Request("http://localhost:3001/api/marketplaces/facebook", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await handler(request({ ...query, intentId: "" }))).status,
    400,
  );
  assert.equal(
    (
      await handler(
        request({ ...query, location: { ...query.location, lat: 100 } }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await handler(request(query, "https://evil.test"))).status,
    403,
  );
  const disabled = createFacebookHandler(
    createSocialFetchProvider({ apiKey: "test-key" }),
  );
  const r = await disabled(request(query));
  const body = await r.json();
  assert.equal(body.result.status, "disabled");
  assert.equal(body.valuation.statistics, null);
});
test("confirmation creates explicit search intent; image/identity changes clear it", () => {
  let state = identificationReducer(emptyIdentificationState, {
    type: "photos",
    photos: [{ id: "a", url: "blob:actual", name: "actual.png" }],
  });
  state = identificationReducer(state, {
    type: "identified",
    identification: query.identification,
  });
  state = identificationReducer(state, {
    type: "facebook-location",
    location: query.location,
  });
  state = identificationReducer(state, {
    type: "confirm",
    requestId: query.intentId,
  });
  assert.equal(state.confirmationId, query.intentId);
  assert.deepEqual(state.facebookLocation, query.location);
  state = identificationReducer(state, { type: "photos", photos: [] });
  assert.equal(state.confirmationId, null);
});
test("disabled section uses existing cards, explains gate and shows no fake listings", () => {
  const html = renderToStaticMarkup(
    createElement(IdentificationProvider, {
      children: createElement(FacebookMarketplaceSection),
    }),
  );
  assert.match(html, /Facebook Marketplace/);
  assert.match(html, /Provider requests are disabled/);
  assert.match(html, /No Social Fetch credits/);
  assert.ok(!html.includes("src="));
  assert.ok(!html.includes("$100"));
});
test("AI advice is gated before any paid request and cannot return price text", async () => {
  const r = await enabled(async () => Response.json(envelope())).search(query);
  let calls = 0;
  await assert.rejects(() =>
    generateFacebookAdvice({
      result: r,
      query,
      permitted: false,
      apiKey: "test-only",
      fetcher: async () => {
        calls++;
        throw Error();
      },
    }),
  );
  assert.equal(calls, 0);
  const fetcher: typeof fetch = async () =>
    Response.json({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ tips: ["List for $100"] }),
            },
          ],
        },
      ],
    });
  await assert.rejects(() =>
    generateFacebookAdvice({
      result: r,
      query,
      permitted: true,
      apiKey: "test-only",
      fetcher,
    }),
  );
});
