import type { Config } from "@netlify/functions";
import type { Idea, IdeaColor, IdeaComment, IdeaStatus } from "../../shared/types";
import { requireSession } from "./_lib/auth";
import { fail, handle, HttpError, isoNow, json, readJson, str } from "./_lib/http";
import { id } from "./_lib/ids";
import { deleteObjects, presignGet } from "./_lib/s3";
import { mutateCollection, readCollection } from "./_lib/store";
import { logActivity } from "./_lib/activity";

/**
 * The ideas board — a shared corkboard for both sides.
 *
 * POST   /api/ideas                       { title, body, color, link }
 * PATCH  /api/ideas/:id                   author or studio: title/body/color/link; studio: status/pinned
 * DELETE /api/ideas/:id                   author or studio
 * POST   /api/ideas/:id/comments          { body }
 * DELETE /api/ideas/:id/comments/:cid     comment author or studio
 * POST   /api/ideas/:id/heart             toggle
 * DELETE /api/ideas/:id/attachments/:aid  author or studio
 * GET    /api/ideas/:id/attachments/:aid  inline URL
 */

const COLORS: IdeaColor[] = ["gold", "sage", "mauve", "cream", "plum"];
const STATUSES: IdeaStatus[] = ["new", "exploring", "in-production", "made", "parked"];

const route = (req: Request): string[] => new URL(req.url).pathname.replace(/^\/api\/ideas\/?/, "").split("/").filter(Boolean);

