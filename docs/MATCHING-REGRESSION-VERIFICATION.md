# Marketplace matching regression verification

## Outcome

129 tests passed, TypeScript passed with the project's explicit Node/React type scope, and the mocked Edge browser regression passed. No live marketplace requests or vision calls were made. Minimum listing counts, seller diversity, MAD filtering and the 2× spread safeguard were preserved.

The matching patch is regression-ready for the existing local application. This is not a claim of measured production-wide precision or improved recommendation coverage: a full independently labeled real-world dataset is still unavailable, and the saved evidence is post-filtered.

## Retained-listing replay

Source: the two November 11, 2026 version-2 Air Jordan 1 snapshots. Replay runs at the original observation time. Model, color, condition and sizing fields come from the saved normalized identity. Because the exact original identification object was not stored, the saved search query is used as the product name and contains the explicit high-top description; medium identification confidence is assumed. The replay strips old generated match warnings, preserves upstream variation and conflicting-duplicate warnings, and reapplies current matching.

| Marketplace | Original API rows | Retained rows available to replay | Before selected / price | After candidates / selected / price | Selected group |
|---|---:|---:|---|---|---|
| eBay | 300 | 261 | 4 / unavailable (4.40× dispersion) | 4 / 2 / unavailable (count) | High OG |
| Mercari | 100 | 82 | 1 / unavailable (count) | 0 / 0 / unavailable (count) | None |

eBay's two selected asks are both $87.99. The $45.50 edition-unspecified high-top and $200 OG SP listing remain outside the OG pricing group. There are still fewer than three selected listings; no recommendation was forced.

Mercari's $11 “1/6 Scale Jordan 1 Sneakers for 12 inch Figure” is rejected as non-wearable. Other rows still fail supported color, condition, silhouette or size-group checks.

### Reasons within the replay input

eBay: 92 incompatible silhouettes; 125 color failures; 13 unverified variation prices; 12 condition failures; 15 unconfirmed youth groups. Four pricing candidates remain, then two are excluded from the selected edition group.

Mercari: one non-wearable miniature; ten incompatible silhouettes; 38 color failures; 23 unconfirmed youth groups; two unconfirmed distinct editions; five condition failures; three conflicting named colorways.

Reasons describe a row's primary matching outcome; they are not inferred labels of all original inventory. Detailed decisions are saved privately in evaluation/private/matching-replay/retained-jordan-replay.json.

## Unintended-consequence checks

- Genuine youth footwear remains eligible when the target's youth group is supported; small numeric sizes alone are not treated as miniature evidence.
- Explicit Retro High OG targets accept both “Retro High OG” and “High OG” title forms.
- OG SP remains separate from OG.
- Standard High listings can produce a valid estimate as their own group.
- A target with an unknown edition or silhouette can use a sufficiently large homogeneous listing group; mixed silhouettes do not count as one group.
- A valid three-listing/two-seller fixture produces a recommendation. The original two-listing High OG group does not.
- Fallback queries retain black/white and the supported silhouette, without adding OG/SP or guessing a missing silhouette.

Verification exposed and fixed an overrestrictive Retro alias check. Canonicalization now accepts an optional “Retro” before the silhouette while preserving edition comparisons. A broad “dolls” title token was also narrowed to avoid treating the legitimate Dolls Kill brand as doll footwear.

## Search scope and repeatability

The planned fallback now includes “nike air jordan 1 high black white”; the saved old fallback was “nike air jordan 1”. No new query was executed. The request plan remains bounded; actual latency and upstream retrieval changes were not measured. Recommendation precision cannot be quantified without independent labels.

The algorithm and short-cache versions were incremented so old mixed-edition calculations are not reused as current-rule results. The daily storage architecture is unchanged.

## Highest-priority next improvement

Verify the supported silhouette/edition and test the revised targeted retrieval using authorized pre-filter captures. The replay has only two compatible High OG observations and cannot show whether the revised search can retrieve a third. Expand the evidence before changing any pricing safeguard.

## Reproduce

From resellai:

    node --import tsx scripts/replay-retained-jordan.ts
    npm test
    npm run typecheck -- --types node,react,react-dom

Browser checks use scripts/test-loading-ui.cjs with a temporary playwright-core installation and mocked provider responses, as in the existing regression workflow.
