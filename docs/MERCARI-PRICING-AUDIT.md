# Mercari Air Jordan 1 Mid pricing audit

Source: saved Mercari production snapshot, November 9, 2026 at 18:15:37 UTC, version 1. The search returned 100 rows; seven were in the final used cohort under the old rules. These are active listing asks. Descriptions below summarize the listing titles and provider condition; they are not independent physical inspections.

| Listing | Ask | Condition / size | Colorway / edition | Why it previously counted | New treatment |
|---|---:|---|---|---|---|
| [m96715917874](https://www.mercari.com/us/item/m96715917874/) | $75.00 | Good, men’s 13 | Yin Yang white/black, 554724-113 | Mid silhouette and both requested colors | Remains comparable; size and release not confirmed for the target |
| [m55732045287](https://www.mercari.com/us/item/m55732045287/) | $100.00 | Good, men’s 14 | Medium Olive black/white, DQ8426-092 | Mid silhouette and black/white tokens; olive was not recognized as a conflict | Colorway conflict; context only |
| [m66785309914](https://www.mercari.com/us/item/m66785309914/) | $15.56 | Good, women’s 6.5 | SE Split Homage black/white, DR0501-101 | Mid silhouette and both colors; the target had no verified edition | Distinct edition; context only |
| [m74678539492](https://www.mercari.com/us/item/m74678539492/) | $22.50 | Good, 3Y | Tropical Twist teal/black/white | Mid silhouette and both colors; numeric youth suffix was not recognized | Unconfirmed youth size group; context only |
| [m30161608126](https://www.mercari.com/us/item/m30161608126/) | $30.00 | Good, US 6Y | SE Zen Master black/white/coral/amethyst | Mid silhouette and both colors; extra hues and youth suffix slipped through | Unconfirmed youth size group and distinct color/edition; context only |
| [m36160843642](https://www.mercari.com/us/item/m36160843642/) | $50.00 | Good, women’s 6.5 | Coconut Milk/black | Mid silhouette and a partial black match | Colorway conflict; context only |
| [m28128405399](https://www.mercari.com/us/item/m28128405399/) | $48.45 | Like New, 6.5Y | SE DIY Doodle black graffiti, DC4098-100 as written without the hyphen | Mid silhouette and a partial black match | Unconfirmed youth size group and distinct edition; context only |

All seven were presented as complete shoes in the available titles. None was identified as an accessory or single shoe. Size and SKU come from title text where shown; they are not verified beyond the listing.

The old median was $48.45 and MAD was $25.95. The 3× scaled MAD band was about $115.42 either side of the median, so it flagged none of these asks. The high-to-low ratio was 6.43×, exceeding the 2× guard. The spread reflected differences in product evidence rather than an isolated numeric outlier. Removing the cheapest rows on price alone would not have been justified.

The new Mercari path retains contextual rows, removes explicitly damaged and incomplete listings, and does not use clear color, edition, youth-size or footwear-type conflicts for pricing. The price engine still uses the existing MAD rule; if the broad condition group fails, an independently qualifying condition grade can supply a limited estimate. It must still have three listings, at least two identified sellers, and an acceptable post-filter spread. The daily store is unchanged; the Mercari rules have a new snapshot key version so saved old calculations are not presented as new ones.
