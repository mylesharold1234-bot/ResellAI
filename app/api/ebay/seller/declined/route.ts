import { createSellerHandlers } from "../../../../../lib/ebay-seller/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createSellerHandlers();
export const GET = (request: Request) => handlers.declined(request);
