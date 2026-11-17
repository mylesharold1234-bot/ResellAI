import type { Comparable } from "./marketplaces";

/** Listings first posted within this many days count as the recent market. */
export const RECENT_DAYS = 365;
const DAY = 86_400_000;
// eBay launched in September 1995; anything earlier is not a real listing date.
const EARLIEST = Date.parse("1995-09-01T00:00:00Z");

/** A date string a marketplace gave us, if it is a real, past timestamp. */
export function reliableDate(value: unknown, observedAt: string | number): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const t = Date.parse(value);
  const seen = typeof observedAt === "number" ? observedAt : Date.parse(observedAt);
  if (!Number.isFinite(t) || !Number.isFinite(seen) || t < EARLIEST || t > seen + DAY) return null;
  return new Date(t).toISOString();
}

export type ListingAge =
  | { kind: "recent"; days: number }
  | { kind: "older"; days: number }
  | { kind: "unknown"; reason: "no date" | "unreliable date" | "relist date only" };

/**
 * How long a listing had been up when we saw it. Only the original listing date can show a listing is
 * recent. A later date (e.g. eBay's date for a relisted copy) is a lower bound: it can prove a listing is
 * old, but never that it is recent. Missing or impossible dates are never treated as recent.
 */
export function listingAge(item: Pick<Comparable, "listedAt" | "listedAtSource" | "observedAt">): ListingAge {
  if (!item.listedAt) return { kind: "unknown", reason: "no date" };
  const listed = reliableDate(item.listedAt, item.observedAt);
  if (!listed) return { kind: "unknown", reason: "unreliable date" };
  const days = Math.floor((Date.parse(item.observedAt) - Date.parse(listed)) / DAY);
  if (days < 0) return { kind: "unknown", reason: "unreliable date" };
  if (days > RECENT_DAYS) return { kind: "older", days };
  if (item.listedAtSource === "ebay-current-listing") return { kind: "unknown", reason: "relist date only" };
  return { kind: "recent", days: Math.max(0, days) };
}

/** "Listed 3 days ago", "Listed 4 months ago", "Listed 3 years ago". */
export function listedAgoLabel(age: ListingAge): string {
  if (age.kind === "unknown") return "Listing date unknown";
  const d = age.days;
  const prefix = "Listed ";
  if (d < 1) return prefix + "today";
  if (d < 14) return `${prefix}${d} day${d === 1 ? "" : "s"} ago`;
  if (d < 60) return `${prefix}${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${prefix}${Math.round(d / 30)} months ago`;
  const y = d / 365;
  return `${prefix}${y < 2 ? "over a year" : `${Math.floor(y)} years`} ago`;
}
