import {
  FACEBOOK_PERMISSION_MESSAGE,
  FACEBOOK_CONDITIONS,
  type FacebookRequest,
  type FacebookResult,
  type FacebookComparable,
} from "../facebook";
import { buildEbayQuery, matchComparable } from "../product-matching";
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const safePhoto = (v: unknown) => {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["fbcdn.net", "fbsbx.com"].some(
        (d) => u.hostname === d || u.hostname.endsWith("." + d),
      )
      ? u.href
      : null;
  } catch {
    return null;
  }
};
export function normalizeFacebookResponse(
  body: unknown,
  request: FacebookRequest,
  observedAt: string,
) {
  if (
    !isObject(body) ||
    !isObject(body.data) ||
    !Array.isArray(body.data.listings) ||
    body.data.listings.length > 100 ||
    !isObject(body.meta) ||
    !Number.isInteger(body.meta.creditsCharged) ||
    (body.meta.creditsCharged as number) < 0 ||
    typeof body.meta.requestId !== "string"
  )
    throw new Error(
      "Social Fetch returned an invalid response. No prices were calculated.",
    );
  const comparables: FacebookComparable[] = [];
  let invalid = 0,
    excluded = 0;
  const seen = new Set<string>();
  for (const row of body.data.listings) {
    if (
      !isObject(row) ||
      typeof row.id !== "string" ||
      !row.id ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      row.title.length > 1000 ||
      !isObject(row.price) ||
      !isObject(row.status)
    ) {
      invalid++;
      continue;
    }
    let url: URL;
    try {
      url = new URL(String(row.url));
    } catch {
      invalid++;
      continue;
    }
    const amount = row.price.amount;
    const label = row.price.formattedAmount;
    // A bare '$' is ambiguous. Never assume USD from coordinates or a currency offset.
    const usd =
      typeof label === "string" &&
      (/\bUSD\b/i.test(label) || /US\s*\$/i.test(label));
    if (
      !usd ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 10000000 ||
      url.protocol !== "https:" ||
      !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/marketplace\/item\/\d+\/?$/.test(url.pathname) ||
      row.status.isSold !== false ||
      row.status.isLive !== true ||
      row.status.isPending !== false ||
      row.status.isHidden !== false ||
      seen.has(row.id)
    ) {
      invalid++;
      continue;
    }
    seen.add(row.id);
    const condition = request.location.condition;
    const conditionId = condition === "new" ? "1000" : condition ? "3000" : "";
    const loc = isObject(row.location) ? row.location : {};
    const location =
      typeof loc.displayName === "string"
        ? loc.displayName
        : [loc.city, loc.state].filter((x) => typeof x === "string").join(", ");
    const item: FacebookComparable = {
      id: row.id,
      title: row.title,
      price: Math.round(amount * 100) / 100,
      currency: "USD",
      status: "asking",
      condition: condition
        ? `${FACEBOOK_CONDITIONS[condition]} (search filter; not individually verified)`
        : "Not reported",
      conditionId,
      url: url.href,
      observedAt,
      shipping: null,
      seller: null,
      categories: [],
      matchReasons: [],
      warnings: [],
      photo: isObject(row.primaryPhoto)
        ? safePhoto(row.primaryPhoto.url)
        : null,
      location: String(location || "Location not reported").slice(0, 240),
      conditionEvidence: condition ? "filter" : "unknown",
    };
    const match = matchComparable(item, request);
    if (!match.matches) {
      excluded++;
      continue;
    }
    comparables.push({
      ...item,
      matchReasons: match.reasons,
      warnings: [
        ...match.warnings,
        ...(condition
          ? [
              "Condition is evidenced by the provider search filter, not a returned per-listing condition.",
            ]
          : []),
      ],
    });
  }
  return {
    comparables,
    examined: body.data.listings.length,
    excluded,
    invalid,
    creditsCharged: body.meta.creditsCharged as number,
    requestId: body.meta.requestId,
  };
}
export function createSocialFetchProvider({
  apiKey,
  permittedUseConfirmed = false,
  permissionReference = "",
  fetcher = fetch,
  now = Date.now,
}: {
  apiKey?: string;
  permittedUseConfirmed?: boolean;
  permissionReference?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const enabled = permittedUseConfirmed && !!permissionReference.trim();
  const cache = new Map<string, { expires: number; result: FacebookResult }>();
  const intents = new Map<
    string,
    { key: string; expires: number; result: Promise<FacebookResult> }
  >();
  const pending = new Map<string, Promise<FacebookResult>>();
  let calls: number[] = [];
  let cooldown = 0;
  return {
    enabled,
    async getEvidence(intentId: string) {
      const entry = intents.get(intentId);
      if (!entry || entry.expires <= now()) return null;
      const result = await entry.result;
      if (
        result.status !== "available" ||
        !result.expiresAt ||
        Date.parse(result.expiresAt) <= now()
      )
        return null;
      return { result, query: JSON.parse(entry.key) };
    },
    async search(request: FacebookRequest): Promise<FacebookResult> {
      const query = buildEbayQuery(request);
      const empty = (
        status: FacebookResult["status"],
        reason: string,
      ): FacebookResult => ({
        provider: "facebook-social-fetch",
        status,
        reason,
        query,
        location: request.location,
        comparables: [],
        examined: 0,
        excluded: 0,
        invalid: 0,
        retrievedAt: null,
        expiresAt: null,
        cached: false,
        creditsCharged: 0,
        originalCreditsCharged: null,
        requestId: null,
        warnings: [],
      });
      if (!enabled) return empty("disabled", FACEBOOK_PERMISSION_MESSAGE);
      if (!apiKey?.trim())
        return empty(
          "unavailable",
          "Add SOCIAL_FETCH_API_KEY to resellai/.env.local and restart the server.",
        );
      const key = JSON.stringify({
        identification: request.identification,
        details: request.details,
        location: request.location,
      });
      for (const [id, entry] of intents)
        if (entry.expires <= now()) intents.delete(id);
      const previous = intents.get(request.intentId);
      if (previous) {
        if (previous.key !== key)
          return empty(
            "unavailable",
            "This search action was already used for different details. Request an explicit update.",
          );
        return previous.result;
      }
      const saved = cache.get(key);
      if (saved && saved.expires > now()) {
        const value = Promise.resolve({
          ...saved.result,
          cached: true,
          creditsCharged: 0,
        });
        intents.set(request.intentId, {
          key,
          expires: now() + 86400000,
          result: value,
        });
        return value;
      }
      if (saved) cache.delete(key);
      if (pending.has(key)) {
        const value = pending.get(key)!;
        intents.set(request.intentId, {
          key,
          expires: now() + 86400000,
          result: value,
        });
        return value;
      }
      if (cooldown > now())
        return {
          ...empty(
            "unavailable",
            "Social Fetch cooldown is active. No automatic retry will be made.",
          ),
          retryAfterSeconds: Math.ceil((cooldown - now()) / 1000),
        };
      calls = calls.filter((t) => t > now() - 3600000);
      if (calls.length >= 5 || pending.size >= 1 || intents.size >= 100)
        return empty(
          "unavailable",
          "Local credit protection limit reached. No request was sent. Try later.",
        );
      calls.push(now());
      const job = (async () => {
        let sent = false;
        try {
          const params = new URLSearchParams({
            query,
            lat: String(request.location.lat),
            lng: String(request.location.lng),
            radiusKm: String(request.location.radiusKm),
            limit: "50",
            sortBy: "suggested",
            availability: "available",
            deliveryMethod: "localPickup",
          });
          if (request.location.condition)
            params.set("condition", request.location.condition);
          sent = true;
          const response = await fetcher(
            `https://api.socialfetch.dev/v1/facebook/marketplace/search?${params}`,
            {
              headers: { "x-api-key": apiKey, Accept: "application/json" },
              cache: "no-store",
              redirect: "error",
              signal: AbortSignal.timeout(25000),
            },
          );
          if (!response.ok) {
            if (response.status === 429) {
              const raw = response.headers.get("retry-after");
              const n =
                raw && /^\d+$/.test(raw)
                  ? Number(raw)
                  : raw
                    ? Math.ceil((Date.parse(raw) - now()) / 1000)
                    : 60;
              const wait = Number.isFinite(n)
                ? Math.max(1, Math.min(n, 86400))
                : 60;
              cooldown = now() + wait * 1000;
              return {
                ...empty(
                  "unavailable",
                  "Social Fetch rate limit reached. No automatic retry.",
                ),
                retryAfterSeconds: wait,
                creditsCharged: null,
              };
            }
            return {
              ...empty(
                "unavailable",
                response.status === 402
                  ? "Social Fetch credits are exhausted. No automatic retry or purchase was made."
                  : response.status === 401 || response.status === 403
                    ? "Social Fetch access was denied. Check the server key and account permissions."
                    : "Social Fetch could not complete this search. No automatic retry.",
              ),
              creditsCharged: null,
            };
          }
          const normalized = normalizeFacebookResponse(
            await response.json(),
            request,
            new Date(now()).toISOString(),
          );
          const result: FacebookResult = {
            ...empty(
              normalized.comparables.length ? "available" : "no_matches",
              "",
            ),
            ...normalized,
            reason: undefined,
            retrievedAt: new Date(now()).toISOString(),
            expiresAt: new Date(now() + 600000).toISOString(),
            creditsCharged: normalized.creditsCharged,
            originalCreditsCharged: normalized.creditsCharged,
            warnings: [
              "Active asking prices only; availability may change.",
              "One page of up to 50 listings. No automatic pagination or location-lookup calls.",
              "Only explicitly USD-denominated, live, non-hidden, non-pending, non-sold listings with safe source URLs are analyzed. Ambiguous currency, missing status flags and unverified requested details are excluded.",
              "Search radius is requested from Social Fetch; exact listing coordinates are not supplied for independent distance verification.",
            ],
          };
          if (cache.size >= 50) cache.delete(cache.keys().next().value!);
          cache.set(key, { expires: now() + 600000, result });
          return result;
        } catch {
          return {
            ...empty(
              "unavailable",
              "Social Fetch returned unreadable data or timed out. No automatic retry was made.",
            ),
            creditsCharged: sent ? null : 0,
          };
        } finally {
          pending.delete(key);
        }
      })();
      intents.set(request.intentId, {
        key,
        expires: now() + 86400000,
        result: job,
      });
      pending.set(key, job);
      return job;
    },
  };
}
