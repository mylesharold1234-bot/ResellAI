import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductImage } from "../components/product-image";
test("renders the supplied photo URL rather than an invented image", () => {
  const html = renderToStaticMarkup(
    createElement(ProductImage, {
      photo: "blob:user-upload-123",
      alt: "Your uploaded product",
    }),
  );
  assert.match(html, /src="blob:user-upload-123"/);
  assert.match(html, /alt="Your uploaded product"/);
  assert.ok(!html.includes("Product photo unavailable"));
});
test("renders a camera placeholder if no actual photo is available", () => {
  const html = renderToStaticMarkup(createElement(ProductImage, {}));
  assert.match(html, /Product photo unavailable/);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("sneaker illustration"));
});
import { ReportItemContent } from "../components/report-item";
import {
  identificationReducer,
  emptyIdentificationState,
} from "./identification-workflow";
import type { Identification } from "./identification";
test("confirmed report renders uploaded photo with corrected identification, not demo identity", () => {
  const item: Identification = {
    brand: "Example maker",
    productName: "User corrected camera",
    category: "Electronics",
    model: null,
    colorway: "Black",
    visibleCondition: "Unknown",
    identifyingInformation: null,
    confidence: "low",
    uncertainties: ["Model uncertain"],
    additionalEvidence: ["Model plate"],
  };
  let state = identificationReducer(emptyIdentificationState, {
    type: "photos",
    photos: [
      { id: "actual", url: "blob:confirmed-user-photo", name: "actual.png" },
    ],
  });
  state = identificationReducer(state, {
    type: "identified",
    identification: item,
  });
  state = identificationReducer(state, { type: "confirm" });
  const html = renderToStaticMarkup(
    createElement(ReportItemContent, { state }),
  );
  assert.match(html, /src="blob:confirmed-user-photo"/);
  assert.match(html, /User corrected camera/);
  assert.match(html, /Model uncertain/);
  assert.ok(!html.includes("Nike Dunk"));
});
test("unconfirmed report cannot pair an uploaded photo with the demo item", () => {
  const state = identificationReducer(emptyIdentificationState, {
    type: "photos",
    photos: [
      { id: "unconfirmed", url: "blob:unconfirmed", name: "unknown.png" },
    ],
  });
  const html = renderToStaticMarkup(
    createElement(ReportItemContent, { state }),
  );
  assert.ok(!html.includes('src="blob:unconfirmed"'));
  assert.match(html, /fixed demo item/);
});
test("explicit demo report does not substitute a previously confirmed photo", () => {
  const state = {
    ...emptyIdentificationState,
    photos: [{ id: "actual", url: "blob:actual", name: "actual.png" }],
    confirmed: {
      brand: "Other",
      productName: "Different product",
      category: "Electronics",
      model: null,
      colorway: null,
      visibleCondition: null,
      identifyingInformation: null,
      confidence: "low" as const,
      uncertainties: [],
      additionalEvidence: [],
    },
  };
  const html = renderToStaticMarkup(
    createElement(ReportItemContent, { state, forceDemo: true }),
  );
  assert.match(html, /Nike Dunk Low/);
  assert.ok(!html.includes('src="blob:actual"'));
  assert.ok(!html.includes("Different product"));
});
