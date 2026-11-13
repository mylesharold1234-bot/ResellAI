import { randomBytes, timingSafeEqual } from "node:crypto";
import { parseDraft } from "../listing/apply";
import { assessListing } from "../listing/readiness";
import { createSellerClient, EbaySellerError } from "./client";
import { missingSellerSettings, readSellerConfig, type SellerConfig } from "./config";
import { authorizeUrl, exchangeCode, refreshTokens, SellerAuthError } from "./oauth";
import { buildInventoryItem, buildOffer, ebayPublishIssues, skuForDraft } from "./payload";
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

  function sameOrigin(request: Request) {
    // State-changing seller requests must come from this app. Browsers always send Origin on fetch POSTs.
    const origin = request.headers.get("origin");
    return !!origin && origin === new URL(request.url).origin;
  }

  return {
    async status(request: Request) {
      const { c, tokens, missing } = await connection(request);
      return json({
        environment: c.environment,
        configured: missing.length === 0,
        missing,
        publishingEnabled: c.publishingEnabled,
        connected: !!tokens,
        connectedAt: tokens?.connectedAt ?? null,
      });
    },

    async connect(request: Request) {
      const c = config();
      const missing = missingSellerSettings(c);
      const back = safeReturn(new URL(request.url).searchParams.get("return") || undefined);
      if (missing.length) return Response.redirect(new URL(`${back}?ebay=not-configured`, request.url), 303);
      const state = randomBytes(24).toString("hex");
      const session = cookies(request)[SESSION_COOKIE] || randomBytes(32).toString("hex");
      const headers = new Headers({ Location: authorizeUrl(c, state), "Cache-Control": "no-store" });
      headers.append("Set-Cookie", cookie(STATE_COOKIE, `${state}|${back}`, request, 600));
      headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, request, 60 * 60 * 24 * 30));
      return new Response(null, { status: 303, headers });
    },

    async callback(request: Request) {
      const url = new URL(request.url);
      const c = config();
      const s = store(c);
      const jar = cookies(request);
      const [expected, back] = (jar[STATE_COOKIE] || "").split("|");
      const target = (q: string) => {
        const headers = new Headers({ Location: new URL(`${safeReturn(back)}?ebay=${q}`, request.url).toString(), "Cache-Control": "no-store" });
        headers.append("Set-Cookie", cookie(STATE_COOKIE, "", request, 0));
        return new Response(null, { status: 303, headers });
      };
      const state = url.searchParams.get("state") || "";
      if (!expected || !state || !safeEqual(expected, state)) return target("state-mismatch");
      if (url.searchParams.get("error")) return target("declined");
      const code = url.searchParams.get("code");
      const session = jar[SESSION_COOKIE];
      if (!code || !session || !s || missingSellerSettings(c).length) return target("failed");
      try {
        await s.saveTokens(session, await exchangeCode(c, code, fetcher, now()));
        return target("connected");
      } catch {
        return target("failed");
      }
    },

    async disconnect(request: Request) {
      if (!sameOrigin(request)) return json({ error: "Open ResellAI directly." }, 403);
      const { s } = await connection(request);
      const session = cookies(request)[SESSION_COOKIE];
      if (s && session) await s.deleteTokens(session);
      return json({ connected: false });
    },

    /** Seller policies, locations, category suggestions and required aspects for the publish form. Read-only. */
    async setup(request: Request) {
      const { c, tokens, missing } = await connection(request);
      if (missing.length) return json({ error: "eBay seller access isn't configured.", missing }, 503);
      if (!tokens) return json({ error: "Connect your eBay seller account first." }, 401);
      const client = createSellerClient({ environment: c.environment, accessToken: async () => tokens.accessToken, fetcher });
      const params = new URL(request.url).searchParams;
      try {
        const q = (params.get("q") || "").trim().slice(0, 100);
        const categoryId = (params.get("categoryId") || "").trim();
        if (q) return json({ categories: await client.categorySuggestions(q) });
        if (/^\d{1,10}$/.test(categoryId)) return json({ requiredAspects: await client.requiredAspects(categoryId) });
        const [policies, locations] = await Promise.all([client.policies(), client.locations()]);
        return json({ policies, locations });
      } catch (e) {
        return json({ error: e instanceof EbaySellerError ? e.message : "Couldn't load eBay account settings." }, e instanceof EbaySellerError && e.status < 500 ? e.status : 502);
      }
    },

    async publish(request: Request) {
      if (!sameOrigin(request)) return json({ error: "Open ResellAI directly to publish." }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Send the listing as JSON." }, 415);
      const { c, s, session, tokens, missing } = await connection(request);
      if (missing.length || !s) return json({ error: "eBay seller access isn't configured on this server.", missing }, 503);
      if (!c.publishingEnabled) return json({ error: "Publishing is turned off. Set EBAY_SELLER_PUBLISHING_ENABLED=true on the server after reviewing the setup guide." }, 503);
      if (!tokens || !session) return json({ error: "Connect your eBay seller account first." }, 401);
      const text = await request.text();
      if (text.length > 120_000) return json({ error: "The listing is too large." }, 413);
      let body: { draft?: unknown; confirm?: unknown; requiredAspects?: unknown };
      let draft;
      try {
        body = JSON.parse(text);
        draft = parseDraft(body.draft);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Invalid listing." }, 400);
      }
      if (body.confirm !== true) return json({ error: "Publishing needs your explicit confirmation." }, 400);
      const required = Array.isArray(body.requiredAspects) ? body.requiredAspects.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
      const issues = ebayPublishIssues(draft, assessListing(draft, "ebay", now()), required);
      if (issues.length) return json({ error: "This listing isn't ready for eBay.", issues }, 422);
      const client = createSellerClient({ environment: c.environment, accessToken: async () => (await sellerToken(c, s, session))?.accessToken ?? "", fetcher });
      const sku = skuForDraft(draft.id);
      try {
        const outcome = await publishListing({ client, store: s, session, sku, item: buildInventoryItem(draft), offer: buildOffer(draft), now: () => new Date(now()).toISOString() });
        return json({ ...outcome, environment: c.environment });
      } catch (e) {
        if (e instanceof PublishBusyError) return json({ error: e.message }, 409);
        const record = (e as { record?: unknown }).record ?? null;
        const message = e instanceof EbaySellerError || e instanceof SellerAuthError ? e.message : "Publishing didn't finish. Retrying is safe: ResellAI reuses the same eBay offer and won't create a duplicate listing.";
        return json({ error: message, record, retryable: true }, 502);
      }
    },
  };
}
