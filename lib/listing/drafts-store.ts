"use client";
import { parseDraft } from "./apply";
import type { ListingDraft } from "./types";

/**
 * Listing drafts live in this browser (IndexedDB), including copies of the selected photos,
 * so unfinished drafts survive reloads. Nothing is uploaded to ResellAI's server.
 * If IndexedDB is unavailable (private mode, blocked storage) an in-memory store is used for this tab.
 */
const DB = "resellai-listings";
const VERSION = 1;
type StoredPhoto = { key: string; draftId: string; photoId: string; name: string; blob: Blob };

const memory = { drafts: new Map<string, ListingDraft>(), photos: new Map<string, StoredPhoto>() };
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
        if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "key" }).createIndex("draftId", "draftId");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
    tx.onerror = () => reject(tx.error || new Error("Browser storage failed."));
    tx.onabort = () => reject(tx.error || new Error("Browser storage was interrupted."));
  });
}

export async function storageIsPersistent() {
  return !!(await open());
}

export async function saveDraft(draft: ListingDraft) {
  const db = await open();
  if (!db) return void memory.drafts.set(draft.id, draft);
  await run(db, "drafts", "readwrite", (s) => s.put(JSON.parse(JSON.stringify(draft))));
}

export async function getDraft(id: string): Promise<ListingDraft | null> {
  const db = await open();
  const raw = db ? await run<unknown>(db, "drafts", "readonly", (s) => s.get(id)) : memory.drafts.get(id);
  return raw ? parseDraft(raw) : null;
}

export async function listDrafts(): Promise<ListingDraft[]> {
  const db = await open();
  const raw = db ? await run<unknown[]>(db, "drafts", "readonly", (s) => s.getAll()) : [...memory.drafts.values()];
  return raw
    .flatMap((x) => {
      try {
        return [parseDraft(x)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteDraft(id: string) {
  const db = await open();
  if (!db) {
    memory.drafts.delete(id);
    for (const [k, v] of memory.photos) if (v.draftId === id) memory.photos.delete(k);
    return;
  }
  const photos = await getPhotos(id);
  await run(db, "drafts", "readwrite", (s) => s.delete(id));
  for (const p of photos) await run(db, "photos", "readwrite", (s) => s.delete(`${id}:${p.photoId}`));
}

export async function savePhoto(draftId: string, photoId: string, name: string, blob: Blob) {
  const record: StoredPhoto = { key: `${draftId}:${photoId}`, draftId, photoId, name, blob };
  const db = await open();
  if (!db) return void memory.photos.set(record.key, record);
  await run(db, "photos", "readwrite", (s) => s.put(record));
}

export async function getPhotos(draftId: string): Promise<StoredPhoto[]> {
  const db = await open();
  if (!db) return [...memory.photos.values()].filter((p) => p.draftId === draftId);
  return run<StoredPhoto[]>(db, "photos", "readonly", (s) => s.index("draftId").getAll(draftId));
}