const cleanLink = (v: unknown): string | undefined => {
  const s = str(v, 500);
  if (!s) return undefined;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

export default handle(async (req) => {
  const session = requireSession(req);
  const isStudio = session.role === "studio";
  const parts = route(req);
  const now = isoNow();

  if (!parts.length) {
    if (req.method !== "POST") return fail(405, "Method not allowed");
    const body = await readJson<Record<string, unknown>>(req);
    const title = str(body.title, 120);
    const text = str(body.body, 4000);
    if (!title && !text) throw new HttpError(400, "Write something first.");
    const idea: Idea = {
      id: id(),
      title: title || text.slice(0, 60),
      body: text,
      color: COLORS.includes(body.color as IdeaColor) ? (body.color as IdeaColor) : "cream",
      status: "new",
      author: session.name,
      role: session.role,
      createdAt: now,
      updatedAt: now,
      link: cleanLink(body.link),
      attachments: [],
      comments: [],
      hearts: [],
      pinned: false,
    };
    await mutateCollection<Idea>("ideas", (items) => {
      items.unshift(idea);
    });
    await logActivity(session.name, session.role, "idea.created", `${session.name} pinned an idea: "${idea.title}"`, { kind: "idea", id: idea.id }).catch(() => {});
    return json({ idea });
  }

  const iid = parts[0];
  const sub = parts[1];

  if (req.method === "GET" && sub === "attachments" && parts[2]) {
    const ideas = await readCollection<Idea>("ideas");
    const idea = ideas.find((x) => x.id === iid);
    const att = idea?.attachments.find((a) => a.id === parts[2]);
    if (!att) return fail(404, "Not found");
    const url = await presignGet(att.key, { mime: att.mime });
    return json({ url, name: att.name, mime: att.mime });
  }

  if (req.method === "DELETE" && sub === "attachments" && parts[2]) {
    let keys: string[] = [];
    const idea = await mutateCollection<Idea, Idea | undefined>("ideas", (items) => {
      const i = items.find((x) => x.id === iid);
      if (!i) return undefined;
      if (!isStudio && i.author !== session.name) throw new HttpError(403, "Only the author can remove this.");
      const a = i.attachments.find((x) => x.id === parts[2]);
      if (a) {
        keys = [a.key, a.posterKey || ""];
        i.attachments = i.attachments.filter((x) => x.id !== parts[2]);
        i.updatedAt = now;
      }
      return i;
    });
    if (!idea) return fail(404, "Not found");
    await deleteObjects(keys);
    return json({ idea });
  }

  if (req.method === "DELETE" && sub === "comments" && parts[2]) {
    const idea = await mutateCollection<Idea, Idea | undefined>("ideas", (items) => {
      const i = items.find((x) => x.id === iid);
      if (!i) return undefined;
      const c = i.comments.find((x) => x.id === parts[2]);
      if (c && (isStudio || c.author === session.name)) {
        i.comments = i.comments.filter((x) => x.id !== parts[2]);
        i.updatedAt = now;
      }
      return i;
    });
    if (!idea) return fail(404, "Not found");
    return json({ idea });
  }

  if (req.method === "DELETE" && !sub) {
    let removed: Idea | undefined;
    await mutateCollection<Idea>("ideas", (items) => {
      const i = items.findIndex((x) => x.id === iid);
      if (i < 0) return;
      if (!isStudio && items[i].author !== session.name) throw new HttpError(403, "Only the author can delete this idea.");
      removed = items.splice(i, 1)[0];
    });
    if (!removed) return fail(404, "Not found");
    await deleteObjects(removed.attachments.flatMap((a) => [a.key, a.posterKey || ""]));
    return json({ ok: true });
  }

  if (req.method === "PATCH" && !sub) {
    const body = await readJson<Record<string, unknown>>(req);
    let statusChanged: IdeaStatus | null = null;
    const idea = await mutateCollection<Idea, Idea | undefined>("ideas", (items) => {
      const i = items.find((x) => x.id === iid);
      if (!i) return undefined;
      const owner = isStudio || i.author === session.name;
      if (body.title !== undefined && owner) i.title = str(body.title, 120) || i.title;
      if (body.body !== undefined && owner) i.body = str(body.body, 4000);
      if (body.color !== undefined && owner && COLORS.includes(body.color as IdeaColor)) i.color = body.color as IdeaColor;
      if (body.link !== undefined && owner) i.link = cleanLink(body.link);
      if (body.status !== undefined && isStudio && STATUSES.includes(body.status as IdeaStatus) && i.status !== body.status) {
        i.status = body.status as IdeaStatus;
        statusChanged = i.status;
      }
      if (body.pinned !== undefined && isStudio) i.pinned = Boolean(body.pinned);
      i.updatedAt = now;
      return i;
    });
    if (!idea) return fail(404, "Not found");
    if (statusChanged) {
      const label: Record<IdeaStatus, string> = { new: "new", exploring: "exploring", "in-production": "in production", made: "made", parked: "parked" };
      await logActivity(session.name, session.role, "idea.status", `${session.name} marked "${idea.title}" as ${label[statusChanged]}`, { kind: "idea", id: idea.id }).catch(() => {});
    }
    return json({ idea });
  }

  if (req.method !== "POST") return fail(405, "Method not allowed");

  if (sub === "comments") {
    const body = await readJson<{ body?: string }>(req);
    const text = str(body.body, 2000);
    if (!text) throw new HttpError(400, "Write a comment first.");
    const comment: IdeaComment = { id: id(), author: session.name, role: session.role, body: text, at: now };
    const idea = await mutateCollection<Idea, Idea | undefined>("ideas", (items) => {
      const i = items.find((x) => x.id === iid);
      if (!i) return undefined;
      i.comments.push(comment);
      i.updatedAt = now;
      return i;
    });
    if (!idea) return fail(404, "Not found");
    await logActivity(session.name, session.role, "idea.commented", `${session.name} replied on "${idea.title}": ${text.slice(0, 100)}`, { kind: "idea", id: idea.id }).catch(() => {});
    return json({ idea, comment });
  }

  if (sub === "heart") {
    const idea = await mutateCollection<Idea, Idea | undefined>("ideas", (items) => {
      const i = items.find((x) => x.id === iid);
      if (!i) return undefined;
      i.hearts = i.hearts.includes(session.name) ? i.hearts.filter((n) => n !== session.name) : [...i.hearts, session.name];
      return i;
    });
    if (!idea) return fail(404, "Not found");
    return json({ idea });
  }

  return fail(404, "Unknown action");
});

export const config: Config = { path: ["/api/ideas", "/api/ideas/*"] };
