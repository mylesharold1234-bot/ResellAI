import type { SellerClient } from "./client";
import type { PublishRecord, SellerStore } from "./store";

export class PublishBusyError extends Error {}

const inFlight = new Set<string>();

export type PublishOutcome = { record: PublishRecord; alreadyPublished: boolean; steps: string[] };

/**
 * Idempotent eBay publish: PUT inventory item (replace) → reuse or create the SKU's offer → publish once.
 * - A concurrent publish for the same session + SKU is rejected.
 * - If the SKU's offer is already published, the existing listing is returned; nothing is re-published.
 * - A failure after the offer exists keeps the offer ID, so retrying updates and publishes that same offer.
 */
export async function publishListing({
  client,
  store,
  session,
  sku,
  item,
  offer,
  now = () => new Date().toISOString(),
}: {
  client: SellerClient;
  store: SellerStore;
  session: string;
  sku: string;
  item: unknown;
  offer: unknown;
  now?: () => string;
}): Promise<PublishOutcome> {
  const lock = `${session}:${sku}`;
  if (inFlight.has(lock)) throw new PublishBusyError("This listing is already being published. Wait for it to finish.");
  inFlight.add(lock);
  const steps: string[] = [];
  let record: PublishRecord = (await store.getRecord(session, sku)) ?? { sku, offerId: null, listingId: null, status: "in-progress", lastError: null, updatedAt: now() };
  try {
    if (record.status === "published" && record.listingId) return { record, alreadyPublished: true, steps: ["Already published; nothing sent to eBay."] };
    record = { ...record, status: "in-progress", lastError: null, updatedAt: now() };
    await store.saveRecord(session, record);

    await client.putInventoryItem(sku, item);
    steps.push("Inventory item saved");

    const offers = await client.offersForSku(sku);
    const live = offers.find((o) => o.status === "PUBLISHED" && o.listingId);
    if (live) {
      record = { ...record, offerId: live.offerId, listingId: live.listingId, status: "published", updatedAt: now() };
      await store.saveRecord(session, record);
      return { record, alreadyPublished: true, steps: [...steps, "eBay already has a published offer for this SKU; it was not published again."] };
    }
    const existing = offers.find((o) => o.offerId) ?? (record.offerId ? { offerId: record.offerId } : null);
    let offerId: string;
    if (existing) {
      await client.updateOffer(existing.offerId, offer);
      offerId = existing.offerId;
      steps.push("Existing offer updated");
    } else {
      offerId = await client.createOffer(offer);
      steps.push("Offer created");
    }
    record = { ...record, offerId, updatedAt: now() };
    await store.saveRecord(session, record);

    const listingId = await client.publishOffer(offerId);
    steps.push("Offer published");
    record = { ...record, listingId, status: "published", updatedAt: now() };
    await store.saveRecord(session, record);
    return { record, alreadyPublished: false, steps };
  } catch (e) {
    record = { ...record, status: "failed", lastError: e instanceof Error ? e.message : "Publishing failed.", updatedAt: now() };
    await store.saveRecord(session, record).catch(() => undefined);
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { record, steps });
  } finally {
    inFlight.delete(lock);
  }
}
