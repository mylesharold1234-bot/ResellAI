# Mercari "Price unavailable" for Nike Dunk Low (2026-11-14)

**Symptom:** "Price unavailable. The comparable prices vary too widely. Confirm the exact variant and condition to narrow the results. Insufficient evidence."

Investigated offline from saved daily snapshots (`.marketplace-snapshots/2026-11-12` and `2026-11-14`). No paid API calls were made.

## What happened
| Step | Result |
|---|---|
| Query | `nike dunk low black white`, 1 Mercari request, 100 results |
| Seller details | No size, no condition, no variant entered (all blank) |
| Matching | 0 exact, 62 close, 35 related (context only) |
| Condition | Photo read as "New or very lightly worn", so only New / Like New kept (44 used listings excluded) |
| Groups | New "Retro" (7), New unspecified (6, including an **SB Dunk**), Like New (5 + 1) |
| Chosen group | New "Retro": $36.12–$122 (sizes from men's 4 to 15), spread 3.38 > 2.0, so **blocked** |
| Next group | New unspecified: $65–$139.99, spread 2.15 > 2.0, **blocked** only because of the SB Dunk |

The Nov 12 run of the same item returned $79.31 from a luckier mix of listings.

## Root cause
1. **Incorrect product matching (bug):** a *Nike Dunk Low Pro SB "Black White Gum"* (HF3704-003), a different product line, was matched as close. It alone pushed an otherwise valid group over the 2× limit. A multi-size listing ("Men's Sizes 4/4.5/5/5.5") was also priced as one pair.
2. **Genuine dispersion:** without a size or condition, Mercari Dunk Low listings genuinely span $36–$122. The 2× safeguard was correct to refuse a price for that group.
3. **Too few size-specific listings:** with "US Men's 10" entered, 0 of the 100 results qualify. Most Mercari titles don't state a size, and the query doesn't include one.
4. **UX:** size and condition were hidden behind "Add item details (optional)", and the main button ("continue with general search") erased them.

Not the cause: duplicate filtering, outlier filtering (no outliers at n=7), snapshot freshness and caching (fresh until midnight), or the dispersion threshold.

## Changes
- `lib/mercari-matching.ts`: SB Dunks are treated as a separate edition unless an SB was requested; listings offering several sizes can't price a pair. With these two fixes, the Nov 14 snapshot prices at **$79.31** from 5 listings ($65–$100, spread 1.54), the same as Nov 12. The safeguard is unchanged.
- `lib/pricing-explanation.ts`: plain-language reasons for sellers (for example "Prices vary too much to recommend one. Similar Mercari listings range from $36 to $122, because they mix different sizes and conditions. Add the size and condition for a tighter estimate."). Engine diagnostics appear only in the developer view (`?debug=1`).
- Analyze screen: size, condition and box are shown up front, and confirming always keeps them.
- Regression tests: `lib/mercari-investigation.test.ts` with an anonymized fixture (`lib/test-support/mercari-dunk-low-2026-11-14.json`: titles, prices and conditions only).

## Not done (needs a paid request to verify)
Including the size in the Mercari query when a size is confirmed might retrieve more size-specific listings. That's unverified without one or two paid API.SH calls, so retrieval was left unchanged.

Today's cached snapshot still holds the old matching. Running the analysis tomorrow, or refreshing, applies the fix.
