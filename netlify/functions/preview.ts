import type { Config } from "@netlify/functions";
import type { Deliverable } from "../../shared/types";
import { requireSession } from "./_lib/auth";
import { fail, handle, json } from "./_lib/http";
import { presignGet } from "./_lib/s3";
import { readCollection } from "./_lib/store";

/**
 * GET /api/preview?key=<object key>
 * Inline (non-attachment) URL for any object the caller may see. Used for
 * posters that were not in the last state load, and for playing video inline.
 */
export default handle(async (req) => {
  if (req.method !== "GET") return fail(405, "Method not allowed");
  const session = requireSession(req);
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!key || key.includes("..") || !/^(raw|deliverables|ideas)\//.test(key)) return fail(400, "Bad key");

  if (session.role === "client" && key.startsWith("deliverables/")) {
    const did = key.split("/")[1];
    const all = await readCollection<Deliverable>("deliverables");
    const d = all.find((x) => x.id === did);
    if (!d || d.status === "draft") return fail(404, "Not found");
  }
  const url = await presignGet(key);
  return json({ url });
});

export const config: Config = { path: "/api/preview" };
