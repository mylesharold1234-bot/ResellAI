import { randomBytes, timingSafeEqual } from "node:crypto";
import { parseDraft } from "../listing/apply";
import { assessListing } from "../listing/readiness";
import { validateImageBytes } from "../images";
import { createSellerClient, EbaySellerError, type SellerClient } from "./client";
import { endpointsFor, listingUrl, missingSellerSettings, parseAppUrl, readSellerConfig, type SellerConfig } from "./config";
import { authorizeUrl, exchangeCode, refreshTokens, SellerAuthError } from "./oauth";
import { buildInventoryItem, buildOffer, ebayPublishIssues, skuForDraft } from "./payload";
import { locationBody, parseLocationInput, parsePolicyInput, policyBody } from "./policies";
import { publishListing, PublishBusyError } from "./publish";
import { createSellerStore, type SellerStore } from "./store";

export const SESSION_COOKIE = "resellai_seller";
export const STATE_COOKIE = "resellai_ebay_oauth";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function cookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k, v]) => k && v)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]),
  );
}

function cookie(name: string, value: string, request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const appOrigin = (c: SellerConfig) => parseAppUrl(c.appUrl);

/**
 * The host the browser actually used. Next.js builds request.url from the server's own hostname, so a request
 * arriving through a tunnel (ngrok sets Host and X-Forwarded-Host) would otherwise look like localhost.
 * Only used to decide whether to forward to RESELLAI_APP_URL, a fixed target, so a spoofed header gains nothing.
 */
function browserHost(request: Request) {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return (forwarded || request.headers.get("host") || new URL(request.url).host).toLowerCase();
}
const safeReturn = (p: string | undefined) => (p && /^\/listings(\/[A-Za-z0-9-]{1,64})?$/.test(p) ? p : "/listings");

export type SellerDeps = { config?: SellerConfig; fetcher?: typeof fetch; now?: () => number; store?: SellerStore };

/** Route handlers for seller sign-in and publishing. Tokens stay on the server; the browser only holds an opaque httpOnly session id. */
export function createSellerHandlers(deps: SellerDeps = {}) {
  const config = () => deps.config ?? readSellerConfig();
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;
  const store = (c: SellerConfig) => deps.store ?? (c.tokenKey ? createSellerStore(c.dataDir, c.tokenKey) : null);

  async function sellerToken(c: SellerConfig, s: SellerStore, session: string) {
    const tokens = await s.getTokens(session);
    if (!tokens || tokens.environment !== c.environment) return null;
    if (tokens.refreshExpiresAt <= now()) {
      await s.deleteTokens(session);
      return null;
    }
    if (tokens.accessExpiresAt - now() > 5 * 60_000) return tokens;
    const refreshed = await refreshTokens(c, tokens, fetcher, now());
    await s.saveTokens(session, refreshed);
    return refreshed;
  }

  async function connection(request: Request) {
    const c = config();
    const missing = missingSellerSettings(c);
    const s = store(c);
    const session = cookies(request)[SESSION_COOKIE];
    if (missing.length || !s) return { c, s: null, session: null, tokens: null, missing };
    const tokens = session ? await sellerToken(c, s, session).catch(() => null) : null;
    return { c, s, session: tokens ? session : null, tokens, missing };
  }

  const clientFor = (c: SellerConfig, s: SellerStore, session: string): SellerClient =>
    createSellerClient({
      endpoints: endpointsFor(c),
      accessToken: async () => {
        const t = await sellerToken(c, s, session);
        if (!t) throw new EbaySellerError("Your eBay connection expired. Reconnect your eBay account.", 401);
        return t.accessToken;
      },
      fetcher,
    });

  const failure = (e: unknown, fallback: string) =>
    json({ error: e instanceof EbaySellerError || e instanceof SellerAuthError ? e.message : fallback }, e instanceof EbaySellerError && e.status < 500 ? e.status : 502);

  /** Guards shared by every request that changes something in the seller's eBay account. */
  async function writeAccess(request: Request) {
    if (!sameOrigin(request)) return { ok: false as const, response: json({ error: "Open ResellAI directly." }, 403) };
    const { c, s, session, tokens, missing } = await connection(request);
    if (missing.length || !s) return { ok: false as const, response: json({ error: "eBay seller access isn't configured on this server.", missing }, 503) };
    if (!c.publishingEnabled)
      return { ok: false as const, response: json({ error: "Changes to eBay are turned off on this server. Set EBAY_SELLER_PUBLISHING_ENABLED=true after reviewing the setup guide." }, 503) };
    if (!tokens || !session) return { ok: false as const, response: json({ error: "Connect your eBay seller account first." }, 401) };
    return { ok: true as const, c, s, session, client: clientFor(c, s, session) };
  }

  const uploads = new Map<string, number[]>();

  function sameOrigin(request: Request) {
    // State-changing seller requests must come from this app. Browsers always send Origin on fetch POSTs.
    const origin = request.headers.get("origin");
    return !!origin && origin === new URL(request.url).origin;
  }

  return {
    async status(request: Request) {
      const { c, s, session, tokens, missing } = await connection(request);
      const body = {
        environment: c.environment,
        configured: missing.length === 0,
        missing,
        publishingEnabled: c.publishingEnabled,
        testEndpoints: endpointsFor(c).overridden,
        appUrl: appOrigin(c),
        connected: !!tokens,
        connectedAt: tokens?.connectedAt ?? null,
      };
      // ?check=1 makes one read-only call (business policies) to prove the stored token works on this environment.
      if (new URL(request.url).searchParams.get("check") !== "1" || !tokens || !s || !session) return json(body);
      try {
        const policies = await clientFor(c, s, session).policies();
        return json({ ...body, check: { ok: true, message: `eBay ${c.environment} accepted the connection (${policies.fulfillment.length} shipping, ${policies.payment.length} payment, ${policies.return.length} return policies found).` } });
      } catch (e) {
        return json({ ...body, check: { ok: false, message: e instanceof EbaySellerError || e instanceof SellerAuthError ? e.message : "eBay didn't answer the connection check." } });
      }
    },

    async connect(request: Request) {
      const c = config();
      const missing = missingSellerSettings(c);
      const back = safeReturn(new URL(request.url).searchParams.get("return") || undefined);
      if (missing.length) return Response.redirect(new URL(`${back}?ebay=not-configured`, request.url), 303);
      // The OAuth state cookie must live on the origin the callback forwards to (RESELLAI_APP_URL).
      if (browserHost(request) !== new URL(appOrigin(c)).host) return Response.redirect(new URL(`${back}?ebay=wrong-host`, `${request.headers.get("x-forwarded-proto") === "https" ? "https" : "http"}://${browserHost(request)}`), 303);
      const state = randomBytes(24).toString("hex");
      const session = cookies(request)[SESSION_COOKIE] || randomBytes(32).toString("hex");
      const headers = new Headers({ Location: authorizeUrl(c, state), "Cache-Control": "no-store" });
      headers.append("Set-Cookie", cookie(STATE_COOKIE, `${state}|${back}`, request, 600));
      headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, request, 60 * 60 * 24 * 30));
      return new Response(null, { status: 303, headers });
    },

    /**
     * eBay's "auth accepted" URL. Locally this is reached through an HTTPS tunnel whose host differs from the
     * app's. In that case the browser is forwarded, with only the OAuth parameters, to this same route on
     * RESELLAI_APP_URL, where the state cookie set at connect time is checked. Nothing is exchanged on the
     * tunnel host, and the forward target is fixed by configuration (no open redirect).
     */
    async callback(request: Request) {
      const url = new URL(request.url);
      const c = config();
      const app = appOrigin(c);
      if (browserHost(request) !== new URL(app).host) {
        const forward = new URL("/api/ebay/seller/callback", app);
        for (const k of ["state", "code", "error", "error_description"]) {
          const v = url.searchParams.get(k);
          if (v && v.length <= 2048) forward.searchParams.set(k, v);
        }
        return new Response(null, { status: 303, headers: { Location: forward.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
      }
      const s = store(c);
      const jar = cookies(request);
      const [expected, back] = (jar[STATE_COOKIE] || "").split("|");
      const target = (q: string, reason = "") => {
        const location = new URL(safeReturn(back), app);
        location.searchParams.set("ebay", q);
        if (reason) location.searchParams.set("reason", reason);
        const headers = new Headers({ Location: location.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
        headers.append("Set-Cookie", cookie(STATE_COOKIE, "", request, 0));
        return new Response(null, { status: 303, headers });
      };
      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state") || "";
      if (!expected || !state || !safeEqual(expected, state)) return target("state-mismatch");
      if (error) return error === "access_denied" ? target("declined") : target("failed", /^[a-z_]{1,40}$/.test(error) ? error : "");
      const code = url.searchParams.get("code");
      const session = jar[SESSION_COOKIE];
      if (!code || !session || !s || missingSellerSettings(c).length) return target("failed", code ? "" : "no_code");
      try {
        await s.saveTokens(session, await exchangeCode(c, code, fetcher, now()));
        return target("connected");
      } catch (e) {
        return target("failed", e instanceof SellerAuthError ? e.code : "");
      }
    },

    /** eBay's "auth declined" URL: the seller chose not to grant access. Forwards to the app and clears the state. */
    async declined(request: Request) {
      const c = config();
      const app = appOrigin(c);
      if (browserHost(request) !== new URL(app).host)
        return new Response(null, { status: 303, headers: { Location: new URL("/api/ebay/seller/declined", app).toString(), "Cache-Control": "no-store" } });
      const [, back] = (cookies(request)[STATE_COOKIE] || "").split("|");
      const location = new URL(safeReturn(back), app);
      location.searchParams.set("ebay", "declined");
      const headers = new Headers({ Location: location.toString(), "Cache-Control": "no-store" });
      headers.append("Set-Cookie", cookie(STATE_COOKIE, "", request, 0));
      return new Response(null, { status: 303, headers });
    },

    async disconnect(request: Request) {
      if (!sameOrigin(request)) return json({ error: "Open ResellAI directly." }, 403);
      const { s } = await connection(request);
      const session = cookies(request)[SESSION_COOKIE];
      if (s && session) await s.deleteTokens(session);
      return json({ connected: false });
    },

    /**
     * Read-only data for the publish form:
     * - no query: policies + locations
     * - ?q=: category suggestions
     * - ?categoryId=: the category's item specifics and allowed conditions
     * - ?shippingServices=1: domestic shipping services usable in a fulfillment policy
     */
    async setup(request: Request) {
      const { c, s, session, tokens, missing } = await connection(request);
      if (missing.length || !s) return json({ error: "eBay seller access isn't configured.", missing }, 503);
      if (!tokens || !session) return json({ error: "Connect your eBay seller account first." }, 401);
      const client = clientFor(c, s, session);
      const params = new URL(request.url).searchParams;
      try {
        const q = (params.get("q") || "").trim().slice(0, 100);
        const categoryId = (params.get("categoryId") || "").trim();
        if (q) return json({ categories: await client.categorySuggestions(q) });
        if (/^\d{1,10}$/.test(categoryId)) {
          const [aspects, conditions] = await Promise.all([client.categoryAspects(categoryId), client.conditionPolicy(categoryId)]);
          return json({ aspects, conditions: conditions.conditions, conditionRequired: conditions.required });
        }
        if (params.get("shippingServices") === "1") return json({ shippingServices: await client.shippingServices() });
        const [policies, locations] = await Promise.all([client.policies(), client.locations()]);
        return json({ policies, locations });
      } catch (e) {
        return failure(e, "Couldn't load eBay account settings.");
      }
    },

    /** Upload one draft photo to eBay Picture Services (Media API). Returns its eBay-hosted URL. */
    async uploadImage(request: Request) {
      const access = await writeAccess(request);
      if (!access.ok) return access.response;
      const recent = (uploads.get(access.session) || []).filter((t) => t > now() - 3_600_000);
      if (recent.length >= 120) return json({ error: "Photo upload limit reached for this hour. Try again later." }, 429);
      const limit = 10 * 1024 * 1024 + 64 * 1024;
      if (Number(request.headers.get("content-length")) > limit) return json({ error: "Each photo must be 10 MB or smaller." }, 413);
      if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return json({ error: "Send the photo as a file upload." }, 415);
      let form: FormData;
      try {
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length > limit) return json({ error: "Each photo must be 10 MB or smaller." }, 413);
        form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
      } catch {
        return json({ error: "The photo upload could not be read." }, 400);
      }
      const file = form.get("image");
      if (!(file instanceof File)) return json({ error: "Choose a photo." }, 400);
      try {
        validateImageBytes(file.type, new Uint8Array(await file.arrayBuffer()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Unsupported photo." }, 400);
      }
      uploads.set(access.session, [...recent, now()]);
      try {
        const image = await access.client.uploadImage(file, file.name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "photo.jpg");
        return json({ ...image, environment: access.c.environment });
      } catch (e) {
        return failure(e, "eBay couldn't accept this photo. Try again.");
      }
    },

    /** Create a business policy from the seller's explicit choices. */
    async createPolicy(request: Request) {
      const access = await writeAccess(request);
      if (!access.ok) return access.response;
      let input;
      try {
        const body = await request.json();
        if (body?.confirm !== true) return json({ error: "Creating a policy needs your confirmation." }, 400);
        input = parsePolicyInput(body);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Invalid policy." }, 400);
      }
      try {
        const id = await access.client.createPolicy(input.type, policyBody(input));
        return json({ type: input.type, id, name: policyBody(input).name });
      } catch (e) {
        return failure(e, "eBay couldn't create the policy.");
      }
    },

    /** Create a ship-from inventory location from the seller's address details. */
    async createLocation(request: Request) {
      const access = await writeAccess(request);
      if (!access.ok) return access.response;
      let input;
      try {
        const body = await request.json();
        if (body?.confirm !== true) return json({ error: "Adding a location needs your confirmation." }, 400);
        input = parseLocationInput(body);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Invalid location." }, 400);
      }
      const key = `resellai-${randomBytes(6).toString("hex")}`;
      try {
        await access.client.createLocation(key, locationBody(input));
        return json({ key, name: input.name });
      } catch (e) {
        return failure(e, "eBay couldn't add the location.");
      }
    },

    /** Current eBay status for a draft's SKU (read-only). */
    async listing(request: Request) {
      const { c, s, session, tokens, missing } = await connection(request);
      if (missing.length || !s) return json({ error: "eBay seller access isn't configured.", missing }, 503);
      if (!tokens || !session) return json({ error: "Connect your eBay seller account first." }, 401);
      const draftId = new URL(request.url).searchParams.get("draftId") || "";
      if (!/^[A-Za-z0-9-]{8,64}$/.test(draftId)) return json({ error: "Unknown draft." }, 400);
      const sku = skuForDraft(draftId);
      try {
        const offers = await clientFor(c, s, session).offersForSku(sku);
        const live = offers.find((o) => o.listingId) ?? offers[0];
        return json({
          sku,
          offerStatus: live?.status ?? null,
          listingId: live?.listingId ?? null,
          listingStatus: live?.listingStatus ?? null,
          soldQuantity: live?.soldQuantity ?? null,
          url: live?.listingId ? listingUrl(c.environment, live.listingId) : null,
          environment: c.environment,
        });
      } catch (e) {
        return failure(e, "Couldn't check the listing on eBay.");
      }
    },

    async publish(request: Request) {
      if (!request.headers.get("content-type")?.startsWith("application/json") && sameOrigin(request)) return json({ error: "Send the listing as JSON." }, 415);
      const access = await writeAccess(request);
      if (!access.ok) return access.response;
      const { c, s, session, client } = access;
      const text = await request.text();
      if (text.length > 160_000) return json({ error: "The listing is too large." }, 413);
      let body: { draft?: unknown; confirm?: unknown };
      let draft;
      try {
        body = JSON.parse(text);
        draft = parseDraft(body.draft);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Invalid listing." }, 400);
      }
      if (body.confirm !== true) return json({ error: "Publishing needs your explicit confirmation." }, 400);
      // Category rules come from eBay, not from the browser.
      let rules;
      try {
        const categoryId = draft.ebay.categoryId.trim();
        if (/^\d{1,10}$/.test(categoryId)) {
          const [aspects, conditions] = await Promise.all([client.categoryAspects(categoryId), client.conditionPolicy(categoryId)]);
          rules = { aspects, conditions: conditions.conditions, conditionRequired: conditions.required };
        }
      } catch (e) {
        return failure(e, "Couldn't check eBay's requirements for this category.");
      }
      const issues = ebayPublishIssues(draft, assessListing(draft, "ebay", now()), rules, { now: now() });
      if (issues.length) return json({ error: "This listing isn't ready for eBay.", issues }, 422);
      const sku = skuForDraft(draft.id);
      try {
        const outcome = await publishListing({ client, store: s, session, sku, item: buildInventoryItem(draft, rules?.aspects, now()), offer: buildOffer(draft), now: () => new Date(now()).toISOString() });
        return json({ ...outcome, environment: c.environment, url: outcome.record.listingId ? listingUrl(c.environment, outcome.record.listingId) : null });
      } catch (e) {
        if (e instanceof PublishBusyError) return json({ error: e.message }, 409);
        const record = (e as { record?: unknown }).record ?? null;
        const message = e instanceof EbaySellerError || e instanceof SellerAuthError ? e.message : "Publishing didn't finish. Retrying is safe: ResellAI reuses the same eBay offer and won't create a duplicate listing.";
        return json({ error: message, record, retryable: true }, 502);
      }
    },
  };
}
