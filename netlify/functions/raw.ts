import type { Config } from "@netlify/functions";
import type { RawAsset, RawBatch, RawStatus } from "../../shared/types";
import { requireSession } from "./_lib/auth";
import { fail, handle, HttpError, isoNow, json, readJson, str, strList } from "./_lib/http";
import { id } from "./_lib/ids";
import { deleteObjects, presignGet } from "./_lib/s3";
import { mutateCollection, readCollection } from "./_lib/store";
import { logActivity } from "./_lib/activity";

/**
 * Raw footage (client → studio).
 *
 * POST   /api/raw/batches            { note }            create a drop-off batch (any role)
 * PATCH  /api/raw/batches/:id        { note }            rename (author or studio)
 * PATCH  /api/raw/:id                { label | status }  label: any role; status: studio
 * POST   /api/raw/archive            { ids }             studio: delete objects, keep the record as "archived"
 * DELETE /api/raw/:id                                    studio: delete everything
 * GET    /api/raw/:id/download                           any role: attachment URL
 * GET    /api/raw/:id/play                               any role: inline URL (video/audio playback)
 */

const route = (req: Request): string[] => {
  const p = new URL(req.url).pathname.replace(/^\/api\/raw\/?/, "");
  return p.split("/").filter(Boolean);
};

export default handle(async (req) => {
  const session = requireSession(req);
  const parts = route(req);
  const isStudio = session.role === "studio";

  // ── batches ────────────────────────────────────────────────────────────
  if (parts[0] === "batches") {
    if (req.method === "POST") {
      const body = await readJson<{ note?: string }>(req);
      const batch: RawBatch = { id: id(), note: str(body.note, 300), createdBy: session.name, createdAt: isoNow(), count: 0 };
      await mutateCollection<RawBatch>("batches", (items) => {
        items.unshift(batch);
      });
      return json({ batch });
    }
    if (req.method === "PATCH" && parts[1]) {
      const body = await readJson<{ note?: string }>(req);
      const batch = await mutateCollection<RawBatch, RawBatch | undefined>("batches", (items) => {
        const b = items.find((x) => x.id === parts[1]);
        if (!b) return undefined;
        if (!isStudio && b.createdBy !== session.name) throw new HttpError(403, "Only the person who dropped this off can rename it.");
        b.note = str(body.note, 300);
        return b;
      });
      if (!batch) return fail(404, "Batch not found");
      return json({ batch });
    }
    return fail(405, "Method not allowed");
  }

  if (parts[0] === "archive" && req.method === "POST") {
    if (!isStudio) throw new HttpError(403, "Only the studio can archive footage.");
    const body = await readJson<{ ids?: string[] }>(req);
    const ids = new Set(strList(body.ids, 500, 64));
    const keys: string[] = [];
    const archived: RawAsset[] = [];
    await mutateCollection<RawAsset>("raw", (items) => {
      for (const r of items) {
        if (ids.has(r.id) && r.status !== "archived") {
          keys.push(r.key);
          if (r.posterKey) keys.push(r.posterKey);
          r.status = "archived";
          archived.push(r);
        }
      }
    });
    await deleteObjects(keys);
    if (archived.length) {
      await logActivity(session.name, session.role, "raw.archived", `${session.name} archived ${archived.length} raw file${archived.length === 1 ? "" : "s"} to free up space`).catch(() => {});
    }
    return json({ archived: archived.length });
  }

  const assetId = parts[0];
  if (!assetId) return fail(404, "Not found");

  if (req.method === "GET" && (parts[1] === "download" || parts[1] === "play")) {
    const raw = await readCollection<RawAsset>("raw");
    const asset = raw.find((r) => r.id === assetId);
    if (!asset || asset.status === "archived") return fail(404, "That file is no longer stored.");
    const url =
      parts[1] === "download"
        ? await presignGet(asset.key, { download: asset.name, mime: asset.mime })
        : await presignGet(asset.key, { mime: asset.mime });
    return json({ url, name: asset.name, mime: asset.mime, size: asset.size });
  }

  if (req.method === "PATCH") {
    const body = await readJson<{ label?: string; status?: RawStatus; usedIn?: string[] }>(req);
    const asset = await mutateCollection<RawAsset, RawAsset | undefined>("raw", (items) => {
      const a = items.find((x) => x.id === assetId);
      if (!a) return undefined;
      if (body.label !== undefined) a.label = str(body.label, 140) || undefined;
      if (body.status !== undefined) {
        if (!isStudio) throw new HttpError(403, "Only the studio can change footage status.");
        if (body.status === "new" || body.status === "used") a.status = body.status;
      }
      if (body.usedIn !== undefined && isStudio) a.usedIn = strList(body.usedIn, 100, 64);
      return a;
    });
    if (!asset) return fail(404, "File not found");
    return json({ asset });
  }

  if (req.method === "DELETE") {
    if (!isStudio) throw new HttpError(403, "Only the studio can delete footage.");
    let removed: RawAsset | undefined;
    await mutateCollection<RawAsset>("raw", (items) => {
      const i = items.findIndex((x) => x.id === assetId);
      if (i >= 0) removed = items.splice(i, 1)[0];
    });
    if (!removed) return fail(404, "File not found");
    await deleteObjects([removed.key, removed.posterKey || ""]);
    await mutateCollection<RawBatch>("batches", (items) => {
      const b = items.find((x) => x.id === removed!.batchId);
      if (b) b.count = Math.max(0, b.count - 1);
    });
    return json({ ok: true });
  }

  return fail(405, "Method not allowed");
});

export const config: Config = { path: ["/api/raw", "/api/raw/*"] };
