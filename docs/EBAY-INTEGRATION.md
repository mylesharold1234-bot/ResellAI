# eBay integration — Phase 3

Reviewed against official documentation on October 18, 2026. The implementation is complete for local testing and ready to connect to an authorized eBay keyset. Live listing retrieval has not been exercised because EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured.

## Data access and cost

Use the official Buy Browse API for active fixed-price listings. OAuth uses the client-credentials grant and an Application access token, not a seller login or a user refresh token. Required scope: `https://api.ebay.com/oauth/api_scope`.

Join the eBay Developers Program using an eBay member account and create the application keysets. Developer-program enrollment is free. No paid data service, subscription, scraping tool, or affiliate checkout is used by ResellAI. Standard API quotas apply; eBay publishes a default Browse allowance of 5,000 calls/day, but actual app allowances and production terms must be checked with eBay. The local adapter is deliberately limited to 100 searches/hour per server process, two simultaneous searches, and a five-minute bounded cache. This is not a replacement for eBay's own limits or production abuse controls. eBay selling fees and existing OpenAI image-identification usage are separate from marketplace API access.

Sandbox keysets produce test listings, not real marketplace evidence. Production Buy API access is subject to eBay's review/approval, contracts and use-case requirements. Explain that ResellAI is a resale research application displaying active listings and calculating asking-price summaries, and get explicit confirmation that the proposed use is permitted. Do not assume a working OAuth token alone authorizes every API or commercial use. Review current content-display, caching and API-license requirements with eBay before public release. No account signup, terms acceptance, subscription or purchase was performed by this implementation.

Marketplace Insights is the sold-history API, but current eBay Partner Network documentation states that access cannot be granted on request. ResellAI does not call it or claim access. Legacy completed-item endpoints, seller-account order history, scraping, asking-price reductions, and AI-generated prices are not substitutes for marketplace-wide sold comparables. If you already hold a special agreement granting sold-data access, provide the permission details and approved documentation before adding that adapter.

## Exact credentials required

Edit the EXISTING file:

`C:\Users\Myles Foster\OneDrive\Documents\ChatGPT\syllabus optimizer\resellai\.env.local`

Keep the working OpenAI settings intact. Add:

```dotenv
EBAY_CLIENT_ID=your_ebay_app_id
EBAY_CLIENT_SECRET=your_ebay_cert_id
EBAY_ENVIRONMENT=sandbox
EBAY_PRODUCTION_APPROVED=false
```

- **App ID / Client ID:** from the eBay developer application keyset.
- **Cert ID / Client Secret:** from that SAME keyset/environment; keep private.
- **Dev ID:** not used by this REST Browse integration.
- **RuName / redirect URI / seller refresh token:** not needed for application-token Browse search.

For real data, obtain production Browse permission for this use case, then use the PRODUCTION App ID and Cert ID together and set:

```dotenv
EBAY_ENVIRONMENT=production
EBAY_PRODUCTION_APPROVED=true
```

The boolean is an acknowledgment of your actual permission, not a mechanism for granting eBay access. Do not enable it merely to bypass the local guard. The adapter also handles eBay 401/403 denials. Restart the development server after editing environment variables. Never add `NEXT_PUBLIC_` to these names and do not paste credentials into chat. The tracked `.env.example` documents the settings; `.env.local` remains ignored.

No production retrieval can be verified until those credentials and permissions are available. The current missing-credential state is intentional: it returns no comparables and no prices, not demo data.

## Try the workflow

1. Run `npm run dev` in `resellai/`; open http://localhost:3001/analyze.
2. Use your actual Jordan photo or another product. Review and correct the Phase 2 identification.
3. Optionally add size and sizing system, marketplace condition, packaging, variant words, and an exact identifier you can verify. Any short identifier transcribed by AI is prefilled for review; it is not independently verified.
4. Confirm identification. `/analysis` uses your actual product photo and searches eBay automatically. Changing matching details requires **Find eBay comparables** and immediately invalidates prior displayed results.
5. With no eBay settings, read the actionable configuration message. With sandbox credentials, review test results carrying prominent sandbox labels; no market recommendation is issued. With authorized production access, inspect actual titles, item asking prices, separately quoted shipping, seller conditions, source links, counts, retrieval/expiry timestamps, and evidence warnings.
6. Follow the source links and manually check that size, variant, condition and product are appropriate before relying on any figure. Title matching is deliberately conservative but imperfect.
7. The separate demo is http://localhost:3001/analysis?demo=1. It never substitutes the current uploaded photo or identity into a fictional example. `/analysis` without a confirmed item prompts you to confirm an item; it does not load a demo.

## Matching and valuation rules

