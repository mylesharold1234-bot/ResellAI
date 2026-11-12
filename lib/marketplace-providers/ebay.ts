import {retrievalDiagnostics,sufficientSearchEvidence} from "../retrieval-diagnostics";
import {completeComparable,scoreComparable} from "../comparable-quality";
import type {
  Comparable,
  MarketplaceProvider,
  MarketplaceResult,
  ProductQuery,
} from "../marketplaces";
import { searchPlan, searchCacheKey, tierComparable } from "../ebay-search";
export class EbayError extends Error {
  constructor(
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function money(value: unknown): number | null {
  if (
    !object(value) ||
    value.currency !== "USD" ||
    typeof value.value !== "string" ||
    !/^\d{1,9}(?:\.\d{1,4})?$/.test(value.value)
  )
    return null;
  const n = Number(value.value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
export function normalizeEbaySearch(
  body: unknown,
  environment: "production" | "sandbox",
  observedAt: string,
) {
  if (
    !object(body) ||
    body.errors ||
    (body.itemSummaries !== undefined && !Array.isArray(body.itemSummaries)) ||
    (!Array.isArray(body.itemSummaries) && body.total !== 0)
  )
    throw new EbayError(
      "eBay returned an unreadable listing response. No valuation was calculated.",
    );
  const rows = (body.itemSummaries || []) as unknown[];
  if (rows.length > 200)
    throw new EbayError("eBay returned an unexpected number of listings.");
  const result: Comparable[] = [];
  let invalid = 0;
  const exclusions: Record<string, number> = {};
  const diagnostics: { id: string; title: string; stage: string; reason: string }[] = [];
  function reject(row: unknown, reason: string) {
    invalid++; exclusions[reason] = (exclusions[reason] || 0) + 1;
    diagnostics.push({id: object(row) ? String(row.itemId || "unknown") : "unknown", title: object(row) ? String(row.title || "") : "", stage: "normalization", reason});
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (!object(row)) {
      reject(row, "malformed_row");
      continue;
    }
    const price = money(row.price);
    const conditionId = typeof row.conditionId === "number" && Number.isSafeInteger(row.conditionId) ? String(row.conditionId) : row.conditionId;
    let url: URL;
    try {
      url = new URL(String(row.itemWebUrl));
    } catch {
      reject(row, "invalid_url");
      continue;
    }
    const allowed =
      environment === "production"
        ? ["www.ebay.com", "ebay.com"]
        : ["www.sandbox.ebay.com", "sandbox.ebay.com"];
    if (
      typeof row.itemId !== "string" ||
      row.itemId.length > 200 ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      row.title.length > 500 ||
      price === null ||
      price <= 0 ||
      url.protocol !== "https:" ||
      !allowed.includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith("/itm/") ||
      !Array.isArray(row.buyingOptions) ||
      !row.buyingOptions.includes("FIXED_PRICE")
    ) {
      reject(row, price === null || price <= 0 ? "invalid_or_non_usd_price" : !Array.isArray(row.buyingOptions) || !row.buyingOptions.includes("FIXED_PRICE") ? "unsupported_buying_option" : typeof row.condition !== "string" || typeof conditionId !== "string" ? "missing_condition" : "invalid_identity_or_url");
      continue;
    }
    if (
      row.itemEndDate &&
      (typeof row.itemEndDate !== "string" ||
        !Number.isFinite(Date.parse(row.itemEndDate)) ||
        Date.parse(row.itemEndDate) <= Date.parse(observedAt))
    ) {
      reject(row, "ended_or_invalid_end_date");
      continue;
    }
    if (seen.has(row.itemId)) {
      const prior=result.find(item=>item.id===row.itemId);
      if(prior&&(prior.price!==price||(typeof conditionId==="string"&&prior.conditionId!==conditionId)))prior.warnings.push("Conflicting duplicate listing");
      reject(row, "duplicate_item");
      continue;
    }
    seen.add(row.itemId);
    const options = Array.isArray(row.shippingOptions)
      ? row.shippingOptions
      : [];
    const shipping =
      options.length && object(options[0])
        ? money(options[0].shippingCost)
        : null;
    const seller =
      object(row.seller) && typeof row.seller.username === "string"
        ? row.seller.username.slice(0, 200)
        : null;
    const categories = Array.isArray(row.categories)
      ? row.categories
          .filter(object)
          .map((c) => String(c.categoryName || ""))
          .filter(Boolean)
      : [];
    result.push({
      id: row.itemId,
      title: row.title.trim(),
      price,
      currency: "USD",
      status: "asking",
      condition: typeof row.condition === "string" ? row.condition.slice(0, 200) : "Not specified",
      conditionId: typeof conditionId === "string" ? conditionId : "",
      url: url.href,
      observedAt,
      shipping,
      seller,
      categories,
      matchReasons: [],
      warnings: [
        ...(typeof conditionId !== "string" || typeof row.condition !== "string" ? ["Condition unavailable; cannot verify condition match"] : []),
        ...(row.itemGroupType || row.itemGroupHref ? ["Variation selection unverified; excluded from pricing statistics"] : []),
        ...(!seller ? ["Seller identifier unavailable"] : []),
      ],
    });
  }
  return {
    exclusions, diagnostics,
    items: result,
    invalid,
    examined: rows.length,
    warnings:
      Array.isArray(body.warnings) && body.warnings.length
        ? ["eBay reported search warnings; this is a limited sample."]
        : [],
  };
}
export function createEbayProvider({
  clientId,
  clientSecret,
  environment = "sandbox",
  productionApproved = false,
  fetcher = fetch,
  now = Date.now,
}: {
  clientId?: string;
  clientSecret?: string;
  environment?: "production" | "sandbox";
  productionApproved?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
}): MarketplaceProvider {
  clientId = clientId?.trim();
  clientSecret = clientSecret?.trim();
  const base =
    environment === "production"
      ? "https://api.ebay.com"
      : "https://api.sandbox.ebay.com";
  const cache = new Map<
    string,
    { expires: number; value: MarketplaceResult }
  >();
  const pending = new Map<string, Promise<MarketplaceResult>>();
  let token: { value: string; expires: number } | null = null;
  let tokenPending: Promise<string> | null = null;
  let cooldownUntil = 0;
  let requests: number[] = [];
  let active = 0;
  const failure = (
    query: string,
    reason: string,
    retryAfterSeconds?: number,
  ): MarketplaceResult => ({
    provider: "ebay",
    status: "unavailable",
    environment,
    query,
    reason,
    comparables: [],
    retrievedAt: null,
    expiresAt: null,
    cached: false,
    examined: 0,
    excluded: 0,
    invalid: 0,
    warnings: [],
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
  });
  async function upstream(url: string, init: RequestInit) {
    const response = await fetcher(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      const seconds =
        header && /^\d+$/.test(header)
          ? Number(header)
          : header
            ? Math.ceil((Date.parse(header) - now()) / 1000)
            : 60;
      const wait = Number.isFinite(seconds)
        ? Math.max(1, Math.min(seconds, 86400))
        : 60;
      cooldownUntil = now() + wait * 1000;
      throw new EbayError(
        "eBay rate limit reached. Wait before retrying.",
        wait,
      );
    }
    if (response.status === 401) {
      token = null;
      if (url.endsWith("/identity/v1/oauth2/token")) {
        let code = "";
        try {
          const problem: unknown = await response.json();
          if (object(problem) && problem.error === "invalid_client")
            code = " (invalid_client)";
        } catch {
          /* Never log raw OAuth errors or credentials. */
        }
        throw new EbayError(
          `eBay ${environment} OAuth client authentication failed${code}. The configured App ID/Cert ID pair was rejected; no Browse request was made.`,
        );
      }
      throw new EbayError(
        "eBay Browse authorization failed. The application token was rejected; check token scope and API access.",
      );
    }
    if (response.status === 403)
      throw new EbayError(
        "eBay denied access. Confirm production Browse API permission for this application and use case.",
      );
    if (!response.ok)
      throw new EbayError(
        "eBay is unavailable or rejected the search. No valuation was calculated.",
      );
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new EbayError(
        "eBay returned unreadable data. Please try again later.",
      );
    }
  }
  async function accessToken(): Promise<string> {
    if (token && token.expires > now() + 60000) return token.value;
    if (tokenPending) return tokenPending;
    tokenPending = (async () => {
      const body = await upstream(`${base}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "https://api.ebay.com/oauth/api_scope",
        }).toString(),
      });
      if (
        !object(body) ||
        typeof body.access_token !== "string" ||
        !body.access_token ||
        typeof body.expires_in !== "number" ||
        body.expires_in <= 60 ||
        body.expires_in > 86400
      )
        throw new EbayError("eBay returned an invalid authorization response.");
      token = {
        value: body.access_token,
        expires: now() + body.expires_in * 1000,
      };
      return token.value;
    })();
    try {
      return await tokenPending;
    } finally {
      tokenPending = null;
    }
  }
  return {
    id: "ebay",
    async search(query: ProductQuery, {refresh=false}={}) {
      const plan = searchPlan(query);
      const text = plan[0]?.query || "";
      if(!text)return failure("", "Product search terms are too long. Confirm a concise product model before searching.");
      if (
        (clientId && /\s|[^ -~]/.test(clientId)) ||
        (clientSecret && /\s|[^ -~]/.test(clientSecret))
      )
        return failure(
          text,
          "eBay credentials contain embedded whitespace or non-ASCII/control characters. Copy each credential as one uninterrupted value.",
        );
      if (!clientId?.trim() || !clientSecret?.trim())
        return failure(
          text,
          "eBay is not configured. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to resellai/.env.local, then restart the server.",
        );
      if (environment === "production" && !productionApproved)
        return failure(
          text,
          "Production access is not enabled. Obtain eBay approval for this use case before setting EBAY_PRODUCTION_APPROVED=true.",
        );
      const key = searchCacheKey(query);
      const saved = cache.get(key);
      if (!refresh && saved && saved.expires > now() && saved.value.retrievedAt?.slice(0,10)===new Date(now()).toISOString().slice(0,10))
        return { ...saved.value, cached: true };
      if (saved) cache.delete(key);
      if (pending.has(key)) return pending.get(key)!;
      if (cooldownUntil > now())
        return failure(
          text,
          "eBay rate limit cooldown is active.",
          Math.ceil((cooldownUntil - now()) / 1000),
        );
      requests = requests.filter((t) => t > now() - 3600000);
      if (active >= 2 || requests.length >= 100)
        return failure(
          text,
          "Local marketplace request limit reached. Try again later.",
          60,
        );
      active++;

      const job = (async () => {
        try {
          const started=now();
          const authorization = await accessToken();
          const stamp = new Date(now()).toISOString();
          const comparables: Comparable[] = [];
          const attempts: NonNullable<MarketplaceResult['searchDiagnostics']>['attempts'] = [];
          const rowDiagnostics: NonNullable<MarketplaceResult['diagnostics']>['rows'] = [];
          const exclusionCounts: Record<string,number> = {};
          const seen = new Set<string>();
          let examined=0, invalid=0, normalizedCount=0;
          const filter = 'buyingOptions:{FIXED_PRICE},deliveryCountry:US';
          const searchWarnings:string[]=[];
          for (const step of plan) {
            if(attempts.length&&sufficientSearchEvidence({provider:"ebay",environment,status:"available",query:text,comparables,retrievedAt:stamp,expiresAt:new Date(now()+300000).toISOString(),cached:false,examined,excluded:0,invalid,warnings:[]},query))break;
            requests = requests.filter(t=>t>now()-3600000);
            if(requests.length>=100 || cooldownUntil>now()) {searchWarnings.push('Search budget or rate-limit cooldown stopped further stages.');break;}
            requests.push(now());
            const attemptStart=now();
            const attempt={stage:step.stage,query:step.query,filter,limit:100,returned:0,unique:0,duplicates:0,candidates:0,latencyMs:0,error:undefined as string|undefined};
            attempts.push(attempt);
            let normalized: ReturnType<typeof normalizeEbaySearch>;
            try {
              const params=new URLSearchParams({q:step.query,limit:'100',filter});
              const raw=await upstream(base+'/buy/browse/v1/item_summary/search?'+params,{headers:{Authorization:'Bearer '+authorization,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US','Accept-Language':'en-US'}});
              normalized=normalizeEbaySearch(raw,environment,stamp);
            } catch(error) {
              if(!examined)throw error;
              attempt.latencyMs=now()-attemptStart;
              attempt.error=error instanceof EbayError?error.message:'Search stage failed';searchWarnings.push("Partial marketplace search: "+attempt.error);break;
            }
            attempt.returned=normalized.examined;
            attempt.duplicates=normalized.exclusions.duplicate_item||0;
            examined+=normalized.examined;invalid+=normalized.invalid;normalizedCount+=normalized.items.length;
            rowDiagnostics.push(...normalized.diagnostics);
            for(const [reason,count] of Object.entries(normalized.exclusions))exclusionCounts[reason]=(exclusionCounts[reason]||0)+count;
            for(const item of normalized.items){
              if(seen.has(item.id)){
                const prior=comparables.find(x=>x.id===item.id);
                if(prior&&(prior.price!==item.price||prior.conditionId!==item.conditionId||item.warnings.includes("Conflicting duplicate listing")))
                  prior.warnings.push("Conflicting duplicate listing");
                attempt.duplicates++;invalid++;normalizedCount--;exclusionCounts.duplicate_across_searches=(exclusionCounts.duplicate_across_searches||0)+1;rowDiagnostics.push({id:item.id,title:item.title,stage:'deduplication',reason:'duplicate_across_searches'});continue;}
              seen.add(item.id);attempt.unique++;
              const match=completeComparable(item,query)?tierComparable(item,query):{item:null,reason:"incompatible_or_incomplete_footwear"};
              rowDiagnostics.push({id:item.id,title:item.title,stage:match.item ? match.item.matchTier+(match.item.priceEligible?' (candidate)':' (pricing excluded)') : 'matching',reason:match.reason});
              if(match.item?.priceEligible)attempt.candidates++;
              if(match.item)comparables.push({...match.item,quality:scoreComparable(match.item)});else exclusionCounts[match.reason]=(exclusionCounts[match.reason]||0)+1;
            }
            attempt.latencyMs=now()-attemptStart;
          }
          const value: MarketplaceResult = {
            provider: "ebay",
            status: comparables.length ? "available" : "no_matches",
            environment,
            query: text,
            comparables,
            retrievedAt: stamp,
            expiresAt: new Date(now() + 300000).toISOString(),
            cached: false,
            diagnostics: { normalized: normalizedCount, accepted: comparables.length, exclusions: exclusionCounts, rows: rowDiagnostics },
            searchDiagnostics: { cacheKey:key, attempts, exact:comparables.filter(x=>x.matchTier==="exact").length,close:comparables.filter(x=>x.matchTier==="close").length,related:comparables.filter(x=>x.matchTier==="related").length },
            examined,
            excluded: normalizedCount - comparables.length,
            invalid,
            warnings: [
              ...searchWarnings,
              "Limited sample: up to four searches of the first 100 best-match fixed-price listings, USD, deliverable to the US. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches.",
              ...(environment === "sandbox"
                ? ["Sandbox listings are test data, not market evidence."]
                : []),
            ],
          };
          value.searchCompleteness=attempts.some(a=>a.error)||searchWarnings.some(w=>/stopped further stages/i.test(w))?"partial":"complete";
          value.retrievalDiagnostics=retrievalDiagnostics(value,query,seen.size,(exclusionCounts.duplicate_across_searches||0)+(exclusionCounts.duplicate_item||0),attempts.length,now()-started);
          console.info("[ebay-search]", JSON.stringify({cacheKey:key, attempts:value.searchDiagnostics?.attempts, returned:examined, retained:comparables.length, exclusions:exclusionCounts}));
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(key, { expires: now() + 300000, value });
          return value;
        } catch (error) {
          return failure(
            text,
            error instanceof EbayError
              ? error.message
              : error instanceof Error &&
                  ["TimeoutError", "AbortError"].includes(error.name)
                ? "eBay request timed out. Please try again."
                : "Could not reach eBay. No valuation was calculated.",
            error instanceof EbayError ? error.retryAfterSeconds : undefined,
          );
        } finally {
          active--;
          pending.delete(key);
        }
      })();
      pending.set(key, job);
      return job;
    },
  };
}
