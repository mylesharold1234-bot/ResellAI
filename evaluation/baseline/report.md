# ResellAI Real-World Validation V1

Dataset: resellai-real-world-v1 (real) · 0 independently labeled slots · 0 recorded cases.
**No real-world results yet.** Collect independently labeled products and authorized pre-filter captures.
Collection target: 50–100 independently labeled real products.

| Identification field | Correct | Incorrect | Missing | Evaluated | Accuracy |
|---|---:|---:|---:|---:|---:|
| brand | 0 | 0 | 0 | 0 | — |
| model | 0 | 0 | 0 | 0 | — |
| productName | 0 | 0 | 0 | 0 | — |
| category | 0 | 0 | 0 | 0 | — |
| colorway | 0 | 0 | 0 | 0 | — |
| visibleCondition | 0 | 0 | 0 | 0 | — |
| identifyingInformation | 0 | 0 | 0 | 0 | — |

| Marketplace | Captures / products | Recommendations | Coverage | Match precision | Judged matches | Within-capture recall | Independent-pool recall | Cohort precision | Sold-reference MAE (n) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ebay | 0 / 0 | 0 | — | — | — | — | — | — | — (0) |
| mercari | 0 / 0 | 0 | — | — | — | — | — | — | — (0) |

Coverage includes recorded provider errors. Unrecorded cases are shown separately. Precision excludes unjudged and uncertain listings; check the judgment coverage column. Recall is relative to the reviewed pool, not to all marketplace inventory. A dash means not measurable.

## Failure analysis

- **ebay:** no recorded failures.
- **mercari:** no recorded failures.

| Product | Category | Identification issues | Marketplace | Result | Eligible | Observed ask recommendation | Findings |
|---|---|---|---|---|---:|---:|---|

The JSON report includes per-listing decisions, false positives, missed relevant items, pricing-cohort membership and signed/absolute percentage error. Sales error is evaluated only against at least three eligible, independently verified, authorized, same-marketplace item-only USD sales in the preceding 90 days. Asking prices are never used as sale references.

Engine source fingerprint: 583de3a1a94f7e306c46a12cce4b79e8e9b8b1e314871fba2475f8f67cb9cbc9

