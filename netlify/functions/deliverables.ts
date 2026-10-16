import type { Config } from "@netlify/functions";
import type { Deliverable, DeliverableKind, Idea, Platform, PlatformPlan, RawAsset, RevisionRequest } from "../../shared/types";
import { requireSession } from "./_lib/auth";
import { addBusinessDays } from "./_lib/business";
import { fail, handle, HttpError, isoNow, json, readJson, str, strList } from "./_lib/http";
import { id } from "./_lib/ids";
import { deleteObjects, presignGet } from "./_lib/s3";
import { mutateCollection, readCollection } from "./_lib/store";
import { logActivity } from "./_lib/activity";

/**
 * Finished content (studio → client).
 *
 * POST   /api/deliverables                        studio: create a draft
 * PATCH  /api/deliverables/:id                    studio: edit fields
 * POST   /api/deliverables/:id/publish            studio: make visible, start the 5-business-day clock
 * POST   /api/deliverables/:id/unpublish          studio: back to draft
 * POST   /api/deliverables/:id/approve            client (or studio on their behalf)
 * POST   /api/deliverables/:id/changes {message}  client: request the one included revision round
 * POST   /api/deliverables/:id/posted {platform, posted}  anyone: tick the "posted" box
 * DELETE /api/deliverables/:id                    studio: remove + delete objects
 * DELETE /api/deliverables/:id/files/:fileId      studio: remove one file
 * GET    /api/deliverables/:id/download?file=<fileId>   attachment URL
 * GET    /api/deliverables/:id/play?file=<fileId>       inline URL
 */

const PLATFORMS: Platform[] = ["instagram", "tiktok", "facebook"];

const route = (req: Request): string[] =>
  new URL(req.url).pathname.replace(/^\/api\/deliverables\/?/, "").split("/").filter(Boolean);

const cleanPlatforms = (v: unknown): PlatformPlan[] => {
  if (!Array.isArray(v)) return [];
  const out: PlatformPlan[] = [];
  for (const p of v) {
    if (!p || typeof p !== "object") continue;
    const platform = (p as any).platform as Platform;
    if (!PLATFORMS.includes(platform)) continue;
    if (out.some((x) => x.platform === platform)) continue;
    const plan: PlatformPlan = { platform };
    const fmt = (p as any).format;
    if (platform === "instagram" && ["reel", "feed", "story", "carousel"].includes(fmt)) plan.format = fmt;
    const postAt = str((p as any).postAt, 40);
    if (postAt && !Number.isNaN(Date.parse(postAt))) plan.postAt = new Date(postAt).toISOString();
    const caption = str((p as any).caption, 3000);
    if (caption) plan.caption = caption;
    const tip = str((p as any).tip, 500);
    if (tip) plan.tip = tip;
    const posted = (p as any).posted;
    if (posted && typeof posted === "object" && typeof posted.by === "string" && typeof posted.at === "string") {
      plan.posted = { by: str(posted.by, 40), at: posted.at };
    }
    out.push(plan);
  }
  return out;
};

const applyFields = (d: Deliverable, body: Record<string, unknown>) => {
  if (body.title !== undefined) d.title = str(body.title, 140) || d.title;
  if (body.kind === "video" || body.kind === "static") d.kind = body.kind as DeliverableKind;
  if (body.caption !== undefined) d.caption = str(body.caption, 3000);
  if (body.hashtags !== undefined) d.hashtags = strList(body.hashtags, 60, 80).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""));
  if (body.cta !== undefined) d.cta = str(body.cta, 300) || undefined;
  if (body.tips !== undefined) d.tips = str(body.tips, 2000) || undefined;
  if (body.studioNotes !== undefined) d.studioNotes = str(body.studioNotes, 2000) || undefined;
  if (body.platforms !== undefined) {
    // Preserve "posted" marks the client already made when the studio edits the plan.
    const incoming = cleanPlatforms(body.platforms);
    for (const p of incoming) {
      const prev = d.platforms.find((x) => x.platform === p.platform);
      if (prev?.posted && !p.posted) p.posted = prev.posted;
    }
    d.platforms = incoming;
  }
  if (body.sourceRawIds !== undefined) d.sourceRawIds = strList(body.sourceRawIds, 100, 64);
  d.updatedAt = isoNow();
};

/** Keep raw assets' `usedIn` and `status` in step with a deliverable's sources. */
const syncRawUsage = async (deliverableId: string, sourceIds: string[], remove = false) => {
  await mutateCollection<RawAsset>("raw", (items) => {
    for (const r of items) {
      const has = r.usedIn.includes(deliverableId);
      const should = !remove && sourceIds.includes(r.id);
      if (should && !has) r.usedIn.push(deliverableId);
      if (!should && has) r.usedIn = r.usedIn.filter((x) => x !== deliverableId);
      if (r.status !== "archived") r.status = r.usedIn.length ? "used" : "new";
    }
  });
};

