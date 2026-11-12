# Dunk Low refinement regression investigation

## Saved inputs

Four November 11 snapshots were inspected: general eBay (100 retrieved, 99 retained) and Mercari (100/97), followed by detailed eBay (300/184) and Mercari (100/76).

| Attribute | General | Detailed |
|---|---|---|
| Brand | Nike | Nike |
| Model | Dunk Low | Nike Dunk Low |
| Product-name proxy | nike dunk low black white | nike dunk low sneaker black white |
| Color | black and white | Black and White |
| Size / system | Not restricted | 10 / US Men |
| Condition | Normalized visible-condition cue: new; warnings explicitly say condition not selected | Explicit new condition |
| Variant | Empty | Empty |
| Verified identifier | None | None |
| Other details | Full submitted object not saved | Active subtype check evidenced by warnings; exact subtype text not saved |

Product names above are saved queries, not the complete original identification outputs. Packaging, additional identifying details and exact subtype cannot be recovered from these old files. The replay records this limitation and runs detailed cases both with no subtype and with the explicit controlled assumption “Low-top sneaker.” It does not claim the latter was the exact historical text.

## Findings

1. Repeated Nike terms are not the cause. The model matcher removes brand tokens before comparing model words. The new regression confirms Dunk Low and Nike Dunk Low have equivalent matching behavior.
2. The searches are not equivalent after adding size 10 / US Men. None of the retained titles explicitly establishes all of size 10, US system and men's group. A listing can be a credible Dunk Low while still failing the requested sizing requirement.
3. The detailed runs have no verified SKU and no variant restriction. They are not losing matches because of a hidden verified identifier.
4. Like New/Good and wrong-size listings are correctly excluded from an explicitly new US Men's 10 comparison. Missing system information is not converted into US sizing based only on the source site's country.
5. A verified implementation defect exists in subtype matching: the AI-prefilled subtype is treated as exact title tokens. “Low-top sneaker” should be supported by a matching Dunk Low/Low Top shoe title without requiring the exact words “top” and singular “sneaker.” The semantic subtype check now handles footwear type synonyms while still rejecting High vs Low contradictions and unverified specific configurations.
6. A failed size check previously erased earlier match evidence, causing “Full visible colorway not evidenced” warnings on black/white titles. Confirmed earlier checks are now preserved for diagnostics without changing the failed outcome.
7. Missing size, system, group and condition now have distinct unverified reasons; wrong sizes, incompatible groups and incompatible condition use mismatch reasons. Neither becomes eligible without affirmative evidence.

## Representative rows

- eBay: “Nike Dunk Low Retro - White/Black-White - Size 10” has the requested numeric size but no men's group or US sizing system. It remains unverified.
- eBay: a US 10.5 men's pair contradicts requested size 10.
- Mercari: “NEW Nike Dunk Low Retro 'Black/White Panda' DD1391-100 (Men’s Size 10)” has matching gender and numeric size but no explicit US system in the available title. It remains unverified; no structured size/aspect response was saved.
- Mercari: new Panda listings with no title size remain unverified; pre-owned listings fail condition before size.
- Controlled regression: “Nike Dunk Low Retro Panda Black White Mens US Size 10” is eligible with the descriptive Low-top sneaker subtype. Three distinct sellers at $65/$70/$75 support a $70 median recommendation. This is synthetic input, not a newly retrieved marketplace cohort.

## Before and after replay

| Input | Rows replayed | Before eligible / price | After eligible / price |
|---|---:|---|---|
| General eBay | 99 | 12 / $66.99 | 12 / $66.99 |
| General Mercari | 97 | 5 / $79.31 | 5 / $79.31 |
| Detailed eBay | 184 | 0 / unavailable | 0 / unavailable |
| Detailed Mercari | 76 | 0 / unavailable | 0 / unavailable |

Detailed eBay primary rejection reasons: 56 unverified variation prices, 44 condition mismatches, 27 numeric size mismatches, 22 unconfirmed youth groups, 17 missing sizes, 13 color conflicts, 3 missing sizing groups, 1 unresolved multiple-size selection, and 1 missing sizing system. Detailed Mercari: 36 condition mismatches, 25 youth-group conflicts/unverified groups, 6 missing sizes, 5 color conflicts, 2 numeric size mismatches, 1 unresolved multiple-size selection and 1 missing sizing system.

These are primary rule outcomes among previously retained rows, not labels of the original complete search pool. A row can fail more than one requirement. Detailed per-row decisions are saved privately in evaluation/private/refinement-replay/dunk-refinement.json.

## Changes and limits

- Matching changes are in lib/footwear-compatibility.ts, lib/ebay-search.ts and lib/product-matching.ts.
- Future private snapshots retain the effective identification and matching details so these fields do not have to be reconstructed. Unused free-text additionalDetails is omitted. Existing snapshot files remain untouched; the matching algorithm version is incremented for new results.
- lib/product-refinement.test.ts covers general/refined identity, brand aliases, semantic subtype, explicit and missing sizes, condition, identifiers and variants.
- scripts/replay-dunk-refinement.ts performs offline retained-row replay.

The subtype and diagnostic defects are fixed, but the detailed saved searches still do not support a recommendation. Obtaining authorized pre-filter listing aspects/size evidence would be needed to establish whether missing title information can be safely verified; it cannot be assumed. No live requests, new APIs, additional credits or weaker pricing safeguards were used.

## Verification

143 tests passed; TypeScript checks passed (explicit node/react/react-dom types); browser regression passed for photo/identification loading, marketplace retrieval/refresh/retry, AI review/retry, duplicate guards and reduced motion. Zero marketplace API requests were made.
