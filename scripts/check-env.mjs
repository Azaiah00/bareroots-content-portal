#!/usr/bin/env node
/**
 * Quick sanity check of .env before deploying: are all variables present,
 * are the PINs different, is the session secret strong enough?
 *
 *   npm run check:env
 */
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const envFile = resolve(ROOT, ".env");
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} else {
  console.log("\n  No .env found. Copy .env.example to .env first.\n");
}

const required = ["CLIENT_PIN", "STUDIO_PIN", "SESSION_SECRET", "B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET", "B2_ENDPOINT", "PORTAL_ORIGINS"];
let problems = 0;
const warn = (m) => {
  problems++;
  console.log(`  ✗ ${m}`);
};
const good = (m) => console.log(`  ✓ ${m}`);

console.log("");
for (const k of required) {
  if (!env[k]) warn(`${k} is not set`);
  else good(`${k} set`);
}
if (env.CLIENT_PIN && env.STUDIO_PIN) {
  if (env.CLIENT_PIN === env.STUDIO_PIN) warn("CLIENT_PIN and STUDIO_PIN must be different");
  if (!/^\d{4,8}$/.test(env.CLIENT_PIN)) warn("CLIENT_PIN should be 4–8 digits");
  if (!/^\d{4,8}$/.test(env.STUDIO_PIN)) warn("STUDIO_PIN should be 4–8 digits");
}
if (env.SESSION_SECRET && (env.SESSION_SECRET.length < 24 || env.SESSION_SECRET.includes("change-me"))) {
  warn(`SESSION_SECRET is weak — use this one: ${randomBytes(32).toString("hex")}`);
}
if (env.B2_ENDPOINT && !/^https:\/\/s3\.[a-z0-9-]+\.backblazeb2\.com$/i.test(env.B2_ENDPOINT)) {
  warn("B2_ENDPOINT should look like https://s3.us-east-005.backblazeb2.com");
}
if (env.PORTAL_ORIGINS && !/netlify\.app|https:\/\//.test(env.PORTAL_ORIGINS)) {
  warn("PORTAL_ORIGINS should include your https Netlify URL");
}
console.log(problems ? `\n  ${problems} thing(s) to fix.\n` : "\n  Looks good. Run npm run setup:b2 next.\n");
process.exit(problems ? 1 : 0);
