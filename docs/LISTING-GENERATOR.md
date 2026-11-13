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

Flow inside the draft editor: **Connect eBay → category & item specifics → shipping/payment/returns → photos → Review & publish** (one confirmation).

### What it does
- **Seller sign-in:** OAuth authorization-code grant with a random `state` stored in an httpOnly cookie and verified in constant time. The return path is restricted to `/listings/*`. The draft is saved before redirecting to eBay.
- **Tokens:** stored server-side only, encrypted with AES-256-GCM (`EBAY_SELLER_TOKEN_KEY`), keyed by a hash of an opaque httpOnly `SameSite=Lax` session cookie. Access tokens are refreshed automatically. Tokens never reach the browser, drafts or API responses.
- **Photos:** the selected draft photos are uploaded automatically when you publish (or with "Upload photos to eBay now") using the **Media API** `createImageFromFile`. The eBay-hosted URL comes back through `getImage`, so there's no URL copying. Images whose unused period has expired, or that were uploaded to the other environment, are uploaded again. Manual HTTPS URLs remain available as an advanced option.
- **Category:** suggested automatically from the title (Taxonomy `getCategorySuggestions`, default category tree looked up with `getDefaultCategoryTreeId`). The seller can pick another.
- **Item specifics:** the category's aspects come from `getItemAspectsForCategory`.
  - Confirmed listing values are placed under eBay's aspect names (e.g. size → "US Shoe Size").
  - Selection-only aspects only take eBay's allowed values.
  - Required aspects the listing can't supply are shown as fields to fill. Nothing is guessed.
- **Condition:** the category's allowed conditions come from the Metadata API `getItemConditionPolicies`. ResellAI preselects the matching one (e.g. used → "Pre-owned", 3000) using eBay's condition-ID table. Condition notes are omitted for new-type conditions, which eBay ignores.
- **Policies and location:** the seller's existing business policies and inventory locations are listed, and a single option is preselected. If none exist, the seller can create them inside ResellAI from explicit choices:
  - **Shipping:** a domestic service from Metadata `getShippingServices`, with flat or free cost and a handling time.
  - **Payment:** immediate payment.
  - **Returns:** 30 or 60 days, buyer or seller pays.
  - **Ship-from location:** city, state and ZIP only.
- **Title and description:** the listing generator's text. The description is converted to eBay-allowed markup (`<br>` only) and checked against the 4,000-character `product.description` limit. Titles stay at or under 80 characters.
- **Price:** the draft's price, which comes from ResellAI's pricing engine or the seller.
- **Publish:** `createOrReplaceInventoryItem` (with `Content-Language: en-US`), then reuse or create the offer, then `publishOffer`.
  - The server re-fetches the category's required aspects and allowed conditions before publishing; it doesn't trust the browser.
  - Idempotent: SKU derived from the draft ID, existing offers reused, already-published offers reported rather than re-published, and concurrent publishes of one SKU rejected (409).
  - A browser double-click guard as well.
- **Status:** after publishing, the panel shows the listing ID and link. "Check status" reads the offer's `listing.listingStatus`.
- **Guards on every request that changes something on eBay** (photo upload, policy/location creation, publish):
  - Same-origin required.
  - The seller must be connected.
  - `EBAY_SELLER_PUBLISHING_ENABLED=true` must be set.
  - An explicit `confirm: true` for policies, locations and publishing, plus the confirmation dialog.

