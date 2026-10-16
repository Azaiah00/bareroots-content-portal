#!/usr/bin/env node
/**
 * Fully local development — no Netlify account, no Backblaze account.
 *
 *   npm run dev:local
 *
 * Starts three things:
 *   1. An S3 look-alike (s3rver) on :4569 standing in for Backblaze B2.
 *   2. The portal's API — the very same Netlify Functions, served on :8888
 *      with metadata kept as JSON files under .netlify/local-store/.
 *   3. Vite on :5173 for the UI (it proxies /api to :8888).
 *
 * Open http://localhost:5173 and use PINs 1234 (client) / 9999 (studio).
 * Real deployments never run this file; `netlify dev` + a .env is the
 * route to test against real B2 + Netlify Blobs.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// fileURLToPath keeps Windows paths correct (pathname alone yields C:\C:\...).
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const API_PORT = Number(process.env.API_PORT || 8888);
const S3_PORT = Number(process.env.S3_PORT || 4569);
const BUCKET = "local-portal";

// ── Environment the functions will see ─────────────────────────────────
Object.assign(process.env, {
  CLIENT_PIN: process.env.CLIENT_PIN || "1234",
  STUDIO_PIN: process.env.STUDIO_PIN || "9999",
  SESSION_SECRET: process.env.SESSION_SECRET || "local-dev-secret",
  META_STORE: "file",
  LOCAL_STORE_DIR: resolve(ROOT, ".netlify/local-store"),
  B2_KEY_ID: "S3RVER",
  B2_APP_KEY: "S3RVER",
  B2_BUCKET: BUCKET,
  B2_ENDPOINT: `http://localhost:${S3_PORT}`,
  B2_REGION: "us-east-1",
  MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB || "4000",
});

// ── 1. Local S3 ───────────────────────────────────────────────────────
mkdirSync(resolve(ROOT, ".netlify/local-s3"), { recursive: true });
const { default: S3rver } = await import("s3rver");
const cors = `<CORSConfiguration><CORSRule>
  <AllowedOrigin>*</AllowedOrigin>
  <AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>
  <AllowedHeader>*</AllowedHeader>
  <ExposeHeader>ETag</ExposeHeader>
</CORSRule></CORSConfiguration>`;
const s3 = new S3rver({
  port: S3_PORT,
  address: "localhost",
  silent: true,
  directory: resolve(ROOT, ".netlify/local-s3"),
  configureBuckets: [{ name: BUCKET, configs: [cors] }],
  allowMismatchedSignatures: true,
});
await s3.run();
console.log(`  local S3   → http://localhost:${S3_PORT}  (bucket "${BUCKET}")`);

// ── 2. Functions ──────────────────────────────────────────────────────
const { register: registerTsx } = await import("tsx/esm/api");
registerTsx();
const names = ["auth", "state", "health", "upload", "raw", "deliverables", "ideas", "preview", "admin"];
const routes = [];
for (const n of names) {
  const mod = await import(pathToFileURL(resolve(ROOT, `netlify/functions/${n}.ts`)).href);
  const paths = Array.isArray(mod.config?.path) ? mod.config.path : [mod.config?.path || `/api/${n}`];
  for (const p of paths) {
    const re = new RegExp("^" + p.replace(/\*/g, ".*").replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    routes.push({ re, handler: mod.default, name: n });
  }
}

const toRequest = (req) => {
  const url = `http://localhost:${API_PORT}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: "half" });
};

const api = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  const route = routes.find((r) => r.re.test(path));
  if (!route) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "No function for " + path }));
    return;
  }
  try {
    const m = path.match(route.re);
    const out = await route.handler(toRequest(req), { params: m?.groups || {}, ip: "127.0.0.1" });
    res.writeHead(out.status, Object.fromEntries(out.headers.entries()));
    const buf = Buffer.from(await out.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error(`[${route.name}]`, err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});
api.listen(API_PORT, () => console.log(`  functions  → http://localhost:${API_PORT}/api/*`));

// ── 3. Vite ───────────────────────────────────────────────────────────
if (!process.env.NO_VITE) {
  const vite = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  const stop = () => {
    vite.kill();
    s3.close();
    api.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
console.log(`\n  Client PIN ${process.env.CLIENT_PIN} · Studio PIN ${process.env.STUDIO_PIN}\n`);
