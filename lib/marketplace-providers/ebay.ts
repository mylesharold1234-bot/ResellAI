import {retrievalDiagnostics,sufficientSearchEvidence} from "../retrieval-diagnostics";
import {completeComparable,scoreComparable} from "../comparable-quality";
import type {
  Comparable,
  ListingAspects,
  MarketplaceProvider,
  MarketplaceResult,
  ProductQuery,
} from "../marketplaces";
import { searchPlan, searchCacheKey, sizedSearches, tierComparable } from "../ebay-search";
import { styleCodesIn } from "../style-codes";
import { reliableDate } from "../listing-age";
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
/** The listing's own photo, only from eBay's image host over HTTPS. Display only; never used for matching. */
export function listingImage(row: Record<string, unknown>): string | null {
  const thumbs = Array.isArray(row.thumbnailImages) ? row.thumbnailImages : [];
  const candidates = [object(row.image) ? row.image.imageUrl : null, ...thumbs.map((t) => (object(t) ? t.imageUrl : null))];
  for (const raw of candidates) {
    if (typeof raw !== "string" || raw.length > 500) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" && !u.username && !u.password && !u.port && (u.hostname === "i.ebayimg.com" || u.hostname.endsWith(".ebayimg.com"))) return u.href;
    } catch {
      /* not a URL */
    }
  }
  return null;
}
/** eBay's item-group id for a multi-variation listing, from its itemGroupHref. Digits only. */
export function itemGroupIdOf(row: Record<string, unknown>): string | null {
  if (typeof row.itemGroupHref !== "string") return null;
  try {
    const id = new URL(row.itemGroupHref).searchParams.get("item_group_id");
    return id && /^\d{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
/**
 * Size, department and style code from eBay's own item specifics (localizedAspects). Only plain,
 * single US shoe sizes are accepted ("10", "10 M", "US 10"); anything else is left unknown.
 */
export function ebayAspects(raw: unknown, source: ListingAspects["source"]): ListingAspects | null {
  if (!Array.isArray(raw)) return null;
  const get = (name: RegExp) => {
    const hit = raw.find((a) => object(a) && typeof a.name === "string" && name.test(a.name.trim()) && typeof a.value === "string");
    return hit && object(hit) ? String(hit.value).trim().slice(0, 80) : "";
  };
  const out: ListingAspects = { source };
  const us = get(/^US Shoe Size$/i);
  const size = /^(?:US\s*)?(?:M(?:en'?s)?\s*)?(\d{1,2}(?:\.5)?)\s*(?:M|US|Men'?s?)?$/i.exec(us);
  if (size) {
    out.size = String(Number(size[1]));
    out.sizeSystem = "US";
  }
  const department = get(/^Department$/i);
  if (department) out.department = department;
  const style = get(/^(?:Style Code|Style|Manufacturer Part Number|MPN)$/i);
  if (/^[A-Z]{2}\d{4}[- ]?\d{3}$/i.test(style)) out.styleCode = style.toUpperCase().replace(" ", "-");
  return out.size || out.department || out.styleCode ? out : null;
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
    const image = listingImage(row);
    const itemGroupId = itemGroupIdOf(row);
    // eBay's original listing date survives relists; the current-listing date alone is only a lower bound.
    const origin = reliableDate(row.itemOriginDate, observedAt);
    const current = origin ? null : reliableDate(row.itemCreationDate, observedAt);
    result.push({
      id: row.itemId,
      title: row.title.trim(),
      price,
      currency: "USD",
      status: "asking",
      condition: typeof row.condition === "string" ? row.condition.slice(0, 200) : "Not specified",
      conditionId: typeof conditionId === "string" ? conditionId : "",
      url: url.href,
      ...(image ? { image } : {}),
      ...(itemGroupId ? { itemGroupId } : {}),
      ...(origin ? { listedAt: origin, listedAtSource: "ebay-original-listing" as const } : current ? { listedAt: current, listedAtSource: "ebay-current-listing" as const } : {}),
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
    total: typeof body.total === "number" && Number.isFinite(body.total) && body.total >= 0 ? body.total : null,
    items: result,
    invalid,
    examined: rows.length,
    warnings:
      Array.isArray(body.warnings) && body.warnings.length
        ? ["eBay reported search warnings; this is a limited sample."]
        : [],
  };
}
/**
 * How many eBay requests one item search may use. eBay's Browse API is free within the app's daily
 * allowance (5,000 calls by default), so this protects that allowance rather than spending money.
 * - pages: pages of 200 read for a confirmed style code (1–2)
 * - variationChecks / detailChecks: multi-size listings and listing details checked per search (0–20)
 * - hourlyRequests: all eBay requests from this server per hour (20–1000)
 */
export type EbaySearchBudget = { pages: number; variationChecks: number; detailChecks: number; hourlyRequests: number };
export const defaultEbayBudget: EbaySearchBudget = { pages: 2, variationChecks: 10, detailChecks: 10, hourlyRequests: 100 };
export function ebayBudgetFromEnv(env: Record<string, string | undefined> = process.env): EbaySearchBudget {
  const read = (name: string, fallback: number, min: number, max: number) => {
    const v = Number(env[name]);
    return env[name]?.trim() && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  return {
    pages: read("EBAY_STYLE_CODE_PAGES", defaultEbayBudget.pages, 1, 2),
    variationChecks: read("EBAY_VARIATION_CHECKS", defaultEbayBudget.variationChecks, 0, 20),
    detailChecks: read("EBAY_DETAIL_CHECKS", defaultEbayBudget.detailChecks, 0, 20),
    hourlyRequests: read("EBAY_HOURLY_REQUEST_LIMIT", defaultEbayBudget.hourlyRequests, 20, 1000),
  };
}
export function createEbayProvider({
  clientId,
  clientSecret,
  environment = "sandbox",
  productionApproved = false,
  fetcher = fetch,
  now = Date.now,
  budget: budgetOverrides = {},
}: {
  clientId?: string;
  clientSecret?: string;
  environment?: "production" | "sandbox";
  productionApproved?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  budget?: Partial<EbaySearchBudget>;
}): MarketplaceProvider {
  const limits: EbaySearchBudget = { ...defaultEbayBudget, ...budgetOverrides };
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
      if (active >= 2 || requests.length >= limits.hourlyRequests)
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
          const headers={Authorization:'Bearer '+authorization,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US','Accept-Language':'en-US'};
          /**
           * Structured eBay evidence for a confirmed shoe size: each multi-size listing's own variation in
           * that size (its own price, "US Shoe Size" and stock), and eBay's item specifics (size, style
           * code) for close matches whose titles don't state them. Always runs for a confirmed style code;
           * otherwise only when the searches didn't already support a price. Bounded call counts; nothing
           * is assumed when eBay doesn't state a value.
           */
          async function enrich(){
            const out={groupsChecked:0,variationsFound:0,variationsOutOfStock:0,detailsChecked:0,detailsWithSize:0,detailsWithStyleCode:0,skipped:undefined as string|undefined};
            const wanted=query.details.size.trim();
            if(!sized.length||!wanted){out.skipped='No confirmed US men\'s or women\'s shoe size.';return out;}
            const snapshot=():MarketplaceResult=>({provider:"ebay",environment,status:"available",query:text,comparables,retrievedAt:stamp,expiresAt:new Date(now()+300000).toISOString(),cached:false,examined,excluded:0,invalid,warnings:[]});
            if(!styleCode&&sufficientSearchEvidence(snapshot(),query)){out.skipped='The searches already support a price.';return out;}
            const relaxed:ProductQuery={...query,details:{...query.details,size:'',sizeSystem:''}};
            // Would this listing qualify if eBay confirms its size (and the confirmed style code)? Product,
            // colors, condition, box and sizing group must already check out; nothing here is assumed for pricing.
            const otherwiseEligible=(c:Comparable,source:'ebay-item-group'|'ebay-item-details')=>{
              const hypothetical={...c,matchReasons:[],quality:undefined,aspects:{...(c.aspects||{}),source,...(styleCode?{styleCode}:{})}};
              const m=tierComparable(hypothetical,relaxed);return !!m.item&&m.item.matchTier!=='related'&&m.item.priceEligible===true;};
            // A title that states a different full style code (DD1391-600) can't be the confirmed release.
            const otherCode=(c:Comparable)=>!!styleCode&&styleCodesIn(c.title).some(x=>x.includes('-')&&x!==styleCode);
            const codeInTitle=(c:Comparable)=>!!styleCode&&new RegExp('\\b'+styleCode.replace('-','[- ]?')+'\\b','i').test(c.title);
            // Leave headroom in the hourly allowance for other sellers' searches.
            const budget=()=>{requests=requests.filter(t=>t>now()-3600000);return requests.length<Math.floor(limits.hourlyRequests*0.9)&&cooldownUntil<=now();};
            // Listings that state the confirmed code first, then the strongest title evidence.
            const byQuality=(a:Comparable,b:Comparable)=>Number(codeInTitle(b))-Number(codeInTitle(a))||(b.quality?.score??0)-(a.quality?.score??0)||a.id.localeCompare(b.id);
            const setRow=(id:string,title:string,stage:string,reason:string)=>{const row=rowDiagnostics.find(r=>r.id===id&&r.stage!=='deduplication');if(row){row.stage=stage;row.reason=reason;}else rowDiagnostics.push({id,title,stage,reason});};
            const groups=comparables.filter(c=>c.itemGroupId&&!otherCode(c)&&otherwiseEligible({...sources.get(c.id)!,warnings:[]},'ebay-item-group')).sort(byQuality).slice(0,limits.variationChecks);
            for(const group of groups){
              if(!budget()){searchWarnings.push('eBay item-specific checks stopped early to stay within the request budget.');break;}
              requests.push(now());out.groupsChecked++;
              let body:unknown;
              try{body=await upstream(base+'/buy/browse/v1/item/get_items_by_item_group?'+new URLSearchParams({item_group_id:group.itemGroupId!}),{headers});}
              catch(error){if(error instanceof EbayError&&error.retryAfterSeconds)break;continue;}
              const items=object(body)&&Array.isArray(body.items)?body.items.slice(0,200):[];
              for(const raw of items){
                if(!object(raw))continue;
                const aspects=ebayAspects(raw.localizedAspects,'ebay-item-group');
                if(!aspects?.size||Number(aspects.size)!==Number(wanted))continue;
                // A size the seller lists but has sold out of isn't an asking price anyone can buy at.
                const availability=Array.isArray(raw.estimatedAvailabilities)&&object(raw.estimatedAvailabilities[0])?raw.estimatedAvailabilities[0].estimatedAvailabilityStatus:null;
                if(availability==='OUT_OF_STOCK'){out.variationsOutOfStock++;continue;}
                const {itemGroupHref:_h,itemGroupType:_t,...row}=raw;
                const [variation]=normalizeEbaySearch({total:1,itemSummaries:[row]},environment,stamp).items;
                if(!variation)continue;
                // eBay's size-filtered search returns the matching variation's own id (v1|group|variation), so
                // the size this check verifies is often the same row the search already returned as
                // "unverified". Replace that row; skip only ids that were already verified another way.
                const existing=comparables.findIndex(x=>x.id===variation.id);
                if(seen.has(variation.id)&&(existing<0||!comparables[existing].itemGroupId))continue;
                seen.add(variation.id);
                const prior=existing>=0?sources.get(variation.id)??comparables[existing]:null;
                const dated=prior?.listedAtSource==='ebay-original-listing'?{listedAt:prior.listedAt,listedAtSource:prior.listedAtSource}:{};
                const source:Comparable={...variation,...dated,warnings:variation.warnings.filter(w=>!w.startsWith('Variation selection unverified')),aspects};
                sources.set(source.id,source);
                const match=tierComparable(source,query);
                const stage=match.item?match.item.matchTier+(match.item.priceEligible?' (candidate, eBay size variation)':' (pricing excluded, eBay size variation)'):'matching';
                if(existing>=0){
                  if(match.item)comparables[existing]={...match.item,quality:scoreComparable(match.item)};else comparables.splice(existing,1);
                  setRow(source.id,source.title,stage,match.reason);
                }else{
                  rowDiagnostics.push({id:source.id,title:source.title,stage,reason:match.reason});
                  if(match.item)comparables.push({...match.item,quality:scoreComparable(match.item)});
                }
                if(match.item)out.variationsFound++;
              }
            }
            const unstated=new Set(['size_unverified','sizing_group_unverified','sizing_system_unverified','size_or_sizing_group_unverified',...(styleCode?['identifier_mismatch']:[])]);
            const details=comparables.filter(c=>!c.itemGroupId&&!otherCode(c)&&c.aspects?.source!=='ebay-item-details'&&c.aspects?.source!=='ebay-item-group'&&c.matchTier!=='related'&&!c.priceEligible&&
              unstated.has(tierComparable({...sources.get(c.id)!},query).reason)&&otherwiseEligible(sources.get(c.id)!,'ebay-item-details')).sort(byQuality).slice(0,limits.detailChecks);
            for(const c of details){
              if(!budget()){searchWarnings.push('eBay item-specific checks stopped early to stay within the request budget.');break;}
              requests.push(now());out.detailsChecked++;
              let body:unknown;
              try{body=await upstream(base+'/buy/browse/v1/item/'+encodeURIComponent(c.id),{headers});}
              catch(error){if(error instanceof EbayError&&error.retryAfterSeconds)break;continue;}
              const fetched=object(body)?ebayAspects(body.localizedAspects,'ebay-item-details'):null;
              if(!fetched)continue;
              if(fetched.size)out.detailsWithSize++;
              if(fetched.styleCode)out.detailsWithStyleCode++;
              // Keep what the size filter established; eBay's item specifics add to or replace it.
              const prior=sources.get(c.id)!;
              const aspects={...(prior.aspects||{}),...Object.fromEntries(Object.entries(fetched).filter(([,v])=>v!==undefined))} as typeof fetched;
              const source={...prior,aspects};
              sources.set(c.id,source);
              const match=tierComparable(source,query);
              const index=comparables.findIndex(x=>x.id===c.id);
              if(match.item&&index>=0)comparables[index]={...match.item,quality:scoreComparable(match.item)};
              setRow(c.id,c.title,match.item?match.item.matchTier+(match.item.priceEligible?' (candidate, eBay item specifics)':' (pricing excluded, eBay item specifics)'):'matching',match.reason);
            }
            return out;
          }
          const filter = 'buyingOptions:{FIXED_PRICE},deliveryCountry:US';
          const searchWarnings:string[]=[];
          // Source facts for each listing, so structured eBay evidence can re-check it from scratch.
          const sources = new Map<string, Comparable>();
          const sized = sizedSearches(query);
          const styleCode = sized[0]?.styleCode ?? null;
          type Step = { stage: string; query: string; categoryId?: string; aspectFilter?: string; conditionIds?: string; limit?: number; offset?: number; sizedStep?: (typeof sized)[number] };
          const steps: Step[] = [...sized.map((s) => ({ ...s, sizedStep: s })), ...plan];
          let codeListings = 0, lastReturned = 0;
          const coverage = { reportedTotal: null as number | null, read: 0, exhausted: false, query: "" };
          for (const step of steps) {
            // Style-code pages always run together; page 2 only when page 1 was full.
            if(step.sizedStep?.styleCode&&step.sizedStep.offset>0&&(lastReturned<step.sizedStep.limit||step.sizedStep.offset/step.sizedStep.limit>=limits.pages))continue;
            // Enough style-code listings make the broader title searches unnecessary.
            if(!step.sizedStep&&styleCode&&codeListings>=50){searchWarnings.push('Title searches skipped: the style-code search returned enough listings.');break;}
            if(!step.sizedStep?.styleCode&&attempts.length&&sufficientSearchEvidence({provider:"ebay",environment,status:"available",query:text,comparables,retrievedAt:stamp,expiresAt:new Date(now()+300000).toISOString(),cached:false,examined,excluded:0,invalid,warnings:[]},query))break;
            requests = requests.filter(t=>t>now()-3600000);
            if(requests.length>=limits.hourlyRequests || cooldownUntil>now()) {searchWarnings.push('Search budget or rate-limit cooldown stopped further stages.');break;}
            requests.push(now());
            const attemptStart=now();
            const stepFilter=filter+(step.conditionIds?',conditionIds:{'+step.conditionIds+'}':'');
            const limit=step.limit??100,offset=step.offset??0;
            const attempt={stage:step.stage,query:step.query,filter:stepFilter+(step.aspectFilter?' · category '+step.categoryId+' · '+step.aspectFilter:'')+(offset?' · offset '+offset:''),limit,returned:0,unique:0,duplicates:0,candidates:0,latencyMs:0,error:undefined as string|undefined};
            attempts.push(attempt);
            let normalized: ReturnType<typeof normalizeEbaySearch>;
            try {
              const params=new URLSearchParams({q:step.query,limit:String(limit),filter:stepFilter});
              if(offset)params.set('offset',String(offset));
              if(step.categoryId)params.set('category_ids',step.categoryId);
              if(step.aspectFilter)params.set('aspect_filter',step.aspectFilter);
              const raw=await upstream(base+'/buy/browse/v1/item_summary/search?'+params,{headers:{Authorization:'Bearer '+authorization,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US','Accept-Language':'en-US'}});
              normalized=normalizeEbaySearch(raw,environment,stamp);
            } catch(error) {
              if(!examined)throw error;
              attempt.latencyMs=now()-attemptStart;
              attempt.error=error instanceof EbayError?error.message:'Search stage failed';searchWarnings.push("Partial marketplace search: "+attempt.error);break;
            }
            attempt.returned=normalized.examined;lastReturned=normalized.examined;
            // The main search is the size-filtered one when there is one, otherwise the first title search.
            if(step.sizedStep||(!sized.length&&attempts.length===1)){
              if(!coverage.query)coverage.query=step.query;
              if(coverage.query===step.query){
                if(normalized.total!==null)coverage.reportedTotal=Math.max(coverage.reportedTotal??0,normalized.total);
                coverage.read+=normalized.examined;
                coverage.exhausted=normalized.examined<limit||(normalized.total!==null&&offset+normalized.examined>=normalized.total);
              }
            }
            attempt.duplicates=normalized.exclusions.duplicate_item||0;
            examined+=normalized.examined;invalid+=normalized.invalid;normalizedCount+=normalized.items.length;
            rowDiagnostics.push(...normalized.diagnostics);
            for(const [reason,count] of Object.entries(normalized.exclusions))exclusionCounts[reason]=(exclusionCounts[reason]||0)+count;
            for(const listed of normalized.items){
              // eBay matched this single-size listing on its own "US Shoe Size" item specific in the
              // men's/women's category. Multi-size listings matched on one of their sizes stay unverified.
              const item: Comparable = step.sizedStep && !listed.itemGroupId
                ? {...listed, aspects:{source:'ebay-size-filter', size:step.sizedStep.size, sizeSystem:'US', department:step.sizedStep.department}}
                : listed;
              if(seen.has(item.id)){
                const prior=comparables.find(x=>x.id===item.id);
                if(prior&&(prior.price!==item.price||prior.conditionId!==item.conditionId||item.warnings.includes("Conflicting duplicate listing")))
                  prior.warnings.push("Conflicting duplicate listing");
                attempt.duplicates++;invalid++;normalizedCount--;exclusionCounts.duplicate_across_searches=(exclusionCounts.duplicate_across_searches||0)+1;rowDiagnostics.push({id:item.id,title:item.title,stage:'deduplication',reason:'duplicate_across_searches'});continue;}
              seen.add(item.id);attempt.unique++;if(step.sizedStep?.styleCode)codeListings++;
              sources.set(item.id,item);
              const match=completeComparable(item,query)?tierComparable(item,query):{item:null,reason:"incompatible_or_incomplete_footwear"};
              rowDiagnostics.push({id:item.id,title:item.title,stage:match.item ? match.item.matchTier+(match.item.priceEligible?' (candidate)':' (pricing excluded)') : 'matching',reason:match.reason});
              if(match.item?.priceEligible)attempt.candidates++;
              if(match.item)comparables.push({...match.item,quality:scoreComparable(match.item)});else exclusionCounts[match.reason]=(exclusionCounts[match.reason]||0)+1;
            }
            attempt.latencyMs=now()-attemptStart;
          }
          const enrichment = await enrich();
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
            searchDiagnostics: { cacheKey:key, attempts, enrichment, coverage, exact:comparables.filter(x=>x.matchTier==="exact").length,close:comparables.filter(x=>x.matchTier==="close").length,related:comparables.filter(x=>x.matchTier==="related").length },
            examined,
            excluded: normalizedCount - comparables.length,
            invalid,
            warnings: [
              ...searchWarnings,
              "Limited sample: up to six searches of 100–200 best-match fixed-price listings each, USD, deliverable to the US, plus up to 20 eBay item-specific checks. Item prices exclude shipping and tax. Title-based matching may miss valid listings or accept imperfect matches.",
              ...(environment === "sandbox"
                ? ["Sandbox listings are test data, not market evidence."]
                : []),
            ],
          };
          value.searchCompleteness=attempts.some(a=>a.error)||searchWarnings.some(w=>/stopped further stages/i.test(w))?"partial":"complete";
          value.retrievalDiagnostics=retrievalDiagnostics(value,query,seen.size,(exclusionCounts.duplicate_across_searches||0)+(exclusionCounts.duplicate_item||0),attempts.length+enrichment.groupsChecked+enrichment.detailsChecked,now()-started);
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
