# Mercari through API.SH

Add APISH_API_KEY to resellai/.env.local and restart Next.js. Keep it server-side. Confirm a product, to load Mercari and eBay independently in the resale report. Each marketplace has its own **Refresh Market Prices** button.

Source: [API.SH Mercari Search](https://api.sh/docs/mercari-search). The adapter requests one page of US, on-sale results (up to 100) and verifies USD prices, active status, and canonical US Mercari item links. The shared matcher and price engine evaluate that sample separately. Prices are active asks, not completed sales or proceeds.

An item confirmation loads Mercari using the saved daily snapshot when available. The server coalesces identical in-flight searches and caches normalized search results for five minutes. It does not paginate or automatically retry. Each new request counts toward a per-process limit of five/hour and twenty/day; throttling and exhausted-credit responses add a cooldown. API.SH documents one credit per search and returns actual usage where available. For multi-instance deployments, configure a provider account spending limit or use shared enforcement rather than relying on process-local limits alone.

Tests: npm test. Air Jordan 1 Mid fixtures cover the request contract, invalid and sold rows, provider separation, median calculation, caching, and credit safeguards. A real listing check requires a configured API.SH key.

Search Optimization V1: the default now uses a compact supported query. MERCARI_MAX_SEARCH_QUERIES=2 opts into one additional alias page when the first page lacks a qualifying cohort; default 1 preserves one-credit behavior. See SEARCH-OPTIMIZATION-V1.md.
