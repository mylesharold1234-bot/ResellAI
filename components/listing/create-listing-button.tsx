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
export function CreateListingButton({ ebay, mercari }: { ebay: MarketEvidence; mercari: MarketEvidence }) {
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
  const evidenceNote = [ebay, mercari].some((x) => x?.recommendation.suggestedListingPrice != null)
    ? "Your confirmed details, photos and pricing evidence carry over."
    : "Your confirmed details and photos carry over. Pricing evidence isn't available yet, so you can set the price yourself.";
  return (
    <section className="panel block create-listing-panel" aria-label="Create a listing">
      <div>
        <span className="pill">NEXT STEP</span>
        <h2>Ready to sell it?</h2>
        <p className="muted">{evidenceNote} Nothing is published without your review.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <button className="button" onClick={() => void create()} disabled={busy} aria-busy={busy}>
        <FilePenLine size={18} /> {busy ? "Creating draft…" : "Create Listing"} <ArrowRight size={18} />
      </button>
    </section>
  );
}
