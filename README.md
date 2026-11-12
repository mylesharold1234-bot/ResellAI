# ResellAI — Current handoff

Start with [CLAUDE-HANDOFF.md](CLAUDE-HANDOFF.md) for current setup, features, architecture and Claude Code transfer instructions. [HANDOFF-VERIFICATION.md](HANDOFF-VERIFICATION.md) records packaging checks.

Run npm ci, privately configure .env.local, then npm run dev. Open http://localhost:3001/analyze. API credentials are never included in the transfer archive.

The sections below are historical Phase 3 documentation. Mercari and daily snapshots have since been implemented; use the current handoff and code rather than historical status statements.

---
# ResellAI — Phase 3: eBay asking-price evidence

ResellAI is a separate Next.js/TypeScript app inside `resellai/`; the parent semester-planner project is preserved. It supports OpenAI product identification, user corrections/confirmation and a real eBay Browse adapter. eBay credentials and production permission are still required before real marketplace retrieval can be verified.

## Run on Windows

Use Node.js 22 LTS or newer. In PowerShell:

```powershell
cd 'C:\Users\Myles Foster\OneDrive\Documents\ChatGPT\syllabus optimizer\resellai'
npm ci
npm run dev
```

Keep the terminal open. Open http://localhost:3001/ or http://localhost:3001/analyze. Stop with Ctrl+C.

## Configuration

Keep your existing OpenAI key in `.env.local` (not `.env.local.txt`). The server reads `OPENAI_API_KEY` and optional `OPENAI_VISION_MODEL` (default `gpt-4.1-mini`). Do not put secrets in frontend code or `NEXT_PUBLIC_*` variables.

To enable eBay testing, append the following to the SAME `.env.local`, without replacing the OpenAI settings:

```dotenv
EBAY_CLIENT_ID=your_ebay_app_id
EBAY_CLIENT_SECRET=your_ebay_cert_id
EBAY_ENVIRONMENT=sandbox
EBAY_PRODUCTION_APPROVED=false
```

Use App ID and Cert ID from a matching environment keyset in your eBay developer account. Sandbox is test data only. For real data, get eBay's production permission for this use case, use the production keyset, set environment to `production` and approval to `true`, then restart the server. No seller login, redirect URI, Dev ID or refresh token is required for Browse application tokens.

See [the complete eBay setup, access research, fees and limitations](docs/EBAY-INTEGRATION.md) before configuring production. `.env.example` lists all settings; `.env.local` remains ignored. Neither eBay credential is currently configured. No paid service was purchased and no account was created.

## Product flow

1. Upload or photograph a product (`/analyze`). JPG, PNG or WebP; 1–3 photos, 10 MB combined; client image decode and 40-megapixel limit, server size/type/signature validation.
2. Choose **Identify Item** to send photos and optional notes to OpenAI. No prices are requested from AI. Review brand, model, product name, category, color, visible condition and identifiers; correct uncertain fields and add photos/notes as needed.
3. Add optional matching details: size + sizing system, condition, packaging, variant and a user-reviewed exact SKU/model identifier. Product name and category are required for confirmation; eBay search also needs brand and model.
4. **Confirm Identification** opens `/analysis`, using the actual uploaded photo and confirmed information. It automatically searches eBay. With missing credentials or access, it explains the limitation and shows no fictional prices. Refine details and choose **Find eBay comparables** to refresh.
5. With authorized production access, the report shows relevant active titles, prices, shipping, conditions, source URLs, sample counts, timestamps, and deterministic asking-price statistics. A starting listing recommendation needs the documented evidence thresholds. Expected selling price, verified resale value, demand and selling timing remain unavailable without sold/history evidence.
6. Your latest confirmed item stays visible on Dashboard while navigating in this tab. Photos and identity are kept only in React memory; reloading clears the session. There are no accounts or durable inventory yet.

The explicit fictional demo remains at `/analysis?demo=1`. Its sample product, chart, prices and manual calculator are labeled demo-only and do not represent your uploaded item's value. Live mode never silently falls back to it.

## Checks

```powershell
npm test
npm run typecheck
npm run build
# Serve the production build, with no dev server on the same port:
npm start
```

58 tests pass, TypeScript passes, and the production build passes. All five pages return HTTP 200. The running eBay endpoint was verified to return an explicit missing-credentials response, zero comparables and no statistics/prices. Live eBay success is not claimed: automated provider responses are fixtures until your authorized credentials are configured.

For the black-and-white Jordan test, upload the actual shoe, confirm Jordan / likely Jordan 1 Mid and literal colors, keep SKU unknown unless readable, and specify the actual size/system and condition. Review each real comparable after eBay access is available. The application contains no hardcoded Jordan recognition or live price results. US size matching requires explicit US and size-group evidence in titles; omitted title details can result in zero matches. Mobile camera picker behavior still depends on the device; convert HEIC if necessary. On a phone, localhost refers to the phone, not the PC.

## Scope and architecture

Shared UI and responsive card styling are preserved. `lib/identification*` owns Phase 2 validation/workflow, `lib/identify-server.ts` calls OpenAI, and React context carries photos and identity across routes. `lib/marketplace-providers/ebay.ts` owns authorized Browse retrieval, OAuth/cache/rate limits; `lib/product-matching.ts`, `lib/valuation.ts` and `lib/ebay-fees.ts` keep matching, statistics and documented fee calculations deterministic. `components/live-report.tsx` and `components/demo-report.tsx` separate live evidence from fictional examples.

No new dependencies, direct scraping, marketplace purchases, paid service purchases, sold-data claims or forecasts were added. A Social Fetch Facebook adapter is prepared but disabled pending permitted-use verification; Mercari remains unimplemented. Public deployment needs authentication, centralized abuse controls/quotas, and eBay's approval of the application/use and data-display terms. The current local cache is five minutes, bounded and in-memory; no price history is accumulated. Next.js may emit a nonblocking workspace-root warning because both this app and its parent have lockfiles.

Next steps require your credentials/permissions first. Facebook was subsequently requested and is prepared behind a disabled permission gate; Mercari and forecasting remain out of scope. Future accounts/storage/PWA work remains separate.



## Facebook Marketplace through Social Fetch

A Facebook section has been added to the confirmed-item report while preserving eBay and the existing design. It remains disabled because public documentation did not establish the required source collection and downstream rights. No Social Fetch credits were spent and no genuine listing retrieval is claimed. Read [Social Fetch setup, permission verification and testing](docs/SOCIAL-FETCH.md).

`SOCIAL_FETCH_API_KEY` is read only on the server. The current server reports it is not configured: check the exact `resellai/.env.local` file and restart. Do not paste the key in chat. Setting a key alone does not enable provider requests; do not change the permission gate until actual permitted use is verified.

Location/radius selection, server-side search/header auth, conservative active-listing normalization, observed asking statistics, explicit confirmation/update triggers, duplicate-request protection, hourly limits and optional AI commentary are implemented. Estimated selling-price ranges remain unavailable without sold evidence or a justified model. All Facebook tests use mock fixtures until permission and live access can be tested.

