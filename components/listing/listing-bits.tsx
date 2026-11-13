"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Provenance, TextSource } from "../../lib/listing/types";

export function ProvenanceBadge({ source, confirmed, required }: { source: Provenance; confirmed: boolean; required?: boolean }) {
  if (source === "user-confirmed") return <span className="badge confirmed">Confirmed by you</span>;
  if (source === "identified") return <span className="badge identified" title="Visible in your photo or stated in your notes, reviewed at confirmation">From identification</span>;
  if (source === "ai-inferred")
    return confirmed ? <span className="badge confirmed">AI-inferred · confirmed</span> : <span className="badge inferred" title="The AI's interpretation. Confirm it or correct it.">AI-inferred · unconfirmed</span>;
  return required ? <span className="badge missing">Missing · required</span> : <span className="badge neutral">Not provided</span>;
}

export function TextSourceBadge({ source }: { source: TextSource }) {
  if (source === "ai-generated") return <span className="badge inferred">AI-written · review</span>;
  if (source === "template") return <span className="badge identified">Built from your details</span>;
  if (source === "user-edited") return <span className="badge confirmed">Edited by you</span>;
  return <span className="badge neutral">Empty</span>;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="mini-button"
      disabled={!text}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? "Copied" : label}
    </button>
  );
}

export const dollars = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
