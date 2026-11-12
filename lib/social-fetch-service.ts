// Server routes only. Never import this module into a client component.
import { createSocialFetchProvider } from "./marketplace-providers/social-fetch";
export const socialFetch = createSocialFetchProvider({
  apiKey: process.env.SOCIAL_FETCH_API_KEY,
  permittedUseConfirmed:
    process.env.SOCIAL_FETCH_PERMITTED_USE_CONFIRMED === "true",
  permissionReference: process.env.SOCIAL_FETCH_PERMISSION_REFERENCE || "",
});
