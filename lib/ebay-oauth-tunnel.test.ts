import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { parseAppUrl, readSellerConfig, type SellerConfig } from "./ebay-seller/config";
import { createSellerStore } from "./ebay-seller/store";
import { createSellerHandlers, SESSION_COOKIE, STATE_COOKIE } from "./ebay-seller/handlers";
import { fakeEbay } from "./test-support/fake-ebay";

// Simulates the local Windows setup: app at http://localhost:3001, eBay's RuName accept URL on an HTTPS tunnel.
// eBay itself is simulated (fakeEbay); no live calls.
const key = randomBytes(32);
const NOW = Date.parse("2026-11-13T12:00:00Z");
const TUNNEL = "https://quiet-otter-42.ngrok-free.app";
const config = (o: Partial<SellerConfig> = {}): SellerConfig => ({ clientId: "id", clientSecret: "secret", ruName: "Seller-ResellAI-SBX-abc", environment: "sandbox", tokenKey: key, publishingEnabled: true, dataDir: mkdtempSync(join(tmpdir(), "resellai-oauth-")), appUrl: "http://localhost:3001", ...o });

async function startConnect(h: ReturnType<typeof createSellerHandlers>) {
  const res = await h.connect(new Request("http://localhost:3001/api/ebay/seller/connect?return=/listings/abc-123"));
  const set = res.headers.getSetCookie();
  const stateCookie = decodeURIComponent(set.find((x) => x.startsWith(STATE_COOKIE))!.split(";")[0].split("=")[1]);
  const session = set.find((x) => x.startsWith(SESSION_COOKIE))!.split(";")[0].split("=")[1];
  return { res, state: stateCookie.split("|")[0], jar: `${STATE_COOKIE}=${encodeURIComponent(stateCookie)}; ${SESSION_COOKIE}=${session}`, session };
}

test("RESELLAI_APP_URL accepts https or localhost http only", () => {
  assert.equal(parseAppUrl(undefined), "http://localhost:3001");
  assert.equal(parseAppUrl("http://localhost:3001/listings"), "http://localhost:3001");
  assert.equal(parseAppUrl("https://resell.example.com"), "https://resell.example.com");
  assert.equal(parseAppUrl("http://evil.example"), "http://localhost:3001");
  assert.equal(readSellerConfig({ RESELLAI_APP_URL: "http://127.0.0.1:3001" }).appUrl, "http://127.0.0.1:3001");
});

test("authorization request uses the RuName, seller scopes and a fresh random state each time", async () => {
  const h = createSellerHandlers({ config: config(), fetcher: fakeEbay().fetcher, now: () => NOW });
  const a = await startConnect(h);
  const b = await startConnect(h);
  const url = new URL(a.res.headers.get("location")!);
  assert.equal(url.origin + url.pathname, "https://auth.sandbox.ebay.com/oauth2/authorize");
  assert.equal(url.searchParams.get("redirect_uri"), "Seller-ResellAI-SBX-abc");
  assert.equal(url.searchParams.get("client_id"), "id");
  assert.deepEqual(url.searchParams.get("scope")!.split(" "), ["https://api.ebay.com/oauth/api_scope", "https://api.ebay.com/oauth/api_scope/sell.inventory", "https://api.ebay.com/oauth/api_scope/sell.account"]);
  assert.equal(url.searchParams.get("state"), a.state);
  assert.notEqual(a.state, b.state);
  assert.ok(!/Secure/.test(a.res.headers.getSetCookie()[0]), "no Secure flag on plain-http localhost (the browser would drop the cookie)");
});

