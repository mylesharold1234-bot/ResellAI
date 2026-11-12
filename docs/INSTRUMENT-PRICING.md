# Primary-product matching and deterministic pricing

## Root cause

Two overlapping keyword filters rejected complete instruments when titles contained case, mouthpiece, controllers, or bundle language. The instrument-specific filter recognized only a narrow set of inclusion phrases; the global blacklist then rejected case/controller words even for complete products. Separately, missing model/manufacturer information forced all generic instruments into related context, which pricing correctly excluded, leaving no usable close evidence.

Matching now classifies the primary product first: complete product, accessory-only, parts-only or uncertain. Included accessories do not by themselves reject a complete saxophone, console or camera. Saxophone mouthpieces, plural mouthpiece lots, separate necks, parts-condition records and incompatible instrument subtypes have explicit exclusions with regression tests drawn from live titles. Same-subtype complete instruments can be close evidence without a confirmed model; a known requested brand must still match. Unknown accessory-package contents downgrade exact matches while retaining complete products as provisional close evidence. No arbitrary accessory price premiums are added.

## Image and description understanding

The existing image upload now uses a strict structured understanding object alongside identity fields. It extracts primary product, subtype, described condition, accessories, source-labeled evidence and actual image/description conflicts. Sources are image-visible, user-described and AI-inferred; user corrections retain user-provided attribution. The model cannot assert independent verification. Explicitly described condition can prefill the review condition field when no user choice already exists. User edits and confirmation remain authoritative. Unsupported year-only models are cleared; an era is not treated as a model number. Email/phone text is redacted before description analysis; comparable review sends product fields and actual listing titles/IDs/condition/categories, not seller contacts, prices or URLs.

Description input remains optional. The user clarified that the original Ozici attempt had **no description**. Image-only results therefore never display an invented image-versus-description conflict. Identity-critical conflicts from a supplied description are presented for clarification and block item-specific recommendations until explicitly reviewed, while general discovery remains available. A specific primary product is preserved even when an AI response puts only a broad category in productName.

Structured Outputs implementation follows the [official OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), with additional local bounds and source-ID validation. Existing OPENAI_API_KEY and OPENAI_VISION_MODEL remain server-side; no new credentials or dependencies are required.

## Pricing formulas and safeguards

1. Deduplicate actual USD active listings, then exclude related context, unresolved variations and ineligible attribute mismatches from item-specific calculations.
2. Use the selected condition; if absent, disclose selection of the largest observed condition cohort. Prefer at least three exact items; otherwise use eligible close evidence.
3. For samples of at least five, remove extreme asks outside a three-scaled-MAD band, with a floor of 20% of the sample median. Preserve excluded IDs and reasons.
4. Let M be the retained asking-price median. Suggested starting ask = M × (1 + negotiation margin / 100). For delivered comparisons, quoted shipping is included in M and the user-selected buyer shipping charge is subtracted from the suggested item price. Unknown shipping is not assumed free.
5. A provisional recommendation needs at least three eligible listings from two identified sellers, retained max/min no greater than 2×, a fresh Production snapshot, adequate identity confidence, no unresolved critical conflict and category requirements such as selected shoe size. Qualified guidance additionally needs at least five exact-tier items from three sellers, selected condition and established brand/model; footwear keeps its release safeguards.
6. Modeled offer range = M × (1 − upper discount / 100) to M × (1 − lower discount / 100). The default UI margin is 5%; test offer discounts are 10–20%. These are adjustable hypothetical negotiation assumptions, not observed discounts or conversion rates.
7. When evidence is weak, an illustrative scenario can use the observed cohort/category asking median as a clearly labeled anchor. It is not an item-specific valuation or prediction. Completed-sale and expected-sale fields remain unavailable.

The UI exposes assumptions, shipping basis, eligible IDs, excluded outliers, condition cohort and limitations in a disclosure. Changes recompute locally without another marketplace request. The AI comparison-review button is optional and explicit, limited to five requests/hour per process and one concurrent request. It reviews at most 20 real titles, returns only validated source IDs, similarity judgments, primary-product classifications and qualitative uncertainty. It cannot supply new listings, URLs or monetary fields. Pricing arithmetic remains deterministic and independent of the AI ranking. Reviews cache by fresh server-held snapshot; stale evidence cannot trigger a paid review.

## Actual Production route tests

