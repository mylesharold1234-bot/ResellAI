"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FilePenLine, Trash2 } from "lucide-react";
import { useIdentification } from "../../components/identification-context";
import { deleteDraft, getPhotos, listDrafts, storageIsPersistent } from "../../lib/listing/drafts-store";
import { assessListing } from "../../lib/listing/readiness";
import { marketplaces } from "../../lib/listing/categories";
import type { ListingDraft } from "../../lib/listing/types";

export default function ListingsPage() {
  const { state } = useIdentification();
  const [drafts, setDrafts] = useState<ListingDraft[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [persistent, setPersistent] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    (async () => {
      try {
        const [list, persists] = await Promise.all([listDrafts(), storageIsPersistent()]);
        const firstPhotos = await Promise.all(
          list.map(async (d) => {
            const photos = await getPhotos(d.id);
            const first = d.photos.find((p) => p.selected) || d.photos[0];
            const photo = photos.find((p) => p.photoId === first?.id) || photos[0];
            return [d.id, photo ? URL.createObjectURL(photo.blob) : ""] as const;
          }),
        );
        if (cancelled) return;
        urls = firstPhotos.map(([, u]) => u).filter(Boolean);
        setThumbs(Object.fromEntries(firstPhotos));
        setDrafts(list);
        setPersistent(persists);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read saved drafts.");
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  async function remove(d: ListingDraft) {
    if (!window.confirm(`Delete the draft "${d.title.value || d.identification.productName}"? This can't be undone.`)) return;
    await deleteDraft(d.id);
    setDrafts((list) => list?.filter((x) => x.id !== d.id) ?? null);
  }

  return (
    <section className="wrap workspace narrow">
      <div className="eyebrow">YOUR LISTINGS</div>
      <h1 className="page-title">Listing drafts</h1>
      <p className="muted">
        Drafts are saved in this browser {persistent ? "and survive reloads" : "for this tab only, because browser storage is unavailable"}. Create a new one from a confirmed item's resale report.
      </p>
      {state.confirmed && (
        <div className="info-card">
          <strong>{state.confirmed.productName}</strong>
          <span>is your current analyzed item.</span>
          <Link className="text-link" href="/analysis">Open its report to create a listing →</Link>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {drafts === null && !error && <p className="muted" aria-busy="true">Loading drafts…</p>}
      {drafts?.length === 0 && (
        <div className="info-card">
          <strong>No drafts yet.</strong>
          <span>Analyze an item, confirm it, then choose Create Listing on the report.</span>
          <Link className="button small" href="/analyze">Analyze an Item</Link>
        </div>
      )}
      <div className="draft-list block">
        {drafts?.map((d) => {
          const r = assessListing(d);
          const published = d.ebay.publish?.status === "published";
          return (
            <article className="draft-item" key={d.id}>
              {thumbs[d.id] ? <img src={thumbs[d.id]} alt="" /> : <div className="thumb" />}
              <div style={{ minWidth: 0 }}>
                <h3>{d.title.value || d.identification.productName || "Untitled item"}</h3>
                <p className="fine" style={{ marginTop: 6 }}>
                  {marketplaces[d.marketplace].label} · {d.pricing.price === null ? "No price" : `$${d.pricing.price.toFixed(2)}`} · Updated {new Date(d.updatedAt).toLocaleString()}
                </p>
                <span className={`badge ${published ? "confirmed" : r.publishable ? "confirmed" : "inferred"}`} style={{ marginTop: 8 }}>
                  {published ? "Published on eBay" : r.publishable ? "Ready" : `${r.blockers.length} to complete`}
                </span>
              </div>
              <div className="actions">
                <Link className="mini-button primary" href={`/listings/${d.id}`}><FilePenLine size={14} /> Open</Link>
                <button type="button" className="mini-button" onClick={() => void remove(d)} aria-label={`Delete draft ${d.identification.productName}`}><Trash2 size={14} /> Delete</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