test("callback on the tunnel host forwards only OAuth parameters to the app and exchanges nothing", async () => {
  const fake = fakeEbay();
  const h = createSellerHandlers({ config: config(), fetcher: fake.fetcher, now: () => NOW });
  // Next.js reports request.url on its own hostname; the tunnel is only visible in Host / X-Forwarded-Host.
  const res = await h.callback(new Request(`http://localhost:3001/api/ebay/seller/callback?state=s1&code=good-code&expires_in=299&evil=https://x`, { headers: { host: "localhost:3001", "x-forwarded-host": new URL(TUNNEL).host } }));
  assert.equal(res.status, 303);
  const to = new URL(res.headers.get("location")!);
  assert.equal(to.origin + to.pathname, "http://localhost:3001/api/ebay/seller/callback");
  assert.deepEqual([...to.searchParams.keys()].sort(), ["code", "state"]);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(fake.calls.length, 0, "no token exchange on the tunnel host");
});

test("the forwarded callback connects only when the state matches the cookie set at connect", async () => {
  const c = config();
  const fake = fakeEbay();
  const h = createSellerHandlers({ config: c, fetcher: fake.fetcher, now: () => NOW });
  const { state, jar, session } = await startConnect(h);
  const forged = await h.callback(new Request(`http://localhost:3001/api/ebay/seller/callback?state=${"0".repeat(48)}&code=good-code`, { headers: { cookie: jar } }));
  assert.match(forged.headers.get("location")!, /ebay=state-mismatch/);
  const noCookie = await h.callback(new Request(`http://localhost:3001/api/ebay/seller/callback?state=${state}&code=good-code`));
  assert.match(noCookie.headers.get("location")!, /ebay=state-mismatch/, "a callback completed in another browser can't attach tokens (login CSRF)");
  assert.equal(fake.calls.filter((x) => x.path === "/identity/v1/oauth2/token").length, 0);
  const ok = await h.callback(new Request(`http://localhost:3001/api/ebay/seller/callback?state=${state}&code=good-code`, { headers: { cookie: jar } }));
  assert.equal(ok.headers.get("location"), "http://localhost:3001/listings/abc-123?ebay=connected");
  assert.match(ok.headers.getSetCookie()[0], new RegExp(`^${STATE_COOKIE}=; .*Max-Age=0`), "state cookie cleared (one-time use)");
  const exchange = fake.calls.find((x) => x.path === "/identity/v1/oauth2/token")!;
  assert.equal(new URLSearchParams(String(exchange.body)).get("redirect_uri"), "Seller-ResellAI-SBX-abc");
  assert.equal(new URLSearchParams(String(exchange.body)).get("grant_type"), "authorization_code");
  assert.equal((await createSellerStore(c.dataDir, key).getTokens(session))?.accessToken, "user-access");
});

test("denial and eBay errors return to the draft with an explanation and store nothing", async () => {
  const c = config();
  const h = createSellerHandlers({ config: c, fetcher: fakeEbay().fetcher, now: () => NOW });
  const run = async (query: string) => {
    const { state, jar, session } = await startConnect(h);
    const r = await h.callback(new Request(`http://localhost:3001/api/ebay/seller/callback?state=${state}&${query}`, { headers: { cookie: jar } }));
    return { location: r.headers.get("location")!, tokens: await createSellerStore(c.dataDir, key).getTokens(session) };
  };
  const denied = await run("error=access_denied&error_description=User+declined");
  assert.equal(denied.location, "http://localhost:3001/listings/abc-123?ebay=declined");
  assert.equal(denied.tokens, null);
  assert.equal((await run("error=invalid_scope")).location, "http://localhost:3001/listings/abc-123?ebay=failed&reason=invalid_scope");
  assert.equal((await run("error=<script>")).location, "http://localhost:3001/listings/abc-123?ebay=failed");
  assert.equal((await run("code=expired-code")).location, "http://localhost:3001/listings/abc-123?ebay=failed&reason=invalid_grant", "eBay's token error code surfaced");
  assert.equal((await run("")).location, "http://localhost:3001/listings/abc-123?ebay=failed&reason=no_code");
});

