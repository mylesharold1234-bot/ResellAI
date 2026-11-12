# Pricing Intelligence V1

The app already had separate eBay and Mercari snapshots, fixed-price active listing validation, ID deduplication, condition cohorts, a three-listing/two-seller minimum for estimates, median and scaled MAD filtering, provider throttles, and manual refresh. This update preserves the photo and search flow, separate price cards, existing eBay fee profile, and local daily storage.

## Audit findings and changes

- Conflicting duplicates were resolved by first appearance at the provider or by sorted price when passed directly to the engine. Provider adapters now flag duplicate IDs with inconsistent prices or conditions, and the engine excludes conflicting IDs. Exact duplicates still count once.
- A broad cohort could pass minimum safeguards while weak matches dominated the median. An independently qualified stronger-evidence cohort is now preferred when it has at least five listings from three identified sellers and passes the existing spread check. The selected cohort controls the price, range and count.
- A high count alone could give an inflated confidence label. Evidence quality now explains exact vs close matching, eligible listing and seller counts, spread, unresolved attributes, and incomplete searches. Labels describe evidence, not statistical probabilities.
- A cross-market preference requires two current supported recommendations, the same condition evidence, and a distinct quality advantage of Medium or High. The recommendation is a preference for stronger pricing evidence, not better returns or sale speed.
- The profit calculator works with either marketplace. It uses the displayed asking price as a hypothetical sale, deducts seller shipping, configured total fees and other expenses, and then deducts purchase cost. Missing amounts prevent an estimate; type zero explicitly when applicable. Buyer shipping is included only when received by the seller; collected tax is not revenue. The existing applicable eBay sneaker profile remains separate.
- Existing bounded timeouts, rate limits, in-flight coalescing and no automatic provider retries were retained. Partial eBay search failures are now labeled in the evidence and lower its quality. The snapshot version was bumped once so calculations using the previous rules are not mistaken for V1.

## Synthetic before-and-after benchmark

Same four inputs; legacy baseline simulates first-row provider deduplication and retaining the broad cohort when it qualifies. Numbers are asking prices, not actual sale values.

| Case | Before: price / listings | After: price / listings |
|---|---:|---:|
| One extreme ask | $100 / 5 | $100 / 5 |
| Conflicting duplicate | $100 / 3 | Insufficient / 2 |
| Mixed relevance, independently strong subgroup | $95 / 9 | $105 / 5 |
| No comparables | Insufficient / 0 | Insufficient / 0 |

Recommendation availability was 3/4 before and 2/4 after. This deliberately removes one unsupported recommendation. The cases do not establish real-world price error; no independent verified sales data was available. Provider credit usage per new query and vision call counts are unchanged. Reanalysis under the new rules may populate a new snapshot once for a previously cached item. No paid APIs or marketplace image comparison were added.

Next milestone: create an independently labeled evaluation set with verified product identifiers, condition and size, then add authorized completed-sale references where available. Use it to calibrate evidence thresholds and measure price error and recommendation coverage before adding another marketplace.
