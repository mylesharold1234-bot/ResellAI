"use client";
import { useEffect, useMemo, useRef } from "react";
import { CheckCircle2, Download, ExternalLink, Send, X } from "lucide-react";
import { buildAspects, chosenConditionId } from "../../lib/ebay-seller/payload";
import { marketplaces } from "../../lib/listing/categories";
import { exportListing } from "../../lib/listing/export";
import type { ReadinessIssue } from "../../lib/listing/readiness";
import { conditionPhrase } from "../../lib/listing/template";
import { CopyButton, dollars } from "./listing-bits";
import { RequirementList, type FixContext } from "./requirement-fix";

export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Review & publish. Always available: it shows the finished listing, then exactly what still blocks publishing
 * (each with an inline fix) apart from optional suggestions. Only the final publish button is disabled, and
 * only by genuine requirements; the server re-checks the same rules before anything reaches eBay.
 */
export function ReviewDialog({
  ctx,
  blockers,
  optional,
  mainPhoto,
  focus = "review",
  onClose,
}: {
  ctx: FixContext;
  blockers: ReadinessIssue[];
  optional: ReadinessIssue[];
  mainPhoto?: string;
  /** "fix" opens straight onto the first missing detail. */
  focus?: "review" | "fix";
  onClose: () => void;
}) {
  const { draft, seller } = ctx;
  const ref = useRef<HTMLDivElement>(null);
  const isEbay = draft.marketplace === "ebay";
  const profile = marketplaces[draft.marketplace];
  const status = seller?.status;
  const live = status?.environment === "production" && !status.testEndpoints;
  const published = draft.ebay.publish?.status === "published" ? draft.ebay.publish : null;
  const listingId = seller?.listing?.listingId || published?.listingId;

  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const firstFix = focus === "fix" ? el?.querySelector<HTMLElement>(".lx-review-reqs input, .lx-review-reqs select, .lx-review-reqs button, .lx-review-reqs a") : null;
    if (firstFix) {
      el?.querySelector(".lx-review-reqs")?.scrollIntoView({ block: "start" });
      firstFix.focus({ preventScroll: true });
    } else el?.querySelector<HTMLElement>("h2")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && seller?.phase !== "uploading" && seller?.phase !== "publishing") onClose();
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
    // Focus is set once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, seller?.phase]);

  const aspects = useMemo(() => buildAspects(draft, seller?.rules?.aspects), [draft, seller?.rules]);
  const s = seller?.setup;
  const policyNames = s
    ? [
        s.policies.fulfillment.find((p) => p.id === draft.ebay.fulfillmentPolicyId)?.name,
        s.policies.payment.find((p) => p.id === draft.ebay.paymentPolicyId)?.name,
        s.policies.return.find((p) => p.id === draft.ebay.returnPolicyId)?.name,
      ].filter(Boolean)
    : [];
  // eBay's own name for the condition once the category's rules are loaded; until then the plain-language phrase.
  const ebayConditionName = seller?.rules?.conditions.find((c) => c.id === chosenConditionId(draft))?.name || "";
  const photoCount = draft.photos.filter((p) => p.selected).length + draft.ebay.imageUrls.length;
  const busy = seller?.phase === "uploading" || seller?.phase === "publishing";
  const checking = isEbay && (!status || seller?.rulesState === "loading");
  const disabledReason = !isEbay
    ? ""
    : !status
      ? "Checking your eBay connection…"
      : !status.publishingEnabled && status.configured
        ? "Publishing is switched off on this server (EBAY_SELLER_PUBLISHING_ENABLED)."
        : blockers.length
          ? `Resolve ${blockers.length} required item${blockers.length === 1 ? "" : "s"} above to publish.`
          : seller?.rulesState === "loading"
            ? "Checking eBay's requirements for this category…"
            : "";
  const canPublish = isEbay && !!status?.publishingEnabled && !blockers.length && !busy && !checking && !published;
  const exported = exportListing(draft);

  return (
    <div className="dialog-backdrop lx-review-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="lx-review" role="dialog" aria-modal="true" aria-labelledby="review-h" ref={ref}>
        <header className="lx-review-head">
          <div>
            <h2 id="review-h" tabIndex={-1}>Review & {isEbay ? "publish" : "export"}</h2>
            {isEbay && status && (
              <span className={`badge ${live ? "identified" : "inferred"}`}>{status.testEndpoints ? "Test endpoints · simulated" : live ? "eBay · live listing" : "eBay Sandbox · test listing"}</span>
            )}
          </div>
          <button type="button" className="lx-icon-btn" onClick={onClose} aria-label="Close review" disabled={busy}><X size={18} /></button>
        </header>

        <div className="lx-review-body">
          <section className="lx-review-preview" aria-label="Listing preview">
            <div className="lx-review-photo">{mainPhoto ? <img src={mainPhoto} alt="" /> : <div className="thumb" />}</div>
            <div>
              <h3 className="lx-review-title">{draft.title.value || <span className="lx-muted">No title yet</span>}</h3>
              <p className="lx-review-price">{dollars(draft.pricing.price)}</p>
              <dl className="lx-review-dl">
                <dt>Condition</dt><dd>{(isEbay && ebayConditionName) || conditionPhrase(draft) || "—"}</dd>
                {isEbay && <><dt>Category</dt><dd>{draft.ebay.categoryName?.split(/ [›>] /).slice(-2).join(" › ") || "—"}</dd></>}
                <dt>Photos</dt><dd>{photoCount}{isEbay && seller?.pending.length ? ` (${seller.pending.length} upload to eBay when you publish)` : ""}</dd>
                {isEbay && <><dt>Shipping & returns</dt><dd>{policyNames.length ? policyNames.join(" · ") : "—"}</dd></>}
                {isEbay && <><dt>Ships from</dt><dd>{s?.locations.find((l) => l.key === draft.ebay.merchantLocationKey)?.name || "—"}</dd></>}
                <dt>Item specifics</dt>
                <dd>{(isEbay ? Object.entries(aspects).map(([k, v]) => `${k}: ${v[0]}`) : exported.specifics.map(([k, v]) => `${k}: ${v}`)).join(" · ") || "—"}</dd>
              </dl>
            </div>
            <details className="lx-review-desc">
              <summary>Description</summary>
              <div className="lx-desc-preview">{draft.description.value || "No description yet."}</div>
            </details>
          </section>

          <section aria-labelledby="req-h" className="lx-review-reqs">
            {blockers.length ? (
              <>
                <h3 id="req-h" className="lx-review-sub">Required before publishing <span className="lx-count bad">{blockers.length}</span></h3>
                <RequirementList issues={blockers} ctx={ctx} kind="blocker" />
              </>
            ) : (
              <p id="req-h" className="lx-ready"><CheckCircle2 size={17} /> Everything {profile.label} requires is complete.</p>
            )}
            {optional.length > 0 && (
              <details className="lx-optional">
                <summary>Optional improvements ({optional.length})</summary>
                <RequirementList issues={optional} ctx={ctx} kind="optional" />
              </details>
            )}
          </section>

          {isEbay && seller?.result && (
            <div className={seller.result.ok ? "tip" : "warn-box"} role="status">
              {seller.result.message}
              {!!seller.result.issues?.length && <ul>{seller.result.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
            </div>
          )}
          {isEbay && listingId && (
            <div className="ready-banner">
              <CheckCircle2 size={18} /> Listed {status?.testEndpoints ? "on the test server" : status?.environment === "sandbox" ? "on eBay Sandbox" : "on eBay"} · #{listingId}
              <a className="text-link" target="_blank" rel="noopener noreferrer" href={seller?.listing?.url || `${status?.environment === "sandbox" ? "https://sandbox.ebay.com" : "https://www.ebay.com"}/itm/${listingId}`}>
                View <ExternalLink size={13} />
              </a>
            </div>
          )}
          {isEbay && draft.ebay.publish?.status === "failed" && !seller?.result && <p className="lx-muted">Last attempt: {draft.ebay.publish.lastError}</p>}
        </div>

        <footer className="lx-review-foot">
          {isEbay ? (
            <>
              <p className="lx-foot-note" role="status">
                {busy
                  ? seller?.phase === "uploading"
                    ? "Uploading photos…"
                    : "Creating the listing…"
                  : published
                    ? "This listing is already published."
                    : disabledReason ||
                      (status?.testEndpoints
                        ? "Sends to the local test server configured on this machine. Nothing reaches eBay."
                        : live
                          ? "Buyers can purchase this immediately."
                          : "Creates a test listing in eBay's Sandbox. Real buyers won't see it.")}
              </p>
              <div className="lx-foot-actions">
                <button type="button" className="secondary lx-secondary" onClick={onClose} disabled={busy}>{published ? "Done" : "Keep editing"}</button>
                {!published && (
                  <button type="button" className="button" disabled={!canPublish} aria-busy={busy} onClick={() => void seller?.publish(draft)}>
                    <Send size={16} /> {busy ? "Publishing…" : status?.testEndpoints ? "Publish to test server" : live ? "Publish live on eBay" : "Publish to eBay Sandbox"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="lx-foot-note">ResellAI doesn't post to {profile.label} for you; paste these into its listing form.</p>
              <div className="lx-foot-actions">
                <CopyButton text={exported.title} label="Copy title" />
                <CopyButton text={exported.description} label="Copy description" />
                <CopyButton text={exported.text} label="Copy everything" />
                <button type="button" className="mini-button" onClick={() => downloadText(`${(draft.title.value || "listing").replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.txt`, exported.text)}><Download size={14} /> .txt</button>
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