- One request retrieves the first 100 best-match, fixed-price listings in EBAY_US deliverable to the US. No pagination or fallback broadening is performed. Auctions, foreign currencies, unsupported variation groups, ended, duplicate and invalid rows are excluded. Prices are USD item asking prices, excluding shipping and tax.
- Require the confirmed brand/model words. Known footwear silhouette conflicts, accessory-only listings, obvious bundles, replica/custom claims and mismatched explicit colors are rejected. User-specified SKU, variant, size/system, condition and packaging must be evidenced. US shoe matching requires explicit US text and the requested men's/women's/youth group. This may exclude many relevant listings whose titles omit details. Apparel uses optional size words. Non-shoe products use the same brand/model/color and optional variant rules.
- Color and packaging checks are title-based. Conditions use eBay condition IDs grouped into new/used/refurbished/parts. No image-based authenticity, condition-grade equivalence, exact SKU confirmation or price-outlier removal is claimed. The sample may still contain imperfect matches; listings show match reasons.
- Statistics use deterministic integer-cent calculations: count, median, arithmetic mean, lowest and highest asking price, deduplicated by listing ID. No AI is used to generate numbers.
- A suggested starting listing price equals the median only when production evidence has at least **five** matched listings from at least **three** distinct identified sellers, a selected condition, non-low identification confidence, confirmed brand/model, and maximum/minimum price ratio at most **2**. Shoes additionally require size/system. These are transparent heuristic thresholds, not a calibrated confidence model or a prediction of sale.
- Below the threshold, available descriptive statistics are still displayed with low quality; there is no suggested listing price. Quality is capped at moderate even when the threshold passes. No completed sales means **expected selling price is always unavailable**. No cross-marketplace ranking, best time to sell, demand score, forecast or historical series is generated.
- Positive numeric item prices only; shipping is separate and may depend on destination. A cached snapshot retains its original retrieval timestamp. It expires after five minutes; recommendations/proceeds are disabled on expiry. Expired observations may remain visible with an explicit expired warning until refreshed. Errors never return a stale snapshot or fictional prices.

## Seller proceeds

The live report offers an explicit scenario for a **US non-Store seller in adult Men's/Women's Athletic Shoes**, based on eBay's published basic fee page checked October 18, 2026. The user must select this profile and supply all costs, including explicit zeroes. Do not choose it for children's shoes, other categories, Store accounts or special fee arrangements.

Under $150 total sale: 13.6% plus $0.30 for orders up to $10 or $0.40 above $10. At $150 or more: 8% and no per-order fee. The total fee base includes item price, fee-applicable buyer shipping and tax. Sales tax is not seller revenue. Any eBay-collected Authenticity Guarantee shipping exempt from final-value fees must be excluded from the buyer-shipping input. Proceed calculation: item price + buyer shipping - estimated final-value fee - seller shipping - entered additional costs. Purchase cost is not deducted, so proceeds are not profit.

The scenario is conditional on a sale at the suggested asking price. It is not a selling-price forecast, an authenticated fee quote or a complete account-specific fee engine. Store discounts, international charges, seller-performance adjustments, insertion/advertising fees, refunds and promotions are not automatically modeled. Other categories show proceeds unavailable until an applicable fee profile is implemented; the existing manual profit calculator remains in the separate demo. Verify eBay's current fee schedule before listing.

## Architecture and operational limits

- `lib/marketplaces.ts`: provider interface, normalized evidence types and matching-details validation.
- `lib/marketplace-providers/ebay.ts`: official OAuth/Browse calls, token reuse until near expiry, five-minute/100-entry cache, concurrent request coalescing, rate limits, safe source-URL checks and response normalization.
- `lib/product-matching.ts`: transparent deterministic title/condition matching and query builder.
- `lib/valuation.ts`: pure statistics, quality thresholds and recommendation rules.
- `lib/ebay-fees.ts`: explicit documented sneaker fee scenario.
- `lib/marketplace-server.ts`, `app/api/marketplaces/ebay/route.ts`: bounded same-origin JSON endpoint and server-only credential lookup.
- `components/live-report.tsx`: confirmed-photo report, matching controls, actual source listings and unavailable/error states.
- `components/demo-report.tsx`: isolated fictional Phase 1 report.

eBay's Retry-After is honored with a shared cooldown. Token 401 clears the token for the next explicit retry; 403 asks for approval checks. Permission/network/schema failures never expose raw provider response bodies or credentials. Cache, token and limits are memory-local and reset on process restart. A public multi-instance deployment needs centralized quotas, user authentication/abuse controls and eBay-approved storage/display terms; this implementation does not deploy publicly or add a database. Mercari has no adapter. A Facebook adapter was subsequently prepared but remains disabled pending permitted-use verification; see SOCIAL-FETCH.md.

## Verification

`npm test`, `npm run typecheck`, and `npm run build` pass. Tests include Phase 2 regression coverage and matching exclusions, size/identifier boundaries, statistics/deduplication, evidence thresholds, US fee tiers/tax treatment, upstream response validation, OAuth/token/cache behavior, cooldowns, missing credentials, permission denial, sandbox isolation, request validation, and live/demo separation. All eBay success responses in automated tests are fixtures, not verified live listings.

HTTP smoke tests verified the running marketplace endpoint returns an explicit missing-credentials state with zero comparables and null statistics/recommendations, and all five page routes return 200. The remaining integration acceptance test is authorized real eBay retrieval with your production keyset and manual comparable review.

## Official references

- [Browse API overview](https://developer.ebay.com/api-docs/buy/api-browse.html)
- [Browse search](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)
- [Buy field filters](https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html)
- [OAuth application tokens](https://developer.ebay.com/develop/guides/sell/authorization)
- [Buy production requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html)
- [Restricted API request limitations](https://partnernetwork.ebay.com/page/developer-questionnaire)
- [Developer program](https://developer.ebay.com/)
- [Published call limits](https://www.developer.ebay.com/develop/api/buy/api_call_limits)
- [US non-Store selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)

Final verification: all 43 tests passed, TypeScript passed, and the production build passed. Browser checks verified that `/analysis` prompts for confirmation without displaying demo prices and that the explicitly linked `?demo=1` report still works separately. Live retrieval and the populated real-listing report remain unverified until authorized eBay credentials are supplied.