### Verified against official eBay documentation
Downloaded from developer.ebay.com on 2026-11-13: the OpenAPI contracts for Sell Inventory v1, Sell Account v1, Commerce Media v1_beta, Commerce Taxonomy v1 and Sell Metadata v1, plus the "Item condition ID and name values" table.
- **Confirmed:** every path, method, required header, request field, response field, limit (title 80, description 4,000, condition description 1,000, 24 images, location key 36) and OAuth URL used here. The OAuth URLs come from the contracts' `securitySchemes`.
- **Not confirmed** (eBay's OAuth guide pages returned eBay error pages to this environment):
  - The sandbox host names: `auth.sandbox.ebay.com`, `api.sandbox.ebay.com` and especially the Media API host `apim.sandbox.ebay.com`. The contracts list production hosts only.
  - The sandbox item page domain.
  - That `redirect_uri` takes the RuName.

  All of these follow eBay's long-standing conventions and can be overridden (see below).

### What has and hasn't been run
- **Unit tests** (`lib/ebay-seller.test.ts`, `lib/ebay-publishing.test.ts`) run against a simulated eBay (`lib/test-support/fake-ebay.ts`).
- **A browser end-to-end run** went from photo to published listing against a local simulator (`scripts/mock-ebay-seller.mjs`): simulated sign-in, photo upload, category, specifics, condition, policy and location creation, one-confirmation publish, status, duplicate-replay protection, and desktop and phone layouts.
- **No live eBay call has been made,** in sandbox or production. Sandbox testing needs your sandbox keyset and a sandbox seller (test) user.

### What you need to set up (Sandbox)

**How sign-in works locally.** You use ResellAI at `http://localhost:3001`. eBay will only send the browser back to an HTTPS address, so an HTTPS tunnel (ngrok) to port 3001 receives eBay's callback. The callback immediately forwards the browser to `http://localhost:3001/api/ebay/seller/callback`. There the one-time state is checked against the httpOnly cookie set when you clicked Connect, and only then is the authorization code exchanged.
- Never open the app through the tunnel address. Drafts are stored per address, and the sign-in check only runs on `RESELLAI_APP_URL`.
- The tunnel is only for eBay's redirect.

1. **Sandbox keyset:** App ID and Cert ID from the Developer Portal → Application Keys → Sandbox.
2. **HTTPS tunnel:** run `ngrok http 3001`. A free static ngrok domain keeps the URL the same between runs.
3. **RuName** (Developer Portal → User Tokens (Sandbox) → "Get a Token from eBay via Your Application" → add an eBay Redirect URL, OAuth enabled):
   - Auth accepted URL: `https://<your-tunnel-domain>/api/ebay/seller/callback`
   - Auth declined URL: `https://<your-tunnel-domain>/api/ebay/seller/declined`
   - Privacy policy URL: any HTTPS page you control (required by the form)

   Copy the generated RuName string (e.g. `YourName-YourApp-SBX-…`), not a URL.
4. **Scopes:** `api_scope`, `sell.inventory`, `sell.account`. Sandbox keysets normally include them.
5. **Sandbox test seller user** (Developer Portal → Sandbox user). You'll sign in as this user.
6. **`.env.local`** (never committed):
   ```dotenv
   EBAY_SELLER_ENVIRONMENT=sandbox
   EBAY_SELLER_CLIENT_ID=...        # Sandbox App ID (or leave blank to use EBAY_CLIENT_ID)
   EBAY_SELLER_CLIENT_SECRET=...    # Sandbox Cert ID (or leave blank to use EBAY_CLIENT_SECRET)
   EBAY_SELLER_RUNAME=...
   EBAY_SELLER_TOKEN_KEY=...        # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   EBAY_SELLER_PUBLISHING_ENABLED=true
   RESELLAI_APP_URL=http://localhost:3001
   ```
   Keep your existing `EBAY_ENVIRONMENT` / `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` for price comparisons. Publishing ignores `EBAY_ENVIRONMENT` and stays in Sandbox unless `EBAY_SELLER_ENVIRONMENT=production`. Restart `npm run dev` after any change.
7. **Production** later requires eBay's approval of your application for the Sell APIs, a production keyset and RuName, and `EBAY_SELLER_ENVIRONMENT=production`.

**Sign-in outcomes shown in the editor:**
- **Connected.**
- **Declined:** nothing stored.
- **State mismatch:** expired, other tab, or wrong address. Nothing stored.
- **eBay errors** with plain-language help: `invalid_client` (App ID/Cert ID pair), `invalid_grant` (expired code or RuName mismatch), `invalid_scope`, and others.
- **Wrong address:** you opened the app somewhere other than `RESELLAI_APP_URL`.

"Test eBay connection" makes one read-only call (business policies) to prove the stored token works.

### Trying the whole flow without eBay (simulator)
1. Start the simulator:
   ```bash
   node scripts/mock-ebay-seller.mjs
   ```
2. In another terminal, start ResellAI pointed at it, with **fake** values only: `EBAY_SELLER_ENVIRONMENT=sandbox`, any values for `EBAY_SELLER_CLIENT_ID`/`EBAY_SELLER_CLIENT_SECRET`/`EBAY_SELLER_RUNAME`, a random `EBAY_SELLER_TOKEN_KEY`, `EBAY_SELLER_PUBLISHING_ENABLED=true` and the three `*_BASE` overrides set to `http://localhost:4010`.
3. The publish panel is labelled "Test endpoints · simulated", and nothing reaches eBay.

The overrides are ignored when `EBAY_SELLER_ENVIRONMENT=production`. To mimic the tunnel, start the simulator with `MOCK_EBAY_CALLBACK=http://127.0.0.1:3001/api/ebay/seller/callback` and `MOCK_EBAY_DECLINED=http://127.0.0.1:3001/api/ebay/seller/declined` while you browse at `http://localhost:3001`.

## Other marketplaces
Mercari, Facebook Marketplace and others get **copy/export**: per-field copy buttons, "Copy everything" and a `.txt` download, with marketplace-specific title/description limits and condition hints. There is no automation or browser scripting of these sites.

## Tests
- `lib/listing-core.test.ts` (12): categories, provenance, readiness, claim audit, templates, evidence summary, condition fit, proceeds/fees, regeneration merge, draft validation, export.
- `lib/listing-generate.test.ts` (7): template fallback without a key, facts-only prompt, hallucination replacement, length limits, per-field regeneration, OpenAI failure fallback, input validation and origin checks. OpenAI responses are mocked.
- `lib/ebay-seller.test.ts` (12): configuration, authorize URL, token encryption, OAuth state verification and cookies, refresh, payload mapping, publish guards, single publish, concurrency, failure recovery, existing listings, setup.
- `lib/ebay-oauth-tunnel.test.ts` (9): app URL validation, authorize request, tunnel-host forwarding (only OAuth params, no exchange), cookie-bound state (login CSRF), denial and eBay error codes, declined route, wrong-address guard, connection check, seller/pricing environment separation.
- `lib/ebay-publishing.test.ts` (13): scopes, endpoint overrides, Media API photo upload and its guards, hosted-image reuse/expiry, condition table and category-allowed conditions, aspect mapping (including selection-only), description markup and length, category rules, shipping services, policy and location creation, server-side rule re-check on publish, listing status. eBay responses are simulated.

Run: `npm test`, `npm run typecheck`, `npm run build`.

## Known limitations
- Drafts are browser-local; there are no accounts or server persistence.
- Variations, multi-quantity, auctions, and revising or ending live listings aren't implemented. Policy creation covers a single domestic flat-rate or free shipping service.
- Seller tokens and publish records use local files (`.seller-data/`, git-ignored), suitable for a single local server only.
- Fee rates other than eBay's athletic-sneaker profile are entered by the seller.
- Price evidence is active asking prices only, as in the rest of ResellAI.
