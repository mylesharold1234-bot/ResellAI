"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useIdentification } from "./identification-context";
import { ProductImage } from "./product-image";
export function LatestItemCard() {
  const { state } = useIdentification();
  if (!state.confirmed) return null;
  return (
    <Link href="/analysis" className="panel inventory-card">
      <ProductImage
        small
        photo={state.photos[0]?.url}
        alt={`Your photo of ${state.confirmed.productName}`}
      />
      <div className="row">
        <h3>{state.confirmed.productName}</h3>
        <ArrowUpRight size={20} />
      </div>
      <p className="muted">{state.confirmed.category} · Confirmed by you</p>
      <div className="row">
        <strong>Value not assessed</strong>
        <span className="muted">Current session</span>
      </div>
    </Link>
  );
}
