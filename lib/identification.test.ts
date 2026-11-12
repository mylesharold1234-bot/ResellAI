import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIdentification, type Identification } from "./identification";
import {
  identificationReducer as reduce,
  emptyIdentificationState as empty,
} from "./identification-workflow";
import { createIdentifyHandler } from "./identify-server";
// Contract fixture only; never used in application behavior or live recognition.
const candidate: Identification = {
  brand: "Jordan",
  productName: "Likely Air Jordan 1 Mid",
  category: "Sneakers",
  model: "Likely Jordan 1 Mid",
  colorway: "Black and white",
  visibleCondition: "Light visible creasing",
  identifyingInformation: null,
  confidence: "medium",
  uncertainties: ["Exact variant cannot be established from this angle."],
  additionalEvidence: ["Add a close-up of the tongue label and lateral side."],
};
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function request({
  bytes = image,
  type = "image/png",
  notes = "",
  origin = "http://localhost:3001",
} = {}) {
  const form = new FormData();
  form.append("images", new File([bytes], "item.png", { type }));
  form.append("notes", notes);
  return new Request("http://localhost:3001/api/identify", {
    method: "POST",
    body: form,
    headers: { origin },
  });
}
function completed(value: unknown = candidate) {
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  });
}
test("upload → identify → edit → confirm retains actual photo and unknown SKU", () => {
  let state = reduce(empty, {
    type: "photos",
    photos: [
      { id: "photo", url: "blob:actual-product-photo", name: "actual.png" },
    ],
  });
  state = reduce(state, { type: "identified", identification: candidate });
  assert.equal(state.confirmed, null);
  state = reduce(state, {
    type: "edit",
    identification: {
      ...state.draft!,
      productName: "Air Jordan 1 Mid (user reviewed)",
    },
  });
  state = reduce(state, { type: "confirm" });
  assert.equal(state.confirmed?.brand, "Jordan");
  assert.equal(state.confirmed?.identifyingInformation, null);
  assert.equal(
    state.confirmed?.productName,
    "Air Jordan 1 Mid (user reviewed)",
  );
  assert.equal(state.photos[0].url, "blob:actual-product-photo");
  assert.equal(state.edited, true);
  state = reduce(state, {
    type: "photos",
    photos: [{ id: "new", url: "blob:other-product", name: "other.png" }],
  });
  assert.equal(state.draft, null);
  assert.equal(state.confirmed, null);
});
test("confirmation requires a photo and recognizable description, with model/category fallback", () => {
  assert.throws(() => reduce(empty, { type: "confirm" }));
  const s = {
    ...empty,
    photos: [{ id: "a", url: "blob:a", name: "a" }],
    draft: { ...candidate, productName: null, model:null, category:null },
  };
  assert.throws(() => reduce(s, { type: "confirm" }));
});
test("incomplete model output is rejected; uncertain non-sneaker items are supported", () => {
  assert.throws(() => parseIdentification({ brand: "Nike" }));
  const other = {
    ...candidate,
    brand: null,
    productName: "Unidentified device",
    category: "Electronics",
    model: null,
    confidence: "low" as const,
  };
  assert.equal(parseIdentification(other).confidence, "low");
});
test("server sends actual image bytes to OpenAI with strict schema and no storage", async () => {
  let called = false;
  const fetcher: typeof fetch = async (url, init) => {
    called = true;
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(
      body.input[0].content[1].image_url,
      `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
    );
    assert.match(body.instructions, /Do not infer a SKU/);
    return completed();
  };
  const response = await createIdentifyHandler({
    apiKey: "test-only-key",
    fetcher,
  })(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).identification, candidate);
  assert.ok(called);
});
test("invalid uploads are rejected before calling the API", async () => {
  let called = false;
  const handler = createIdentifyHandler({
    apiKey: "test-only",
    fetcher: async () => {
      called = true;
      return completed();
    },
  });
  assert.equal(
    (await handler(request({ bytes: new Uint8Array([1, 2, 3]) }))).status,
    400,
  );
  assert.equal((await handler(request({ type: "image/heic" }))).status, 400);
  assert.equal(called, false);
});
test("missing key is actionable and does not call the API", async () => {
  const response = await createIdentifyHandler({
    fetcher: async () => {
      throw Error("must not call");
    },
  })(request());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /OPENAI_API_KEY/);
});
test("rejects cross-origin uploads and oversized/incorrect requests", async () => {
  const handler = createIdentifyHandler({});
  assert.equal(
    (await handler(request({ origin: "https://another-site.example" }))).status,
    403,
  );
  assert.equal(
    (
      await handler(
        new Request("http://localhost:3001/api/identify", {
          method: "POST",
          body: "x",
          headers: { "content-length": String(12 * 1024 * 1024) },
        }),
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await handler(
        new Request("http://localhost:3001/api/identify", {
          method: "POST",
          body: "x",
        }),
      )
    ).status,
    415,
  );
});
test("provider errors never expose credentials or upstream body", async () => {
  for (const [upstream, expected] of [
    [401, 502],
    [403, 502],
    [429, 429],
    [500, 502],
  ]) {
    const response = await createIdentifyHandler({
      apiKey: "private-test-secret",
      fetcher: async () =>
        new Response("private-test-secret", { status: upstream }),
    })(request());
    assert.equal(response.status, expected);
    assert.ok(!(await response.text()).includes("private-test-secret"));
  }
});
test("handles refusal, incomplete, malformed and schema-invalid outputs", async () => {
  for (const [body, status] of [
    [
      {
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal" }] }],
      },
      422,
    ],
    [{ status: "incomplete", output: [] }, 502],
    [{ status: "completed", output: [] }, 502],
    [
      {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "output_text", text: "{}" }] },
        ],
      },
      502,
    ],
  ] as const) {
    const response = await createIdentifyHandler({
      apiKey: "test-only",
      fetcher: async () => Response.json(body),
    })(request());
    assert.equal(response.status, status);
  }
});
test("handles network failure and timeout", async () => {
  for (const [error, status] of [
    [new Error("private network details"), 502],
    [new DOMException("timed out", "TimeoutError"), 504],
  ] as const) {
    const response = await createIdentifyHandler({
      apiKey: "test-only",
      fetcher: async () => {
        throw error;
      },
    })(request());
    assert.equal(response.status, status);
  }
});
test("user notes are passed as observations, not system instructions", async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    assert.match(body.input[0].content[0].text, /Visible size label/);
    assert.ok(!body.instructions.includes("Visible size label"));
    return completed();
  };
  assert.equal(
    (
      await createIdentifyHandler({ apiKey: "test-only", fetcher })(
        request({ notes: "Visible size label: 9" }),
      )
    ).status,
    200,
  );
});
