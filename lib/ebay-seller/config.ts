/**
 * eBay seller (Sell APIs) configuration. Server-only.
 *
 * Endpoints follow eBay's documented OAuth authorization-code grant and Sell Inventory / Account /
 * Taxonomy REST APIs. They are centralised here so they can be checked against current eBay
 * documentation in one place. They have been exercised only against mocked responses in this
 * repository; no live seller call has been made.
 */
export type EbayEnv = "production" | "sandbox";

export const hosts: Record<EbayEnv, { auth: string; api: string }> = {
  production: { auth: "https://auth.ebay.com", api: "https://api.ebay.com" },
  sandbox: { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" },
};

export const sellerScopes = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
];

export const MARKETPLACE_ID = "EBAY_US";
export const CATEGORY_TREE_ID = "0"; // eBay US category tree

export type SellerConfig = {
  clientId: string;
  clientSecret: string;
  ruName: string;
  environment: EbayEnv;
  tokenKey: Buffer | null;
  publishingEnabled: boolean;
  dataDir: string;
};

export function readSellerConfig(env: Record<string, string | undefined> = process.env): SellerConfig {
  const raw = (env.EBAY_SELLER_TOKEN_KEY || "").trim();
  let tokenKey: Buffer | null = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) tokenKey = Buffer.from(raw, "hex");
  else if (raw) {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) tokenKey = b;
  }
  return {
    clientId: (env.EBAY_CLIENT_ID || "").trim(),
    clientSecret: (env.EBAY_CLIENT_SECRET || "").trim(),
    ruName: (env.EBAY_SELLER_RUNAME || "").trim(),
    environment: env.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox",
    tokenKey,
    publishingEnabled: env.EBAY_SELLER_PUBLISHING_ENABLED === "true",
    dataDir: env.RESELLAI_SELLER_DATA_DIR || `${process.cwd()}/.seller-data`,
  };
}

/** Names of settings still needed before seller sign-in can work. Never returns values. */
export function missingSellerSettings(c: SellerConfig) {
  return [
    !c.clientId && "EBAY_CLIENT_ID",
    !c.clientSecret && "EBAY_CLIENT_SECRET",
    !c.ruName && "EBAY_SELLER_RUNAME",
    !c.tokenKey && "EBAY_SELLER_TOKEN_KEY (32 random bytes, hex or base64)",
  ].filter(Boolean) as string[];
}
