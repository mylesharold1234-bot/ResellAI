import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyMatchDetails } from "./marketplaces";
import { createListingDraft, confirmAttribute } from "./listing/draft";
import { createListingGenerateHandler, listingPromptFacts } from "./listing/generate-server";
import type { ListingDraft } from "./listing/types";

const draft = (): ListingDraft => {
  let d = createListingDraft({
    id: "d1",
    now: "2026-11-13T12:00:00.000Z",
    identification: { brand: "Nike", productName: "Nike Dunk Low", category: "Sneakers", model: "Dunk Low", colorway: "White and black", visibleCondition: "Worn", identifyingInformation: null, confidence: "medium", uncertainties: [], additionalEvidence: [] },
    details: { ...emptyMatchDetails, size: "10", sizeSystem: "US Men", condition: "used" },
    sources: { brand: "image-visible", productName: "image-visible", model: "ai-inferred", colorway: "image-visible" },
    photos: [{ id: "p1", name: "a.jpg" }],
    ebay: null,
    mercari: null,
  });
  d = { ...d, condition: { ...d.condition, noKnownDefects: true } };
  return d;
};
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3001/api/listings/generate", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const aiReply = (out: object) =>
  (async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out) }] }] })) as unknown as typeof fetch;

test("without an API key, a complete template listing is returned and no network call is made", async () => {
  let calls = 0;
  const handler = createListingGenerateHandler({ apiKey: "", fetcher: (async () => { calls++; return new Response(); }) as unknown as typeof fetch });
  const res = await handler(request({ draft: draft() }));
  const { listing } = await res.json();
  assert.equal(res.status, 200);
  assert.equal(calls, 0);
  assert.equal(listing.source, "template");
  assert.match(listing.title, /Nike Dunk Low/);
  assert.ok(!/Dunk Low Dunk/.test(listing.title));
  assert.match(listing.description, /Item details/);
  assert.match(listing.warnings[0], /OPENAI_API_KEY/);
});

test("the model receives only confirmed/identified facts and no photos", async () => {
  let sent: { input: string; store: boolean } | null = null;
  const fetcher = (async (_u: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ title: "Nike Dunk Low Men's Size 10 Pre-Owned", description: "Nike Dunk Low.\n\nItem details:\n- Size: 10", conditionDescription: "Pre-owned. No other flaws known to the seller.", tips: ["Photograph the soles."] }) }] }] });
  }) as unknown as typeof fetch;
  const res = await createListingGenerateHandler({ apiKey: "k", fetcher })(request({ draft: draft() }));
  const { listing } = await res.json();
  assert.equal(listing.source, "ai");
  assert.equal(listing.title, "Nike Dunk Low Men's Size 10 Pre-Owned");
  assert.ok(sent);
  const s = sent as unknown as { input: string; store: boolean };
  assert.equal(s.store, false);
  assert.ok(!s.input.includes("data:image"), "no images re-sent");
  const facts = JSON.parse(s.input);
  assert.ok(facts.facts.some((f: { name: string }) => f.name === "Model"), "seller-approved identity can be named");
  assert.ok(facts.missingDetails.includes("Style code / SKU"));
  // A non-identity AI inference (material read from the photo) stays out until the seller confirms it.
  const withMaterial = draft();
  withMaterial.attributes = withMaterial.attributes.map((a) => (a.key === "material" ? { ...a, value: "Leather", source: "ai-inferred" as const, confirmed: false } : a));
  assert.ok(!listingPromptFacts(withMaterial, "ebay").facts.some((f) => f.name === "Upper material"));
  assert.ok(listingPromptFacts(confirmAttribute(withMaterial, "material"), "ebay").facts.some((f) => f.name === "Upper material" && f.value === "Leather"));
});

test("hallucinated claims in AI output are replaced by the template, with warnings", async () => {
  const handler = createListingGenerateHandler({
    apiKey: "k",
    fetcher: aiReply({
      title: "100% Authentic Nike Dunk Low Panda Size 11 DS",
      description: "Brand new with original box. Style DD1391-100.",
      conditionDescription: "Flawless.",
      tips: ["Price it at $120 to sell fast", "Photograph the size tag."],
    }),
  });
  const { listing } = await (await handler(request({ draft: draft() }))).json();
  assert.equal(listing.source, "ai");
  assert.ok(!/authentic|11|DS/i.test(listing.title));
  assert.ok(!/brand new|DD1391/i.test(listing.description));
  assert.ok(!/flawless/i.test(listing.condition));
  assert.equal(listing.warnings.length, 3);
  assert.match(listing.warnings.join(" "), /authenticity/);
  assert.ok(!listing.recommendations.some((t: string) => /\$120/.test(t)), "AI tips with prices dropped");
  assert.ok(listing.recommendations.includes("Photograph the size tag."));
});

test("over-length AI titles fall back to a title within the marketplace limit", async () => {
  const handler = createListingGenerateHandler({ apiKey: "k", fetcher: aiReply({ title: "Nike ".repeat(30), description: "Nike Dunk Low.", conditionDescription: "Pre-owned.", tips: [] }) });
  const { listing } = await (await handler(request({ draft: draft(), marketplace: "ebay" }))).json();
  assert.ok(listing.title.length <= 80);
  assert.match(listing.warnings[0], /80-character/);
});

test("per-field regeneration returns only the requested field", async () => {
  const handler = createListingGenerateHandler({ apiKey: "", fetcher: fetch });
  const { listing } = await (await handler(request({ draft: draft(), fields: ["title"] }))).json();
  assert.ok(listing.title);
  assert.equal(listing.description, undefined);
  assert.equal(listing.condition, undefined);
});

test("OpenAI failures and timeouts degrade to the template instead of failing", async () => {
  for (const fetcher of [
    (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
    (async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) as unknown as typeof fetch,
    (async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] })) as unknown as typeof fetch,
  ]) {
    const res = await createListingGenerateHandler({ apiKey: "k", fetcher })(request({ draft: draft() }));
    const { listing } = await res.json();
    assert.equal(res.status, 200);
    assert.equal(listing.source, "template");
    assert.match(listing.warnings[0], /unavailable/);
  }
});

test("invalid requests are rejected before any AI call", async () => {
  const handler = createListingGenerateHandler({ apiKey: "k", fetcher: (async () => { throw new Error("must not call"); }) as unknown as typeof fetch });
  assert.equal((await handler(request({ draft: { id: "x" } }))).status, 400);
  assert.equal((await handler(request({ draft: draft(), fields: ["price"] }))).status, 400);
  assert.equal((await handler(request({ draft: draft(), marketplace: "amazon" }))).status, 400);
  assert.equal((await handler(request({ draft: draft() }, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await handler(new Request("http://localhost:3001/x", { method: "POST", body: "a" }))).status, 415);
});
