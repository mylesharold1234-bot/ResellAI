import type {createDailySnapshots} from './daily-snapshots';
import {saveEvidence} from './ebay-evidence';
import {parsePricingOptions} from './pricing-engine';
import { normalizeProduct, recognizableName } from "./product-profile";
import { parseIdentification } from "./identification";
import { parseMatchDetails } from "./marketplaces";
import type { MarketplaceProvider } from "./marketplaces";
import { recommend } from "./valuation";
export function createMarketplaceHandler(provider: MarketplaceProvider, snapshots?:ReturnType<typeof createDailySnapshots>) {
  return async function (request: Request) {
    const json = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return json(
        { error: "Open ResellAI directly to search marketplace listings." },
        403,
      );
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "Send product details as JSON." }, 415);
    const reader = request.body?.getReader();
    if (!reader)
      return json({ error: "Confirm an item before searching." }, 400);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 24000) {
          await reader.cancel();
          return json({ error: "Product details are too long." }, 413);
        }
        chunks.push(value);
      }
    } catch {
      return json({ error: "Could not read the search request." }, 400);
    } finally {
      reader.releaseLock();
    }
    let query;
    let pricingOptions;
    let refresh=false;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const identification = normalizeProduct(parseIdentification(body.identification));
      const details = parseMatchDetails(body.details);
      pricingOptions=parsePricingOptions(body.pricingOptions);
      refresh=body.refresh===true;
      if (!recognizableName(identification)) throw new Error("Describe the recognizable item before searching. Brand, model and SKU are optional.");
      query = { identification, details };
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Invalid product details." },
        400,
      );
    }
    try {
      const saved=snapshots?await snapshots(provider,query,refresh):null;
      const result = saved?.result??await provider.search(query);
      return json({ result:{...result,evidenceId:result.provider==="ebay"?saveEvidence(result,query):undefined}, recommendation: saved?.recommendation??recommend(result, query,pricingOptions), snapshot:saved?.snapshot });
    } catch {
      return json(
        { error: "Marketplace search failed. No prices were calculated." },
        502,
      );
    }
  };
}
