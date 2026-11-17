# Sneaker pricing: style code, eBay depth and representativeness (2026-11-17)

Benchmark: Nike Dunk Low Panda, DD1391-100, US Men's 10, new with box.

## What the investigation found
- **The app searched too broadly.** Without the style code it searched "nike dunk low black white". That brought back 30+ different shoes; only 22–44% of results were the Panda.
- **It read a small slice.** eBay reported 3,580 results for that size 10 search and 522 for DD1391-100 + size 10 + new. The app read the first 100, in eBay's Best Match order.
- **Multi-size listings were left unopened.** 47–59 of each 100–200 results offer several sizes for one price, and they weren't expanded.
- **Title-only rules rejected real Pandas.** Some titles say "Panda" without color words; others omit the code even though eBay's own data confirms it.
- **The $70 depended on the sample.** Across 400 of the 522 listings, 88 verified asks run from $55 to $189 (middle half $78–$121, median $93). The first Best Match page leaned cheap.
- **A small subgroup could set the price.** When the main group was too spread out, the engine could fall back to a smaller group of the same shoe whose titles simply don't name the edition (e.g. no "Retro"). That gave $70 from 8 listings.

## What changed
1. **Style code field.** For sneakers it sits next to size and condition. A code typed in Nike/Jordan format (DD1391-100) counts as checked. A code read from the photo is suggested but must be ticked.
2. **Targeted eBay search.** With a confirmed code, the search uses the code, eBay's "US Shoe Size" in the men's or women's Athletic Shoes category, and new-only conditions. It reads 200 per page, and a second page only if the first is full. When those pages return enough listings, the title searches are skipped.
3. **Configurable budget.** `EBAY_STYLE_CODE_PAGES` (1–2), `EBAY_VARIATION_CHECKS` and `EBAY_DETAIL_CHECKS` (0–20 each, default 10) and `EBAY_HOURLY_REQUEST_LIMIT` (default 100). eBay's Browse API is free within the app's daily allowance. Results are still cached for 5 minutes in memory and per day in snapshots; the eBay snapshot key changed.
4. **Multi-size listings.** Each one's size variation has its own price and size, and a size that's out of stock is skipped. With a code, these checks always run; listings whose title states a different code are skipped.
5. **eBay item specifics.** A confirmed code can come from eBay's "Style Code" item specific, not just the title. With the code confirmed, a "Panda" title without color words is accepted. A title naming a different color, or a different code, is still rejected.
6. **Fallback fix (bug).** A group can no longer stand in for a larger matching group of the same condition whose prices vary too much, when the two may be the same release (one edition unnamed). This changes two results:
   - The DD1391-100 page-1 $70 becomes no price.
   - The Nov 14 Mercari $79.31 becomes no price: 5 non-"Retro" listings had stood in for 7 "Retro" ones asking $36–$122.
7. **Partial samples.** Every eBay result records eBay's total, how many were read and whether the last page was reached. A price from a search that stopped at a full page without reaching ¾ of the reported total is labeled **Estimate** and says how much was checked. Saved snapshots are judged from their pages.
8. **Spread instead of a forced price.** When verified asks are too spread out, the report shows the middle half, median, lowest and highest, labeled "Not a recommendation".

The minimum-listing and 2× dispersion safeguards are unchanged.

## Results on saved data (lib/representativeness.test.ts)
| Sample | Before | Now |
|---|---|---|
| Generic query, first 200 of ~3,580 | $70 shown as "Price found" | $70 labeled **Estimate**: "first 200 of about 3,580, Best Match order" |
| DD1391-100 page 1, code not known | $70 from 8 "unspecified" listings | no price: the main "Retro" group's asks vary too widely |
| DD1391-100 pages 1–2 (400 of 522), code confirmed | not available before | no price; spread shown: 88 listings from 86 sellers, $78–$121 middle half, median $93, $55–$189 |
| Nov 15 live first page (100) | $70 shown as "Price found" | $70 labeled **Estimate** |

Live calls during this work: 5 controlled eBay Browse calls in the investigation; none after. No Mercari credits were used.

## Market reference bands (stage 1 of market-aware pricing)
- **Listing dates.** Each comparable keeps its original listing date. For eBay that's `itemOriginDate`, which survives relists. The current-listing date (`itemCreationDate`) is only a lower bound, so it can mark a listing as older but never as recent. Mercari's date is `created_at`. Missing, future-dated or pre-1995 dates count as unknown, and unknown is never recent.
- **Bands.** From the same verified group the engine already uses (same size, condition, box, edition and outlier filter), listings are split into recent (first listed within 365 days), older and undated. A band shows the lower quarter, median and upper quarter, plus listing and seller counts. It needs at least 8 listings from 5 sellers; below that the app says so instead of showing quartiles.
- **Labeling.** Bands are labeled "Reference only · Asking prices, not sale prices". Older listings are shown separately as context, and undated listings are counted but left out of both. The official recommendation and its thresholds are unchanged, and bands never set a price.
- **Dunk Low Panda DD1391-100, US Men's 10, new with box (saved 2026-11-17 data, 400 of 522 listings):**
  - No official price (the spread is too wide).
  - Recent listings: lower quarter $70, median $80, upper quarter $90, from 38 listings and 37 sellers, with 4 extreme recent asks left out.
  - Older listings: middle half $89–$135, median $117, from 48 listings and 48 sellers.

## Shipping (investigated, not implemented)
- **Search results don't reliably include shipping.** Of 400 saved results, 225 had no shipping information and 36 said "calculated" without an amount. Only 139 (35%) gave a usable cost: 79 free and 58 flat fee, plus 2 calculated with a cost.
- **Per-listing lookups do include it.** The listing-detail and multi-size lookups return the full shipping cost and delivery estimates.
- **Calculated shipping depends on the buyer's location.** eBay documents a request header (`X-EBAY-C-ENDUSERCTX`) for estimating it.
- **Next step.** Test that header with a reference ZIP code (1–2 free live calls) before pricing on item plus shipping. Until then, prices stay item-only, as the report already says.
