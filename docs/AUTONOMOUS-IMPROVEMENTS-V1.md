# Autonomous reliability improvements — three-cycle report

## Scope and outcome

Three targeted cycles completed using local code inspection, synthetic regression inputs, and retained snapshots. No live marketplace requests, vision calls, additional APIs or paid services were used. Pricing count, seller-diversity, spread and outlier thresholds were not relaxed.

Final checks: **138 tests passed**, TypeScript passed with the project's explicit Node/React type scope, and the Edge browser regression passed using mocked provider responses. The final saved-evidence replay is unchanged for the original Jordan case: two eligible High OG listings on eBay, zero on Mercari, no supported recommendation. Original rejected raw responses and independent product/listing labels remain unavailable, so no live precision or recall improvement is claimed.

## Cycle 1: preserve supported search constraints under length limits

**Root cause:** query strings were truncated after construction. A long description could occupy the first 100 characters and remove the supported model/silhouette, edition and visible colors. A generic “high-top” product name could also conflict with an explicit Mid model.

**Change:** query construction now reserves complete supported attributes before adding expendable description words. It never cuts a required attribute in half. If the supported core cannot fit, that query is omitted, and an empty eBay plan returns an actionable message without a provider call. Generic high-top wording does not override an explicit Mid or Low model. Query and daily algorithm versions were updated once for the release.

**Before/after:** in the long-title synthetic reproduction, the prior stage-A truncation lost Mid, OG, black and white. The revised plan retains all four within the 100-character limit and has no conflicting High token. Existing alias, cost-budget and matching tests remain passing. No actual new query was run, so retrieval gains are unmeasured.

**Files:** lib/ebay-search.ts; lib/marketplace-providers/ebay.ts; lib/daily-snapshots.ts; lib/search-retrieval.test.ts.

## Cycle 2: do not freeze a partial retrieval as the day's result

**Root cause:** the daily store considered every non-unavailable production result durable. If one stage succeeded and a fallback failed, a partial/possibly insufficient sample could become the cached answer for the rest of the day. A partial refresh could overwrite a more complete snapshot.

**Change:** adapters identify complete and partial searches. The store also recognizes existing partial-stage diagnostics. Initial partial evidence retains its original short expiry, is not written as a daily snapshot, and has an incomplete-search notice. A partial refresh returns an unavailable result for that attempt and leaves the prior complete daily file intact. The existing UI shows previous results and the retry explanation. No automatic retry was added.

**Before/after:** a synthetic partial response is no longer persisted (one potential durable entry becomes zero). A later explicit attempt can save a complete version 1. A subsequent partial refresh does not replace it. Tests verify source expiry, persisted metadata, provider call counts and equality of the saved complete result.

Reopening a failed/partial search later may make another bounded provider request after the existing short cache expires; this is not an automatic retry. Existing default query budgets and provider spending safeguards remain.

**Files:** lib/marketplaces.ts; lib/marketplace-providers/ebay.ts; lib/marketplace-providers/mercari.ts; lib/daily-snapshots.ts; components/pricing-panel.tsx; components/live-report.tsx; components/mercari-pricing.tsx; lib/daily-snapshots.test.ts.

## Cycle 3: distinguish included accessories from the primary footwear

**Root cause:** both the non-wearable filter and strict title matcher rejected any keychain token, including complete shoes explicitly sold with a keychain. This contradicted the existing treatment of included accessories for other product categories.

**Change:** a small shared helper suppresses only included keychain/keyring/ornament words following an explicit “with/includes/including/comes with” clause when the primary clause clearly names wearable shoes, sneakers, boots or trainers. It does not suppress miniature, doll, scale, replica or incomplete-product evidence. Accessory-only titles and accessory categories remain excluded. No accessory premium or inferred price adjustment is applied.

**Before/after:** the complete-shoes-with-keychain regression changes from rejected to eligible in both matchers. Three such controlled listings at $90/$95/$100 produce a $95 statistical recommendation. Keychain-only, miniature and doll controls stay rejected. This improves fixture recommendation availability; it is not a measured live-market availability gain.

**Files:** lib/listing-primary-text.ts; lib/footwear-compatibility.ts; lib/product-matching.ts; lib/footwear-compatibility.test.ts; scripts/validate-real-world.ts (source fingerprint dependency).

## Remaining limitations and next milestone

The saved Jordan evidence still lacks three compatible High OG listings and contains no usable Mercari cohort. Replaying retained rows cannot recover original rejected rows or measure whether the revised query finds new relevant inventory. The exact original identification output is also missing from those older snapshots; the replay uses the previously documented reconstruction.

Stop further accuracy tuning against that one incomplete sample. The highest-priority next milestone is the existing ten-product independently verified pilot: provide actual photos, independent identity and comparable criteria, authorized pre-filter captures, and human relevance judgments. No evidence-based live accuracy ranking can be produced until those inputs exist.
