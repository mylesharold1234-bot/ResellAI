"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AllowedCondition, CategoryAspect } from "../../lib/ebay-seller/client";
import { ebayRequirements, photosNeedingUpload, suggestedConditionId } from "../../lib/ebay-seller/payload";
import { choosePolicies, type SellerPrefs } from "../../lib/ebay-seller/preferences";
import { getPhotos } from "../../lib/listing/drafts-store";
import type { ReadinessIssue } from "../../lib/listing/readiness";
import type { EbayHostedImage, ListingDraft } from "../../lib/listing/types";

export type SellerStatus = {
  environment: "production" | "sandbox";
  configured: boolean;
  missing: string[];
  publishingEnabled: boolean;
  testEndpoints: boolean;
  appUrl?: string;
  connected: boolean;
  connectedAt: string | null;
  check?: { ok: boolean; message: string };
};
export type PolicyOption = { id: string; name: string; calculated?: boolean };
export type SellerSetup = { policies: { fulfillment: PolicyOption[]; payment: PolicyOption[]; return: PolicyOption[] }; locations: { key: string; name: string }[] };
export type CategoryRulesState = { aspects: CategoryAspect[]; conditions: AllowedCondition[]; conditionRequired: boolean };
export type CategoryOption = { id: string; name: string; path: string };
export type ListingStatus = { listingId: string | null; listingStatus: string | null; offerStatus: string | null; url: string | null };
export type PublishResult = { ok: boolean; message: string; issues?: string[] };
type Patch = Partial<ListingDraft["ebay"]>;

const connectMessages: Record<string, string> = {
  connected: "eBay account connected.",
  declined: "You declined access on eBay, so nothing was connected. Connect again whenever you're ready.",
  "state-mismatch": "The eBay sign-in couldn't be verified (it expired, was started in another tab, or came back to a different address). Connect again from this page.",
  failed: "eBay sign-in failed. Try again.",
  "not-configured": "eBay seller access isn't configured on this server yet.",
  "wrong-host": "Open ResellAI at the address set in RESELLAI_APP_URL (normally http://localhost:3001) to connect eBay.",
};

/** Plain-language help for eBay's OAuth error codes. */
const reasonHelp: Record<string, string> = {
  invalid_client: "eBay rejected the App ID / Cert ID pair. Check that both come from the same keyset.",
  invalid_grant: "The sign-in code expired, was already used, or the RuName doesn't match the keyset. Connect again.",
  invalid_scope: "Your keyset isn't allowed one of the requested permissions (sell.inventory, sell.account).",
  invalid_request: "eBay rejected the sign-in request. Check EBAY_SELLER_RUNAME matches the RuName in the Developer Portal.",
  unauthorized_client: "This keyset isn't allowed to use the authorization-code grant. Check the RuName's OAuth settings.",
  server_error: "eBay had a temporary problem. Try again.",
  temporarily_unavailable: "eBay is temporarily unavailable. Try again.",
  no_code: "eBay returned without an authorization code.",
};

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || "eBay request failed.");
  return b as T;
}
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error || "eBay request failed."), { body: b, status: r.status });
  return b as T;
}

/**
 * Seller preferences, remembered per eBay environment in this browser: the policies and ship-from location the
 * seller last chose. Only IDs are stored (no tokens), and a remembered ID is used only while it still exists on
 * the seller's account.
 */
const prefKey = (env: string) => `resellai:ebay-seller-prefs:${env}`;
function readPrefs(env: string): SellerPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(prefKey(env)) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function savePrefs(env: string, patch: SellerPrefs) {
  try {
    localStorage.setItem(prefKey(env), JSON.stringify({ ...readPrefs(env), ...patch }));
  } catch {
    /* storage unavailable: preferences just aren't remembered */
  }
}

