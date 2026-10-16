import type { Config } from "@netlify/functions";
import type {
  Deliverable,
  DeliverableFile,
  FileRole,
  Idea,
  IdeaAttachment,
  MediaKind,
  PresignRequest,
  PresignResponse,
  RawAsset,
  RawBatch,
} from "../../shared/types";
import { MEDIA_KIND_BY_MIME } from "../../shared/types";
import { requireSession } from "./_lib/auth";
import { env } from "./_lib/env";
import { fail, handle, HttpError, isoNow, json, readJson, safeFilename, str } from "./_lib/http";
import { id } from "./_lib/ids";
import { headObject, presignPut } from "./_lib/s3";
import { mutateCollection, readCollection } from "./_lib/store";
import { logActivity } from "./_lib/activity";

/**
 * POST /api/upload/presign   → a one-hour URL the browser PUTs the file to.
 * POST /api/upload/complete  → registers the uploaded object in the right collection.
 *
 * Key layout (one bucket, three top-level folders, never mixed):
 *   raw/<batchId>/<fileId>-<name>            client footage
 *   deliverables/<deliverableId>/<fileId>-<name>   finished content
 *   ideas/<ideaId>/<fileId>-<name>           board attachments
 *   <any of the above>.poster.jpg            browser-made thumbnail
 */

const ALLOWED_PREFIX: Record<PresignRequest["scope"], string> = {
  raw: "raw/",
  deliverable: "deliverables/",
  idea: "ideas/",
};

const presign = async (req: Request): Promise<Response> => {
  const session = requireSession(req);
  const body = await readJson<Partial<PresignRequest>>(req);
  const scope = body.scope;
  if (scope !== "raw" && scope !== "deliverable" && scope !== "idea") throw new HttpError(400, "Unknown upload scope");
  if (scope === "deliverable" && session.role !== "studio") throw new HttpError(403, "Only the studio can add finished content.");

  const parentId = str(body.parentId, 64);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(parentId)) throw new HttpError(400, "Missing parent id");
  const name = safeFilename(str(body.name, 200) || "file");
  const mime = str(body.mime, 120) || "application/octet-stream";
  const size = Number(body.size);
  if (!Number.isFinite(size) || size < 0) throw new HttpError(400, "Missing file size");
  if (size > env.maxUploadBytes()) {
    const gb = (env.maxUploadBytes() / 1024 ** 3).toFixed(1);
    throw new HttpError(413, `That file is larger than the ${gb} GB limit. Please trim it or send it in parts.`, "too_large");
  }

  let key: string;
  if (body.poster) {
    const forKey = str(body.forKey, 600);
    if (!forKey.startsWith(ALLOWED_PREFIX[scope]) || forKey.includes("..")) throw new HttpError(400, "Bad poster target");
    if (size > 2 * 1024 * 1024) throw new HttpError(413, "Poster too large");
    key = `${forKey}.poster.jpg`;
  } else {
    key = `${ALLOWED_PREFIX[scope]}${parentId}/${id()}-${name}`;
  }

  const signed = await presignPut(key, body.poster ? "image/jpeg" : mime, size);
  const res: PresignResponse = { key, url: signed.url, headers: signed.headers, expiresAt: signed.expiresAt };
  return json(res);
};

interface CompleteBody {
  scope: PresignRequest["scope"];
  parentId: string;
  key: string;
  name: string;
  mime: string;
  size: number;
  posterKey?: string;
  width?: number;
  height?: number;
  duration?: number;
  label?: string;
  /** deliverable only */
  role?: FileRole;
}

const dims = (b: CompleteBody) => ({
  ...(Number.isFinite(Number(b.width)) && Number(b.width) > 0 ? { width: Math.round(Number(b.width)) } : {}),
  ...(Number.isFinite(Number(b.height)) && Number(b.height) > 0 ? { height: Math.round(Number(b.height)) } : {}),
  ...(Number.isFinite(Number(b.duration)) && Number(b.duration) > 0 ? { duration: Math.round(Number(b.duration) * 10) / 10 } : {}),
});

