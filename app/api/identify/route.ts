import { createIdentifyHandler } from "../../../lib/identify-server";
export const runtime = "nodejs";
export const maxDuration = 60;
// Local prototype only: no public deployment until account-level quotas/auth are added.
let activeRequests = 0;
export async function POST(request: Request) {
  if (activeRequests >= 2)
    return Response.json(
      {
        error:
          "Two identifications are already running. Please try again shortly.",
      },
      { status: 429 },
    );
  activeRequests++;
  try {
    return await createIdentifyHandler({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
    })(request);
  } finally {
    activeRequests--;
  }
}
