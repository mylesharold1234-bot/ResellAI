/**
 * eBay seller (Sell APIs) configuration. Server-only.
 *
 * Verified against eBay's official OpenAPI contracts (developer.ebay.com/api-docs/master/…/openapi/3,
 * downloaded 2026-11-13):
 * - OAuth authorizationUrl https://auth.ebay.com/oauth2/authorize and tokenUrl
 *   https://api.ebay.com/identity/v1/oauth2/token (securitySchemes of the Inventory, Account and Media contracts).
 * - Sell Inventory v1, Sell Account v1, Commerce Taxonomy v1 and Sell Metadata v1 on https://api.ebay.com.
 * - Commerce Media v1_beta on https://apim.ebay.com (also listed: api.ebay.com, apiz.ebay.com).
 * Sandbox hosts follow eBay's sandbox naming. They aren't listed in the contracts (which only name
 * production servers), and the sandbox Media host in particular is unverified; override them if eBay differs.
 */
export type EbayEnv = "production" | "sandbox";

export type Endpoints = { auth: string; api: string; media: string; overridden: boolean };

export const hosts: Record<EbayEnv, Omit<Endpoints, "overridden">> = {
  production: { auth: "https://auth.ebay.com", api: "https://api.ebay.com", media: "https://apim.ebay.com" },
  sandbox: { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com", media: "https://apim.sandbox.ebay.com" },
};

/**
 * Scopes requested at seller sign-in. sell.account (not .readonly) lets ResellAI create business policies
 * for sellers who have none; the keyset must be granted these scopes in the eBay Developer Portal.
 */
export const sellerScopes = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
];

export const MARKETPLACE_ID = "EBAY_US";

export type SellerConfig = {
  clientId: string;
  clientSecret: string;
  ruName: string;
  environment: EbayEnv;
  tokenKey: Buffer | null;
  publishingEnabled: boolean;
  dataDir: string;
  endpoints?: Endpoints;
  /**
   * Where the seller uses ResellAI (default http://localhost:3001). eBay returns the browser to the RuName's
   * HTTPS "accept" URL, which during local development is a tunnel (e.g. ngrok) to this same server. The
   * callback forwards the browser back here so the cookie-bound state check runs on the origin that set it.
   */
  appUrl?: string;
};

/** Validate RESELLAI_APP_URL: https anywhere, plain http only for localhost. Returns an origin. */
export function parseAppUrl(value: string | undefined) {
  const v = (value || "").trim() || "http://localhost:3001";
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) return u.origin;
  } catch {
    /* fall through */
  }
  return "http://localhost:3001";
}

/**
 * Optional base-URL overrides (EBAY_SELLER_AUTH_BASE, EBAY_SELLER_API_BASE, EBAY_MEDIA_API_BASE) exist for
 * pointing a sandbox setup at a local simulator. They're ignored in production, and plain http is
 * allowed only for localhost.
 */
function override(value: string | undefined, environment: EbayEnv) {
  const v = (value || "").trim().replace(/\/+$/, "");
  if (!v || environment === "production") return null;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) return u.origin;
  } catch {
    /* ignored */
  }
  return null;
}

export function endpointsFor(c: SellerConfig): Endpoints {
  return c.endpoints ?? { ...hosts[c.environment], overridden: false };
}

export function readSellerConfig(env: Record<string, string | undefined> = process.env): SellerConfig {
  const raw = (env.EBAY_SELLER_TOKEN_KEY || "").trim();
  let tokenKey: Buffer | null = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) tokenKey = Buffer.from(raw, "hex");
  else if (raw) {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) tokenKey = b;
  }
  // Seller publishing is configured separately from the Browse API used for price comparisons
  // (EBAY_ENVIRONMENT), so pricing can stay on production data while publishing is tested in Sandbox.
  // Publishing uses production only when explicitly set; everything else is Sandbox.
  const environment: EbayEnv = env.EBAY_SELLER_ENVIRONMENT === "production" ? "production" : "sandbox";
  const auth = override(env.EBAY_SELLER_AUTH_BASE, environment);
  const api = override(env.EBAY_SELLER_API_BASE, environment);
  const media = override(env.EBAY_MEDIA_API_BASE, environment);
  return {
    clientId: (env.EBAY_SELLER_CLIENT_ID || env.EBAY_CLIENT_ID || "").trim(),
    clientSecret: (env.EBAY_SELLER_CLIENT_SECRET || env.EBAY_CLIENT_SECRET || "").trim(),
    ruName: (env.EBAY_SELLER_RUNAME || "").trim(),
    environment,
    tokenKey,
    publishingEnabled: env.EBAY_SELLER_PUBLISHING_ENABLED === "true",
    dataDir: env.RESELLAI_SELLER_DATA_DIR || `${process.cwd()}/.seller-data`,
    appUrl: parseAppUrl(env.RESELLAI_APP_URL),
    endpoints: {
      auth: auth ?? hosts[environment].auth,
      api: api ?? hosts[environment].api,
      media: media ?? hosts[environment].media,
      overridden: !!(auth || api || media),
    },
  };
}

/** Names of settings still needed before seller sign-in can work. Never returns values. */
export function missingSellerSettings(c: SellerConfig) {
  return [
    !c.clientId && "EBAY_SELLER_CLIENT_ID (or EBAY_CLIENT_ID)",
    !c.clientSecret && "EBAY_SELLER_CLIENT_SECRET (or EBAY_CLIENT_SECRET)",
    !c.ruName && "EBAY_SELLER_RUNAME",
    !c.tokenKey && "EBAY_SELLER_TOKEN_KEY (32 random bytes, hex or base64)",
  ].filter(Boolean) as string[];
}

/** Public listing page for a published listing ID. The sandbox site domain is not confirmed by the contracts. */
export function listingUrl(environment: EbayEnv, listingId: string) {
  return `${environment === "sandbox" ? "https://sandbox.ebay.com" : "https://www.ebay.com"}/itm/${encodeURIComponent(listingId)}`;
}
