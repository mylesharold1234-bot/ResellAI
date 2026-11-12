# Social Fetch / Facebook Marketplace — disabled pending permitted-use verification

## Current state

The server adapter, report section, location/radius controls, deterministic calculations, credit protections and optional qualitative AI-advice route are implemented within the existing app. Design, OpenAI recognition/corrections, actual-photo display, and eBay integration remain in place. All Facebook provider requests remain DISABLED. No Social Fetch search, location lookup, image download, account change, purchase or credit-consuming live test was performed.

The running ResellAI server reports `keyConfigured: false`. It does not currently load SOCIAL_FETCH_API_KEY. Verify that your key is saved in this exact EXISTING file, keeping the OpenAI and eBay settings intact:

`C:\Users\Myles Foster\OneDrive\Documents\ChatGPT\syllabus optimizer\resellai\.env.local`

The filename must not end in `.txt`. The key must be named `SOCIAL_FETCH_API_KEY`, without `NEXT_PUBLIC_`. Restart the dev server after editing. Do not paste the key in chat. The application's GET status endpoint reports only whether a key is configured; it never returns the key. The permission gate remains closed even when a key is present.

## What the research established

Official Social Fetch documentation specifies the Facebook **Listing search** operation:

- Base: `https://api.socialfetch.dev`
- `GET /v1/facebook/marketplace/search`
- Header: `x-api-key`
- Required query, lat and lng; radiusKm optional.
- `limit` is preferred over the older count parameter. The adapter requests one page of up to 50, `availability=available`, `deliveryMethod=localPickup`, `sortBy=suggested`, and an optional documented condition filter.
- Rows: `data.listings`; metadata: `meta.requestId` and `meta.creditsCharged`.
- Documented successful listing-search price: one credit per page. Actual response metadata governs charges. Provider-side cached responses can still incur credits. There is no automatic pagination or retry.

Social Fetch's October 14, 2026 terms allow customers to incorporate outputs in products, while reserving source-platform rights and placing third-party compliance on the customer. They do NOT establish Meta authorization for the specific Marketplace collection, photo redistribution and downstream ResellAI use. Meta's official explanation also distinguishes authorized and unauthorized automation. I could not confirm the necessary permission chain from the public documentation. This is an unresolved verification, not a determination that the provider's use is prohibited.

As you requested, access remains disabled. Before enabling, obtain and review written evidence covering:

1. The provider's authorization or other applicable permission for automated Marketplace collection under the relevant source-platform terms, including this endpoint and region.
2. ResellAI's commercial use of the returned listing titles, prices, images, locations and direct links, including attribution and media rights.
3. Permitted cache/retention periods and any listing deletion/update obligations. The implementation uses a ten-minute response cache and a memory-local action ledger retaining outcomes for up to a day to avoid duplicate charges; process restart clears both.
4. Permission to send a minimal derived evidence summary to OpenAI for optional selling advice, with any third-party AI restrictions addressed. No listing photos or precise search coordinates are sent to OpenAI for this feature.
5. Your account/plan's access to the endpoint and expected credit/billing behavior.

Do not treat an API key, paid subscription, public-data label, availability=sold filter, or a local configuration flag as proof of these rights. Do not enable live testing merely to discover whether the API technically works.

After the above is actually verified, a maintainer can record the reviewed non-secret permission/agreement reference and enable:

```dotenv
SOCIAL_FETCH_API_KEY=your_actual_server_only_key
SOCIAL_FETCH_PERMITTED_USE_CONFIRMED=true
SOCIAL_FETCH_PERMISSION_REFERENCE=reference_to_the_reviewed_permission
```

Default is false; both the confirmation flag and a nonempty reference are required. These are acknowledgments of verified permissions, not permissions themselves. Keep them disabled until verification is complete.

## User flow after clearance

