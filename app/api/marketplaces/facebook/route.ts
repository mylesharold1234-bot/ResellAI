import { socialFetch } from "../../../../lib/social-fetch-service";
import { createFacebookHandler } from "../../../../lib/facebook-server";
import { FACEBOOK_PERMISSION_MESSAGE } from "../../../../lib/facebook";
export const runtime = "nodejs";
export const maxDuration = 35;
export const POST = createFacebookHandler(socialFetch);
export function GET() {
  return Response.json(
    {
      enabled: socialFetch.enabled,
      keyConfigured: Boolean(process.env.SOCIAL_FETCH_API_KEY?.trim()),
      permissionChecks: {
        permittedUseConfirmed:
          process.env.SOCIAL_FETCH_PERMITTED_USE_CONFIRMED === "true",
        permissionReferenceRecorded: Boolean(
          process.env.SOCIAL_FETCH_PERMISSION_REFERENCE?.trim(),
        ),
      },
      reason: socialFetch.enabled ? null : FACEBOOK_PERMISSION_MESSAGE,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
