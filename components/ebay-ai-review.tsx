"use client";
import type { MarketplaceResult } from "../lib/marketplaces";
import type { AIReview } from "../lib/ebay-ai-review";
import { RequestSpinner, SkeletonLines } from "./request-loading";
import { useRequest } from "./use-request";

export function EbayAIReview({ result }: { result?: MarketplaceResult }) {
  const { state, run } = useRequest<AIReview>(result?.evidenceId || "");
  const busy = state.status === "loading";
  const review = state.status === "success" ? state.data : null;
  function requestReview() {
    if (!result?.evidenceId || !result.comparables.length || review) return;
    return run(async signal => {
      try {
        const response = await fetch("/api/marketplaces/ebay/review", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evidenceId: result.evidenceId }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        });
        const payload = await response.json();
        if (!response.ok || !payload.review) throw Error(payload.error || "AI review failed. Please try again.");
        return payload.review as AIReview;
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw Error("AI review timed out. Please try again.");
        if (error instanceof TypeError || error instanceof SyntaxError) throw Error("Could not read the AI review response. Please try again.");
        throw error;
      }
    });
  }

  return <section className="panel block">
    <h2>AI comparison review</h2>
    <p className="fine">Optional structured review of up to 20 actual listing titles. Shares product fields and listing titles with OpenAI; pricing calculations remain deterministic.</p>
    <button className="secondary" disabled={busy || !result?.evidenceId || !result.comparables.length || !!review} onClick={() => void requestReview()}>
      {busy ? <><RequestSpinner size={17} /> Reviewing listings…</> : state.status === "error" ? "Retry AI comparable review" : review ? "Review complete" : "Review comparable similarity with AI"}
    </button>
    <div role="status" className="sr-only">{busy ? "Reviewing listings…" : review ? "AI comparison review complete." : ""}</div>
    {busy && <div aria-busy="true"><SkeletonLines /></div>}
    {state.status === "error" && <p role="alert" className="error">{state.message}</p>}
    {review && <div className="info-card">
      <strong>AI-inferred review, not independent verification</strong><p>{review.summary}</p>
      <ol>{[...review.rankings].sort((a,b) => b.similarity-a.similarity).slice(0,5).map(x =>
        <li key={x.id}>{result?.comparables.find(i => i.id === x.id)?.title}: {x.reason} ({x.primaryProduct}, similarity {x.similarity}/100 — model judgment)</li>
      )}</ol>
      <ul>{review.uncertainties.map(x => <li key={x}>{x}</li>)}</ul>
    </div>}
  </section>;
}
