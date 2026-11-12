import {createDailySnapshots} from "../../../../lib/daily-snapshots";
import { createEbayProvider } from "../../../../lib/marketplace-providers/ebay";
import { createMarketplaceHandler } from "../../../../lib/marketplace-server";
export const runtime = "nodejs";
export const maxDuration = 60;
const provider = createEbayProvider({
  clientId: process.env.EBAY_CLIENT_ID,
  clientSecret: process.env.EBAY_CLIENT_SECRET,
  environment:
    process.env.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox",
  productionApproved: process.env.EBAY_PRODUCTION_APPROVED === "true",
});
export const POST = createMarketplaceHandler(provider,process.env.EBAY_ENVIRONMENT==="production"&&process.env.EBAY_PRODUCTION_APPROVED==="true"?createDailySnapshots():undefined);
