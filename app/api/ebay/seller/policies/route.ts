import { createSellerHandlers } from "../../../../../lib/ebay-seller/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const handlers = createSellerHandlers();
export const POST = (request: Request) => handlers.createPolicy(request);
