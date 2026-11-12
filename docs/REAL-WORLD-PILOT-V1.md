# Real-World Pilot V1

Run these commands from the ResellAI folder. The CLI is development-only: it adds no web route, changes no pricing logic, and does not read or write production daily snapshots. Use local, access-controlled storage. Git ignores everything under evaluation/private/.

## 1. Create and verify ten product records

    npm run pilot -- init pilot-01

Open evaluation/private/pilot-01/labels.json. Populate exactly ten real product cases using the schema in [Real-World Validation V1](REAL-WORLD-VALIDATION-V1.md#manifest-format). Record verified identity, brand and colorway (in accepted), model, condition, category, and size and sizing system where applicable. Write the comparable criteria and accepted aliases before seeing model results. Add a private photo reference and independent evidence reference to each case. Do not fill labels from AI output, example products, or listing guesses. Labels are frozen on first collection; start a separate pilot if the protocol changes.

## 2. Record identification and marketplace evidence

**Manual import is the default.** If your provider permissions allow retaining responses for this evaluation, use an authorized export of the original pre-filter listing responses. Put those responses and the actual pre-correction identification response in a capture manifest using the collection guide's format. Start from evaluation/captures.template.json, update datasetId to match labels.json, and use the same product IDs. Record failed attempts explicitly. Never substitute the results table or daily snapshots for pre-filter responses.

    npm run pilot -- import pilot-01 <path-to-authorized-captures.json> --authorized <approval-reference>

Replace placeholders with your actual file and a short, nonsecret approval reference (letters, digits, underscores or hyphens). The reference records your authorization basis; it does not grant permission. If you cannot verify rights to retain the response, skip that provider's capture. Do not scrape or copy restricted data to get around this requirement.

**Optional live capture, only for the provider whose search, retention and replay permissions you have verified:** use the app's existing environment variables and production approval. Run one product and marketplace at a time:

    npm run pilot -- identify pilot-01 <product-id> <path-to-one-photo.jpg>
    npm run pilot -- collect pilot-01 <product-id> ebay --authorized <approval-reference>
    npm run pilot -- collect pilot-01 <product-id> mercari --authorized <approval-reference>

Repeat for the ten products. Skip identify if you already imported the actual identification attempt. Identify uses the existing OpenAI handler once per product (normal usage charges apply). It stores only its structured output, no photo bytes or photo path in the capture. Collect uses that output and any actually recorded refinement inputs, never gold labels, to run the existing provider adapter. The pilot permits up to five Mercari search attempts per rolling hour and twenty per day, and the usual bounded eBay query plan with an additional local pilot budget. Mercari may use one existing API.SH credit per search. No automatic retries or new services. Do not run a live pilot in parallel with other heavy use of those provider accounts. The local pilot budget is not a provider-wide quota.

The capture file preserves authorized pre-filter row order and the fields needed for replay. It drops descriptions, listing images, raw metadata, headers, and tracking query strings; it redacts contact-like text and hashes seller IDs with a private per-pilot salt. Sensitive original exports still need separate protection. Do not share captures, salt, review files, or reports without checking permissions and minimizing data. The pilot refuses to overwrite recorded identification or marketplace attempts; preserve failures and use another explicitly planned run for a repeat.

## 3. Have a human review the listings

    npm run pilot -- review pilot-01

Give the independent reviewer only evaluation/private/pilot-01/review.json and authorized product evidence. The worksheet contains listing ID, title, condition, source link where valid, and the verified product criteria. It does not show the model prediction, asking prices, eligibility, match tier, or price recommendations. For every group, enter a reviewer ID, then mark each listing relevant, irrelevant, or uncertain with a reason and evidence reference. Review a listing in its authorized source if the title is insufficient. Collect all intended captures before generating the worksheet. If you need to regenerate an unfinished worksheet, move it aside first; the command never overwrites it.

    npm run pilot -- merge pilot-01

The merge rejects unreviewed rows, invalid verdicts, duplicate or unknown IDs, and missing evidence. It creates labels.reviewed.json and keeps the original product labels intact. A worksheet drawn from returned listings measures within-capture recall only. To measure independent-pool recall, include a separately collected, independently adjudicated pool in the original labels and set its pool type to independent before freezing. Sale references are optional and must meet the validation guide's authorization and verification rules.

## 4. Replay and generate the report

    npm run validate:real -- evaluation/private/pilot-01/labels.reviewed.json evaluation/private/pilot-01/captures.json evaluation/private/pilot-01/report

Open report/report.md for identification accuracy, match precision and recall, marketplace coverage, and failure analysis. report/report.json contains per-listing decisions and reproducibility hashes. A ten-product run is a pilot below the full 50–100 product target; it is useful for finding recurring errors but does not establish market-wide accuracy. No real pilot results ship with this workflow.

If a command was interrupted and leaves evaluation/private/.pilot.lock, verify no pilot process is running before removing that specific stale lock. Then resume from the saved captures.

Provider references: [eBay API License Agreement](https://www.developer.ebay.com/join/api-license-agreement) · [API.SH Terms](https://api.sh/legal/terms) · [API.SH Mercari search](https://api.sh/docs/mercari-search).
