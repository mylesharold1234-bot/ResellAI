"use client";
import { IdentificationWarning } from "../../components/identification-warning";
import {recognizableName} from "../../lib/product-profile";
import { useRef, useState } from "react";
import { MatchDetailsFields } from "../../components/match-details-fields";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, UploadCloud, X, ArrowRight } from "lucide-react";
import { useIdentification } from "../../components/identification-context";
import {
  fieldLabels,
  identityFields,
  parseIdentification,
} from "../../lib/identification";
import { validateImageBatch, validateImageBytes } from "../../lib/images";
import type { ProductPhoto } from "../../lib/identification-workflow";
import { loadingMessages, RequestProgress, RequestSpinner, SkeletonLines } from "../../components/request-loading";
import { useRequest } from "../../components/use-request";
import type { Identification } from "../../lib/identification";

export default function Analyze() {
  const { state, dispatch } = useIdentification();
  const router = useRouter();
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const analysis = useRequest<Identification>(JSON.stringify(state.photos.map(photo => photo.id)));
  const busy = analysis.state.status === "loading";
  const [photoStatus, setPhotoStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const selecting = photoStatus === "loading";
  const selectingRef = useRef(false);
  const [notes, setNotes] = useState("");
  const camera = useRef<HTMLInputElement>(null);
  const selectionVersion = useRef(0);
  async function select(input: FileList | null) {
    if (!input?.length || busy || selectingRef.current) return;
    selectingRef.current = true;
    setError("");
    setPhotoStatus("loading");
    const version = ++selectionVersion.current;
    const created: ProductPhoto[] = [];
    try {
      const files = [...input];
      validateImageBatch([
        ...state.photos.flatMap((p) => (p.file ? [p.file] : [])),
        ...files,
      ]);
      for (const file of files) {
        validateImageBytes(file.type, new Uint8Array(await file.arrayBuffer()));
        const url = URL.createObjectURL(file);
        created.push({ id: crypto.randomUUID(), url, name: file.name, file });
        await new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () =>
            image.naturalWidth * image.naturalHeight > 40_000_000
              ? reject(new Error("Choose a photo under 40 megapixels."))
              : resolve();
          image.onerror = () =>
            reject(
              new Error(
                "This image could not be opened. Choose a different photo.",
              ),
            );
          image.src = url;
        });
      }
      if (version === selectionVersion.current) {
        dispatch({ type: "photos", photos: [...state.photos, ...created] });
        setPhotoStatus("success");
      } else created.forEach((p) => URL.revokeObjectURL(p.url));
    } catch (e) {
      created.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotoStatus("error");
      setError((e as Error).message);
    } finally {
      selectingRef.current = false;
    }
  }
  function identify() {
    if (selectingRef.current || !state.photos.length) return;
    setError("");
    return analysis.run(async signal => {
      const files = state.photos.flatMap((p) => (p.file ? [p.file] : []));
      validateImageBatch(files);
      const form = new FormData();
      files.forEach(file => form.append("images", file));
      form.append("notes", notes);
      try {
        const response = await fetch("/api/identify", {
          method: "POST", body: form,
          signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
        });
        const payload = await response.json();
        if (!response.ok) throw Error(payload.error || "Identification failed. Please try again.");
        return parseIdentification(payload.identification);
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw Error("Identification took too long. Please try again.");
        if (error instanceof TypeError || error instanceof SyntaxError) throw Error("Could not read the identification response. Please try again.");
        throw error;
      }
    }, identification => dispatch({ type: "identified", identification }));
  }
  function remove(id: string) {
    dispatch({
      type: "photos",
      photos: state.photos.filter((p) => p.id !== id),
    });
    setError("");
  }
  function confirm(mode: "general" | "refined" = "refined") {
    try {
      dispatch({ type: "confirm", mode, requestId: crypto.randomUUID() });
      router.push("/analysis");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const canConfirm = !!state.draft && !!recognizableName(state.draft);
  const editField = (k: (typeof identityFields)[number], v: string) =>
    dispatch({ type: "edit", identification: { ...state.draft!, [k]: v || null } });
  const essentials = (["productName", "brand", "model", "colorway"] as const).filter((k) => identityFields.includes(k));
  const others = identityFields.filter((k) => !essentials.includes(k as (typeof essentials)[number]));
  const labels: Record<string, string> = { productName: "Item", brand: "Brand", model: "Model", colorway: "Color" };
  return (
    <section className="wrap workspace narrow analyze">
      {!state.draft || busy ? (
        <>
          <h1 className="page-title">What are you selling?</h1>
          <p className="lead">Add a clear photo of the item. A close-up of the label or tag helps.</p>
          <div
            className={`upload-zone ${drag ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (!busy && !selecting) void select(e.dataTransfer.files);
            }}
          >
            {state.photos.length > 0 ? (
              <div className="photo-grid">
                {state.photos.map((photo, i) => (
                  <div key={photo.id} className="photo-tile">
                    <img className="upload-preview" src={photo.url} alt={`Your photo ${i + 1}`} />
                    <button disabled={busy || selecting} className="icon-button photo-remove" onClick={() => remove(photo.id)} aria-label={`Remove photo ${i + 1}`}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="upload-icon"><UploadCloud size={24} aria-hidden="true" /></div>
                <h2>Drop photos here</h2>
                <p>or choose them from your device</p>
              </>
            )}
            {state.photos.length < 3 && (
              <div className="upload-actions">
                <label className={state.photos.length ? "secondary file-button" : "button file-button"}>
                  {selecting ? "Opening…" : state.photos.length ? "Add another photo" : "Choose photos"}
                  <input
                    disabled={busy || selecting}
                    multiple
                    aria-label="Choose product photos"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      void select(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button disabled={busy || selecting} className="secondary" onClick={() => camera.current?.click()}>
                  <Camera size={17} aria-hidden="true" /> Take a photo
                </button>
              </div>
            )}
            {selecting && <RequestProgress title="Opening your photos…" />}
            <small>Up to 3 photos · JPG, PNG or WebP</small>
            <input
              hidden
              ref={camera}
              aria-label="Take an item photo"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy || selecting}
              onChange={(e) => {
                void select(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <details className="details-link block">
            <summary>Add a note for the AI (optional)</summary>
            <textarea
              aria-label="Note about the item"
              maxLength={1500}
              rows={3}
              disabled={busy}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Size, label text, or anything the photo doesn't show"
            />
          </details>

          <div className="analyze-cta">
            <button disabled={busy || selecting || !state.photos.length} className="button" onClick={() => void identify()}>
              {busy ? (
                <>
                  <RequestSpinner size={17} /> Identifying…
                </>
              ) : (
                <>
                  {analysis.state.status === "error" ? "Try again" : "Identify item"} <ArrowRight size={17} aria-hidden="true" />
                </>
              )}
            </button>
            <p className="fine">Photos are sent to OpenAI to identify the item and aren&apos;t stored. AI can make mistakes and can&apos;t verify authenticity.</p>
          </div>
          <div role="status" className="sr-only">{selecting ? "Opening your photos." : busy ? "Identifying your item." : ""}</div>
          {busy && (
            <div className="card analyze-loading" aria-label="Identifying your item">
              <RequestProgress title="Identifying your item…" messages={loadingMessages.identification} />
              <div aria-busy="true"><SkeletonLines count={3} /></div>
            </div>
          )}
          {analysis.state.status === "error" && <p role="alert" className="error">{analysis.state.message}</p>}
          {error && <p role="alert" className="error">{error}</p>}
          <p className="fine block"><Link className="text-link" href="/analysis?demo=1">See an example report</Link></p>
        </>
      ) : (
        <>
          <button type="button" className="back" onClick={() => dispatch({ type: "photos", photos: state.photos })}>← Change photos</button>
          <h1 className="page-title">Is this right?</h1>
          <p className="lead">Check what we found. Size and condition make the price much more accurate.</p>
          {analysis.state.status === "error" && <p role="alert" className="error">{analysis.state.message}</p>}
          {error && <p role="alert" className="error">{error}</p>}

          <section className="card confirm-card" aria-label="Review identification">
            <div className="confirm-head">
              {state.photos[0] && <img className="confirm-photo" src={state.photos[0].url} alt="Your item" />}
              <div className="confirm-name">
                <label className="sr-only" htmlFor="id-productName">Item name</label>
                <input
                  id="id-productName"
                  className="confirm-name-input"
                  maxLength={150}
                  value={state.draft.productName || ""}
                  placeholder="What is it?"
                  onChange={(e) => editField("productName", e.target.value)}
                />
                <span className={`pill ${state.draft.confidence === "high" ? "success" : state.draft.confidence === "low" ? "warning" : ""}`}>
                  {state.draft.confidence === "high" ? "Confident match" : state.draft.confidence === "low" ? "Not sure, please check" : "Likely match"}
                </span>
              </div>
            </div>

            <div className="details-grid">
              {essentials.filter((k) => k !== "productName").map((k) => (
                <label className="field" key={k}>
                  {labels[k]}
                  <input maxLength={150} disabled={selecting} value={state.draft![k] || ""} placeholder="Unknown" onChange={(e) => editField(k, e.target.value)} />
                </label>
              ))}
            </div>
            <MatchDetailsFields identification={state.draft} value={state.details} onChange={(details) => dispatch({ type: "details", details })} disabled={selecting} part="essential" />

            {state.draft.uncertainties.length > 0 && (
              <p className="fine confirm-note">Not certain: {state.draft.uncertainties.join(" ")}</p>
            )}
            {!!state.draft.understanding?.conflicts.length && (
              <div className="warn-box" role="alert">
                <strong>Your photo and note don&apos;t agree:</strong> {state.draft.understanding.conflicts.join(" ")} Fix the details above before continuing.
              </div>
            )}
            <IdentificationWarning identification={state.draft} details={state.details} />

            <details className="disclosure confirm-more">
              <summary>More details <small>Optional</small></summary>
              <div className="disclosure-body">
                <div className="details-grid">
                  {others.map((k) => (
                    <label className="field" key={k}>
                      {fieldLabels[k]}
                      <input maxLength={1500} disabled={selecting} value={state.draft![k] || ""} placeholder="Unknown" onChange={(e) => editField(k, e.target.value)} />
                    </label>
                  ))}
                </div>
                <MatchDetailsFields identification={state.draft} value={state.details} onChange={(details) => dispatch({ type: "details", details })} disabled={selecting} part="more" />
                {(state.draft.understanding?.candidates?.length || state.draft.additionalEvidence.length) ? (
                  <div className="fine">
                    {!!state.draft.understanding?.candidates?.length && <p>Other possibilities: {state.draft.understanding.candidates.map((c) => c.model + (c.variant ? ` (${c.variant})` : "")).join(", ")}.</p>}
                    {!!state.draft.additionalEvidence.length && <p>A photo of these would help: {state.draft.additionalEvidence.join("; ")}.</p>}
                  </div>
                ) : null}
              </div>
            </details>

            <div className="confirm-actions">
              <button disabled={busy || selecting || !canConfirm} className="button" onClick={() => confirm("refined")}>
                Looks right — see prices <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button type="button" className="secondary" disabled={busy || selecting} onClick={() => void identify()}>
                Identify again
              </button>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