1. Upload your actual black-and-white Air Jordan 1 Mid or another product, identify it, and review/correct the result as before. Nothing is hardcoded for Jordan.
2. Specify actual size/system, condition, variant and packaging when known. Review any proposed exact SKU rather than inferring one.
3. In the added Facebook search-area controls, select a built-in city or enter labeled coordinates. Set radius (1–250 km) and a Facebook condition filter; choose **Apply search area**. Built-in cities use local constants, so no paid geocoder or location API is contacted. City names are conveniences; custom coordinates allow other locations.
4. Confirm identification. That creates a unique search-action ID. If a location was selected, a key is loaded and permitted use is enabled, the report searches once. If no area was selected, apply it in the report and explicitly choose **Update Facebook comparisons**.
5. The existing eBay section remains. The Facebook card lists supporting source photos, asking prices, source URLs, locations, search-filter conditions and match evidence. No Facebook login is required by ResellAI; following an original listing link may be subject to Facebook's own access rules.
6. Review median, observed asking range, suggested starting listing price, match count and evidence-quality warnings. The image shown for your own identified item remains your actual uploaded photo; marketplace photos belong to their respective source listings.
7. Optionally choose **Generate qualitative AI selling advice**. This is a separate OpenAI request, limited to one per search action and a bounded process allowance. It uses fresh server-held evidence and does not calculate prices. No AI advice call occurs automatically.

The app does NOT produce an estimated transaction-price range from active listings alone. Instead it displays the actual observed asking-price range and explicitly marks estimated selling price unavailable. A numeric transaction range needs sold evidence or a separately justified/calibrated model. There is no invented negotiation discount, sold price or future prediction.

## Data validation and matching limits

Shared deterministic matching checks confirmed brand/model, known colors, size/system, variant, verified identifier, packaging and condition evidence where available. The Listing search response does not document per-listing condition or seller details; requested condition is therefore evidenced only by its search filter and is labeled accordingly. If the main confirmed condition is specified but cannot be supported, the listing is excluded. Seller independence is unknown, and evidence quality is capped at moderate.

Available listings must have `isSold=false`, `isLive=true`, `isPending=false`, and `isHidden=false`; null/missing flags are excluded rather than assumed available. Prices require a positive finite `price.amount` and an explicit USD/US$ formatted label. A bare `$` or `amountWithOffsetInCurrency` is not interpreted as a verified USD price; such rows are excluded. This conservative rule can result in zero matches even when the provider returns listings. The scope is USD analytics only, with no exchange-rate assumptions.

Source URLs must be HTTPS Facebook Marketplace item URLs. Photos must be HTTPS on supported Facebook CDN hosts; invalid media becomes unavailable. Listing images are lazy loaded with no referrer. No provider images are requested while the feature is disabled. The provider applies the radius; the endpoint does not return exact listing coordinates for independent distance verification.

Statistics use the existing deterministic cents-based calculations and deduplicate listing IDs. A starting listing price equals the median only for at least five relevant active asks, selected condition, non-low identification confidence, requested size for footwear and a max/min price ratio of no more than two. These are transparent heuristics, not a calibrated probability of sale.

## Credit and request safeguards

- Permission gate checked before any external call; key lookup stays server-side.
- One page per explicit search action. No automatic retries, pagination, subscription purchases or auto-refill changes.
- A tab-local confirmation promise and server action IDs prevent duplicate requests from remounts/StrictMode. Changing details cannot reuse an earlier response as if it matched the new query.
- Ten-minute/50-entry search cache; cached hits from ResellAI report zero new provider credits. A stored idempotent outcome may retain its original charge metadata; it does not imply another charge.
- At most five new requests/hour per process and one concurrent provider call; a separate bounded action ledger prevents repeated confirmation billing. These are prototype safeguards, not distributed authenticated quotas.
- Handle 401/403, exhausted credits (402), 429 with Retry-After cooldown, network failures, timeouts, missing configuration and malformed schema. Unreadable/error responses have unknown credit cost when the server cannot verify charge metadata; check provider billing rather than assuming a refund.
- Reload clears the in-memory confirmed item, so no Facebook provider search runs on page refresh. Merely opening the report performs a free local status check, not a Social Fetch request. Comparisons refresh only on confirmation or an explicit update.
- OpenAI tips are generated only after an explicit request and fresh server-held evidence. Price-bearing or unreadable output is rejected. They remain AI-generated commentary, separate from deterministic statistics.

## Files

- `lib/facebook.ts`: types, permission explanation, location validation.
- `lib/marketplace-providers/social-fetch.ts`: gated server adapter, header auth, schema normalization, caching, action deduplication, credit limits and errors.
- `lib/facebook-server.ts`, `lib/social-fetch-service.ts`: bounded request handling and server-only configuration.
- `lib/facebook-valuation.ts`: deterministic asks, heuristic recommendation, explicit absence of a selling-price prediction.
- `lib/facebook-advice.ts`: optional gated qualitative OpenAI explanation.
- `app/api/marketplaces/facebook/route.ts`: local status and search endpoint.
- `app/api/marketplaces/facebook/advice/route.ts`: gated AI-advice endpoint using server-held evidence.
- `components/facebook-location-fields.tsx`, `components/facebook-marketplace-section.tsx`: existing-style controls/report cards.
- `lib/identification-workflow.ts`, `app/analyze/page.tsx`: optional search area and explicit confirmation intent.
- `components/live-report.tsx`, `app/globals.css`: append the Facebook section with matching responsive styling.
- `lib/facebook.test.ts`, `.env.example`, README and this guide.