All seven tests below called the real HTTP route /api/marketplaces/ebay on the optimized production preview, and all returned HTTP 200 with actual eBay listings. Fixture inputs were explicitly labeled; this is not a claim to have photographed all seven products. Counts are observations during testing and can change. API row totals include overlapping searches before deduplication. Pricing assumes item-price basis excluding shipping and tax, 5% starting-ask margin and hypothetical 10–20% offer discounts.

| Product | API rows | Exact/close/related | Eligible after robust filtering | Starting ask | Modeled offer range | Quality |
|---|---:|---|---:|---|---|---|
| Ozici Alto Saxophone | 102 | 0/0/66 | 0 | Scenario only | Unsupported | unavailable |
| Alto Saxophone | 200 | 0/84/9 | 20 | Scenario only | Unsupported | low |
| Yamaha Alto Saxophone Mouthpiece | 100 | 22/5/22 | 21 | Scenario only | Unsupported | low |
| Air Jordan 1 Mid | 300 | 0/169/0 | 0 | Scenario only | Unsupported | unavailable |
| PlayStation 5 Console | 100 | 10/85/0 | 9 | $503.99 | $383.99–$431.99 | moderate |
| Sony WH-1000XM5 Headphones | 300 | 4/78/98 | 4 | $139.04 provisional | $105.94–$119.18 | limited |
| Ceramic dinner plate | 200 | 0/0/103 | 0 | Scenario only | Unsupported | unavailable |

### Ozici limitation

The Ozici query returned two listings without sufficient Ozici brand evidence, followed by 100 broad saxophone rows. No matched-brand Ozici evidence qualified for pricing. The brand was inferred in the original user attempt, not supplied in a description. The app must not turn other manufacturers' asks into an Ozici value. It now explains that limitation and displays only an illustrative broader-category scenario. A label photo or corrected manufacturer/model may improve matching. This is distinct from rejecting complete saxophones merely for having cases or mouthpieces.

### Ozici Alto Saxophone

Identification input was a deterministic fixture, not a new photograph of this item: {"brand":"Ozici","model":null,"productName":"Ozici Alto Saxophone","category":"Musical instruments","colorway":null,"visibleCondition":null,"identifyingInformation":null,"confidence":"medium","uncertainties":[],"additionalEvidence":[]}

Confirmed matching details: {"size":"","sizeSystem":"","condition":"","packaging":"","variant":"","productIdentifier":"","subtype":"Alto","includedAccessories":"case, mouthpiece, gloves"}

Queries: A: ozici alto saxophone (2 rows); C: saxophone (100 rows). HTTP 200, provider status available.

Eligible condition cohort: none; robust exclusions: 0. Price recommendation: Unsupported. Illustrative scenario only: $278.83–$313.69 from a $348.54 asking-price anchor. This is not an item-specific selling estimate.

Limitations: Limited sample: up to four searches of the first 100 best-match fixed-price listings, USD, deliverable to the US. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches. Condition not selected: using the largest observed condition cohort (none). Item-price basis excludes shipping and tax; unknown shipping is not assumed free. Fewer than three eligible listings remain. Fewer than two identified sellers support the sample. Accessory packages are compared as advertised; unverified accessory differences receive no invented price adjustment. Offer discounts and negotiation margins are user-adjustable assumptions, not observed conversion rates. No sold transactions, demand, sell-through, or future price evidence is available.

Exclusion categories: {"incompatible_instrument_subtype":19,"accessory_only_primary_product":4,"brand_or_model_mismatch":7,"parts_condition_not_complete_item":5,"parts_only_primary_product":1}. Every monetary calculation uses the actual source listings saved in the credential-free audit.

### Alto Saxophone

Identification input was a deterministic fixture, not a new photograph of this item: {"brand":null,"model":null,"productName":"Alto Saxophone","category":"Musical instruments","colorway":null,"visibleCondition":null,"identifyingInformation":null,"confidence":"medium","uncertainties":[],"additionalEvidence":[]}

Confirmed matching details: {"size":"","sizeSystem":"","condition":"new","packaging":"","variant":"","productIdentifier":"","subtype":"Alto","includedAccessories":"case"}

Queries: A: alto saxophone (100 rows); C: saxophone (100 rows). HTTP 200, provider status available.

Eligible condition cohort: new; robust exclusions: 2. Price recommendation: Unsupported. Illustrative scenario only: $162.80–$183.15 from a $203.50 asking-price anchor. This is not an item-specific selling estimate.

