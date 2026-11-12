"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useIdentification } from "./identification-context";
import { FacebookLocationFields } from "./facebook-location-fields";
import {
  FACEBOOK_PERMISSION_MESSAGE,
  type FacebookResult,
} from "../lib/facebook";
import type { facebookValuation } from "../lib/facebook-valuation";
import { parseMatchDetails } from "../lib/marketplaces";
// Shared within this tab: StrictMode/remounts reuse the same confirmation action, not another billed search.
const confirmations = new Map<
  string,
  { key: string; promise: Promise<FacebookData> }
>();
type FacebookData = {
  result: FacebookResult;
  valuation: ReturnType<typeof facebookValuation>;
};
const money = (v: number | null | undefined) =>
  v == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(v);
export function FacebookMarketplaceSection() {
  const { state, dispatch } = useIdentification();
  const [access, setAccess] = useState<{
    enabled: boolean;
    keyConfigured: boolean;
  } | null>(null);
  const [saved, setSaved] = useState<{
    key: string;
    intentId: string;
    data: FacebookData;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tips, setTips] = useState<string[]>([]);
  const [adviceBusy, setAdviceBusy] = useState(false);
  const version = useRef(0);
  const currentKey = useRef("");
  const key = JSON.stringify({
    identification: state.confirmed,
    details: state.details,
    location: state.facebookLocation,
  });
  currentKey.current = key;
  const data = saved?.key === key ? saved.data : null;
  const result = data?.result;
  const valuation = data?.valuation;
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let live = true;
    void fetch("/api/marketplaces/facebook", { cache: "no-store" })
      .then((r) => r.json())
      .then((v) => {
        if (live) setAccess(v);
      })
      .catch(() => {
        if (live) setAccess({ enabled: false, keyConfigured: false });
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  async function search(intentId: string, trigger: "confirmation" | "refresh") {
    if (!state.confirmed || !state.facebookLocation) return;
    const requestKey = key;
    const serial = ++version.current;
    setBusy(true);
    setError("");
    setTips([]);
    setSaved(null);
    try {
      const details = parseMatchDetails(state.details);
      const run = () =>
        fetch("/api/marketplaces/facebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identification: state.confirmed,
            details,
            location: state.facebookLocation,
            intentId,
            trigger,
          }),
          signal: AbortSignal.timeout(35000),
        }).then(async (r) => {
          const v = await r.json();
          if (!r.ok) throw Error(v.error || "Facebook search failed.");
          return v as FacebookData;
        });
      const existing = confirmations.get(intentId);
      if (existing && existing.key !== requestKey)
        throw Error(
          "Search details changed after confirmation. Request an explicit update.",
        );
      let promise = existing?.promise;
      if (!promise) {
        promise = run();
        if (confirmations.size >= 50)
          confirmations.delete(confirmations.keys().next().value!);
        confirmations.set(intentId, { key: requestKey, promise });
      }
      const response = await promise;
      if (currentKey.current === requestKey && serial === version.current)
        setSaved({ key: requestKey, intentId, data: response });
    } catch (e) {
      if (currentKey.current === requestKey)
        setError(
          e instanceof Error
            ? e.message
            : "Could not search Facebook Marketplace.",
        );
    } finally {
      if (serial === version.current) setBusy(false);
    }
  }
  const autoId = state.confirmationId;
  useEffect(() => {
    if (!autoId || !access?.enabled || !access.keyConfigured) return;
    if (state.confirmed && state.facebookLocation)
      void search(autoId, "confirmation");
  }, [autoId, access?.enabled, access?.keyConfigured]);
  const expired = !!result?.expiresAt && Date.parse(result.expiresAt) <= clock;
  async function advice() {
    if (!saved || !data) return;
    setAdviceBusy(true);
    setError("");
    const requestKey = key;
    try {
      const r = await fetch("/api/marketplaces/facebook/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: saved.intentId }),
        signal: AbortSignal.timeout(35000),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error || "Advice is unavailable.");
      if (currentKey.current === requestKey) setTips(v.tips);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Advice is unavailable.");
    } finally {
      setAdviceBusy(false);
    }
  }
  return (
    <section className="panel block facebook-section">
      <div className="section-heading">
        <div>
          <h2>Facebook Marketplace</h2>
          <p className="muted">
            Local asking-price comparisons through Social Fetch.
          </p>
        </div>
        <span className="pill">
          {access?.enabled ? "ASKING ≠ SOLD" : "DISABLED · USE NOT VERIFIED"}
        </span>
      </div>
      {!access?.enabled && (
        <div className="info-card" role="status">
          <strong>Provider requests are disabled.</strong>
          <p>{FACEBOOK_PERMISSION_MESSAGE}</p>
          <p>
            No listing search, location lookup, image fetch or AI advice request
            is made while disabled. No Social Fetch credits are spent.
          </p>
        </div>
      )}
      {access?.enabled && !access.keyConfigured && (
        <p className="error">
          SOCIAL_FETCH_API_KEY is not loaded by this ResellAI server. Check
          resellai/.env.local and restart.
        </p>
      )}
      <FacebookLocationFields
        value={state.facebookLocation}
        onChange={(location) =>
          dispatch({ type: "facebook-location", location })
        }
        disabled={busy}
      />
      <button
        className="button block"
        disabled={
          !access?.enabled ||
          !access.keyConfigured ||
          !state.confirmed ||
          !state.facebookLocation ||
          busy
        }
        onClick={() => void search(crypto.randomUUID(), "refresh")}
      >
        {busy ? (
          <>
            <LoaderCircle size={17} className="spinner" />
            Searching Facebook…
          </>
        ) : (
          "Update Facebook comparisons"
        )}
      </button>
      <p className="fine block">
        A confirmation searches only if an area was selected and permitted use
        is enabled. Updating is explicit. No refresh polling, automatic retries,
        pagination or paid geocoding. One provider page is documented as one
        credit; actual charges come from response metadata. Local limits: five
        requests/hour, one concurrent call, ten-minute cache.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result?.reason && (
        <div className="info-card">
          <p>{result.reason}</p>
        </div>
      )}
      {result && (
        <p className="fine block">
          Credits charged for this operation:{" "}
          {result.creditsCharged === null
            ? "Unknown — check provider billing"
            : result.creditsCharged}
          {result.cached ? " (local cache; no provider call)" : ""}.{" "}
          {result.requestId ? `Provider reference: ${result.requestId}` : ""}
        </p>
      )}
      {data &&
        result?.status !== "disabled" &&
        result?.status !== "unavailable" && (
          <>
            <div className="market-stats block">
              <div>
                <span className="muted">Median asking</span>
                <strong>{money(valuation?.statistics?.median)}</strong>
              </div>
              <div>
                <span className="muted">Observed asking range</span>
                <strong>
                  {valuation?.askingRange
                    ? `${money(valuation.askingRange.low)} – ${money(valuation.askingRange.high)}`
                    : "Unavailable"}
                </strong>
              </div>
              <div>
                <span className="muted">Suggested listing</span>
                <strong>
                  {money(expired ? null : valuation?.suggestedListingPrice)}
                </strong>
              </div>
              <div>
                <span className="muted">Relevant listings</span>
                <strong>{valuation?.statistics?.count || 0}</strong>
              </div>
            </div>
            <div className="info-card">
              <strong>
                Evidence quality:{" "}
                {expired ? "expired" : valuation?.evidenceQuality}
              </strong>
              <p>{valuation?.explanation}</p>
              <p>
                <strong>Estimated selling-price range: unavailable.</strong>{" "}
                {valuation?.sellingRangeExplanation}
              </p>
            </div>
            {result?.status === "no_matches" && (
              <p className="fine">
                Insufficient matching, explicitly USD-priced, currently
                available listings. Currency, status or requested details may
                not be verifiable; no demo prices are substituted.
              </p>
            )}
            <p className="fine block">
              Retrieved:{" "}
              {result?.retrievedAt
                ? new Date(result.retrievedAt).toLocaleString()
                : "Unavailable"}{" "}
              · {result?.examined} examined · {result?.excluded} mismatches ·{" "}
              {result?.invalid} invalid/ambiguous rows.{" "}
              {expired ? "Snapshot expired. Request an explicit update." : ""}
            </p>
            <div className="facebook-listings block">
              {result?.comparables.map((item) => (
                <article className="panel" key={item.id}>
                  {item.photo ? (
                    <img
                      src={item.photo}
                      alt={item.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="photo-placeholder">Photo unavailable</div>
                  )}
                  <h3>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.title} ↗
                    </a>
                  </h3>
                  <strong>{money(item.price)}</strong>
                  <p className="muted">{item.location}</p>
                  <p className="fine">{item.condition}</p>
                  <p className="fine">{item.matchReasons.join(" · ")}</p>
                </article>
              ))}
            </div>
            <ul className="evidence-list">
              {valuation?.warnings.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <button
              className="secondary"
              disabled={adviceBusy || expired || !result?.comparables.length}
              onClick={() => void advice()}
            >
              {adviceBusy
                ? "Generating advice…"
                : "Generate qualitative AI selling advice"}
            </button>
            <p className="fine">
              Optional OpenAI usage; one request per search action. AI explains
              evidence and uncertainty; it does not supply prices.
            </p>
            {tips.length > 0 && (
              <div className="info-card">
                <strong>AI-generated qualitative advice</strong>
                <ul>
                  {tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
    </section>
  );
}
