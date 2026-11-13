import { createSellerHandlers } from "../../../../../lib/ebay-seller/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const handlers = createSellerHandlers();
export const GET = (request: Request) => handlers.listing(request);
