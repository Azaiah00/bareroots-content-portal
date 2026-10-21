/**
 * Shared data model — imported by both the browser app (src/) and the
 * Netlify Functions (netlify/functions/). Keep it dependency-free.
 */

export type Role = "client" | "studio";

export interface Session {
  role: Role;
  name: string;
  /** Unix ms expiry */
  exp: number;
}

export type MediaKind = "video" | "image" | "audio" | "other";

export type Platform = "instagram" | "tiktok" | "facebook";

export type InstagramFormat = "reel" | "feed" | "story" | "carousel";

/* ───────────────────────── Raw footage (client → studio) ───────────────── */

export interface RawBatch {
  id: string;
  /** What the client said this footage is. */
  note: string;
  createdBy: string;
  createdAt: string; // ISO
  /** Number of assets registered under this batch. Kept in sync by the API. */
  count: number;
}

export type RawStatus = "new" | "used" | "archived";

export interface RawAsset {
  id: string;
  batchId: string;
  /** Original filename as the client sent it. */
  name: string;
  /** Object key in the bucket. */
  key: string;
  /** Poster/thumbnail key (small JPEG), if the browser could make one. */
  posterKey?: string;
  size: number;
  mime: string;
  kind: MediaKind;
  width?: number;
  height?: number;
  /** Seconds, for video/audio. */
  duration?: number;
  /** Optional per-file label the client added. */
  label?: string;
  uploadedBy: string;
  uploadedAt: string;
  status: RawStatus;
  /** Deliverable ids this raw file was used in. */
  usedIn: string[];
}

/* ───────────────────────── Deliverables (studio → client) ──────────────── */

export type DeliverableKind = "video" | "static";

export type DeliverableStatus =
  | "draft" // studio only
  | "published" // visible to client, awaiting approval
  | "changes" // client asked for a change
  | "approved"; // client approved or auto-approved

export type FileRole = "main" | "cover" | "alt";

export interface DeliverableFile {
  id: string;
  role: FileRole;
  key: string;
  name: string;
  size: number;
  mime: string;
  kind: MediaKind;
  posterKey?: string;
  width?: number;
  height?: number;
  duration?: number;
  /** A short label when there are several alts ("square crop", "no music"). */
  label?: string;
}

export interface PlatformPlan {
  platform: Platform;
  /** Instagram only. */
  format?: InstagramFormat;
  /** Recommended posting time, ISO with offset. */
  postAt?: string;
  /** Caption override for this platform. Falls back to the main caption. */
  caption?: string;
  /** Platform tip shown to the client ("Post as a Reel, add trending audio"). */
  tip?: string;
  posted?: { by: string; at: string };
}

export interface RevisionRequest {
  id: string;
  by: string;
  at: string;
  message: string;
  /** Set when the studio republishes with the fix. */
  resolvedAt?: string;
  resolvedNote?: string;
}

export interface Deliverable {
  id: string;
  title: string;
  kind: DeliverableKind;
  status: DeliverableStatus;
  files: DeliverableFile[];
  caption: string;
  hashtags: string[];
  cta?: string;
  /** Free-text posting tips, shown under the caption. */
  tips?: string;
  platforms: PlatformPlan[];
  /** Raw asset ids this was cut from. */
  sourceRawIds: string[];
  /** Internal studio notes — never sent to the client UI. */
  studioNotes?: string;
  revisions: RevisionRequest[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  /** When silence becomes approval (5 business days after publish). */
  autoApproveAt?: string;
  approvedAt?: string;
  approvedBy?: string; // a name, or "auto"
  /** Bumped every republish. */
  version: number;
}

/* ───────────────────────── Ideas board ─────────────────────────────────── */

export type IdeaColor = "gold" | "sage" | "mauve" | "cream" | "plum";

export type IdeaStatus = "new" | "exploring" | "in-production" | "made" | "parked";

export interface IdeaAttachment {
  id: string;
  key: string;
  name: string;
  mime: string;
  kind: MediaKind;
  size: number;
  posterKey?: string;
}

export interface IdeaComment {
  id: string;
  author: string;
  role: Role;
  body: string;
  at: string;
}

export interface Idea {
  id: string;
  title: string;
  body: string;
  color: IdeaColor;
  status: IdeaStatus;
  author: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
  link?: string;
  attachments: IdeaAttachment[];
  comments: IdeaComment[];
  /** Names of people who hearted it. */
  hearts: string[];
  pinned: boolean;
  /** Set once it became a deliverable. */
  deliverableId?: string;
}

/* ───────────────────────── Activity feed ───────────────────────────────── */

export type ActivityType =
  | "raw.uploaded"
  | "raw.archived"
  | "deliverable.published"
  | "deliverable.republished"
  | "deliverable.approved"
  | "deliverable.changes"
  | "deliverable.posted"
  | "deliverable.deleted"
  | "idea.created"
  | "idea.commented"
  | "idea.status"
  | "session.joined"
  | "upload.problem";

export interface Activity {
  id: string;
  at: string;
  who: string;
  role: Role;
  type: ActivityType;
  message: string;
  ref?: { kind: "raw" | "batch" | "deliverable" | "idea"; id: string };
}

/* ───────────────────────── API shapes ──────────────────────────────────── */

export interface PortalConfig {
  clientNames: string[];
  studioNames: string[];
  maxUploadBytes: number;
  storageBudgetBytes: number;
  businessName: string;
  studioName: string;
}

export interface StateResponse {
  session: Session;
  config: PortalConfig;
  batches: RawBatch[];
  raw: RawAsset[];
  deliverables: Deliverable[];
  ideas: Idea[];
  activity: Activity[];
  /** key → short-lived inline URL for posters and small previews. */
  previews: Record<string, string>;
  storage: { usedBytes: number; rawBytes: number; deliverableBytes: number; ideaBytes: number };
  serverTime: string;
}

export interface PresignRequest {
  /** Where this file belongs. */
  scope: "raw" | "deliverable" | "idea";
  /** Batch / deliverable / idea id the file is for. */
  parentId: string;
  name: string;
  mime: string;
  size: number;
  /** Mark as a poster for `forKey` rather than a primary file. */
  poster?: boolean;
  forKey?: string;
}

export interface PresignResponse {
  key: string;
  url: string;
  /** Headers the browser must send with the PUT, exactly. */
  headers: Record<string, string>;
  expiresAt: string;
}

export const MEDIA_KIND_BY_MIME = (mime: string, name = ""): MediaKind => {
  const m = (mime || "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() || "";
  if (m.startsWith("video/") || ["mov", "mp4", "m4v", "webm", "mkv", "avi", "hevc"].includes(ext)) return "video";
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "tif", "tiff", "bmp"].includes(ext))
    return "image";
  if (m.startsWith("audio/") || ["mp3", "m4a", "wav", "aac", "ogg"].includes(ext)) return "audio";
  return "other";
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

export const INSTAGRAM_FORMAT_LABEL: Record<InstagramFormat, string> = {
  reel: "Reel",
  feed: "Feed post",
  story: "Story",
  carousel: "Carousel",
};

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  new: "New idea",
  exploring: "Exploring",
  "in-production": "In production",
  made: "Made",
  parked: "Parked",
};

export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  draft: "Draft",
  published: "Ready to post",
  changes: "Change requested",
  approved: "Approved",
};
