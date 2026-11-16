"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePenLine, ArrowRight } from "lucide-react";
import { useIdentification } from "../identification-context";
import { createListingDraft } from "../../lib/listing/draft";
import { saveDraft, savePhoto } from "../../lib/listing/drafts-store";
import type { MarketEvidence } from "../../lib/listing/pricing";

/**
 * Entry point from the resale report. Snapshots the confirmed item, its photos and whatever pricing
 * evidence has loaded into a new listing draft. Makes no AI or marketplace calls.
 */
export function CreateListingButton({ ebay, mercari, manualPrice = null }: { ebay: MarketEvidence; mercari: MarketEvidence; manualPrice?: number | null }) {
  const { state } = useIdentification();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state.confirmed) return null;
  async function create() {
    if (busy || !state.confirmed) return;
    setBusy(true);
    setError("");
    try {
      const id = crypto.randomUUID();
      const draft = createListingDraft({
        id,
        now: new Date().toISOString(),
        identification: state.confirmed,
        details: state.details,
        sources: state.sources,
        photos: state.photos.map((p) => ({ id: p.id, name: p.name })),
        ebay,
        mercari,
        manualPrice,
      });
      for (const photo of state.photos) {
        const blob = photo.file ?? (await (await fetch(photo.url)).blob());
        await savePhoto(id, photo.id, photo.name, blob);
      }
      await saveDraft(draft);
      router.push(`/listings/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the listing draft.");
      setBusy(false);
    }
  }
  return (
    <div className="create-listing">
      <button className="button" onClick={() => void create()} disabled={busy} aria-busy={busy}>
        <FilePenLine size={17} aria-hidden="true" /> {busy ? "Writing your listing…" : "Create listing"} <ArrowRight size={17} aria-hidden="true" />
      </button>
      <p className="fine">We&apos;ll write it for you. Nothing is published until you review it.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
