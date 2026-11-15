"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Trash2 } from "lucide-react";
import { deleteDraft, getPhotos, listDrafts, storageIsPersistent } from "../../lib/listing/drafts-store";
import { assessListing } from "../../lib/listing/readiness";
import { upgradeDraft } from "../../lib/listing/draft";
import { marketplaces } from "../../lib/listing/categories";
import type { ListingDraft } from "../../lib/listing/types";

/** Saved drafts with their first photo, newest first. Thumbnails are revoked on unmount. */
export function useDrafts() {
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
        if (cancelled) return firstPhotos.forEach(([, u]) => u && URL.revokeObjectURL(u));
        urls = firstPhotos.map(([, u]) => u).filter(Boolean);
        setThumbs(Object.fromEntries(firstPhotos));
        setDrafts(list.map(upgradeDraft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
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
    if (!window.confirm(`Delete "${d.title.value || d.identification.productName}"? This can't be undone.`)) return;
    await deleteDraft(d.id);
    setDrafts((list) => list?.filter((x) => x.id !== d.id) ?? null);
  }
  return { drafts, thumbs, persistent, error, remove };
}

export function draftStatus(d: ListingDraft) {
  if (d.ebay.publish?.status === "published") return { label: "Published", tone: "success" as const };
  const n = assessListing(d).blockers.length;
  return n ? { label: `${n} detail${n === 1 ? "" : "s"} needed`, tone: "warning" as const } : { label: "Ready to review", tone: "accent" as const };
}

export function DraftRows({ drafts, thumbs, onDelete, limit }: { drafts: ListingDraft[]; thumbs: Record<string, string>; onDelete?: (d: ListingDraft) => void; limit?: number }) {
  return (
    <ul className="draft-rows">
      {drafts.slice(0, limit ?? drafts.length).map((d) => {
        const s = draftStatus(d);
        const title = d.title.value || d.identification.productName || "Untitled item";
        return (
          <li key={d.id} className="draft-row">
            <Link href={`/listings/${d.id}`} className="draft-row-link">
              <span className="draft-thumb">{thumbs[d.id] ? <img src={thumbs[d.id]} alt="" /> : null}</span>
              <span className="draft-text">
                <span className="draft-title">{title}</span>
                <span className="draft-meta">
                  {d.pricing.price === null ? "No price yet" : `$${d.pricing.price.toFixed(2)}`} · {marketplaces[d.marketplace].label}
                </span>
              </span>
              <span className={`pill ${s.tone}`}>{s.label}</span>
              <ChevronRight size={18} className="draft-chevron" aria-hidden="true" />
            </Link>
            {onDelete && (
              <button type="button" className="icon-button draft-delete" onClick={() => onDelete(d)} aria-label={`Delete ${title}`}>
                <Trash2 size={16} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
