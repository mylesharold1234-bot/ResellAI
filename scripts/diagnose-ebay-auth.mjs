// Safe local diagnostics: never print credentials, headers, tokens, or raw provider bodies.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import nextEnv from "@next/env";
const names = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"];
const file = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const parsed = parseEnv(file);
const inherited = Object.fromEntries(names.map((k) => [k, process.env[k]]));
const { combinedEnv, loadedEnvFiles } = nextEnv.loadEnvConfig(
  process.cwd(),
  true,
  { info() {}, error() {} },
  true,
);
const flags = (v) => ({
  present: typeof v === "string" && v.length > 0,
  outerWhitespace: typeof v === "string" && v !== v.trim(),
  embeddedWhitespace: typeof v === "string" && /\s/.test(v.trim()),
  lineBreak: typeof v === "string" && /[\r\n]/.test(v),
  nonAscii: typeof v === "string" && /[^\x20-\x7e]/.test(v),
  literalQuotes: typeof v === "string" && /["']/.test(v),
  colon: typeof v === "string" && v.includes(":"),
});
const diagnostics = {
  envFiles: loadedEnvFiles.map((f) => f.path),
  credentials: Object.fromEntries(
    names.map((k) => [
      k,
      {
        ...flags(combinedEnv[k]),
        matchesSavedFile: combinedEnv[k] === parsed[k],
        inheritedOverridePresent:
          inherited[k] !== undefined && inherited[k] !== parsed[k],
        assignmentCount: file
          .split(/\r?\n/)
          .filter((line) =>
            new RegExp("^\\s*(?:export\\s+)?" + k + "\\s*=").test(line),
          ).length,
      },
    ]),
  ),
  configuredEnvironment:
    combinedEnv.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox",
  productionBrowseApproved: combinedEnv.EBAY_PRODUCTION_APPROVED === "true",
};
console.log(JSON.stringify(diagnostics));
if (process.argv.includes("--production-auth")) {
  const id = combinedEnv.EBAY_CLIENT_ID?.trim(),
    secret = combinedEnv.EBAY_CLIENT_SECRET?.trim();
  if (!id || !secret || /[\r\n]/.test(id + secret)) {
    console.log(
      JSON.stringify({
        authCheckSkipped: true,
        reason: "missing_or_multiline_credentials",
      }),
    );
    process.exit(0);
  }
  const endpoint = "https://api.ebay.com/identity/v1/oauth2/token";
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  }).toString();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(id + ":" + secret, "utf8").toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    const allowedErrors = [
      "invalid_client",
      "invalid_request",
      "invalid_scope",
      "unauthorized_client",
      "unsupported_grant_type",
    ];
    const knownDescriptions = [
      "client authentication failed",
      "client authentication failed.",
      "client authentication failed (e.g., unknown client, no client authentication included, or unsupported authentication method).",
    ];
    const description =
      typeof result.error_description === "string"
        ? result.error_description.toLowerCase()
        : "";
    console.log(
      JSON.stringify({
        endpoint,
        httpStatus: response.status,
        authenticated: response.ok && typeof result.access_token === "string",
        errorCode: allowedErrors.includes(result.error) ? result.error : null,
        description: knownDescriptions.includes(description)
          ? "Client authentication failed."
          : result.error_description
            ? "Provider description withheld; not a recognized safe message."
            : null,
        productionListingsRequested: false,
      }),
    );
  } catch {
    console.log(
      JSON.stringify({
        endpoint,
        authCheckFailed: true,
        reason: "network_timeout_or_invalid_response",
        productionListingsRequested: false,
      }),
    );
  }
}
