import type { ProductQuery, Comparable } from "./marketplaces";
export const FACEBOOK_PERMISSION_MESSAGE =
  "Facebook Marketplace requests are disabled: permitted collection, redistribution/photo display, caching and AI use have not been verified. A Social Fetch API key alone does not establish those rights.";
export type FacebookLocation = {
  label: string;
  lat: number;
  lng: number;
  radiusKm: number;
  condition: "" | "new" | "usedLikeNew" | "usedGood" | "usedFair";
};
export function parseFacebookLocation(value: unknown): FacebookLocation {
  if (!value || typeof value !== "object")
    throw new Error("Choose a search location and radius.");
  const v = value as Record<string, unknown>;
  if (
    typeof v.label !== "string" ||
    !v.label.trim() ||
    v.label.length > 120 ||
    typeof v.lat !== "number" ||
    !Number.isFinite(v.lat) ||
    v.lat < -90 ||
    v.lat > 90 ||
    typeof v.lng !== "number" ||
    !Number.isFinite(v.lng) ||
    v.lng < -180 ||
    v.lng > 180 ||
    typeof v.radiusKm !== "number" ||
    !Number.isFinite(v.radiusKm) ||
    v.radiusKm < 1 ||
    v.radiusKm > 250 ||
    !["", "new", "usedLikeNew", "usedGood", "usedFair"].includes(
      String(v.condition),
    )
  )
    throw new Error(
      "Use a valid location, radius from 1–250 km, and condition filter.",
    );
  return {
    label: v.label.trim(),
    lat: v.lat,
    lng: v.lng,
    radiusKm: v.radiusKm,
    condition: v.condition as FacebookLocation["condition"],
  };
}
export type FacebookComparable = Comparable & {
  photo: string | null;
  location: string;
  conditionEvidence: "filter" | "unknown";
};
export type FacebookResult = {
  provider: "facebook-social-fetch";
  status: "disabled" | "unavailable" | "available" | "no_matches";
  reason?: string;
  query: string;
  location: FacebookLocation;
  comparables: FacebookComparable[];
  examined: number;
  excluded: number;
  invalid: number;
  retrievedAt: string | null;
  expiresAt: string | null;
  cached: boolean;
  creditsCharged: number | null;
  originalCreditsCharged: number | null;
  requestId: string | null;
  warnings: string[];
  retryAfterSeconds?: number;
};
export type FacebookRequest = ProductQuery & {
  location: FacebookLocation;
  intentId: string;
  trigger: "confirmation" | "refresh";
};
export const FACEBOOK_CONDITIONS: Record<
  FacebookLocation["condition"],
  string
> = {
  "": "Not specified",
  new: "New",
  usedLikeNew: "Used — like new",
  usedGood: "Used — good",
  usedFair: "Used — fair",
};
