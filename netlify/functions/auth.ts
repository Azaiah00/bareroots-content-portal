import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { issueToken, roleForPin } from "./_lib/auth";
import { env } from "./_lib/env";
import { clientIp, fail, handle, json, readJson, str } from "./_lib/http";
import { logActivity } from "./_lib/activity";

/**
 * POST /api/auth  { pin, name }
 * → { token, session }
 *
 * A wrong PIN is slowed down: ten misses from one address in fifteen minutes
 * locks that address out for the rest of the window. The counter lives in
 * Netlify Blobs; if Blobs is unavailable the check degrades to "allow", so a
 * storage hiccup never locks the owners out of their own portal.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_MISSES = 10;

interface Misses {
  count: number;
  first: number;
}

const rl = () => getStore({ name: "bareroots-portal-ratelimit", consistency: "strong" });

const missesFor = async (ip: string): Promise<Misses> => {
  try {
    const m = (await rl().get(`rl:${ip}`, { type: "json" })) as Misses | null;
    if (!m || Date.now() - m.first > WINDOW_MS) return { count: 0, first: Date.now() };
    return m;
  } catch {
    return { count: 0, first: Date.now() };
  }
};

const recordMiss = async (ip: string, m: Misses) => {
  try {
    await rl().setJSON(`rl:${ip}`, { count: m.count + 1, first: m.first });
  } catch {
    /* best effort */
  }
};

const clearMisses = async (ip: string) => {
  try {
    await rl().delete(`rl:${ip}`);
  } catch {
    /* best effort */
  }
};

export default handle(async (req, ctx) => {
  if (req.method !== "POST") return fail(405, "Method not allowed");
  const body = await readJson<{ pin?: string; name?: string }>(req);
  const pin = str(body.pin, 32).replace(/\s+/g, "");
  const name = str(body.name, 40);
  const ip = clientIp(req, ctx);

  if (!pin) return fail(400, "Enter your PIN.", "missing_pin");
  if (!env.clientPin() || !env.studioPin()) {
    return fail(503, "PINs are not configured yet. Set CLIENT_PIN and STUDIO_PIN.", "pins_unconfigured");
  }

  const misses = await missesFor(ip);
  if (misses.count >= MAX_MISSES) {
    const minutes = Math.max(1, Math.ceil((misses.first + WINDOW_MS - Date.now()) / 60000));
    return fail(429, `Too many tries. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`, "locked");
  }

  const role = roleForPin(pin);
  if (!role) {
    await recordMiss(ip, misses);
    const left = MAX_MISSES - misses.count - 1;
    return fail(401, left > 0 ? "That PIN isn't right." : "That PIN isn't right. One more miss locks this device for 15 minutes.", "bad_pin");
  }

  const allowed = role === "client" ? env.clientNames() : env.studioNames();
  // Canonical casing for a known name; otherwise whatever they typed (a guest, a new team member).
  const who = allowed.find((n) => n.toLowerCase() === name.toLowerCase()) || name.replace(/[^\p{L}\p{N} '.-]/gu, "").slice(0, 30) || allowed[0] || (role === "client" ? "Client" : "Studio");

  await clearMisses(ip);
  const { token, session } = issueToken(role, who);

  // Only note first-time joins per device loudly; the UI passes `quiet` on renewals.
  if (!body || !(body as any).quiet) {
    await logActivity(who, role, "session.joined", `${who} opened the portal`).catch(() => {});
  }

  return json({ token, session });
});

export const config: Config = { path: "/api/auth" };
