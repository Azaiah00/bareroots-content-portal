/**
 * Metadata store — five JSON collections (batches, raw, deliverables, ideas,
 * activity) kept as single documents so every read is one fetch.
 *
 * Driver "blobs" (default): Netlify Blobs with strong consistency and
 * compare-and-set writes, so two people acting at once can never lose each
 * other's change — the loser simply retries on fresh data.
 *
 * Driver "b2": the same documents stored as `_meta/<name>.json` inside the
 * B2 bucket. No conditional writes (B2's S3 layer has none), so a mutation is
 * read-modify-write; fine for a four-person portal, documented as the fallback.
 */
import { getStore } from "@netlify/blobs";
import { env } from "./env";
import { getObjectText, putObjectText } from "./s3";

export type CollectionName = "batches" | "raw" | "deliverables" | "ideas" | "activity" | "meta";

interface Doc<T> {
  items: T[];
  etag?: string;
}

interface Driver {
  read<T>(name: string): Promise<Doc<T>>;
  /** Returns false on a CAS conflict. */
  write<T>(name: string, items: T[], etag?: string): Promise<boolean>;
}

const STORE_NAME = "bareroots-portal";

const blobsDriver: Driver = {
  async read<T>(name: string): Promise<Doc<T>> {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const entry = await store.getWithMetadata(name, { type: "json" });
    if (!entry || entry.data == null) return { items: [] };
    const data = entry.data as unknown;
    return { items: Array.isArray(data) ? (data as T[]) : [], etag: entry.etag };
  },
  async write<T>(name: string, items: T[], etag?: string): Promise<boolean> {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const res = await store.setJSON(name, items, opts as any);
    // Older @netlify/blobs versions return void; treat that as success.
    if (res && typeof (res as any).modified === "boolean") return (res as any).modified;
    return true;
  },
};

const b2Driver: Driver = {
  async read<T>(name: string): Promise<Doc<T>> {
    const text = await getObjectText(`_meta/${name}.json`);
    if (!text) return { items: [] };
    try {
      const data = JSON.parse(text);
      return { items: Array.isArray(data) ? data : [] };
    } catch {
      return { items: [] };
    }
  },
  async write<T>(name: string, items: T[]): Promise<boolean> {
    await putObjectText(`_meta/${name}.json`, JSON.stringify(items), "application/json");
    return true;
  },
};

/**
 * Driver "file": plain JSON files under .netlify/local-store/. Used only by
 * `npm run dev:local` so the portal runs on a laptop with no Netlify account.
 */
const fileDriver: Driver = {
  async read<T>(name: string): Promise<Doc<T>> {
    const { readFile } = await import("node:fs/promises");
    try {
      const text = await readFile(localPath(name), "utf8");
      const data = JSON.parse(text);
      return { items: Array.isArray(data) ? data : [] };
    } catch {
      return { items: [] };
    }
  },
  async write<T>(name: string, items: T[]): Promise<boolean> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const p = localPath(name);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(items, null, 2));
    return true;
  },
};

const localPath = (name: string) => `${process.env.LOCAL_STORE_DIR || ".netlify/local-store"}/${name}.json`;

const driver = (): Driver => {
  const mode = env.metaStore();
  if (mode === "b2") return b2Driver;
  if (mode === "file") return fileDriver;
  return blobsDriver;
};

export const readCollection = async <T>(name: CollectionName): Promise<T[]> => (await driver().read<T>(name)).items;

/**
 * Atomically mutate a collection. `fn` receives a fresh copy and may edit it in
 * place; whatever it returns is handed back to the caller. Retries up to six
 * times on a write conflict.
 */
export const mutateCollection = async <T, R = void>(name: CollectionName, fn: (items: T[]) => R | Promise<R>): Promise<R> => {
  const d = driver();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { items, etag } = await d.read<T>(name);
    const working = JSON.parse(JSON.stringify(items)) as T[];
    const result = await fn(working);
    try {
      const ok = await d.write<T>(name, working, etag);
      if (ok) return result;
    } catch (err) {
      lastErr = err;
    }
    // Conflict: brief jittered backoff, then re-read.
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
  }
  throw lastErr instanceof Error ? lastErr : new Error("The portal was busy — please try that again.");
};

/** Read every collection the UI needs in parallel. */
export const readAll = async () => {
  const [batches, raw, deliverables, ideas, activity] = await Promise.all([
    readCollection<any>("batches"),
    readCollection<any>("raw"),
    readCollection<any>("deliverables"),
    readCollection<any>("ideas"),
    readCollection<any>("activity"),
  ]);
  return { batches, raw, deliverables, ideas, activity };
};