Limitations: Limited sample: up to four searches of the first 100 best-match fixed-price listings, USD, deliverable to the US. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches. Item-price basis excludes shipping and tax; unknown shipping is not assumed free. 2 extreme asking-price outliers excluded using a 3× scaled-MAD band with a 20% median floor. Eligible asking prices still span more than 2× after robust filtering; use a scenario, not an item-specific recommendation. Accessory packages are compared as advertised; unverified accessory differences receive no invented price adjustment. Offer discounts and negotiation margins are user-adjustable assumptions, not observed conversion rates. No sold transactions, demand, sell-through, or future price evidence is available.

Exclusion categories: {"incompatible_instrument_subtype":19,"accessory_only_primary_product":4,"parts_condition_not_complete_item":6,"instrument_accessory":1,"brand_or_model_mismatch":9,"parts_only_primary_product":1,"duplicate_across_searches":67}. Every monetary calculation uses the actual source listings saved in the credential-free audit.

### Yamaha Alto Saxophone Mouthpiece

Identification input was a deterministic fixture, not a new photograph of this item: {"brand":"Yamaha","model":"4C","productName":"Yamaha Alto Saxophone Mouthpiece","category":"Musical instrument accessories","colorway":null,"visibleCondition":null,"identifyingInformation":null,"confidence":"medium","uncertainties":[],"additionalEvidence":[]}

Confirmed matching details: {"size":"","sizeSystem":"","condition":"new","packaging":"","variant":"","productIdentifier":"","subtype":"Alto","includedAccessories":""}

Queries: A: yamaha alto saxophone mouthpiece (100 rows). HTTP 200, provider status available.

Eligible condition cohort: new; robust exclusions: 1. Price recommendation: Unsupported. Illustrative scenario only: $39.12–$44.01 from a $48.90 asking-price anchor. This is not an item-specific selling estimate.

Limitations: Limited sample: up to four searches of the first 100 best-match fixed-price listings, USD, deliverable to the US. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches. Item-price basis excludes shipping and tax; unknown shipping is not assumed free. 1 extreme asking-price outliers excluded using a 3× scaled-MAD band with a 20% median floor. Eligible asking prices still span more than 2× after robust filtering; use a scenario, not an item-specific recommendation. Accessory packages are compared as advertised; unverified accessory differences receive no invented price adjustment. Offer discounts and negotiation margins are user-adjustable assumptions, not observed conversion rates. No sold transactions, demand, sell-through, or future price evidence is available.

Exclusion categories: {"accessory_bundle_or_unsupported":29,"brand_or_model_mismatch":10,"unsupported_or_accessory":1,"incompatible_instrument_subtype":11}. Every monetary calculation uses the actual source listings saved in the credential-free audit.

### Air Jordan 1 Mid

Identification input was a deterministic fixture, not a new photograph of this item: {"brand":"Jordan","model":"Air Jordan 1 Mid","productName":"Air Jordan 1 Mid","category":"Footwear","colorway":"black white","visibleCondition":null,"identifyingInformation":null,"confidence":"medium","uncertainties":[],"additionalEvidence":[]}

Confirmed matching details: {"size":"10","sizeSystem":"US Men","condition":"used","packaging":"","variant":"","productIdentifier":"","subtype":"","includedAccessories":""}

Queries: A: air jordan 1 mid black white (100 rows); B: jordan footwear (100 rows); C: nike jordan 1 mid (100 rows). HTTP 200, provider status available.

Eligible condition cohort: used; robust exclusions: 0. Price recommendation: Unsupported. Illustrative scenario only: $59.99–$67.49 from a $74.99 asking-price anchor. This is not an item-specific selling estimate.

Limitations: Limited sample: up to four searches of the first 100 best-match fixed-price listings, USD, deliverable to the US. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches. Item-price basis excludes shipping and tax; unknown shipping is not assumed free. Fewer than three eligible listings remain. Fewer than two identified sellers support the sample. Accessory packages are compared as advertised; unverified accessory differences receive no invented price adjustment. Offer discounts and negotiation margins are user-adjustable assumptions, not observed conversion rates. No sold transactions, demand, sell-through, or future price evidence is available.

Exclusion categories: {"brand_or_model_mismatch":102,"duplicate_across_searches":28,"unsupported_or_accessory":1}. Every monetary calculation uses the actual source listings saved in the credential-free audit.

### PlayStation 5 Console

