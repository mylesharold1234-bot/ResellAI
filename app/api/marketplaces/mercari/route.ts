import {createDailySnapshots} from "../../../../lib/daily-snapshots";
import { createMercariProvider } from "../../../../lib/marketplace-providers/mercari";
import { createMarketplaceHandler } from "../../../../lib/marketplace-server";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = createMarketplaceHandler(createMercariProvider({apiKey:process.env.APISH_API_KEY,maxQueries:process.env.MERCARI_MAX_SEARCH_QUERIES==="2"?2:1}),process.env.APISH_API_KEY?.trim()?createDailySnapshots():undefined);
