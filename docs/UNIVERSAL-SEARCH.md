# Universal product search and optional refinement

## Root cause and scope

The marketplace HTTP handler rejected identifications unless brand, model, product name and category were all present. A generic saxophone with null brand/model therefore could fail with HTTP 400 before the eBay provider executed. This code path was reproduced with identification fixtures. The original failing upload/request was not retained, so no claim is made to have inspected that particular photo or response. There was no unsupported-category eBay mapping: the rejection occurred in application validation. Frontend confirmation also unnecessarily required category; matching lacked a safe broad-object classification when specific identity words were absent.

## Implemented behavior

A recognizable item description, model or category fallback now permits a search. Unknown brand/model placeholder values normalize to null rather than search requirements. A missing brand is not identification failure. The OpenAI image-upload API, actual uploaded photo, secure credentials, model settings and vision instructions remain intact.

product-profile.ts evaluates identification specificity using optional category-aware attributes for footwear, instruments, electronics, furniture, dinnerware, collectibles and a generic fallback. Missing maker/model/subtype or identity-critical uncertainty yields a non-blocking amber warning. Known brand/model combinations such as Yamaha YAS-280 Alto Saxophone do not receive a blanket warning. Condition and matching options remain optional and separate from identification completeness.

The review screen offers expandable Add item details, Continue with these details, and No, continue with general search. The first confirms corrected fields and optional subtype/material/dimensions/condition/configuration; the skip path clears optional matching details and confirms the recognizable identification. Both navigate to the existing report, whose existing effect starts the marketplace request. User corrections are stored separately from the original AI identification and labeled user-provided, not independently verified. Explicit identifier verification remains a user assertion; the app never calls inferred identity/authenticity independently verified.

Search stages use the recognizable name, known brand plus object type, broader object description or a naming alias, and optionally a user-verified identifier. Queries are nonempty, deduplicated, limited to four stages of 100 results, stop early with five exact matches, and preserve the existing hourly per-stage budget, cooldown, cache, in-flight coalescing and server-only credentials. Stage D is never populated from unverified image text.

Broad generic objects produce related context, not a specific-item median/recommendation. Known models can supply close/exact evidence only with matching category-relevant attributes. Instrument accessories and conflicting alto/tenor subtypes, decorative versus dinner plates, adult/toddler footwear, miniature furniture, non-dinnerware plates and automotive/reptile lamp parts have explicit exclusions. Related listings show genuine individual asking prices, but are excluded from valuation statistics. Additional free-text notes are retained as user observations, not interpreted as verified identifiers.

The report distinguishes not attempted, loading, zero API results, retrieved-but-filtered, provider errors, available context and qualified pricing evidence. Broad context says Listings found rather than implying the marketplace is unavailable. Detailed queries, counts and cache reference live in an expandable diagnostics section.

## Real Production API route results

All 16 HTTP requests below returned 200 from the running /api/marketplaces/ebay route, with actual Production eBay listings. General and refined modes were produced by the same confirmation reducer used by the page. Refined-mode live tests selected Used condition; the automated suite additionally verifies brand corrections, material/dimensions fields and source preservation. Rows returned sum upstream stage responses before deduplication. Retained counts are shown as exact/close/related, and differ slightly across calls because listings change.

