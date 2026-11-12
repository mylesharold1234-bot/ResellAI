# Daily marketplace pricing

The report uses one saved pricing recommendation per product and marketplace. A first search or an explicit refresh saves evidence and calculations; the same normalized product reuses the latest successful version for the rest of the Eastern calendar day, including after a server restart. Failed refreshes leave the previous snapshot intact. Each card displays the update time and version. The next UTC day starts a new series.

Storage defaults to .marketplace-snapshots in the ResellAI project. To persist across deployments, set RESELLAI_SNAPSHOT_DIR to a durable private volume. This filesystem store assumes one local server process; use coordinated shared storage before deploying multiple workers. No API credentials are written. The algorithm version in lib/daily-snapshots.ts must change when matching or recommendation rules change.

The key includes marketplace, normalized model (including known silhouette), brand, colorway, size and sizing system, condition or its relevant visible cue, verified identifier, requested variant and other matching attributes. Volatile model caveats and display copy are excluded except where low confidence or unresolved conflicts change the result.

The calculation uses active item asks before shipping, tax, or seller fees. Qualifying listings come from one condition cohort. If a broad sample fails dispersion or seller safeguards, a group with stronger model/color evidence can qualify on its own. Price sorting uses listing IDs to break ties. The price shown is the saved statistical recommendation, rounded to a nearby .99 only within $0.25 and within the same comparable range; otherwise it stays unchanged. The exact cohort range, size, and evidence quality appear on each card.

The previous cache lasted minutes and keyed whole identification objects, so differences in AI wording and changing relevance-ranked result pages could lead to different recommendations. The new snapshot pins the first usable same-day calculation without merging eBay and Mercari or paginating. Manual refresh bypasses the short application cache and requests fresh Mercari source data per https://api.sh/docs#caching.
