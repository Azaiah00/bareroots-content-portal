#!/usr/bin/env node
/**
 * One-time Backblaze B2 setup for the portal.
 *
 *   npm run setup:b2
 *
 * Reads B2_* and PORTAL_ORIGINS from .env (or the environment), then:
 *   1. Confirms the key can see the bucket.
 *   2. Writes the CORS rule that lets browsers PUT/GET directly to the bucket
 *      from the portal's origins (your Netlify URL + localhost).
 *   3. Runs a put → get → delete round-trip with a presigned URL, exactly the
 *      way the browser will, so you know uploads will work before deploying.
 *
 * If the key can't set CORS (a bucket-restricted key lacks that capability),
 * it prints the exact rule to paste into the Backblaze web console instead.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

// Minimal .env loader (no dependency).
const envFile = resolve(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`\n  Missing ${k}. Copy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return v;
};

const keyId = need("B2_KEY_ID");
const appKey = need("B2_APP_KEY");
const bucket = need("B2_BUCKET");
const endpoint = need("B2_ENDPOINT").replace(/\/$/, "");
const region = process.env.B2_REGION || (endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i) || [])[1] || "us-east-005";
const origins = (process.env.PORTAL_ORIGINS || "http://localhost:8888,http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: keyId, secretAccessKey: appKey },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const step = (n, msg) => console.log(`\n  ${n}. ${msg}`);
const ok = (msg) => console.log(`     ✓ ${msg}`);
const bad = (msg) => console.log(`     ✗ ${msg}`);

console.log(`\n  Bare Roots portal — Backblaze B2 setup\n  bucket: ${bucket}\n  endpoint: ${endpoint} (${region})\n  origins: ${origins.join(", ")}`);

step(1, "Checking the key can reach the bucket");
try {
  await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "_health/" }));
  ok("bucket reachable");
} catch (err) {
  bad(`${err.name}: ${err.message}`);
  console.log("\n  Check B2_BUCKET spelling, that the key has access to this bucket, and that B2_ENDPOINT matches the bucket's region.\n");
  process.exit(1);
}

step(2, "Setting the CORS rule for browser uploads/downloads");
/**
 * Backblaze's console presets only cover its native download API. Browser
 * uploads use the S3 API (PUT + preflight OPTIONS), which needs a rule that
 * names s3_put / s3_get / s3_head — and Backblaze only accepts that rule
 * through its native API. So: authorize → find bucketId → b2_update_bucket.
 * Any origin is allowed on purpose: the bucket is private, so a file is still
 * only reachable with a signed link, and the Netlify URL can change later
 * without anyone touching this again.
 */
const nativeRules = [
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
let corsSet = false;
try {
  const basic = Buffer.from(`${keyId}:${appKey}`).toString("base64");
  const authRes = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", { headers: { Authorization: `Basic ${basic}` } });
  if (!authRes.ok) throw new Error(`b2_authorize_account ${authRes.status}: ${(await authRes.text()).slice(0, 200)}`);
  const auth = await authRes.json();
  const listRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "content-type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketName: bucket }),
  });
  if (!listRes.ok) throw new Error(`b2_list_buckets ${listRes.status}: ${(await listRes.text()).slice(0, 200)}`);
  const found = (await listRes.json()).buckets?.[0];
  if (!found) throw new Error(`bucket "${bucket}" not visible to this key`);
  const updRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_update_bucket`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "content-type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketId: found.bucketId, corsRules: nativeRules }),
  });
  if (!updRes.ok) throw new Error(`b2_update_bucket ${updRes.status}: ${(await updRes.text()).slice(0, 300)}`);
  const updated = await updRes.json();
  ok(`CORS rules written via the Backblaze API (${updated.corsRules?.length ?? 0} rules: S3 put/get/head + native download)`);
  corsSet = true;
} catch (err) {
  bad(`couldn't set CORS via the Backblaze API: ${err.message}`);
  console.log(`
     The key needs "writeBuckets" (a key created with access to ALL buckets has it;
     a bucket-restricted key does not). Create such a key, put it in .env, and re-run.
`);
}

step(3, "Round-trip test with a presigned URL (like the browser does)");
const key = `_setup/roundtrip-${Date.now()}.txt`;
const body = `portal setup ${new Date().toISOString()}`;
try {
  const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "text/plain", ContentLength: body.length }), { expiresIn: 300 });
  const put = await fetch(putUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body });
  if (!put.ok) throw new Error(`PUT returned ${put.status}: ${(await put.text()).slice(0, 200)}`);
  ok("presigned PUT accepted");
  const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
  const got = await fetch(getUrl);
  if (!got.ok || (await got.text()) !== body) throw new Error(`GET returned ${got.status}`);
  ok("presigned GET returned the object");
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  ok("test object deleted");
} catch (err) {
  bad(`${err.name || "Error"}: ${err.message}`);
  process.exit(1);
}

console.log(`
  Done. ${corsSet ? "Storage is ready." : "Storage works — finish the CORS step above before the first browser upload."}
  Next: add the same B2_* values (plus CLIENT_PIN, STUDIO_PIN, SESSION_SECRET)
  to Netlify → Site configuration → Environment variables, then deploy.
`);
