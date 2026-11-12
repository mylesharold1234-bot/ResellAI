# Marketplace Search Optimization V1

## Audit

The pre-change eBay strategy used up to three first-page queries (four with a verified identifier), each limited to 100 results and eBay's default best-match order. It did not paginate. It stopped after five exact-tier rows, even when those rows could not support one pricing cohort. Close matches that did support a price did not trigger that stop.

Mercari submitted only stage A, a verbose name query, with 100 relevance-ordered active US listings. Search terms such as “high top sneaker” can be unnecessary alongside an already supported model/silhouette. Exact retrieval impact is not measurable from the available post-filter snapshots.

The November 11 retained Jordan evidence showed both overlapping eBay queries and matching/cohort bottlenecks. Original API counts are not equivalent to pricing candidates. Previously rejected pre-filter rows and independent reviewer judgments are unavailable.

## Changes

- All bounded stages preserve supported color, silhouette and explicit edition constraints. An abbreviated alias can use AJ1, PS5 or WH1000XM5 where the existing matcher already recognizes those forms. No unknown SKU, edition or silhouette is inserted.
- Mercari starts with the compact supported model/silhouette/color query instead of the verbose product name. Default usage remains one query/page.
- eBay stops when the existing price engine supports at least five cohort listings from three identified sellers. Pricing counts, spread checks and seller safeguards have not changed. This avoids extra fallback requests for supported close cohorts and avoids treating an unusable exact-tier count as success.
- MERCARI_MAX_SEARCH_QUERIES=2 optionally permits one alias fallback only if the first page lacks that evidence. The default is 1. The opt-in can spend up to two API.SH credits per uncached search, under the unchanged five/hour and twenty/day safeguards. A slow first request suppresses fallback; failed fallback preserves first-query data with a partial-search warning. There is no automatic retry or pagination.
- Overlapping rows are deduplicated by ID; conflicting prices or conditions retain the existing conflict exclusion.
- Expandable diagnostics expose per-query returned rows, new normalized IDs, duplicates, new matching candidates, timing, errors, aggregate candidate/cohort counts and a bottleneck classification. These diagnostics do not expose tokens, seller IDs or raw payloads. Timing and request counts describe the saved search, not a cost incurred when reopening the snapshot.
- Daily snapshot identities include the retrieval algorithm version and Mercari query-budget setting, preventing reuse across incompatible retrieval settings. Same-day stability and storage behavior remain unchanged.
- Offline capture validation accepts the opt-in two-page Mercari result set. The pilot collector stays at its default single-query budget. Evaluation source fingerprints include the shared footwear and retrieval helpers.

## Verified controlled cases (synthetic provider responses)

- A usable five-listing close cohort completes in one eBay request. The prior exact-tier stopping condition would not have recognized that cohort; bounded fallbacks are no longer necessary in this case.
- An eBay alias stage supplies four additional unique compatible rows plus an incompatible Low row. Five compatible listings support a $93 fixture recommendation; the wrong model is rejected. The three-query run has one duplicate among seven normalized row appearances (14.3%); this is fixture behavior, not an observed marketplace duplicate rate.
- Default Mercari: two compatible fixture listings, one request/credit, insufficient. With the opt-in alias stage: five compatible unique listings, two requests/credits, $93 fixture recommendation. Two overlapping rows are counted once; subsequent use is cached with no additional request.
- If five first-page Mercari listings already qualify, enabling the fallback still makes only one request.
- A failed second query retains actual first-page fixture evidence and is diagnosed as a retrieval error rather than a zero-result search.

No real-world precision or recall is inferred from these fixtures. The existing matching, footwear editions, non-wearable rejection, pricing thresholds and profit scenarios are exercised by the full regression suite.

## Saved Jordan replay

The same saved retained-listing inputs remain 261 eBay rows and 82 Mercari rows. Applying the unchanged matcher/pricer still yields two High OG listings for eBay and zero Mercari pricing candidates. Both remain insufficient. A new query plan cannot retrieve new items during an offline replay.

Previous eBay plan: verbose high-top/color query; compact high/color query; conventional Nike Jordan alias with high-top wording. Revised: the same supported first two stages and a compact AJ1 high black white alias.

Previous Mercari query: nike air jordan 1 high top sneaker black white.
Revised default query: nike air jordan 1 high black white.
Opt-in fallback: aj1 high black white.

No new live searches or provider credits were used for this change. Search latency, relevant-listing recall, real recommendation coverage and precision before vs after remain unmeasured because no complete authorized pre-filter captures with independent labels are available. Existing retained rows cannot establish search-level gains.

## Next validation

Use the existing permitted pilot capture workflow and independent reviewer labels to compare both plans under the same verified product evidence and comparable criteria. Keep default Mercari usage at one query unless the extra-credit budget is explicitly desired. Do not change pricing safeguards to make the retained two/zero cases appear resolved.
