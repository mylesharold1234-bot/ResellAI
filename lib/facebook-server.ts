import { parseIdentification } from "./identification";
import { parseMatchDetails } from "./marketplaces";
import { parseFacebookLocation, type FacebookRequest } from "./facebook";
import { facebookValuation } from "./facebook-valuation";
import type { createSocialFetchProvider } from "./marketplace-providers/social-fetch";
export function createFacebookHandler(
  provider: ReturnType<typeof createSocialFetchProvider>,
) {
  return async (request: Request) => {
    const json = (v: unknown, s = 200) =>
      Response.json(v, { status: s, headers: { "Cache-Control": "no-store" } });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return json({ error: "Open ResellAI directly to search." }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "Send product and location details as JSON." }, 415);
    const reader = request.body?.getReader();
    if (!reader)
      return json({ error: "Confirm an item and choose a location." }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 26000) {
          await reader.cancel();
          return json({ error: "Search details are too long." }, 413);
        }
        chunks.push(value);
      }
    } catch {
      return json({ error: "Could not read the search request." }, 400);
    } finally {
      reader.releaseLock();
    }
    let query: FacebookRequest;
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const identification = parseIdentification(v.identification),
        details = parseMatchDetails(v.details),
        location = parseFacebookLocation(v.location);
      if (
        !identification.productName?.trim() ||
        !identification.brand?.trim() ||
        !identification.model?.trim() ||
        !identification.category?.trim()
      )
        throw Error("Confirm brand, model, product name and category first.");
      if (
        typeof v.intentId !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(v.intentId) ||
        !["confirmation", "refresh"].includes(v.trigger)
      )
        throw Error("A confirmation or explicit update action is required.");
      if (
        (details.condition === "new" &&
          location.condition &&
          location.condition !== "new") ||
        (details.condition === "used" && location.condition === "new")
      )
        throw Error(
          "The Facebook condition filter conflicts with your confirmed condition.",
        );
      query = {
        identification,
        details,
        location,
        intentId: v.intentId,
        trigger: v.trigger,
      };
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Invalid search details." },
        400,
      );
    }
    const result = await provider.search(query);
    return json({ result, valuation: facebookValuation(result, query) });
  };
}
