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
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  S3Client,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

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
const rules = {
  CORSRules: [
    {
      ID: "bareroots-portal",
      AllowedOrigins: origins,
      AllowedMethods: ["GET", "PUT", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag", "x-amz-request-id"],
      MaxAgeSeconds: 3600,
    },
  ],
};
let corsSet = false;
try {
  await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: rules }));
  const current = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
  ok(`CORS rule written (${current.CORSRules?.length ?? 0} rule(s) on bucket)`);
  corsSet = true;
} catch (err) {
  bad(`couldn't set CORS via the API: ${err.name}: ${err.message}`);
  console.log(`
     Set it by hand instead (takes a minute):
       Backblaze → Buckets → ${bucket} → Bucket Settings → CORS Rules
       → choose "Share everything in this bucket with every origin"
         (fine for a private bucket — files are still only reachable with a signed link)
       → or "Custom" and paste:

${JSON.stringify(
  [
    {
      corsRuleName: "bareroots-portal",
      allowedOrigins: origins,
      allowedHeaders: ["*"],
      allowedOperations: ["s3_put", "s3_get", "s3_head"],
      exposeHeaders: ["etag"],
      maxAgeSeconds: 3600,
    },
  ],
  null,
  2,
)
  .split("\n")
  .map((l) => "       " + l)
  .join("\n")}
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
