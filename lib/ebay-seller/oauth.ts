import { hosts, sellerScopes, type SellerConfig } from "./config";
import type { SellerTokens } from "./store";

export class SellerAuthError extends Error {}

export function authorizeUrl(c: SellerConfig, state: string) {
  const url = new URL("/oauth2/authorize", hosts[c.environment].auth);
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.ruName, // eBay uses the RuName, not a raw URL, as redirect_uri
    response_type: "code",
    scope: sellerScopes.join(" "),
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(c: SellerConfig, body: Record<string, string>, fetcher: typeof fetch) {
  const response = await fetcher(`${hosts[c.environment].api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  if (!response.ok) {
    // Never echo token responses; surface only eBay's error code.
    const code = typeof json.error === "string" ? ` (${json.error})` : "";
    throw new SellerAuthError(`eBay sign-in failed${code}.`);
  }
  if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") throw new SellerAuthError("eBay returned an unreadable sign-in response.");
  return json;
}

export async function exchangeCode(c: SellerConfig, code: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<SellerTokens> {
  const j = await tokenRequest(c, { grant_type: "authorization_code", code, redirect_uri: c.ruName }, fetcher);
  if (typeof j.refresh_token !== "string" || typeof j.refresh_token_expires_in !== "number") throw new SellerAuthError("eBay did not return a refresh token.");
  return {
    accessToken: j.access_token as string,
    accessExpiresAt: now + (j.expires_in as number) * 1000,
    refreshToken: j.refresh_token,
    refreshExpiresAt: now + j.refresh_token_expires_in * 1000,
    environment: c.environment,
    connectedAt: new Date(now).toISOString(),
  };
}

export async function refreshTokens(c: SellerConfig, tokens: SellerTokens, fetcher: typeof fetch = fetch, now = Date.now()): Promise<SellerTokens> {
  const j = await tokenRequest(c, { grant_type: "refresh_token", refresh_token: tokens.refreshToken, scope: sellerScopes.join(" ") }, fetcher);
  return { ...tokens, accessToken: j.access_token as string, accessExpiresAt: now + (j.expires_in as number) * 1000 };
}