No new dependencies were added. eBay adapter/credentials and the OpenAI identification route were not replaced.

## Test and remaining verification

Run `npm test`, `npm run typecheck`, and `npm run build` from `resellai/`. Facebook tests use an Air Jordan 1 Mid contract fixture and mocked provider data. They test header auth, permission blocking before network calls, matching and currency/status exclusions, images/URLs, calculation rules, request deduplication, credit budget, error handling, confirmation transitions and AI-output validation. They are NOT evidence that genuine listings were retrieved.

GET http://localhost:3001/api/marketplaces/facebook reports the local gate/key status without sending any provider request. A valid POST while disabled returns `status=disabled`, no listings, null valuation and zero credits. The AI endpoint returns a disabled response without contacting OpenAI. Use those to verify the protected state.

A real Air Jordan retrieval test cannot be completed until permitted use is verified and the key is loaded. After clearance, run one explicit search with the actual confirmed item and your chosen area, inspect `meta.creditsCharged`/provider request ID, manually follow listing links and check photos, sizes, model and currency. No genuine-listing success is currently claimed.

## Official sources

- [Listing search documentation](https://www.socialfetch.dev/docs/api/v1/facebook/marketplace/search/get)
- [Marketplace search overview and credit note](https://www.socialfetch.dev/platforms/facebook/marketplace-search)
- [Social Fetch terms, especially Building on Social Fetch and Third-party platforms](https://www.socialfetch.dev/terms)
- [Social Fetch's public-data/legal-use explanation](https://www.socialfetch.dev/answers/is-social-fetch-legal-to-use-for-scraping-public-social-data)
- [Meta's explanation of authorized and unauthorized scraping](https://about.fb.com/news/2021/04/how-we-combat-scraping/)
- [Meta automated data collection terms](https://www.facebook.com/legal/automated_data_collection_terms) (public retrieval redirected to sign-in during this review).

Final verification for this change: all 58 tests passed, TypeScript passed, and the production build passed. HTTP checks returned 200 for upload, dashboard, live report and separate demo. The local Facebook POST smoke test used the Jordan contract details and returned disabled, zero listings, zero credits, null statistics and no suggested price. Browser inspection confirmed the existing upload interface still loads. Genuine Facebook listing retrieval remains intentionally untested pending verified permitted use and a loaded key.

## Latest configuration recheck

After the owner's report that the key had been saved, the old development process was stopped and a fresh `npm run dev` process started from the ResellAI directory on port 3001. The server explicitly loaded `.env.local`. Its local status endpoint still returned:

```json
{
  "enabled": false,
  "keyConfigured": false,
  "permissionChecks": {
    "permittedUseConfirmed": false,
    "permissionReferenceRecorded": false
  }
}
```

Inspection without printing values found that the exact SOCIAL_FETCH_API_KEY variable name was absent from the saved `resellai/.env.local` file. Save the assignment in that exact file (not an unsaved editor buffer or another project's environment file), then restart. Existing OpenAI/eBay settings were not modified. Key presence is not a validation of the key with Social Fetch.

The status endpoint now exposes the two non-secret permission booleans, making configuration and permitted-use blockers distinguishable. Both remain false; no permission settings were bypassed. The integration was reviewed and its existing confirmation-triggered search, location/radius controls, live listing cards and deterministic valuation are already connected to the report. Genuine retrieval cannot be confirmed while those blockers remain.

All 58 tests passed again, including gated no-network behavior and prior eBay/OpenAI workflows; TypeScript passed. No paid provider requests were made. A permission-clarification draft is available in SOCIAL-FETCH-PERMISSION-REQUEST.md; it has not been sent.

Fresh post-restart HTTP checks returned 200 for `/analyze`, `/dashboard`, `/analysis` and the Facebook status endpoint. A transient development-manifest read error on an earlier request cleared on retry. The development server is left running at http://localhost:3001. Only status diagnostics and documentation were changed in this recheck; no design or eBay/OpenAI identification implementation was replaced.
