import { createListingGenerateHandler } from "../../../../lib/listing/generate-server";
export const runtime = "nodejs";
export const maxDuration = 45;

// Local prototype limits, matching the other AI routes: no public deployment until auth and shared quotas exist.
let active = 0;
let recent: number[] = [];
export async function POST(request: Request) {
  recent = recent.filter((t) => t > Date.now() - 3_600_000);
  if (active >= 2 || recent.length >= 60)
    return Response.json({ error: "Listing generation limit reached. Try again shortly." }, { status: 429 });
  active++;
  recent.push(Date.now());
  try {
    return await createListingGenerateHandler({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_LISTING_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
    })(request);
  } finally {
    active--;
  }
}
