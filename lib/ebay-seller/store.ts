import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SellerTokens = {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  environment: "production" | "sandbox";
  connectedAt: string;
};

export type PublishRecord = {
  sku: string;
  offerId: string | null;
  listingId: string | null;
  status: "in-progress" | "published" | "failed";
  lastError: string | null;
  updatedAt: string;
};

const hash = (v: string) => createHash("sha256").update(v).digest("hex");

export function encrypt(key: Buffer, plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

export function decrypt(key: Buffer, payload: string) {
  const p = JSON.parse(payload) as { v: number; iv: string; tag: string; data: string };
  if (p.v !== 1) throw new Error("Unsupported token record.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(p.iv, "base64"));
  decipher.setAuthTag(Buffer.from(p.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(p.data, "base64")), decipher.final()]).toString("utf8");
}

async function atomicWrite(path: string, dir: string, contents: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(tmp, contents, { mode: 0o600, flag: "wx" });
  // Windows (and synced folders such as OneDrive) can briefly lock the target; retry before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes(code || "")) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw e;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

/**
 * Server-side seller data. OAuth tokens are encrypted at rest (AES-256-GCM) and keyed by a hash of an
 * httpOnly session cookie; they never reach the browser. Publish records are kept per session + SKU so
 * retries reuse the same eBay offer instead of creating duplicates.
 *
 * Local single-process storage: a hosted deployment needs a shared database and real user accounts.
 */
export function createSellerStore(dataDir: string, key: Buffer) {
  const tokenDir = join(dataDir, "tokens");
  const publishDir = join(dataDir, "publish");
  const tokenPath = (session: string) => join(tokenDir, `${hash("token:" + session)}.json`);
  const recordPath = (session: string, sku: string) => join(publishDir, `${hash(`publish:${session}:${sku}`)}.json`);
  return {
    async saveTokens(session: string, tokens: SellerTokens) {
      await atomicWrite(tokenPath(session), tokenDir, encrypt(key, JSON.stringify(tokens)));
    },
    async getTokens(session: string): Promise<SellerTokens | null> {
      try {
        return JSON.parse(decrypt(key, await readFile(tokenPath(session), "utf8"))) as SellerTokens;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        // Wrong key or tampered record: treat as signed out rather than exposing details.
        return null;
      }
    },
    async deleteTokens(session: string) {
      await rm(tokenPath(session), { force: true });
    },
    async getRecord(session: string, sku: string): Promise<PublishRecord | null> {
      try {
        return JSON.parse(await readFile(recordPath(session, sku), "utf8")) as PublishRecord;
      } catch {
        return null;
      }
    },
    async saveRecord(session: string, record: PublishRecord) {
      await atomicWrite(recordPath(session, record.sku), publishDir, JSON.stringify(record));
    },
  };
}
export type SellerStore = ReturnType<typeof createSellerStore>;