const complete = async (req: Request): Promise<Response> => {
  const session = requireSession(req);
  const b = await readJson<Partial<CompleteBody>>(req);
  const scope = b.scope;
  if (scope !== "raw" && scope !== "deliverable" && scope !== "idea") throw new HttpError(400, "Unknown upload scope");
  if (scope === "deliverable" && session.role !== "studio") throw new HttpError(403, "Only the studio can add finished content.");

  const parentId = str(b.parentId, 64);
  const key = str(b.key, 600);
  if (!key.startsWith(`${ALLOWED_PREFIX[scope]}${parentId}/`) || key.includes("..")) throw new HttpError(400, "Key does not match scope");

  // Trust nothing about the upload until the bucket confirms it exists.
  const head = await headObject(key);
  if (!head) throw new HttpError(409, "The file didn't finish uploading. Please try again.", "not_uploaded");

  const posterKey = str(b.posterKey, 600);
  const posterOk = posterKey && posterKey === `${key}.poster.jpg` && (await headObject(posterKey));

  const name = str(b.name, 200) || key.split("/").pop() || "file";
  const mime = head.mime || str(b.mime, 120) || "application/octet-stream";
  const kind: MediaKind = MEDIA_KIND_BY_MIME(mime, name);
  const now = isoNow();
  const fileId = id();

  if (scope === "raw") {
    const asset: RawAsset = {
      id: fileId,
      batchId: parentId,
      name,
      key,
      ...(posterOk ? { posterKey } : {}),
      size: head.size,
      mime,
      kind,
      ...dims(b as CompleteBody),
      ...(str(b.label, 140) ? { label: str(b.label, 140) } : {}),
      uploadedBy: session.name,
      uploadedAt: now,
      status: "new",
      usedIn: [],
    };
    await mutateCollection<RawAsset>("raw", (items) => {
      items.unshift(asset);
    });
    const batch = await mutateCollection<RawBatch, RawBatch | undefined>("batches", (items) => {
      const bt = items.find((x) => x.id === parentId);
      if (bt) bt.count += 1;
      return bt;
    });
    await logActivity(session.name, session.role, "raw.uploaded", `${session.name} dropped off ${kind === "video" ? "a video" : kind === "image" ? "a photo" : "a file"}${batch?.note ? ` — ${batch.note}` : ""}`, {
      kind: "batch",
      id: parentId,
    }).catch(() => {});
    return json({ asset });
  }

  if (scope === "deliverable") {
    const role: FileRole = b.role === "cover" || b.role === "alt" ? b.role : "main";
    const file: DeliverableFile = {
      id: fileId,
      role,
      key,
      name,
      size: head.size,
      mime,
      kind,
      ...(posterOk ? { posterKey } : {}),
      ...dims(b as CompleteBody),
      ...(str(b.label, 140) ? { label: str(b.label, 140) } : {}),
    };
    const d = await mutateCollection<Deliverable, Deliverable | undefined>("deliverables", (items) => {
      const found = items.find((x) => x.id === parentId);
      if (!found) return undefined;
      // Only one cover and one main; a new one replaces the old in the list (the object stays until delete).
      if (role !== "alt") found.files = found.files.filter((f) => f.role !== role);
      found.files.push(file);
      found.updatedAt = now;
      return found;
    });
    if (!d) throw new HttpError(404, "Deliverable not found");
    return json({ file, deliverable: d });
  }

  // idea attachment
  const att: IdeaAttachment = {
    id: fileId,
    key,
    name,
    mime,
    kind,
    size: head.size,
    ...(posterOk ? { posterKey } : {}),
  };
  const idea = await mutateCollection<Idea, Idea | undefined>("ideas", (items) => {
    const found = items.find((x) => x.id === parentId);
    if (!found) return undefined;
    found.attachments.push(att);
    found.updatedAt = now;
    return found;
  });
  if (!idea) throw new HttpError(404, "Idea not found");
  return json({ attachment: att, idea });
};

export default handle(async (req, ctx) => {
  if (req.method !== "POST") return fail(405, "Method not allowed");
  const action = (ctx?.params?.action as string) || new URL(req.url).pathname.split("/").pop();
  if (action === "presign") return presign(req);
  if (action === "complete") return complete(req);
  // Lightweight sanity endpoint used by the uploader to confirm the batch exists.
  if (action === "ping") {
    requireSession(req);
    const batches = await readCollection<RawBatch>("batches");
    return json({ ok: true, batches: batches.length });
  }
  return fail(404, "Unknown upload action");
});

export const config: Config = { path: "/api/upload/:action" };