test("the declined URL forwards from the tunnel and clears the pending state", async () => {
  const h = createSellerHandlers({ config: config(), fetcher: fakeEbay().fetcher, now: () => NOW });
  const hop = await h.declined(new Request(`http://localhost:3001/api/ebay/seller/declined`, { headers: { host: new URL(TUNNEL).host } }));
  assert.equal(hop.headers.get("location"), "http://localhost:3001/api/ebay/seller/declined");
  const { jar } = await startConnect(h);
  const back = await h.declined(new Request("http://localhost:3001/api/ebay/seller/declined", { headers: { cookie: jar } }));
  assert.equal(back.headers.get("location"), "http://localhost:3001/listings/abc-123?ebay=declined");
  assert.match(back.headers.getSetCookie()[0], /Max-Age=0/);
});

test("connecting from a different address than RESELLAI_APP_URL is refused with guidance", async () => {
  const h = createSellerHandlers({ config: config(), fetcher: fakeEbay().fetcher, now: () => NOW });
  const r = await h.connect(new Request("http://localhost:3001/api/ebay/seller/connect?return=/listings/abc-123", { headers: { host: "127.0.0.1:3001" } }));
  assert.equal(r.headers.get("location"), "http://127.0.0.1:3001/listings/abc-123?ebay=wrong-host");
  assert.equal(r.headers.getSetCookie().length, 0);
});

test("the connection check makes one read-only call and reports eBay's answer", async () => {
  const c = config();
  const store = createSellerStore(c.dataDir, key);
  const session = "c".repeat(64);
  await store.saveTokens(session, { accessToken: "user-access", accessExpiresAt: NOW + 3_600_000, refreshToken: "r", refreshExpiresAt: NOW + 86_400_000, environment: "sandbox", connectedAt: "x" });
  const fake = fakeEbay();
  const h = createSellerHandlers({ config: c, fetcher: fake.fetcher, now: () => NOW, store });
  const req = new Request("http://localhost:3001/api/ebay/seller/status?check=1", { headers: { cookie: `${SESSION_COOKIE}=${session}` } });
  const s = await (await h.status(req)).json();
  assert.equal(s.check.ok, true);
  assert.match(s.check.message, /sandbox accepted the connection \(1 shipping/);
  assert.ok(fake.calls.every((x) => x.method === "GET"), "read-only");
  const bad = createSellerHandlers({ config: c, fetcher: (async () => Response.json({ errors: [{ errorId: 20403, message: "User is not eligible for Business Policy." }] }, { status: 400 })) as unknown as typeof fetch, now: () => NOW, store });
  const b = await (await bad.status(req)).json();
  assert.equal(b.check.ok, false);
  assert.match(b.check.message, /not eligible for Business Policy/);
});

test("seller publishing defaults to Sandbox and has its own keyset, independent of pricing's EBAY_ENVIRONMENT", () => {
  const pricingOnProduction = readSellerConfig({ EBAY_ENVIRONMENT: "production", EBAY_CLIENT_ID: "browse-prod", EBAY_CLIENT_SECRET: "browse-secret", EBAY_SELLER_CLIENT_ID: "sbx-id", EBAY_SELLER_CLIENT_SECRET: "sbx-secret" });
  assert.equal(pricingOnProduction.environment, "sandbox", "EBAY_ENVIRONMENT=production never switches publishing to production");
  assert.equal(pricingOnProduction.clientId, "sbx-id");
  assert.equal(pricingOnProduction.clientSecret, "sbx-secret");
  assert.equal(pricingOnProduction.endpoints?.auth, "https://auth.sandbox.ebay.com");
  const shared = readSellerConfig({ EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "sbx-shared", EBAY_CLIENT_SECRET: "s" });
  assert.equal(shared.clientId, "sbx-shared", "falls back to EBAY_CLIENT_ID");
  assert.equal(readSellerConfig({ EBAY_SELLER_ENVIRONMENT: "production" }).environment, "production", "production only when explicitly requested");
});