export function useEbaySeller({ draft, onChange }: { draft: ListingDraft; onChange: (fn: (d: ListingDraft) => ListingDraft) => void }) {
  const [status, setStatus] = useState<SellerStatus | null>(null);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState<SellerSetup | null>(null);
  const [setupError, setSetupError] = useState("");
  const [rules, setRules] = useState<CategoryRulesState | null>(null);
  const [rulesState, setRulesState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "done"; ok?: boolean; message?: string }>({ state: "idle" });
  const [phase, setPhase] = useState<"idle" | "uploading" | "publishing">("idle");
  const [uploadState, setUploadState] = useState<Record<string, "uploading" | "error">>({});
  const [result, setResult] = useState<PublishResult | null>(null);
  const [listing, setListing] = useState<ListingStatus | null>(null);
  const inFlight = useRef(false);
  const autoCategory = useRef(false);
  const rulesFor = useRef("");

  const setEbay = useCallback((patch: Patch) => onChange((d) => ({ ...d, ebay: { ...d.ebay, ...patch } })), [onChange]);
  const connected = !!status?.connected;
  const env = status?.environment ?? "sandbox";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const param = params.get("ebay");
    const reason = params.get("reason") || "";
    if (param && connectMessages[param]) {
      setFlash(connectMessages[param] + (reason ? ` ${reasonHelp[reason] || `(eBay error: ${reason.replace(/[^a-z_]/g, "")})`}` : ""));
      // Don't show the sign-in message again on reload.
      params.delete("ebay");
      params.delete("reason");
      const q = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : "") + window.location.hash);
    }
    getJson<SellerStatus>("/api/ebay/seller/status").then(setStatus, () => setError("Couldn't check the eBay connection."));
  }, []);

  const loadSetup = useCallback(async () => {
    setSetupError("");
    try {
      const s = await getJson<SellerSetup>("/api/ebay/seller/setup");
      setSetup(s);
      const prefs = readPrefs(env);
      onChange((d) => ({ ...d, ebay: { ...d.ebay, ...choosePolicies(d.ebay, s, prefs) } }));
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : "Couldn't load your eBay account settings.");
    }
  }, [onChange, env]);
  useEffect(() => {
    if (connected) void loadSetup();
  }, [connected, loadSetup]);

  const searchCategories = useCallback(
    async (text: string, autoSelect: boolean) => {
      if (!text.trim()) return;
      try {
        const { categories: found } = await getJson<{ categories: CategoryOption[] }>(`/api/ebay/seller/setup?q=${encodeURIComponent(text.trim().slice(0, 100))}`);
        setCategories(found);
        if (autoSelect && found[0]) setEbay({ categoryId: found[0].id, categoryName: found[0].path });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Category search failed.");
      }
    },
    [setEbay],
  );
  // Category: eBay suggests one from the product name once; the seller can change it.
  useEffect(() => {
    if (!connected || autoCategory.current || draft.ebay.categoryId) return;
    autoCategory.current = true;
    const i = draft.identification;
    void searchCategories([i.brand, i.model || i.productName].filter(Boolean).join(" ") || draft.title.value, true);
  }, [connected, draft.ebay.categoryId, draft.identification, draft.title.value, searchCategories]);

  // Category rules (required item specifics, allowed conditions) straight from eBay.
  useEffect(() => {
    const id = draft.ebay.categoryId;
    if (!connected || !/^\d+$/.test(id) || rulesFor.current === id) return;
    rulesFor.current = id;
    setRules(null);
    setRulesState("loading");
    getJson<CategoryRulesState>(`/api/ebay/seller/setup?categoryId=${id}`).then(
      (r) => {
        setRules(r);
        setRulesState("ready");
        onChange((d) => {
          const current = d.ebay.conditionId;
          if (current && r.conditions.some((c) => c.id === current)) return d;
          return { ...d, ebay: { ...d.ebay, conditionId: suggestedConditionId(d, r.conditions) ?? "" } };
        });
      },
      (e) => {
        setRulesState("error");
        setError(e instanceof Error ? e.message : "Couldn't load eBay's requirements for this category.");
      },
    );
  }, [connected, draft.ebay.categoryId, onChange]);

  /** Choose a policy or location for this draft and remember it as the seller's preference. */
  const choose = useCallback(
    (key: keyof SellerPrefs, value: string) => {
      setEbay({ [key]: value } as Patch);
      if (value) savePrefs(env, { [key]: value });
    },
    [setEbay, env],
  );

  async function testConnection() {
    setCheck({ state: "checking" });
    setError("");
    try {
      const s = await getJson<SellerStatus>("/api/ebay/seller/status?check=1");
      setStatus(s);
      setCheck({ state: "done", ok: s.check?.ok ?? s.connected, message: s.check?.message ?? (s.connected ? "Connected." : "Not connected to eBay.") });
      if (s.check?.ok) void loadSetup();
    } catch (e) {
      setCheck({ state: "done", ok: false, message: e instanceof Error ? e.message : "Connection check failed." });
    }
  }

  async function disconnect() {
    await fetch("/api/ebay/seller/disconnect", { method: "POST" });
    setStatus((s) => (s ? { ...s, connected: false, check: undefined } : s));
    setSetup(null);
    setCheck({ state: "idle" });
  }

  async function createPolicy(kind: "fulfillment" | "payment" | "return", body: Record<string, unknown>) {
    const r = await postJson<{ id: string; name: string }>("/api/ebay/seller/policies", { type: kind, ...body, confirm: true });
    setSetup((s) => (s ? { ...s, policies: { ...s.policies, [kind]: [...s.policies[kind], { id: r.id, name: r.name }] } } : s));
    choose(`${kind}PolicyId` as keyof SellerPrefs, r.id);
  }
  async function createLocation(body: Record<string, unknown>) {
    const r = await postJson<{ key: string; name: string }>("/api/ebay/seller/location", { ...body, confirm: true });
    setSetup((s) => (s ? { ...s, locations: [...s.locations, { key: r.key, name: r.name }] } : s));
    choose("merchantLocationKey", r.key);
  }

  async function uploadPhotos(current: ListingDraft): Promise<ListingDraft> {
    const needed = photosNeedingUpload(current, env);
    if (!needed.length) return current;
    const blobs = await getPhotos(current.id);
    let hosted = { ...(current.ebay.hostedImages || {}) };
    for (const photo of needed) {
      const blob = blobs.find((b) => b.photoId === photo.id);
      if (!blob) throw new Error(`Photo "${photo.name}" is no longer saved in this browser.`);
      setUploadState((s) => ({ ...s, [photo.id]: "uploading" }));
      const form = new FormData();
      form.append("image", new File([blob.blob], blob.name || "photo.jpg", { type: blob.blob.type }));
      const r = await fetch("/api/ebay/seller/images", { method: "POST", body: form });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setUploadState((s) => ({ ...s, [photo.id]: "error" }));
        throw new Error(b.error || "eBay didn't accept a photo.");
      }
      const image: EbayHostedImage = { url: b.url, expiresAt: b.expiresAt ?? null, environment: env, uploadedAt: new Date().toISOString() };
      hosted = { ...hosted, [photo.id]: image };
      setUploadState((s) => {
        const next = { ...s };
        delete next[photo.id];
        return next;
      });
      onChange((d) => ({ ...d, ebay: { ...d.ebay, hostedImages: { ...(d.ebay.hostedImages || {}), [photo.id]: image } } }));
    }
    return { ...current, ebay: { ...current.ebay, hostedImages: hosted } };
  }

  async function publish(current: ListingDraft) {
    if (inFlight.current || !status) return; // duplicate-click guard; the server also locks per SKU
    inFlight.current = true;
    setResult(null);
    try {
      setPhase("uploading");
      const ready = await uploadPhotos(current);
      setPhase("publishing");
      const b = await postJson<{ record: NonNullable<ListingDraft["ebay"]["publish"]>; alreadyPublished: boolean; url: string | null }>("/api/ebay/seller/publish", { draft: ready, confirm: true });
      setEbay({ publish: b.record });
      setListing({ listingId: b.record.listingId, listingStatus: null, offerStatus: "PUBLISHED", url: b.url });
      const e = current.ebay;
      savePrefs(env, { fulfillmentPolicyId: e.fulfillmentPolicyId, paymentPolicyId: e.paymentPolicyId, returnPolicyId: e.returnPolicyId, merchantLocationKey: e.merchantLocationKey });
      const where = status.testEndpoints ? "the local test server (not eBay)" : status.environment === "sandbox" ? "eBay Sandbox" : "eBay";
      setResult({ ok: true, message: b.alreadyPublished ? "This item was already listed; nothing was published twice." : `Published to ${where}.` });
    } catch (e) {
      const body = (e as { body?: { record?: ListingDraft["ebay"]["publish"]; issues?: string[] } }).body;
      if (body?.record) setEbay({ publish: body.record });
      setResult({ ok: false, message: e instanceof Error ? e.message : "Publishing failed. Retrying won't create a duplicate listing.", issues: body?.issues });
    } finally {
      inFlight.current = false;
      setPhase("idle");
    }
  }

  async function refreshListing() {
    try {
      setListing(await getJson<ListingStatus>(`/api/ebay/seller/listing?draftId=${encodeURIComponent(draft.id)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the listing status.");
    }
  }

  const calculatedShipping = !!setup?.policies.fulfillment.find((p) => p.id === draft.ebay.fulfillmentPolicyId)?.calculated;

  /** eBay-side requirements, shown only when they can actually be acted on. */
  const requirements = useMemo((): ReadinessIssue[] => {
    if (draft.marketplace !== "ebay" || !status) return [];
    if (!status.configured)
      return [{ id: "ebay-not-configured", severity: "blocker", basis: "marketplace", message: "eBay publishing isn't set up on this server.", why: `Missing server settings: ${status.missing.join(", ")}. Copy/export still works.`, target: "ebay-settings" }];
    if (!status.connected)
      return [{ id: "ebay-connect", severity: "blocker", basis: "marketplace", message: "Connect your eBay seller account.", why: "ResellAI publishes through eBay's official seller APIs with your permission. You only do this once.", target: "ebay-settings", fix: "ebay-connect" }];
    return ebayRequirements(draft, rules ?? undefined, { photosPending: true, calculatedShipping });
  }, [draft, status, rules, calculatedShipping]);

  return {
    status,
    connected,
    env,
    flash,
    error,
    setError,
    setup,
    setupError,
    loadSetup,
    rules,
    rulesState,
    categories,
    searchCategories,
    setEbay,
    choose,
    check,
    testConnection,
    disconnect,
    createPolicy,
    createLocation,
    uploadState,
    uploadPhotos,
    pending: status ? photosNeedingUpload(draft, status.environment) : [],
    phase,
    publish,
    result,
    setResult,
    listing,
    refreshListing,
    calculatedShipping,
    requirements,
  };
}

export type EbaySeller = ReturnType<typeof useEbaySeller>;
