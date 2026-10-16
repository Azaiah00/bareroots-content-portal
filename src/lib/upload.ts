import type { FileRole, MediaKind, PresignRequest, PresignResponse } from "@shared/types";
import { MEDIA_KIND_BY_MIME } from "@shared/types";
import { api, ApiError } from "./api";

/**
 * Browser → B2 upload pipeline.
 *
 *  1. Probe the file (dimensions, duration) and draw a small JPEG poster so
 *     the grids never show a blank tile — even for a 2 GB .mov.
 *  2. Ask the portal for a presigned PUT URL.
 *  3. PUT straight to Backblaze with XHR so we get real progress events.
 *  4. Upload the poster the same way (tiny, best effort).
 *  5. Tell the portal the file is there; it verifies with the bucket, then
 *     records it in the right collection.
 */

export type UploadStatus = "queued" | "preparing" | "uploading" | "registering" | "done" | "error" | "cancelled";

export interface UploadJob {
  id: string;
  file: File;
  kind: MediaKind;
  scope: PresignRequest["scope"];
  parentId: string;
  label?: string;
  role?: FileRole;
  status: UploadStatus;
  /** 0..1 */
  progress: number;
  loaded: number;
  error?: string;
  previewUrl?: string;
  result?: unknown;
  xhr?: XMLHttpRequest;
  attempts: number;
}

export interface Probe {
  poster?: Blob;
  width?: number;
  height?: number;
  duration?: number;
}

const POSTER_MAX = 720;

const canvasToJpeg = (canvas: HTMLCanvasElement, q = 0.82): Promise<Blob | undefined> =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), "image/jpeg", q));

const scaleTo = (w: number, h: number) => {
  const s = Math.min(1, POSTER_MAX / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
};

const probeImage = async (file: File): Promise<Probe> => {
  try {
    const bmp = await createImageBitmap(file);
    const { w, h } = scaleTo(bmp.width, bmp.height);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    const poster = await canvasToJpeg(c);
    const out: Probe = { width: bmp.width, height: bmp.height, poster };
    bmp.close?.();
    return out;
  } catch {
    // HEIC and friends: the browser can't decode it. Try the <img> route once.
    return new Promise<Probe>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      const done = (p: Probe) => {
        URL.revokeObjectURL(url);
        resolve(p);
      };
      img.onload = async () => {
        try {
          const { w, h } = scaleTo(img.naturalWidth, img.naturalHeight);
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d")!.drawImage(img, 0, 0, w, h);
          done({ width: img.naturalWidth, height: img.naturalHeight, poster: await canvasToJpeg(c) });
        } catch {
          done({});
        }
      };
      img.onerror = () => done({});
      img.src = url;
    });
  }
};

const probeVideo = (file: File): Promise<Probe> =>
  new Promise<Probe>((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    let settled = false;
    const out: Probe = {};
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const timer = setTimeout(finish, 9000);
    v.onloadedmetadata = () => {
      out.duration = Number.isFinite(v.duration) ? v.duration : undefined;
      out.width = v.videoWidth || undefined;
      out.height = v.videoHeight || undefined;
      const t = out.duration ? Math.min(1.2, out.duration * 0.25) : 0.1;
      try {
        v.currentTime = t;
      } catch {
        finish();
      }
    };
    v.onseeked = async () => {
      try {
        if (!v.videoWidth) return finish();
        const { w, h } = scaleTo(v.videoWidth, v.videoHeight);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(v, 0, 0, w, h);
        out.poster = await canvasToJpeg(c);
      } catch {
        /* no poster */
      }
      clearTimeout(timer);
      finish();
    };
    v.onerror = () => {
      clearTimeout(timer);
      finish();
    };
    v.src = url;
  });

export const probeFile = async (file: File, kind: MediaKind): Promise<Probe> => {
  if (kind === "image") return probeImage(file);
  if (kind === "video") return probeVideo(file);
  return {};
};

const putWithProgress = (
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress?: (loaded: number, total: number) => void,
  attach?: (xhr: XMLHttpRequest) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    attach?.(xhr);
    xhr.open("PUT", url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage replied ${xhr.status}${xhr.status === 0 ? " (blocked — check CORS on the bucket)" : ""}`));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted — check the connection and the bucket's CORS rule."));
    xhr.onabort = () => reject(new Error("cancelled"));
    xhr.ontimeout = () => reject(new Error("The upload timed out."));
    xhr.timeout = 0;
    xhr.send(body);
  });

export const runUpload = async (job: UploadJob, update: (patch: Partial<UploadJob>) => void): Promise<unknown> => {
  update({ status: "preparing", progress: 0, loaded: 0, error: undefined });
  const probe = await probeFile(job.file, job.kind);

  const presign = await api<PresignResponse>("/api/upload/presign", {
    method: "POST",
    json: { scope: job.scope, parentId: job.parentId, name: job.file.name, mime: job.file.type, size: job.file.size } as PresignRequest,
  });

  update({ status: "uploading" });
  let attempt = 0;
  // Three tries for the big file; the presigned URL lasts an hour.
  for (;;) {
    try {
      await putWithProgress(
        presign.url,
        presign.headers,
        job.file,
        (loaded, total) => update({ loaded, progress: total ? loaded / total : 0 }),
        (xhr) => update({ xhr }),
      );
      break;
    } catch (err: any) {
      if (String(err?.message) === "cancelled") throw err;
      attempt++;
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }

  let posterKey: string | undefined;
  if (probe.poster) {
    try {
      const p = await api<PresignResponse>("/api/upload/presign", {
        method: "POST",
        json: {
          scope: job.scope,
          parentId: job.parentId,
          name: "poster.jpg",
          mime: "image/jpeg",
          size: probe.poster.size,
          poster: true,
          forKey: presign.key,
        } as PresignRequest,
      });
      await putWithProgress(p.url, p.headers, probe.poster);
      posterKey = p.key;
    } catch {
      /* a missing thumbnail is cosmetic */
    }
  }

  update({ status: "registering", progress: 1 });
  const result = await api("/api/upload/complete", {
    method: "POST",
    json: {
      scope: job.scope,
      parentId: job.parentId,
      key: presign.key,
      name: job.file.name,
      mime: job.file.type,
      size: job.file.size,
      posterKey,
      width: probe.width,
      height: probe.height,
      duration: probe.duration,
      label: job.label,
      role: job.role,
    },
  });
  update({ status: "done", result });
  return result;
};

export const makeJob = (file: File, scope: PresignRequest["scope"], parentId: string, extra: Partial<UploadJob> = {}): UploadJob => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  file,
  kind: MEDIA_KIND_BY_MIME(file.type, file.name),
  scope,
  parentId,
  status: "queued",
  progress: 0,
  loaded: 0,
  attempts: 0,
  previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  ...extra,
});

export const describeUploadError = (err: unknown): string => {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Upload failed.";
};
