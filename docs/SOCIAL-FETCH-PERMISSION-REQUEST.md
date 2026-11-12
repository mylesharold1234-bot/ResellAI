# Social Fetch permission clarification — draft for the project owner

This draft has NOT been sent. Do not include API keys in correspondence.

To: Social Fetch support (the contact listed on your account or https://www.socialfetch.dev/terms)
Subject: Confirm permitted Facebook Marketplace use for ResellAI

We are building ResellAI, a resale-research application. Users identify their own product photos and confirm the product details. We want to use GET /v1/facebook/marketplace/search to find currently available listings matching product keywords near a user-selected latitude/longitude and radius, using our Social Fetch API key.

Please identify the applicable terms or provide written confirmation addressing:

1. The permission or authorization under source-platform terms covering your automated Facebook Marketplace collection through this endpoint, including any restrictions on region, commercial resale research or downstream users.
2. Our ability to display returned listing titles, asking prices, source URLs, listing photos and approximate locations in our customer-facing application, including any attribution, media-display or redistribution restrictions.
3. Our deterministic calculation of median/range of asking prices and a suggested starting listing price, explicitly distinguished from actual sold prices. We do not claim access to verified completed-sale prices.
4. Permitted caching/retention and deletion/update obligations. Our prototype has a ten-minute response cache and a memory-local duplicate-action ledger that may retain original outcomes up to a day to avoid repeated charges; no permanent price history is collected. Please specify whether those periods or architecture must change.
5. Whether we may send only a minimal derived evidence summary and product brand/model/category to OpenAI for optional qualitative selling advice. This feature does not send source listing photos or precise search coordinates, and the AI does not set prices. If that processing is not permitted, please separate that restriction from display/statistical-analysis permission so it can remain independently disabled.
6. Whether our account/plan includes this endpoint, whether one successful page currently costs one credit, what error/retry charges apply, and how USD currency and live-listing status can reliably be verified from the documented response.

We do not expose or resell API credentials, mirror the Social Fetch API, require Facebook login, scrape Facebook directly, or make automatic paginated requests. We will review your response and the source-platform permission basis before enabling the integration.

Please include the agreement/terms version, scope and any limits we should record as our reviewed permission reference.
