import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role, Session } from "../../../shared/types";
import { env } from "./env";
import { HttpError } from "./http";

/**
 * Session tokens: base64url(JSON{role,name,exp}) + "." + HMAC-SHA256.
 * No database, no cookies — the browser keeps it in localStorage and sends
 * `Authorization: Bearer <token>`. Six months long, renewed on every state load.
 */

const SESSION_DAYS = 180;

const b64u = (buf: Buffer | string): string => Buffer.from(buf).toString("base64url");

const secret = (): string => {
  const s = env.sessionSecret();
  if (!s || s === "change-me-to-a-long-random-string") {
    // Still works in local dev, but is loud about it in the logs.
    console.warn("[portal] SESSION_SECRET is not set — using an insecure development secret.");
    return "dev-secret-do-not-use-in-production";
  }
  return s;
};

const sign = (payload: string): string => createHmac("sha256", secret()).update(payload).digest("base64url");

export const issueToken = (role: Role, name: string): { token: string; session: Session } => {
  const session: Session = { role, name, exp: Date.now() + SESSION_DAYS * 86400_000 };
  const payload = b64u(JSON.stringify(session));
  return { token: `${payload}.${sign(payload)}`, session };
};

export const verifyToken = (token: string | null | undefined): Session | null => {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!session || (session.role !== "client" && session.role !== "studio")) return null;
    if (typeof session.exp !== "number" || session.exp < Date.now()) return null;
    if (typeof session.name !== "string" || !session.name) return null;
    return session;
  } catch {
    return null;
  }
};

const bearer = (req: Request): string | null => {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
};

/** Throws 401/403 unless the request carries a valid session with one of `roles`. */
export const requireSession = (req: Request, roles: Role[] = ["client", "studio"]): Session => {
  const session = verifyToken(bearer(req));
  if (!session) throw new HttpError(401, "Please enter your PIN again.", "unauthorized");
  if (!roles.includes(session.role)) throw new HttpError(403, "That action is for the studio only.", "forbidden");
  return session;
};

/** Constant-time PIN comparison → role, or null. */
export const roleForPin = (pin: string): Role | null => {
  const tryMatch = (expected: string): boolean => {
    if (!expected) return false;
    const a = Buffer.from(pin);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  // Studio first so a (misconfigured) shared PIN never silently downgrades.
  if (tryMatch(env.studioPin())) return "studio";
  if (tryMatch(env.clientPin())) return "client";
  return null;
};
