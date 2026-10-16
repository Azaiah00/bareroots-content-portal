/** Small helpers for Netlify Functions v2 (Request → Response). */

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

export const fail = (status: number, message: string, code = "error"): Response => json({ error: message, code }, status);

export const readJson = async <T = Record<string, unknown>>(req: Request): Promise<T> => {
  const text = await req.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON", "bad_json");
  }
};

/** Wrap a handler so thrown HttpErrors become proper responses. */
export const handle =
  (fn: (req: Request, ctx: any) => Promise<Response>) =>
  async (req: Request, ctx: any): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err: any) {
      if (err instanceof HttpError) return fail(err.status, err.message, err.code);
      console.error("[portal] unhandled", err);
      const msg = typeof err?.message === "string" ? err.message : "Something went wrong";
      return fail(500, msg, "internal");
    }
  };

export const clientIp = (req: Request, ctx: any): string => {
  const h = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  return (ctx?.ip as string) || h.split(",")[0].trim() || "unknown";
};

export const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.slice(0, max).trim() : "");

export const strList = (v: unknown, max = 60, each = 120): string[] =>
  Array.isArray(v)
    ? v
        .filter((x) => typeof x === "string")
        .map((x: string) => x.trim().slice(0, each))
        .filter(Boolean)
        .slice(0, max)
    : [];

export const isoNow = () => new Date().toISOString();

export const safeFilename = (name: string): string => {
  const base = (name || "file").split(/[\\/]/).pop() || "file";
  // Keep letters, numbers, dot, dash, underscore and spaces (as dashes).
  const cleaned = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "");
  return (cleaned || "file").slice(0, 120);
};