| Item | Path | Warning | Browse requests | Rows returned | Exact/close/related | Status |
|---|---|---|---:|---:|---|---|
| Air Jordan 1 Mid | general | Hidden | 3 | 300 | 0/148/0 | available |
| Air Jordan 1 Mid | refined | Hidden | 3 | 300 | 0/148/0 | available |
| Saxophone | general | Shown | 1 | 100 | 0/0/48 | available |
| Saxophone | refined | Shown | 1 | 100 | 0/0/48 | available |
| Yamaha YAS-280 Alto Saxophone | general | Hidden | 3 | 300 | 0/44/66 | available |
| Yamaha YAS-280 Alto Saxophone | refined | Hidden | 1 | 100 | 24/20/5 | available |
| Ceramic dinner plate | general | Shown | 2 | 200 | 0/0/100 | available |
| Ceramic dinner plate | refined | Shown | 2 | 200 | 0/0/101 | available |
| Vintage wooden chair | general | Shown | 2 | 200 | 0/0/169 | available |
| Vintage wooden chair | refined | Shown | 2 | 200 | 0/0/168 | available |
| Unbranded table lamp | general | Shown | 2 | 200 | 0/0/166 | available |
| Unbranded table lamp | refined | Shown | 2 | 200 | 0/0/166 | available |
| Sony WH-1000XM5 headphones | general | Hidden | 3 | 300 | 0/76/99 | available |
| Sony WH-1000XM5 headphones | refined | Hidden | 1 | 100 | 27/48/20 | available |
| PlayStation 5 | general | Hidden | 3 | 300 | 0/31/94 | available |
| PlayStation 5 | refined | Hidden | 3 | 300 | 0/31/94 | available |

Queries (general path; refined can stop earlier when sufficient exact matches are present):

- Air Jordan 1 Mid: A: air jordan 1 mid; B: jordan footwear; C: nike jordan 1 mid
- Saxophone: A: saxophone
- Yamaha YAS-280 Alto Saxophone: A: yamaha yas 280 alto saxophone; B: yamaha saxophone; C: saxophone
- Ceramic dinner plate: A: ceramic dinner plate; C: plate
- Vintage wooden chair: A: vintage wooden chair; C: chair
- Unbranded table lamp: A: table lamp; C: lamp
- Sony WH-1000XM5 headphones: A: sony wh 1000xm5 headphones; B: sony headphones; C: sony wh1000xm5 headphones
- PlayStation 5: A: sony playstation 5; B: sony console; C: sony ps5

## Testing and limits

87 automated tests and TypeScript checks passed. Tests cover all eight requested identification fixtures, warning visibility, both confirmation paths reaching the HTTP handler, original uploaded-photo URL preservation, source attribution, optional field clearing/preservation, identifier verification, category mismatch exclusion, existing API security and cache/rate behavior.

These are deterministic identification fixtures and genuine marketplace integration tests, not eight new live OpenAI image-recognition runs or automated clicks on uploaded photos. Representative photos for all eight items were not supplied; image-recognition accuracy for those photos remains unverified. The existing image byte forwarding/upload validation tests remain passing. A brand/model supplied by AI or the user is not proof of authenticity. Category rules and title parsing are conservative heuristics, not an exhaustive taxonomy. Broader categories can contain materially different items, so context listings never establish a specific item's resale value. No completed sales, expected sales, future predictions or fictional fallback were added.

The credential-free full live audit is in the OS temp file resellai-universal-route-audit.json. Run npx tsx scripts/test-universal-route.ts only when an explicit live verification is intended; it makes real, bounded API calls.

## Files changed

- lib/product-profile.ts: universal name normalization, category profiles, specificity/warning assessment.
- lib/marketplace-server.ts: remove mandatory brand/model/category gate.
- lib/identification-workflow.ts: original AI state, field sources, general/refined confirmation.
- lib/marketplaces.ts: validated optional subtype/material/dimensions/notes.
- lib/ebay-search.ts: universal query stages, broad matching and category exclusions, cache version.
- components/identification-warning.tsx: non-blocking amber review warning.
- app/analyze/page.tsx: expandable refinement, field sources, both continue paths.
- components/match-details-fields.tsx: category-aware optional fields.
- components/live-report.tsx: universal descriptions, semantic statuses, expandable diagnostics.
- lib/universal-search.test.ts plus existing identification/marketplace/search tests: regression coverage and updated universal validation expectations.
- scripts/test-universal-route.ts: eight-category, two-path real HTTP verification.

Final build verification: optimized production build passed. Preview pages /analyze, /analysis and /dashboard were checked separately after the build.
