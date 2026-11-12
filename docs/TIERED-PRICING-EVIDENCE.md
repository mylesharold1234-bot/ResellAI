# Tiered asking-price evidence

## Audit and decision

`pricingEngine` already separates exact, close and context-only listings and enforces freshness, compatible conditions/editions, minimum counts, seller diversity and dispersion. `recommend` supplies persisted daily recommendations. `PricingPanel` displays them; `MarketplaceProfit` reads only `suggestedListingPrice`. This supports a separate non-item-specific reference without changing item matching or pricing thresholds.

When an item-specific recommendation is unavailable and a size/system was confirmed, `recommend` now separately rematches retained source facts with only size/system omitted. Model, visible colors, subtype, condition, variant, verified identifier and other constraints remain. The provider-specific matcher and unchanged pricing engine must still qualify the reference. Generated matching warnings are recomputed; upstream variation-price, duplicate-conflict and seller-integrity warnings are preserved. It uses item-only asks, independent of delivered-price assumptions.

The reference has its own discriminator, median, observed range, count, supporting listing IDs, timestamp and scope. It never populates item recommendation, modeled offer range, marketplace ranking or profit inputs. Its cohort may span sizes and sizing groups; the UI explicitly discloses that scope. It does not silently equate missing attributes with compatibility for the user's item.

No general-search snapshot is reused. Only listings retained in the same confirmed-product response are considered. Expired, sandbox, failed, insufficient, single-seller, unverified variation-price, incompatible or excessively dispersed evidence cannot qualify. The UI hides references during refresh/error and on expiration. Existing item-specific recommendations take priority. Daily algorithm version changes prevent loading older recommendation objects under the new version; no automatic additional searches are introduced.

## Saved Dunk replay

Replay uses the original observation time, not current freshness. These are retained rows, not complete original API responses. Old snapshots did not preserve the full confirmed input; the prior documented reconstruction and subtype sensitivity check remain limitations.

| Refined input | Rows retained | Item eligible / recommendation | Broader median | Asking range | Reference listings |
|---|---:|---|---:|---|---:|
| eBay | 184 | 0 / unavailable | $65.99 | $49.95–$90.00 | 25 |
| Mercari | 76 | 0 / unavailable | $84.66 | $65.00–$100.00 | 4 |

The original general eBay recommendation remains $66.99 / 12 listings and Mercari $79.31 / 5. No old general price was copied. Refined references use compatible condition evidence from the refined response but cannot verify the requested US Men's size 10. They are historical asking-price context, not exact valuations or completed sales. Live display requires fresh evidence; no new requests were made for this investigation.

## Verification

146 automated tests passed and TypeScript passed using explicit node/react/react-dom types. New regressions cover both marketplaces, separate UI labels, no profit fallback, expiry, API errors, wrong model/condition, variants and verified SKU, counts, seller diversity, variation prices, item-specific priority and determinism. Existing pricing safeguards and integrations remain unchanged.

## Files

- `lib/market-reference.ts`: scoped same-response reference calculation.
- `lib/valuation.ts`: keeps reference separate from item recommendation.
- `components/pricing-panel.tsx`: explicitly labeled secondary reference.
- `lib/daily-snapshots.ts`: versioned recommendation semantics.
- `lib/market-reference.test.ts`: safety and presentation regressions.
- `scripts/replay-dunk-refinement.ts`: includes separate reference in offline replay output.

No new dependencies, APIs, AI calls or credits.
