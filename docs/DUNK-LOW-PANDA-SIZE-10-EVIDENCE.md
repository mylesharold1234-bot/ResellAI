# Nike Dunk Low Panda, US Men's 10, new with box: evidence fixes (2026-11-15)

Pricing thresholds are unchanged: at least 3 listings, at least 2 sellers, a 2× spread limit, and the outlier band. Unknown sizes are never treated as matches.

## What changed
1. **Box.** eBay's own condition "New with box" (and "New without box") counts as packaging evidence. A title that contradicts it still fails. Mercari's "New" says nothing about a box.
2. **Men's sizing.** "10M" / "10M/11.5W" counts as a US men's size. A known style code sets the sizing group: DD1391 is men's, DD1503 is women's, CW1590 is GS (`lib/style-codes.ts`). Unknown codes prove nothing. A bare "Size 10" with no men's evidence is still unverified.
3. **Multi-size listings.**
   - eBay listings that offer several sizes for one price, and titles like "Sizes 4/4.5/5", are never treated as a size 10 price.
   - When a search can't support a price on its own, up to 6 such eBay listings are checked for their size 10 variation, which comes with its own price and eBay's "US Shoe Size".
4. **Broader reference.** Sizes are relaxed, sizing groups are not. Women's, youth and GS pairs (by title, style code, eBay Department or Mercari category), Nike By You / NIKEiD pairs, SB Dunks and named non-black/white colorways are excluded.
5. **Edition grouping.** A known style code supplies the edition, so "Dunk Low Panda DD1391-100" and "Dunk Low Retro Panda" form one group. Titles without a known code are unchanged.
6. **eBay retrieval.**
   - For a confirmed US men's or women's shoe size, the first search filters by eBay's own "US Shoe Size" in the men's (15709) or women's (95672) Athletic Shoes category, with new-only conditions when the item is new.
   - If no price is supported yet, eBay item specifics are fetched for up to 10 close matches whose titles don't state the size.
   - The eBay snapshot key changed, so today's eBay snapshots refresh. Mercari's key is unchanged, to avoid paid re-searches; its new rules apply from tomorrow's snapshot.
7. **Mercari.** API.SH's `size` field ("10 (43)") and Men/Women/Kids category are used as structured evidence. If a title states a different size than the structured field, the listing is excluded.

## Results
| Stage | eBay, saved title search (Nov 15) | eBay, live size-filtered search | eBay, live title searches + item checks | Mercari, saved | Mercari, live size query (1 credit) |
|---|---|---|---|---|---|
| Retrieved | 300 | 100 | 300 | 100 | 100 |
| After duplicates | 174 | 100 | 168 | 100 | 100 |
| Wrong product, edition or colorway | 46 | 29 | 50 | 60 | 68 |
| Condition mismatch | 57 | 0 (filtered by eBay) | 56 | 33 | 28 |
| Multi-size, one price | 34 | 47 | 33 | 1 | 1 |
| Size mismatch, or conflicting evidence | 20 | 1 | 21 | 2 | 1 |
| Size or sizing group unknown | 15 | 0 | 4 | 4 | 0 |
| Box not established | 0 | 4 | 0 | 0 | 1 |
| Size 10 candidates | 2 | 19 | 6 | 0 | 1 |
| Outside the price cohort / outliers | 0 / 0 | 4 / 1 | 2 / 0 | – | – |
| **Exact-size price** | none (2 < 3) | **$70** (14 listings, 14 sellers, $54.99–$89) | $64 (4 listings, $60–$65) | none | none (1 < 3) |
| Broader reference | $60 median, $50–$69.99, 16 listings | not needed | not needed | none | none |

The live title-search column didn't run the size-filtered search, so that the item checks could be tested: 6 multi-size listings yielded 2 size 10 variations, and 9 of 10 item lookups stated a size. Its condition and size counts are reconstructed from the logged reasons.

Mercari's live size query surfaced 33 listings whose own size field is 10. Most were used, and many titles say "Panda" without "black/white". Only one new men's size 10 qualified.

Regression fixtures (titles, prices and conditions only; seller names replaced) are in `lib/test-support/ebay-dunk-low-panda-10-*.json`, with tests in `lib/evidence-matching.test.ts`.
