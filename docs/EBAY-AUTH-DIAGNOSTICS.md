# eBay Production OAuth diagnostic result — October 19, 2026

## Sanitized live result

The direct Production token request returned:

- HTTP 401
- OAuth code: `invalid_client`
- Recognized/sanitized description: `Client authentication failed.`
- Production listings requested: no.

This is a rejection of the client credentials at token creation, before Browse authorization. It is not a sold-data access error, and does not establish whether the application has Browse production approval. The provider's generic error does not identify which credential/account condition caused rejection. Do not claim a more precise upstream cause without eBay's evidence.

## Checks completed without displaying credentials

Both App ID and Cert ID are present in the saved `.env.local`. Node's built-in environment parser and Next.js load the same strings. Each has one assignment. Neither contains outer whitespace, embedded whitespace, CR/LF, non-ASCII characters, literal quote characters or a colon. No inherited process variable overrides the saved value. Blank lines are valid and were not removed.

The actual request matched eBay's documented client-credentials flow:

- `POST https://api.ebay.com/identity/v1/oauth2/token`
- `Authorization: Basic BASE64(client_id:client_secret)` with UTF-8 input, one colon separator, and no added newline.
- `Content-Type: application/x-www-form-urlencoded`
- URL-encoded `grant_type=client_credentials`
- Scope `https://api.ebay.com/oauth/api_scope`
- Redirects disabled; raw response bodies and tokens are not printed or persisted.

## Issues fixed

The application was still configured for sandbox despite the owner specifying a Production keyset. `.env.local` now sets `EBAY_ENVIRONMENT=production`. Credential strings, blank-line layout and permission settings were preserved. The existing `EBAY_PRODUCTION_APPROVED` guard remains false; no authorization was assumed or bypassed. The wrong environment explains which endpoint the application previously selected, but does NOT explain away the separately observed 401 from the correct Production endpoint.

The adapter now normalizes only outer credential whitespace and rejects embedded whitespace/non-ASCII/control characters before any request. Existing saved credentials did not have these defects; this is defensive validation, not a claimed cause of the observed failure.

OAuth token 401 errors are now distinguished from Browse token errors. Only the allowlisted `invalid_client` code is surfaced; provider descriptions, credential values and authorization headers are never exposed by the adapter.

## Safe diagnostic command

From the `resellai` directory:

```powershell
node scripts/diagnose-ebay-auth.mjs
```

This prints metadata/booleans only. It uses Next.js environment precedence to detect stale/inherited overrides.

To make ONE explicit Production authentication check, without any listing retrieval:

```powershell
node scripts/diagnose-ebay-auth.mjs --production-auth
```

This creates an application token if authentication succeeds, but does not print, save or use it for Browse. It never dumps raw provider messages. Treat the output as configuration/authentication diagnostics, not API-permission confirmation. Do not repeatedly retry unchanged credentials.

## Next action

The local investigation has not established eBay's undisclosed underlying reason for invalid_client. In the eBay Developer portal, verify that the Production application keyset is active and try the portal's own Application access token generation for that keyset. If portal generation also fails, ask eBay Developer Support to inspect the keyset/account and the 401 invalid_client response. Share the endpoint, UTC request time from your own reproduction and sanitized code, not the credentials.

Credentials were visible in the owner's screenshot. Rotate the exposed secrets in their provider dashboards, update the saved file, and retry only after saving the new pair. No keys were copied from the screenshot into code or logs.

## Files and verification

- `.env.local`: Production environment setting only; not tracked.
- `lib/marketplace-providers/ebay.ts`: normalization, invalid-character guard and phase-specific sanitized errors.
- `lib/marketplace.test.ts`: three new mocked OAuth regression tests.
- `scripts/diagnose-ebay-auth.mjs`: reusable metadata-only diagnostics and opt-in single OAuth check.
- This report.

All 61 tests and the TypeScript check pass. No design, OpenAI identification, Facebook integration or other marketplace logic was replaced. The development server was restarted on port 3001.

Official request-format reference: https://developer.ebay.com/develop/guides/sell/authorization

Preview note: restarting encountered an EBUSY lock on a generated Next.js development manifest. The stopped process's `.next/dev` directory was moved to a verified sibling recovery directory under `.next`, and the preview restarted with a fresh generated cache. Its startup succeeded, but the dashboard's cold compilation did not finish within the HTTP verification timeout. This does not alter the separately verified Production OAuth 401 result. No unrelated application source was changed.
