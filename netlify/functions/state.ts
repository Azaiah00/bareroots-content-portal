import type { Config } from "@netlify/functions";
import type {
  Activity,
  Deliverable,
  Idea,
  PortalConfig,
  RawAsset,
  RawBatch,
  StateResponse,
} from "../../shared/types";
import { issueToken, requireSession } from "./_lib/auth";
import { env } from "./_lib/env";
import { fail, handle, isoNow, json } from "./_lib/http";
import { presignGet } from "./_lib/s3";
import { mutateCollection, readAll } from "./_lib/store";
import { logActivity } from "./_lib/activity";

/**
 * GET /api/state
 * One call returns everything the app renders, filtered for the caller's role,
 * plus short-lived inline URLs for every poster so the grids paint instantly.
 * Also runs the auto-approval sweep lazily — no cron needed.
 */

const sweepAutoApprovals = async (deliverables: Deliverable[]): Promise<Deliverable[]> => {
  const now = Date.now();
  const due = deliverables.filter((d) => d.status === "published" && d.autoApproveAt && Date.parse(d.autoApproveAt) <= now);
  if (!due.length) return deliverables;
  const ids = new Set(due.map((d) => d.id));
  const updated = await mutateCollection<Deliverable, Deliverable[]>("deliverables", (items) => {
    for (const d of items) {
      if (ids.has(d.id) && d.status === "published") {
        d.status = "approved";
        d.approvedAt = isoNow();
        d.approvedBy = "auto";
        d.updatedAt = isoNow();
      }
    }
    return items;
  });
  for (const d of due) {
    await logActivity("Portal", "studio", "deliverable.approved", `"${d.title}" was approved automatically after five business days`, {
      kind: "deliverable",
      id: d.id,
    }).catch(() => {});
  }
  return updated;
};

export default handle(async (req) => {
  if (req.method !== "GET") return fail(405, "Method not allowed");
  const session = requireSession(req);
  const isStudio = session.role === "studio";

  const all = await readAll();
  const batches = all.batches as RawBatch[];
  const raw = all.raw as RawAsset[];
  let deliverables = all.deliverables as Deliverable[];
  const ideas = all.ideas as Idea[];
  const activity = all.activity as Activity[];

  deliverables = await sweepAutoApprovals(deliverables);

  // Role filtering: the client never sees drafts or studio notes.
  const visibleDeliverables = (isStudio ? deliverables : deliverables.filter((d) => d.status !== "draft")).map((d) =>
    isStudio ? d : { ...d, studioNotes: undefined },
  );
  const visibleRaw = isStudio ? raw : raw.filter((r) => r.status !== "archived");

  // Previews: posters for raw, deliverable files, idea attachments.
  // Signing is local CPU work — no round-trips — so this is cheap even at 500 keys.
  const previews: Record<string, string> = {};
  const want = new Set<string>();
  for (const r of visibleRaw) if (r.posterKey) want.add(r.posterKey);
  for (const d of visibleDeliverables) for (const f of d.files) if (f.posterKey) want.add(f.posterKey);
  for (const i of ideas) for (const a of i.attachments) if (a.posterKey) want.add(a.posterKey);
  if (env.b2Configured()) {
    await Promise.all(
      [...want].map(async (key) => {
        try {
          previews[key] = await presignGet(key, { mime: "image/jpeg" });
        } catch {
          /* leave missing — the UI falls back to a tile */
        }
      }),
    );
  }

  const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);
  const rawBytes = sum(raw.map((r) => r.size));
  const deliverableBytes = sum(deliverables.flatMap((d) => d.files.map((f) => f.size)));
  const ideaBytes = sum(ideas.flatMap((i) => i.attachments.map((a) => a.size)));

  const config: PortalConfig = {
    clientNames: env.clientNames(),
    studioNames: env.studioNames(),
    maxUploadBytes: env.maxUploadBytes(),
    storageBudgetBytes: env.storageBudgetBytes(),
    businessName: env.businessName(),
    studioName: env.studioName(),
  };

  // Renew the session on every load so an active device never expires.
  const renewed = issueToken(session.role, session.name);

  const body: StateResponse = {
    session: renewed.session,
    config,
    batches,
    raw: visibleRaw,
    deliverables: visibleDeliverables,
    ideas,
    activity: activity.slice(0, 200),
    previews,
    storage: { usedBytes: rawBytes + deliverableBytes + ideaBytes, rawBytes, deliverableBytes, ideaBytes },
    serverTime: isoNow(),
  };
  return json(body, 200, { "x-portal-token": renewed.token });
});

export const config: Config = { path: "/api/state" };
