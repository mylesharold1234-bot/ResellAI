# AI Listing Generator

Turns a confirmed ResellAI analysis into a marketplace-ready listing draft: title, description, item specifics, condition, photos, price and profit, shipping, export/copy for any marketplace, and (once configured) direct publishing to eBay.

Workflow: **Upload photo → Identify → Confirm → Analyze market → Create Listing → Review/edit → Copy or publish.**

## How it fits the existing app

The feature is self-contained and reuses existing systems instead of duplicating them.

| Need | Reused | New |
|---|---|---|
| Product identity | Confirmed `Identification`, field sources and match details from `IdentificationProvider` | Snapshot into the draft; **no second image analysis** |
| Category | `productProfile()` | `lib/listing/categories.ts` adds clothing/household splits and per-category required specifics |
| Price | `recommend()` output from the eBay/Mercari report (median, cohort, blockers) and `listingDisplayPrice()` | `lib/listing/pricing.ts` summarises it; quick-sale/patient = quartiles of the same qualifying cohort (≥5 asks) |
| Fees and profit | `sneakerProceeds()` (eBay athletic sneakers), `marketplaceProfitScenario()` | `listingProceeds()` wires them to the editor; other fees are user-entered, never assumed |
| UI | Existing tokens, buttons, panels | `app/listing.css`, `components/listing/*`, `/listings`, `/listings/[id]` |

The only change to the existing report is one **Create Listing** panel (`components/listing/create-listing-button.tsx`) under the marketplace comparison, plus a **Listings** link in the header.

### Files
- `lib/listing/types.ts`: draft model with per-field provenance
- `lib/listing/draft.ts`: deterministic draft creation from the confirmed analysis
- `lib/listing/claims.ts`: checks text against confirmed facts (authenticity, size, condition, packaging, specs, identifiers, functional claims, contact info)
- `lib/listing/template.ts`: fact-only title/description/condition builder (also the fallback when AI is unavailable)
- `lib/listing/readiness.ts`: what still needs to be supplied or confirmed per marketplace
- `lib/listing/apply.ts`: merges generated text (per field; preserves seller edits) and validates stored drafts
- `lib/listing/export.ts`: copy/export text per marketplace
- `lib/listing/generate-server.ts` + `app/api/listings/generate`: text-only AI writing with validation
- `lib/listing/drafts-store.ts`: IndexedDB draft + photo storage in the browser
- `lib/ebay-seller/*` + `app/api/ebay/seller/*`: seller OAuth, encrypted token store, Inventory API payloads, idempotent publishing

## Accuracy safeguards
- **Provenance on every specific:** *Confirmed by you*, *From identification* (visible in the photo or stated in notes), *AI-inferred* (must be confirmed), or *Missing*.
- **Required specifics per category.** Examples:
  - Sneakers: size and department.
  - Phones: storage and carrier/lock status.
  - Electronics: functional status.
  - Collectibles: set number and completeness.
  - Household: dimensions.

  The listing isn't "ready" until these are supplied, and any AI-inferred required value is confirmed.
- **Condition:** the AI's photo observation is shown for reference but never written into the listing. The seller chooses the grade, lists flaws (or confirms none are known) and confirms.
- **The AI sees only text facts:** confirmed and identified values plus the seller-approved identity (brand/model/product name). Other unconfirmed inferences, photos, prices and contact details are never sent.
- **AI output is checked against the facts.** Any field with an unsupported claim, or one that exceeds the marketplace limit, is replaced by the template version, with a visible warning. Tips mentioning numbers or prices are dropped.
- **Seller edits** that add claims show warnings (not blockers): sellers are responsible for their own wording.
- **Prices** are labeled as asking-price evidence, never sold prices.
  - Evidence from a different condition group can't price the listing (e.g. used-cohort asks can't price a new listing). The editor flags this and asks for a manual price.
  - With insufficient evidence there's no suggested price; the seller enters one.

## Drafts
Saved automatically to **IndexedDB in the browser**, including copies of the photos, so drafts survive reloads and can be reopened from **/listings**. Nothing about drafts is stored on the server. Drafts are per-browser and per-device; a durable cross-device store needs accounts and a database. If browser storage is blocked, the editor says drafts last for the tab only.

## AI configuration
Uses the existing `OPENAI_API_KEY`. Optional `OPENAI_LISTING_MODEL` (default: `OPENAI_VISION_MODEL`, then `gpt-4.1-mini`). One small text request per generate or regenerate. Without a key, generation still works using the template, and says so.

## eBay direct publishing

