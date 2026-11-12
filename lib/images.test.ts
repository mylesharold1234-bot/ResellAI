import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateImageMeta,
  validateImageBytes,
  validateImageBatch,
  MAX_IMAGE_BYTES,
} from "./images";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
test("accepts supported types and signatures", () => {
  validateImageBytes("image/png", png);
  validateImageBytes("image/jpeg", Uint8Array.from([255, 216, 255, 224]));
  validateImageBytes(
    "image/webp",
    new TextEncoder().encode("RIFF0000WEBPVP8 "),
  );
});
test("rejects empty, oversized and unsupported images", () => {
  assert.throws(() => validateImageMeta("image/png", 0));
  assert.throws(() => validateImageMeta("image/png", MAX_IMAGE_BYTES + 1));
  assert.throws(() => validateImageMeta("image/heic", 10));
  assert.throws(() => validateImageMeta("image/svg+xml", 10));
});
test("rejects disguised files and truncated headers", () => {
  assert.throws(() =>
    validateImageBytes("image/png", new TextEncoder().encode("not a photo")),
  );
  assert.throws(() => validateImageBytes("image/jpeg", png));
  assert.throws(() =>
    validateImageBytes("image/webp", new TextEncoder().encode("RIFF0000WEBP")),
  );
});
test("bounds image count and combined size", () => {
  assert.throws(() => validateImageBatch([]));
  assert.throws(() =>
    validateImageBatch(Array(4).fill({ type: "image/png", size: 10 })),
  );
  assert.throws(() =>
    validateImageBatch(
      Array(2).fill({ type: "image/png", size: MAX_IMAGE_BYTES }),
    ),
  );
  validateImageBatch([{ type: "image/png", size: 10 }]);
});
