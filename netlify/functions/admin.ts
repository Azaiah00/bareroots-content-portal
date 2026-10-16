import type { Config } from "@netlify/functions";
import { requireSession } from "./_lib/auth";
import { env } from "./_lib/env";
import { fail, handle, json } from "./_lib/http";

/**
 * Studio-only maintenance endpoints.
 *
 * GET  /api/admin/cors  → the bucket's current CORS rules and whether browser
 *                         uploads (S3 PUT) are allowed.
 * POST /api/admin/cors  → writes the rule the portal needs, via Backblaze's
 *                         native API (the only way to set S3 operations).
 *
 * Why this exists: Backblaze's console presets only cover its native download
 * API. Browser uploads go through the S3 API and need s3_put/s3_get/s3_head
 * named explicitly. Running this once after bucket creation — or any time an
 * upload shows "check the bucket's CORS rule" — fixes it without a terminal.
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
  const basic = Buffer.from(`${env.b2KeyId()}:${env.b2AppKey()}`).toString("base64");
  const res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) throw new Error(`Backblaze refused the key (${res.status}). Check B2_KEY_ID / B2_APP_KEY.`);
  const a = (await res.json()) as Auth;
  return a;
};

const findBucket = async (auth: Auth) => {
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "content-type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketName: env.b2Bucket() }),
  });
  if (!res.ok) throw new Error(`b2_list_buckets ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b = ((await res.json()) as { buckets?: any[] }).buckets?.[0];
  if (!b) throw new Error(`Bucket "${env.b2Bucket()}" is not visible to this key.`);
  return b as { bucketId: string; corsRules?: any[] };
};

const summarize = (rules: any[] | undefined) => {
  const ops = new Set<string>();
  for (const r of rules ?? []) for (const o of r.allowedOperations ?? []) ops.add(o);
  return {
    rules: rules ?? [],
    browserUploadsAllowed: ops.has("s3_put"),
    browserDownloadsAllowed: ops.has("s3_get"),
  };
};

export default handle(async (req) => {
  const session = requireSession(req, ["studio"]);
  const action = new URL(req.url).pathname.split("/").pop();
  if (action !== "cors") return fail(404, "Unknown admin action");
  if (!env.b2Configured()) return fail(503, "B2_* environment variables are not set.");

  const auth = await authorize();
  const bucket = await findBucket(auth);

  if (req.method === "GET") return json({ bucket: env.b2Bucket(), ...summarize(bucket.corsRules) });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_update_bucket`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "content-type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketId: bucket.bucketId, corsRules: RULES }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    return fail(502, /writeBuckets|unauthorized|not allowed/i.test(text) ? `The Backblaze key can't edit bucket settings — it needs "writeBuckets" (create the key with access to ALL buckets). ${text}` : `b2_update_bucket ${res.status}: ${text}`);
  }
  const updated = (await res.json()) as { corsRules?: any[] };
  console.log(`[portal] CORS rules rewritten by ${session.name}`);
  return json({ bucket: env.b2Bucket(), fixed: true, ...summarize(updated.corsRules) });
});

export const config: Config = { path: "/api/admin/*" };