### What's implemented
- **Seller sign-in:** OAuth authorization-code grant with a random `state` stored in an httpOnly cookie and verified in constant time. The return path is restricted to `/listings/*`.
- **Tokens:** stored server-side only, encrypted with AES-256-GCM (`EBAY_SELLER_TOKEN_KEY`), keyed by a hash of an opaque httpOnly `SameSite=Lax` session cookie. The access token is refreshed automatically. Tokens never reach the browser or API responses.
- **Publish form:** policies, locations, category suggestions and category-required aspects come from eBay. Missing required aspects become extra fields.
- **Payloads:** an Inventory API `inventory_item` (condition enum mapping, aspects, package weight/size, HTML-escaped description, image URLs) and an `offer` (EBAY_US, FIXED_PRICE, quantity 1, policies, location, price).
- **Idempotent publishing:**
  - The SKU is derived from the draft ID.
  - The inventory item is PUT (replace).
  - The SKU's existing offer is reused or updated rather than duplicated, and an already-published offer is reported, not re-published.
  - Concurrent publishes of the same SKU are rejected (409).
  - A failure keeps the offer ID so retrying continues safely.
- **Guards:**
  - Same-origin required for POSTs.
  - An explicit confirmation dialog, plus `confirm: true` sent to the server.
  - Server-side readiness and eBay-specific validation.
  - Publishing disabled unless `EBAY_SELLER_PUBLISHING_ENABLED=true`.
  - Production vs sandbox clearly labeled.

### What's simulated vs live
All seller API behavior is tested against **mocked eBay responses** (`lib/ebay-seller.test.ts`). **No live eBay seller call has been made** from this codebase. Endpoint paths, scopes and enum values are centralised in `lib/ebay-seller/config.ts` and `payload.ts`. Re-check them against eBay's current documentation before enabling production; developer.ebay.com wasn't reachable from the environment where this was built.

### Setup (server, `.env.local`)
```dotenv
EBAY_CLIENT_ID=...          # existing keyset (same environment as below)
EBAY_CLIENT_SECRET=...
EBAY_ENVIRONMENT=sandbox    # start in sandbox; listings there are test data
EBAY_SELLER_RUNAME=...      # RuName from eBay Developer Portal > User Tokens
EBAY_SELLER_TOKEN_KEY=...   # 32 random bytes, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
EBAY_SELLER_PUBLISHING_ENABLED=false   # set true only when ready to publish
```

1. In the eBay Developer Portal, create the **RuName** (redirect settings) for the keyset. Set its *auth accepted URL* to `<your app origin>/api/ebay/seller/callback` and its declined URL to the same address. eBay generally expects an HTTPS URL, so local testing may need an HTTPS tunnel to port 3001.
2. Grant the keyset these scopes: `sell.inventory`, `sell.account.readonly` and the base `api_scope`.
3. In the seller account, opt in to **business policies** and create shipping, payment and return policies plus an **inventory location**. The publish form lists them.
4. Photos: eBay reads images from public HTTPS URLs. Draft photos live only in the browser, so paste hosted image URLs into the publish form. Direct upload through eBay's Media API is the next step and isn't implemented.
5. Restart the server, open a draft, choose **eBay**, then **Connect eBay seller account**.

Production use also requires that your eBay application and use case be approved for the Sell APIs, and compliance with eBay's listing policies.

## Other marketplaces
Mercari, Facebook Marketplace and others get **copy/export**: per-field copy buttons, "Copy everything" and a `.txt` download, with marketplace-specific title/description limits and condition hints. There is no automation or browser scripting of these sites.

## Tests
- `lib/listing-core.test.ts` (12): categories, provenance, readiness, claim audit, templates, evidence summary, condition fit, proceeds/fees, regeneration merge, draft validation, export.
- `lib/listing-generate.test.ts` (7): template fallback without a key, facts-only prompt, hallucination replacement, length limits, per-field regeneration, OpenAI failure fallback, input validation and origin checks. OpenAI responses are mocked.
- `lib/ebay-seller.test.ts` (12): configuration, authorize URL, token encryption, OAuth state verification and cookies, refresh, payload mapping, publish guards, single publish, concurrency, failure recovery, existing listings, setup. eBay responses are mocked.

Run: `npm test`, `npm run typecheck`, `npm run build`.

## Known limitations
- Drafts are browser-local; there are no accounts or server persistence.
- eBay photo upload (Media API), category-specific condition validation (Metadata API), variations/multi-quantity and listing revision/ending aren't implemented.
- Seller tokens and publish records use local files (`.seller-data/`, git-ignored), suitable for a single local server only.
- Fee rates other than eBay's athletic-sneaker profile are entered by the seller.
- Price evidence is active asking prices only, as in the rest of ResellAI.
