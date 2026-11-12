import { socialFetch } from "../../../../../lib/social-fetch-service";
import { generateFacebookAdvice } from "../../../../../lib/facebook-advice";
import { FACEBOOK_PERMISSION_MESSAGE } from "../../../../../lib/facebook";
export const runtime = "nodejs";
export const maxDuration = 35;
const requested = new Set<string>();
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!socialFetch.enabled)
    return json({ error: FACEBOOK_PERMISSION_MESSAGE }, 503);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "Open ResellAI directly." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Send a search action ID." }, 415);
  // Tiny bounded request; do not accept raw third-party evidence supplied by the browser.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Search first." }, 400);
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 500) {
        await reader.cancel();
        return json({ error: "Request too large." }, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const { intentId } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof intentId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(intentId))
      return json({ error: "Search first." }, 400);
    if (requested.has(intentId) || requested.size >= 20)
      return json(
        {
          error:
            "Advice limit reached for this action. No repeat AI call was made.",
        },
        429,
      );
    const evidence = await socialFetch.getEvidence(intentId);
    if (!evidence)
      return json(
        { error: "Fresh server-held listing evidence is required." },
        400,
      );
    requested.add(intentId);
    const tips = await generateFacebookAdvice({
      ...evidence,
      apiKey: process.env.OPENAI_API_KEY,
      permitted: socialFetch.enabled,
    });
    return json({ tips });
  } catch {
    return json(
      {
        error:
          "AI advice could not be generated. Use the deterministic evidence summary; no automatic retry was made.",
      },
      502,
    );
  }
}