export default handle(async (req) => {
  const session = requireSession(req);
  const isStudio = session.role === "studio";
  const parts = route(req);
  const now = isoNow();

  // ── create ─────────────────────────────────────────────────────────────
  if (!parts.length) {
    if (req.method !== "POST") return fail(405, "Method not allowed");
    if (!isStudio) throw new HttpError(403, "Only the studio can create content.");
    const body = await readJson<Record<string, unknown>>(req);
    const d: Deliverable = {
      id: id(),
      title: str(body.title, 140) || "Untitled",
      kind: body.kind === "static" ? "static" : "video",
      status: "draft",
      files: [],
      caption: "",
      hashtags: [],
      platforms: [{ platform: "instagram", format: "reel" }, { platform: "tiktok" }],
      sourceRawIds: [],
      revisions: [],
      createdBy: session.name,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    applyFields(d, body);
    if (body.ideaId) d.studioNotes = [d.studioNotes, `From idea ${str(body.ideaId, 64)}`].filter(Boolean).join("\n");
    await mutateCollection<Deliverable>("deliverables", (items) => {
      items.unshift(d);
    });
    if (body.ideaId) {
      await mutateCollection<Idea>("ideas", (items) => {
        const i = items.find((x) => x.id === str(body.ideaId, 64));
        if (i) {
          i.deliverableId = d.id;
          i.status = "in-production";
          i.updatedAt = now;
        }
      });
    }
    await syncRawUsage(d.id, d.sourceRawIds);
    return json({ deliverable: d });
  }

  const did = parts[0];
  const action = parts[1];

  // ── file URLs ──────────────────────────────────────────────────────────
  if (req.method === "GET" && (action === "download" || action === "play")) {
    const fileId = new URL(req.url).searchParams.get("file") || "";
    const all = await readCollection<Deliverable>("deliverables");
    const d = all.find((x) => x.id === did);
    if (!d || (!isStudio && d.status === "draft")) return fail(404, "Not found");
    const f = d.files.find((x) => x.id === fileId);
    if (!f) return fail(404, "File not found");
    // Give the client a tidy filename: "Bare Roots - Title - cover.jpg"
    const ext = f.name.includes(".") ? f.name.split(".").pop() : "";
    const nice = `${d.title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}${f.role === "main" ? "" : ` - ${f.label || f.role}`}${ext ? `.${ext}` : ""}`;
    const url = action === "download" ? await presignGet(f.key, { download: nice, mime: f.mime }) : await presignGet(f.key, { mime: f.mime });
    return json({ url, name: nice, mime: f.mime, size: f.size });
  }

  // ── delete one file ────────────────────────────────────────────────────
  if (req.method === "DELETE" && action === "files" && parts[2]) {
    if (!isStudio) throw new HttpError(403, "Studio only.");
    let keys: string[] = [];
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === did);
      if (!found) return undefined;
      const f = found.files.find((x) => x.id === parts[2]);
      if (f) {
        keys = [f.key, f.posterKey || ""];
        found.files = found.files.filter((x) => x.id !== parts[2]);
        found.updatedAt = now;
      }
      return found;
    });
    if (!d) return fail(404, "Not found");
    await deleteObjects(keys);
    return json({ deliverable: d });
  }

  // ── relabel one file ───────────────────────────────────────────────────
  if (req.method === "PATCH" && action === "files" && parts[2]) {
    if (!isStudio) throw new HttpError(403, "Studio only.");
    const body = await readJson<{ label?: string }>(req);
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === did);
      if (!found) return undefined;
      const f = found.files.find((x) => x.id === parts[2]);
      if (f) {
        f.label = str(body.label, 140) || undefined;
        found.updatedAt = now;
      }
      return found;
    });
    if (!d) return fail(404, "Not found");
    return json({ deliverable: d });
  }

  // ── delete deliverable ─────────────────────────────────────────────────
  if (req.method === "DELETE" && !action) {
    if (!isStudio) throw new HttpError(403, "Studio only.");
    let removed: Deliverable | undefined;
    await mutateCollection<Deliverable>("deliverables", (items) => {
      const i = items.findIndex((x) => x.id === did);
      if (i >= 0) removed = items.splice(i, 1)[0];
    });
    if (!removed) return fail(404, "Not found");
    await deleteObjects(removed.files.flatMap((f) => [f.key, f.posterKey || ""]));
    await syncRawUsage(did, [], true);
    await mutateCollection<Idea>("ideas", (items) => {
      for (const i of items) if (i.deliverableId === did) i.deliverableId = undefined;
    });
    if (removed.status !== "draft") {
      await logActivity(session.name, "studio", "deliverable.deleted", `${session.name} removed "${removed.title}"`).catch(() => {});
    }
    return json({ ok: true });
  }

  // ── edit ───────────────────────────────────────────────────────────────
  if (req.method === "PATCH" && !action) {
    if (!isStudio) throw new HttpError(403, "Only the studio can edit content.");
    const body = await readJson<Record<string, unknown>>(req);
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === did);
      if (!found) return undefined;
      applyFields(found, body);
      return found;
    });
    if (!d) return fail(404, "Not found");
    if (body.sourceRawIds !== undefined) await syncRawUsage(d.id, d.sourceRawIds);
    return json({ deliverable: d });
  }

  if (req.method !== "POST") return fail(405, "Method not allowed");
  const body = await readJson<Record<string, unknown>>(req);

  // ── publish / unpublish ────────────────────────────────────────────────
  if (action === "publish") {
    if (!isStudio) throw new HttpError(403, "Studio only.");
    let republished = false;
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === did);
      if (!found) return undefined;
      if (!found.files.some((f) => f.role === "main")) throw new HttpError(400, "Add the finished file before publishing.");
      republished = found.status === "changes";
      if (republished) {
        for (const r of found.revisions) if (!r.resolvedAt) {
          r.resolvedAt = now;
          r.resolvedNote = str(body.note, 500) || undefined;
        }
        found.version += 1;
      }
      found.status = "published";
      found.publishedAt = now;
      found.autoApproveAt = addBusinessDays(new Date(), 5);
      found.approvedAt = undefined;
      found.approvedBy = undefined;
      found.updatedAt = now;
      return found;
    });
    if (!d) return fail(404, "Not found");
    await logActivity(
      session.name,
      "studio",
      republished ? "deliverable.republished" : "deliverable.published",
      republished ? `${session.name} delivered the revised "${d.title}"` : `${session.name} delivered "${d.title}" — ready to post`,
      { kind: "deliverable", id: d.id },
    ).catch(() => {});
    return json({ deliverable: d });
  }

  if (action === "unpublish") {
    if (!isStudio) throw new HttpError(403, "Studio only.");
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === did);
      if (!found) return undefined;
      found.status = "draft";
      found.autoApproveAt = undefined;
      found.updatedAt = now;
      return found;
    });
    if (!d) return fail(404, "Not found");
    return json({ deliverable: d });
  }

  // ── approve ────────────────────────────────────────────────────────────
  if (action === "approve") {
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === did);
      if (!found) return undefined;
      if (found.status === "draft") throw new HttpError(400, "Not published yet.");
      found.status = "approved";
      found.approvedAt = now;
      found.approvedBy = session.name;
      found.updatedAt = now;
      return found;
    });
    if (!d) return fail(404, "Not found");
    await logActivity(session.name, session.role, "deliverable.approved", `${session.name} approved "${d.title}"`, { kind: "deliverable", id: d.id }).catch(() => {});
    return json({ deliverable: d });
  }

  // ── request a change ───────────────────────────────────────────────────
  if (action === "changes") {
    const message = str(body.message, 2000);
    if (!message) throw new HttpError(400, "Tell us what to change.");
    const rev: RevisionRequest = { id: id(), by: session.name, at: now, message };
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === did);
      if (!found) return undefined;
      if (found.status === "draft") throw new HttpError(400, "Not published yet.");
      found.revisions.push(rev);
      found.status = "changes";
      found.autoApproveAt = undefined;
      found.updatedAt = now;
      return found;
    });
    if (!d) return fail(404, "Not found");
    await logActivity(session.name, session.role, "deliverable.changes", `${session.name} asked for a change on "${d.title}": ${message.slice(0, 120)}`, {
      kind: "deliverable",
      id: d.id,
    }).catch(() => {});
    return json({ deliverable: d });
  }

  // ── mark posted ────────────────────────────────────────────────────────
  if (action === "posted") {
    const platform = body.platform as Platform;
    if (!PLATFORMS.includes(platform)) throw new HttpError(400, "Unknown platform");
    const posted = Boolean(body.posted);
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === did);
      if (!found) return undefined;
      let plan = found.platforms.find((p) => p.platform === platform);
      if (!plan) {
        plan = { platform };
        found.platforms.push(plan);
      }
      plan.posted = posted ? { by: session.name, at: now } : undefined;
      found.updatedAt = now;
      return found;
    });
    if (!d) return fail(404, "Not found");
    if (posted) {
      await logActivity(session.name, session.role, "deliverable.posted", `${session.name} posted "${d.title}" on ${platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : "Facebook"}`, {
        kind: "deliverable",
        id: d.id,
      }).catch(() => {});
    }
    return json({ deliverable: d });
  }

  return fail(404, "Unknown action");
});

export const config: Config = { path: ["/api/deliverables", "/api/deliverables/*"] };
