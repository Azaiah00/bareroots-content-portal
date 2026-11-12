import type { Config } from "@netlify/functions";
import { requireSession } from "./_lib/auth";
import { env } from "./_lib/env";
import { fail, handle, json, readJson } from "./_lib/http";
import { bucket, finishMultipart, headObject, legacy, legacyPresignGet, listAll, presignPut, provider, s3, signParts, startMultipart } from "./_lib/s3";

/**
 * Studio-only maintenance endpoints.
 *
 * GET  /api/admin/cors      → whether browsers can upload to the bucket.
 * POST /api/admin/cors      → (Backblaze only) writes the CORS rule the portal
 *                             needs via Backblaze's native API. Supabase Storage
 *                             handles CORS itself, so on Supabase both calls just
 *                             report "allowed".
 *
 * One-time move from Backblaze to Supabase (needs STORAGE_* and the old B2_*
 * variables set at the same time):
 * GET  /api/admin/migrate          → every object in the old bucket, and whether
 *                                    the same key already exists in the new one
 *                                    with the same size.
 * POST /api/admin/migrate          → { key, size } → a signed GET for the old copy
 *                                    and a signed upload (single PUT, or multipart
 *                                    part URLs for big files) for the new one.
 * POST /api/admin/migrate/complete → { key, uploadId?, parts?, size } → finishes a
 *                                    multipart copy and checks the size matches.
 * The browser (studio) does the byte copy, so nothing large passes through Netlify.
 */

const RULES = [
  {
    corsRuleName: "bareroots-portal-s3",
    allowedOrigins: ["*"],
    allowedHeaders: ["*"],
    allowedOperations: ["s3_put", "s3_get", "s3_head"],
    exposeHeaders: ["etag", "x-amz-request-id"],
    maxAgeSeconds: 3600,
  },
  {
    corsRuleName: "bareroots-portal-native",
    allowedOrigins: ["*"],
    allowedHeaders: ["*"],
    allowedOperations: ["b2_download_file_by_id", "b2_download_file_by_name", "b2_upload_file", "b2_upload_part"],
    exposeHeaders: ["x-bz-content-sha1"],
    maxAgeSeconds: 3600,
  },
];

interface Auth {
  accountId: string;
  apiUrl: string;
  authorizationToken: string;
}

const authorize = async (): Promise<Auth> => {
  const c = env.storage();
  const basic = Buffer.from(`${c.keyId}:${c.secret}`).toString("base64");
  const res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) throw new Error(`Backblaze refused the key (${res.status}). Check B2_KEY_ID / B2_APP_KEY.`);
  return (await res.json()) as Auth;
};

const findBucket = async (auth: Auth) => {
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "content-type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketName: bucket() }),
  });
  if (!res.ok) throw new Error(`b2_list_buckets ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b = ((await res.json()) as { buckets?: any[] }).buckets?.[0];
  if (!b) throw new Error(`Bucket "${bucket()}" is not visible to this key.`);
  return b as { bucketId: string; corsRules?: any[] };
};

const summarize = (rules: any[] | undefined) => {
  const ops = new Set<string>();
  for (const r of rules ?? []) for (const o of r.allowedOperations ?? []) ops.add(o);
  return { rules: rules ?? [], browserUploadsAllowed: ops.has("s3_put"), browserDownloadsAllowed: ops.has("s3_get") };
};

const MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif",
  json: "application/json", txt: "text/plain", pdf: "application/pdf", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
};
const mimeFor = (key: string) => MIME[(key.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

const SINGLE_MAX = 48 * 1024 * 1024; // above this, copy in parts
const PART_SIZE = 32 * 1024 * 1024;

const cors = async (req: Request, name: string) => {
  if (provider() !== "b2") {
    // Supabase Storage answers browser CORS on its own; nothing to configure.
    return json({ bucket: bucket(), provider: provider(), browserUploadsAllowed: true, browserDownloadsAllowed: true, rules: [] });
  }
  if (!env.storageConfigured()) return fail(503, "Storage environment variables are not set.");
  const auth = await authorize();
  const b = await findBucket(auth);
  if (req.method === "GET") return json({ bucket: bucket(), provider: "b2", ...summarize(b.corsRules) });
  if (req.method !== "POST") return fail(405, "Method not allowed");
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_update_bucket`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "content-type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketId: b.bucketId, corsRules: RULES }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    return fail(502, /writeBuckets|unauthorized|not allowed/i.test(text) ? `The Backblaze key can't edit bucket settings — it needs "writeBuckets" (create the key with access to ALL buckets). ${text}` : `b2_update_bucket ${res.status}: ${text}`);
  }
  const updated = (await res.json()) as { corsRules?: any[] };
  console.log(`[portal] CORS rules rewritten by ${name}`);
  return json({ bucket: bucket(), provider: "b2", fixed: true, ...summarize(updated.corsRules) });
};

const migrate = async (req: Request, sub: string | undefined, name: string) => {
  const old = legacy();
  if (!old) return fail(409, "Migration needs both the new STORAGE_* variables and the old B2_* variables set.");

  if (req.method === "GET" && !sub) {
    const [from, to] = await Promise.all([listAll(old.client, old.bucket), listAll(s3(), bucket())]);
    const have = new Map(to.map((o) => [o.key, o.size]));
    const objects = from.map((o) => ({ ...o, done: have.get(o.key) === o.size }));
    const bytes = (xs: { size: number }[]) => xs.reduce((a, o) => a + o.size, 0);
    return json({
      from: { provider: "b2", bucket: old.bucket, count: from.length, bytes: bytes(from) },
      to: { provider: provider(), bucket: bucket(), count: to.length, bytes: bytes(to) },
      remaining: objects.filter((o) => !o.done).length,
      objects,
    });
  }

  if (req.method === "POST" && !sub) {
    const body = await readJson<{ key?: string; size?: number }>(req);
    const key = String(body.key || "");
    const size = Number(body.size || 0);
    if (!key || key.includes("..") || !(size > 0)) return fail(400, "key and size are required");
    const get = await legacyPresignGet(key);
    const mime = mimeFor(key);
    if (size <= SINGLE_MAX) {
      const put = await presignPut(key, mime, size);
      return json({ mode: "single", key, size, mime, get, put });
    }
    const uploadId = await startMultipart(key, mime);
    const count = Math.ceil(size / PART_SIZE);
    const parts = await signParts(key, uploadId, Array.from({ length: count }, (_, i) => i + 1));
    return json({ mode: "multipart", key, size, mime, get, uploadId, partSize: PART_SIZE, parts });
  }

  if (req.method === "POST" && sub === "complete") {
    const body = await readJson<{ key?: string; size?: number; uploadId?: string; parts?: { n: number; etag: string }[] }>(req);
    const key = String(body.key || "");
    if (!key) return fail(400, "key is required");
    if (body.uploadId) await finishMultipart(key, body.uploadId, body.parts || []);
    const head = await headObject(key);
    const ok = Boolean(head && head.size === Number(body.size));
    if (!ok) console.warn(`[portal] migrate size mismatch for ${key}: want ${body.size}, got ${head?.size}`);
    else console.log(`[portal] migrated ${key} (${body.size} bytes) by ${name}`);
    return json({ key, ok, size: head?.size ?? null });
  }

  return fail(405, "Method not allowed");
};

export default handle(async (req) => {
  const session = requireSession(req, ["studio"]);
  const parts = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
  const [action, sub] = parts;
  if (action === "cors") return cors(req, session.name);
  if (action === "migrate") return migrate(req, sub, session.name);
  return fail(404, "Unknown admin action");
});

export const config: Config = { path: "/api/admin/*" };
