"use client";
import Link from "next/link";
import { ArrowRight, Camera } from "lucide-react";
import { useIdentification } from "../../components/identification-context";
import { DraftRows, useDrafts } from "../../components/listing/draft-list";

export default function Dashboard() {
  const { state } = useIdentification();
  const { drafts, thumbs } = useDrafts();
  const published = drafts?.filter((d) => d.ebay.publish?.status === "published").length ?? 0;
  return (
    <section className="wrap workspace narrow">
      <h1 className="page-title">Home</h1>
      <p className="muted">Pick up where you left off, or start a new item.</p>

      <Link href="/analyze" className="start-card">
        <span className="start-icon" aria-hidden="true"><Camera size={22} /></span>
        <span className="start-text">
          <strong>Price a new item</strong>
          <span className="muted">Take or upload a photo. We&apos;ll identify it and suggest a price.</span>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </Link>

      {state.confirmed && (
        <Link href="/analysis" className="resume-card">
          <span className="muted">Current item</span>
          <strong>{state.confirmed.productName}</strong>
          <span className="text-link">See prices →</span>
        </Link>
      )}

      <div className="home-section-head">
        <h2>Recent listings</h2>
        {!!drafts?.length && <Link className="text-link" href="/listings">View all</Link>}
      </div>
      {drafts === null && <p className="muted" aria-busy="true">Loading…</p>}
      {drafts?.length === 0 && <p className="muted">Your listings will appear here.</p>}
      {!!drafts?.length && (
        <>
          <DraftRows drafts={drafts} thumbs={thumbs} limit={4} />
          <p className="fine block">{drafts.length} listing{drafts.length === 1 ? "" : "s"} · {published} published</p>
        </>
      )}
      <p className="fine block">
        <Link className="text-link" href="/analysis?demo=1">See an example report</Link>
      </p>
    </section>
  );
}
