"use client";
import { IdentificationWarning } from "../../components/identification-warning";
import {recognizableName} from "../../lib/product-profile";
import { useRef, useState } from "react";
import { FacebookLocationFields } from "../../components/facebook-location-fields";
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
  const canConfirm =
    !!state.draft && !!recognizableName(state.draft);
  return (
    <section className="wrap workspace narrow">
      <div className="demo-notice">
        <Camera size={17} />
        <span>
          <strong>AI identification.</strong> Review the result before
          confirming. eBay asks for matching details after identification. Sold
          prices are not available.
        </span>
      </div>
      <Link className="back" href="/dashboard">
        ← Back to dashboard
      </Link>
      <div className="eyebrow">A PHOTO IS ALL IT TAKES</div>
      <h1 className="page-title">What’s your next find?</h1>
      <p className="lead">
        Start with a clear photo. Add close-ups of labels or details for a
        better match.
      </p>
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
              <div key={photo.id}>
                <img
                  className="upload-preview"
                  src={photo.url}
                  alt={`Uploaded product photo ${i + 1}`}
                />
                <p>{photo.name}</p>
                <button
                  disabled={busy || selecting}
                  className="secondary"
                  onClick={() => remove(photo.id)}
                >
                  <X size={16} />
                  Remove photo {i + 1}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="upload-icon">
              <UploadCloud size={32} />
            </div>
            <h2>Drop your next opportunity here</h2>
            <p>Drag photos here, or choose them from your device.</p>
          </>
        )}
        {state.photos.length < 3 && (
          <>
            <label className="button file-button">
              {selecting
                ? "Opening photos…"
                : state.photos.length
                  ? "Add more photos"
                  : "Choose a photo"}
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
            <button
              disabled={busy || selecting}
              className="text-link"
              onClick={() => camera.current?.click()}
            >
              <Camera size={18} />
              Take a photo
            </button>
          </>
        )}
        {selecting && <RequestProgress title="Opening your photos…" messages={["Checking image format and size"]} />}
        <small>JPG, PNG, WebP · Up to 3 photos · 10 MB combined</small>
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
      <label className="notes-label">
        Additional information (optional)
        <textarea
          maxLength={1500}
          rows={3}
          disabled={busy}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Visible label text, size, suspected model, or details the photo doesn’t show…"
        />
      </label>
      <div className="info-card">
        <strong>
          Photos are sent to OpenAI when you choose Identify Item.
        </strong>
        <p>
          Use product-only photos. The app keeps photos in browser memory, with
          no permanent storage; a reload clears this session. AI can make
          mistakes and cannot verify authenticity.
        </p>
      </div>
      <button
        disabled={busy || selecting || !state.photos.length}
        className="button"
        onClick={() => void identify()}
      >
        {busy ? (
          <>
            <RequestSpinner size={18} />
            Analyzing your product…
          </>
        ) : (
          <>
            {analysis.state.status === "error" ? "Retry image analysis" : state.draft ? "Re-analyze with photos & details" : "Identify Item"}
            <ArrowRight size={18} />
          </>
        )}
      </button>
      <div role="status" className="sr-only">{selecting ? "Opening your photos." : busy ? "Analyzing your product. " + loadingMessages.identification.join(". ") : analysis.state.status === "success" ? "Identification ready to review." : ""}</div>
      {busy && <section className="panel block" aria-label="Product identification">
        <RequestProgress title="Analyzing your product…" messages={loadingMessages.identification} />
        <div aria-busy="true"><SkeletonLines count={5} /></div>
      </section>}
      {analysis.state.status === "error" && <p role="alert" className="error">{analysis.state.message}{state.draft ? " The identification below is from the previous analysis." : ""}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {state.draft && !busy && (
        <section
          className="panel block identification-review"
          aria-label="Review identification"
        >
          <div className="row">
            <h2>Review identification</h2>
            <span className="pill">
              {state.draft.confidence.toUpperCase()} CONFIDENCE
            </span>
          </div>
          <p className="fine">
            Model self-assessment, not a measured accuracy score. Edit any field
            before confirming.
          </p>
          {state.draft.understanding?.evidence.some(e=>["materials","logos","colorPlacement"].includes(e.field)) && <details className="info-card">
            <summary>Photo details and their sources</summary>
            <ul>{state.draft.understanding.evidence.filter(e=>["materials","logos","colorPlacement"].includes(e.field)).map((e,index)=><li key={index}>
              {e.value} ({e.source==="image-visible"?"visible in photo":e.source==="user-described"?"user supplied":"AI inferred"})
            </li>)}</ul>
          </details>}
          {!!state.draft.understanding?.candidates?.length && <details className="info-card">
            <summary>Possible identities (unverified)</summary>
            <ul>{state.draft.understanding.candidates.map((candidate,index)=><li key={index}>
              <strong>{candidate.model}{candidate.variant?" — "+candidate.variant:""}</strong>: {candidate.basis}
            </li>)}</ul>
          </details>}
          {state.draft.uncertainties.length > 0 && (
            <div className="info-card">
              <strong>What’s uncertain</strong>
              <ul>
                {state.draft.uncertainties.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {(state.draft.additionalEvidence.length > 0 ||
            state.draft.confidence === "low") && (
            <div className="info-card">
              <strong>A closer look would help</strong>
              <p>
                Add up to three photos above or provide more information, then
                re-analyze.
              </p>
              <ul>
                {state.draft.additionalEvidence.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {!!state.draft.understanding?.conflicts.length && <div className="info-card" role="alert"><strong>Image and description need clarification</strong><ul>{state.draft.understanding.conflicts.map(c=><li key={c}>{c}</li>)}</ul><p>Correct the relevant fields below, then confirm that you reviewed the disagreement. General discovery remains available.</p><label><input type="checkbox" style={{width:"auto"}} checked={state.draft.userReviewedConflicts===true} onChange={e=>dispatch({type:"edit",identification:{...state.draft!,userReviewedConflicts:e.target.checked}})} /> I clarified the conflicting details</label></div>}
          {state.draft.understanding && <p className="fine">Primary product: {state.draft.understanding.primaryProduct}. Subtype and accessory fields may be AI-inferred or user-described; review them before confirmation.</p>}
          <IdentificationWarning identification={state.draft} details={state.details} />
          <details className="block"><summary className="secondary">Add item details (optional)</summary>
          <div className="identity-fields">
            {identityFields.map((k) => (
              <label key={k}>
                {fieldLabels[k]}
                {k === "productName" ? " (recognizable description)" : " (optional)"}
                <small>{`${state.sources[k] || "ai-inferred"}; not independently verified`}</small>
                <input
                  maxLength={1500}
                  disabled={busy || selecting}
                  value={state.draft![k] || ""}
                  placeholder="Unknown / not visible"
                  onChange={(e) =>
                    dispatch({
                      type: "edit",
                      identification: {
                        ...state.draft!,
                        [k]: e.target.value || null,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p className="fine">
            A recognizable item description is enough to search. Brand, model and SKU are optional. Your corrections do not
            increase the AI’s confidence.
          </p>
          <h3 className="block">Improve comparable matching (optional)</h3>
          <p className="fine">
            Enter size and condition. Include only an exact identifier you can
            verify; never infer it from a colorway.
          </p>
          <MatchDetailsFields
            identification={state.draft}
            value={state.details}
            onChange={(details) => dispatch({ type: "details", details })}
            disabled={busy || selecting}
          />
          <FacebookLocationFields
            value={state.facebookLocation}
            onChange={(location) =>
              dispatch({ type: "facebook-location", location })
            }
            disabled={busy || selecting}
          />
          <button
            disabled={busy || selecting || !canConfirm}
            className="button"
            onClick={() => confirm("refined")}
          >
            Continue with these details <ArrowRight size={18} />
          </button>
          </details>
          <button className="button block" disabled={busy || selecting || !canConfirm} onClick={() => confirm("general")}>No, continue with general search <ArrowRight size={18} /></button>
          <p className="fine">
            Next: your item photo and confirmed details alongside an eBay
            active-listing report. Asking prices are not completed-sale prices.
          </p>
        </section>
      )}
      <p className="fine block">
        <Link href="/analysis?demo=1">
          Explore the fictional pricing example without AI →
        </Link>
      </p>
    </section>
  );
}
