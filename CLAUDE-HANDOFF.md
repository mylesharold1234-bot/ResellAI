# ResellAI — Claude Code handoff

Prepared November 11, 2026. This folder is the complete ResellAI Next.js/TypeScript app. The unrelated semester-planner parent project is not required. Extract the archive into its own folder and open that folder in Claude Code.

## Run locally

Use Node.js 22 LTS or newer; verification used Node 24. From the extracted project folder in PowerShell:

```powershell
npm ci
# If you do not have an existing .env.local:
Copy-Item .env.example .env.local
# Edit .env.local with your own credentials, then:
npm run dev
```

Open http://localhost:3001/analyze. Landing: http://localhost:3001/; dashboard: http://localhost:3001/dashboard. Keep the terminal open; stop with Ctrl+C. Only one server can use port 3001.

**If transferring your existing .env.local, skip Copy-Item above.** Copy it privately from the original project's root to the extracted project's root, alongside package.json. It is deliberately excluded from the archive. Do not paste API keys into chat, commit them, or expose them with NEXT_PUBLIC variables. Restart Next.js after environment changes.

Server-only configuration names (values are never included here):

- OpenAI: OPENAI_API_KEY, optional OPENAI_VISION_MODEL.
- eBay: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENVIRONMENT, EBAY_PRODUCTION_APPROVED. Preserve the existing authorized Production configuration; matching App ID/Cert ID keyset required.
- Mercari through API.SH: APISH_API_KEY, MERCARI_MAX_SEARCH_QUERIES. Default 1 conserves credits; 2 permits one controlled fallback.
- Facebook/Social Fetch: SOCIAL_FETCH_API_KEY, SOCIAL_FETCH_PERMITTED_USE_CONFIRMED, SOCIAL_FETCH_PERMISSION_REFERENCE. Do not enable the gate without establishing the documented rights; possession of a key is insufficient.

## Current functionality

- Existing responsive white/navy/blue design and landing/dashboard/upload/report flow preserved.
- Actual uploaded photos, secure OpenAI vision identification with optional description, manual correction and product confirmation. AI does not invent prices.
- Authorized eBay Browse and API.SH Mercari active-listing integrations, independent pricing cards, loading/error/retry states, bounded caching/rate limits and persistent versioned daily snapshots.
- Deterministic model, silhouette, edition, color, condition, identifier and size matching; duplicate/accessory/non-wearable rejection; robust price outlier handling and seller-diversity safeguards.
- Supported item-specific recommended/estimated asking prices. No verified sold-price, demand, future-price or sale-speed claims.
- Separate **Broader market asking-price reference** when item pricing fails and a size was supplied: same-response retained listings rematched with only size/system constraints removed. Other constraints and pricing safeguards remain. Explicitly non-item-specific; never feeds item recommendation, profit or marketplace ranking. Hidden when expired or refreshing. No other product/general snapshot is copied.
- Hypothetical profit calculator requires a supported current item recommendation and user-entered costs. Separate fictional demo mode never silently substitutes for live evidence.
- Offline validation and independent-review pilot tooling. Never use the model's predictions as ground truth or claim benchmark accuracy without independent real labels.

## Latest evidence and limitations

See HANDOFF-VERIFICATION.md for packaging checks. The transfer does not revalidate API keys or perform paid live searches. Fresh marketplace retrieval depends on the existing private configuration, authorization and provider availability.

Historical retained Dunk replay at original timestamps: general eBay 12 eligible / $66.99, Mercari 5 / $79.31. Refined US Men's size 10/new remains zero item-specific eligible because sizing was not fully verified. Refined retained evidence supports separate broader median asks: eBay $65.99 / 25 listings; Mercari $84.66 / 4. These are historical active asks, not current prices, completed sales or accuracy benchmarks. Complete original pre-filter responses and all submitted historical fields were unavailable.

Private files are excluded from the shareable archive: `.env.local`, `.marketplace-snapshots/`, and `evaluation/private/`. They remain untouched in the original project. If needed and permitted, copy private evidence folders separately to the same relative locations. Without those datasets, generic tests work but historical replay cannot reproduce them. Templates are not real labels. The handoff does not establish a completed independently reviewed pilot.

## Architecture and reading order

- app/: Next.js pages and server API routes; components/: existing UI and workflow.
- lib/identify-server.ts and identification*: OpenAI identification and validation.
- lib/marketplace-providers/ebay.ts and mercari.ts: provider auth/search/normalization.
- lib/ebay-search.ts, product-matching.ts, mercari-matching.ts, footwear-compatibility.ts, comparable-quality.ts: retrieval and relevance.
- lib/pricing-engine.ts and valuation.ts: deterministic pricing and orchestration.
- lib/market-reference.ts: separate broader size-scope reference.
- lib/daily-snapshots.ts: local disk persistence and daily versioning.
- components/pricing-panel.tsx and marketplace-intelligence.tsx: price/reference/profit display.
- scripts/, evaluation/, docs/: diagnostics, replay, independent validation and design history.

Read docs/TIERED-PRICING-EVIDENCE.md, DUNK-REFINEMENT-REGRESSION.md, COMPARABLE-QUALITY.md, PRICING-INTELLIGENCE-V1.md, DAILY-PRICING.md, MERCARI.md and REAL-WORLD-PILOT-V1.md before related edits. Some older documents describe historical milestones; current code and this handoff supersede their old scope statements.

## Checks

```powershell
npm test
npm run typecheck
npm run build
# After stopping dev on port 3001:
npm start
```

tsconfig.json explicitly scopes node/react/react-dom types to avoid leaking broken ambient type packages from the original parent project. No runtime behavior changes for the handoff.

scripts/test-loading-ui.cjs uses a separately installed playwright-core package via RESELLAI_PLAYWRIGHT. That temporary browser-testing dependency is not bundled or required by the app; inspect the script before running on a new machine. Its mocked requests use no credits.

Live smoke testing: upload an actual product, confirm only supported details, and search each configured marketplace once. Review source links and evidence scope. Manual refresh may consume credits and produces a new snapshot version. Do not invent SKU, size or edition.

## Paste this into Claude Code

> Read CLAUDE-HANDOFF.md, HANDOFF-VERIFICATION.md and docs/TIERED-PRICING-EVIDENCE.md. Inspect the existing implementation before editing. Preserve the design, OpenAI workflow, eBay/Mercari integrations, daily snapshots and pricing safeguards. Run existing tests and TypeScript checks. Do not make paid API calls, enable permission gates, or change pricing rules without a specific request. Summarize verified status before proposing the next change.

The archive contains the working source tree including uncommitted files, not parent Git history. npm ci recreates dependencies and Next.js recreates build output. A file manifest and archive SHA-256 accompany the transfer.