Identification input was a deterministic fixture, not a new photograph of this item: {"brand":"Sony","model":"PlayStation 5","productName":"PlayStation 5 Console","category":"Electronics","colorway":null,"visibleCondition":null,"identifyingInformation":null,"confidence":"medium","uncertainties":[],"additionalEvidence":[]}

Confirmed matching details: {"size":"","sizeSystem":"","condition":"used","packaging":"","variant":"Disc","productIdentifier":"","subtype":"","includedAccessories":"controller"}

Queries: A: sony playstation 5 console (100 rows). HTTP 200, provider status available.

Eligible condition cohort: used; robust exclusions: 1. Price recommendation: $503.99. 

Limitations: Limited sample: up to four searches of the first 100 best-match fixed-price listings, USD, deliverable to the US. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches. Item-price basis excludes shipping and tax; unknown shipping is not assumed free. 1 extreme asking-price outliers excluded using a 3× scaled-MAD band with a 20% median floor. Accessory packages are compared as advertised; unverified accessory differences receive no invented price adjustment. Offer discounts and negotiation margins are user-adjustable assumptions, not observed conversion rates. No sold transactions, demand, sell-through, or future price evidence is available.

Exclusion categories: {"parts_condition_not_complete_item":1,"accessory_only_primary_product":3,"brand_or_model_mismatch":1}. Every monetary calculation uses the actual source listings saved in the credential-free audit.

### Sony WH-1000XM5 Headphones

Identification input was a deterministic fixture, not a new photograph of this item: {"brand":"Sony","model":"WH-1000XM5","productName":"Sony WH-1000XM5 Headphones","category":"Electronics","colorway":null,"visibleCondition":null,"identifyingInformation":null,"confidence":"medium","uncertainties":[],"additionalEvidence":[]}

Confirmed matching details: {"size":"","sizeSystem":"","condition":"used","packaging":"","variant":"","productIdentifier":"","subtype":"","includedAccessories":"case"}

Queries: A: sony wh 1000xm5 headphones (100 rows); B: sony headphones (100 rows); C: sony wh1000xm5 headphones (100 rows). HTTP 200, provider status available.

Eligible condition cohort: used; robust exclusions: 0. Price recommendation: $139.04. 

Limitations: Limited sample: up to four searches of the first 100 best-match fixed-price listings, USD, deliverable to the US. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches. Item-price basis excludes shipping and tax; unknown shipping is not assumed free. Accessory packages are compared as advertised; unverified accessory differences receive no invented price adjustment. Offer discounts and negotiation margins are user-adjustable assumptions, not observed conversion rates. No sold transactions, demand, sell-through, or future price evidence is available.

Exclusion categories: {"parts_condition_not_complete_item":2,"brand_or_model_mismatch":3,"duplicate_across_searches":115}. Every monetary calculation uses the actual source listings saved in the credential-free audit.

### Ceramic dinner plate

Identification input was a deterministic fixture, not a new photograph of this item: {"brand":null,"model":null,"productName":"Ceramic dinner plate","category":"Dinnerware","colorway":null,"visibleCondition":null,"identifyingInformation":null,"confidence":"medium","uncertainties":[],"additionalEvidence":[]}

Confirmed matching details: {"size":"","sizeSystem":"","condition":"used","packaging":"","variant":"","productIdentifier":"","subtype":"","includedAccessories":""}

Queries: A: ceramic dinner plate (100 rows); C: plate (100 rows). HTTP 200, provider status available.

Eligible condition cohort: used; robust exclusions: 0. Price recommendation: Unsupported. Illustrative scenario only: $22.40–$25.20 from a $28.00 asking-price anchor. This is not an item-specific selling estimate.

Limitations: Limited sample: up to four searches of the first 100 best-match fixed-price listings, USD, deliverable to the US. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches. Item-price basis excludes shipping and tax; unknown shipping is not assumed free. Fewer than three eligible listings remain. Fewer than two identified sellers support the sample. Accessory packages are compared as advertised; unverified accessory differences receive no invented price adjustment. Offer discounts and negotiation margins are user-adjustable assumptions, not observed conversion rates. No sold transactions, demand, sell-through, or future price evidence is available.

Exclusion categories: {"brand_or_model_mismatch":6,"not_dinnerware_evidence":90,"accessory_bundle_or_unsupported":1}. Every monetary calculation uses the actual source listings saved in the credential-free audit.

## Actual browser workflow test

A real public eBay photo, obtained through the authorized Browse API and inspected before upload, was used in an isolated production browser tab. The listing was an Amati Kraslice saxophone; it was not mislabeled as the user's original Ozici photo.

