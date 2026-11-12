# eBay comparable pipeline diagnosis

Verified 2026-10-19 with actual Production Browse requests. No credentials or tokens are logged or stored in the audit.

The original user-reported 57-row response was not retained, so its exact row-by-row exclusions cannot be reconstructed. A fresh first-100 search was captured and examined, followed by a complete corrected-provider Production test.

Root causes found in code and public response fields:
- Every itemGroupType/itemGroupHref listing was previously rejected before product matching. Actual Browse results include valid seller-defined variation records with prices and URLs. These now remain visible with an explicit variation warning and are excluded from pricing statistics pending selection verification.
- Used-condition matching omitted 2990 (Pre-owned - Excellent) and 3010. These map to used. Numeric condition IDs normalize to strings. Condition groups still must match when explicitly selected.
- Literal model-token matching required Air and did not recognize AJ1. Jordan 1, Air Jordan 1 and AJ1 now canonicalize for matching without broadening other models or accepting low/high silhouettes.
- Missing seller identifiers were already nullable, not the cause of rejection. Regression tests preserve this and prevent missing sellers from satisfying seller-diversity thresholds.
- Named colors Starfish, Sail and Infrared normalize for conflict detection. Missing optional filters remain unrestricted and generate warnings, rather than hidden exact-match requirements.

Final end-to-end Production test: 100 returned, 100 structurally valid, 21 retained; 77 colorway mismatches and 2 brand/model mismatches. Twenty listings were eligible for descriptive asking statistics; one unresolved variation was display-only. All 21 retained listings had valid eBay item URLs, positive USD prices and match evidence. Counts change as live listings change. No confident recommendation was generated because the broad test supplied no size, condition or exact identifier. No sold-price evidence was requested or inferred.

The dashboard now shows grouped exclusions and expandable per-row reasons, distinguishes zero returned results from zero matching results and provider errors, displays low-count comparables, and shows per-listing uncertainty. Descriptive statistics may mix unspecified sizes/conditions and are labeled accordingly. Shoe recommendations additionally require a confirmed exact product identifier to avoid merging different releases with the same visible colors. Existing minimum sample, seller diversity, condition, size, price spread, production and identification-confidence gates remain.

Validation: 67 automated tests passed; TypeScript check passed; optimized Next.js build passed after rerunning outside the sandbox filesystem restriction. Added coverage for aliases, condition grades/numeric IDs, missing sellers, duplicate records, variation price exclusion, small samples and complete row accounting. Existing cache/coalescing, rate-limit, OAuth, API error and permission tests pass unchanged.

Run the explicit live diagnostic from the resellai directory with `npx tsx scripts/diagnose-ebay-comparables.ts`. It makes one search through the existing guarded, rate-limited provider and writes a credential-free public-listing audit to the OS temporary directory. It is a diagnostic command, never run automatically on refresh.
