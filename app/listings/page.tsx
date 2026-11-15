"use client";
import Link from "next/link";
import { Camera } from "lucide-react";
import { useIdentification } from "../../components/identification-context";
import { DraftRows, useDrafts } from "../../components/listing/draft-list";

export default function ListingsPage() {
  const { state } = useIdentification();
  const { drafts, thumbs, persistent, error, remove } = useDrafts();
  return (
    <section className="wrap workspace narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Listings</h1>
          <p className="muted">Saved in this browser{persistent ? "" : " for this tab only"}.</p>
        </div>
        <Link className="button small dark" href="/analyze"><Camera size={15} aria-hidden="true" /> New item</Link>
      </div>

      {state.confirmed && (
        <Link href="/analysis" className="resume-card">
          <span className="muted">Continue with</span>
          <strong>{state.confirmed.productName}</strong>
          <span className="text-link">See prices and create a listing →</span>
        </Link>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {drafts === null && !error && <p className="muted block" aria-busy="true">Loading…</p>}
      {drafts?.length === 0 && (
        <div className="empty-state">
          <h2>No listings yet</h2>
          <p className="muted">Start with a photo. ResellAI writes the listing for you.</p>
          <Link className="button" href="/analyze">Start with a photo</Link>
        </div>
      )}
      {!!drafts?.length && <DraftRows drafts={drafts} thumbs={thumbs} onDelete={(d) => void remove(d)} />}
    </section>
  );
}