- Uploaded through the real file control; thumbnail appeared.
- Image-only OpenAI identification returned an alto saxophone with brand/model uncertain, a non-blocking warning, and no false description conflict.
- Clicked No, continue with general search; the report preserved the actual photo and retrieved real active listings. It displayed 158 close plus 15 related listings and an appropriately unsupported-specific-price scenario in that observed run. Broad asks remained widely dispersed, so no specific-item recommendation was made.
- Clicked the real AI comparison-review button. A real OpenAI structured response ranked actual supplied IDs and explained subtype, finish, vintage/model and accessory uncertainty, without monetary fields or invented source URLs.
- Returned to review without losing the photo and added a test description based on the public listing: Amati Kraslice alto saxophone, used, case/mouthpiece/neck strap, late-1950s era but no confirmed model number. This was a separate test description, not text falsely attributed to the user.
- Verified brand was tagged user-described, model remained blank rather than an era/year, and accessories were retained. Confirmed Used condition and clicked Continue with these details. The actual report returned evidence but only one eligible same-manufacturer comparison, so it showed a scenario, not an unsupported item-specific estimate.
- Changed lower offer discount from 10% to 5% in the real interface. The visible scenario changed from $360–$405 to $360–$427.50 using the same $450 anchor, without re-searching eBay.
- Allowed the actual five-minute snapshot to expire. Photo and listings stayed visible, EXPIRED SNAPSHOT appeared, current recommendations/scenarios disappeared and historical evidence remained. Clicked Refresh comparisons after the final server restart; fresh evidence replaced the old snapshot and the photo was still visible.

Screenshots are saved as resellai-pricing-test.png and resellai-expired-snapshot.png in this chat's visualization output directory. The production preview avoids development hot reloads, which were clearing the per-tab upload session during initial testing.

## Validation and limitations

99 automated tests passed; TypeScript and optimized production build passed. Coverage includes complete products with accessories, accessory-only/parts-only listings, subtype and brand mismatches, exact-versus-close package uncertainty, robust math/outliers, shipping, seller diversity, weak-data scenarios, stale snapshots, source attribution, unsupported year models, low identity confidence and constrained AI review inputs/outputs.

The original Ozici photo is not available for a fresh brand-verification run; no claim is made that the original brand was visually verified. Seven-category marketplace tests use identity fixtures; the actual browser image/description test used the separately identified public saxophone photo. Title parsing remains heuristic and may miss ambiguous listings; included accessory quantities, repair history, hidden function and authenticity are not verified. Related category scenarios can mix brands/variants/conditions and must never be presented as specific product values. No authorized completed-sale dataset exists in this integration, and modeled offers do not predict achieved prices or sale probability.

Server evidence/review caches and rate limits are process-local. A multi-worker deployment would need shared storage before relying on cross-worker snapshot lookup. Browser photos and snapshots survive local expiry and manual refresh, but a hard page reload clears the existing in-memory session. No paid data service, Facebook gate bypass, marketplace scraping or additional dependency was introduced.

## Files changed

- lib/primary-product.ts: primary product/package classification.
- lib/ebay-search.ts: instrument close matches, subtype/parts/accessory-package guards, query cleanup and cache version.
- lib/pricing-engine.ts and lib/valuation.ts: robust deterministic pricing, provisional guidance, scenarios and expiry.
- lib/product-understanding.ts, lib/identification.ts, lib/identify-server.ts: strict image/description understanding, source validation, year and privacy handling.
- lib/product-profile.ts and lib/identification-workflow.ts: recognizable primary name, preserved source attribution, described condition/accessories.
- lib/marketplaces.ts and lib/marketplace-server.ts: accessory fields, validated pricing options and server-held snapshot reference.
- lib/ebay-evidence.ts and lib/ebay-ai-review.ts: bounded evidence storage and constrained qualitative ranking.
- app/api/marketplaces/ebay/review/route.ts: secure explicit AI review endpoint with freshness/cache/rate controls.
- app/analyze/page.tsx and components/match-details-fields.tsx: source/conflict review and optional accessories.
- components/pricing-panel.tsx, components/ebay-ai-review.tsx and components/live-report.tsx: pricing/scenario controls, qualitative review, preserved historical evidence and manual refresh.
- lib/pricing-engine.test.ts, existing marketplace/search regression tests and scripts/test-pricing-route.ts: regression and real-route verification.
