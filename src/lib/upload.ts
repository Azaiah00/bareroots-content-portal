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

/* ── Resumable multipart path (big files) ─────────────────────────────────
 * Phones drop long single uploads: the screen locks, Safari pauses the tab,
 * the signal dips. Anything over MULTIPART_MIN goes up in 8 MB parts instead —
 * three at a time, each retried on its own, and the finished parts are saved
 * on the device so picking the same file again carries on where it stopped. */

const MULTIPART_MIN = 20 * 1024 * 1024;
const PART_CONCURRENCY = 3;
const PART_TRIES = 10;
const RESUME_PREFIX = "br-mp:";

interface ResumeRecord {
  key: string;
  uploadId: string;
  parentId: string;
  partSize: number;
  partCount: number;
  etags: Record<number, string>;
  savedAt: number;
}

const resumeId = (job: UploadJob) =>
  `${RESUME_PREFIX}${job.scope}:${job.scope === "raw" ? "" : job.parentId}:${job.file.name}:${job.file.size}:${job.file.lastModified}`;

const loadResume = (job: UploadJob): ResumeRecord | null => {
  try {
    const raw = localStorage.getItem(resumeId(job));
    if (!raw) return null;
    const r = JSON.parse(raw) as ResumeRecord;
    // Signed part URLs and multipart sessions are good for well over a day; be conservative.
    if (Date.now() - r.savedAt > 1000 * 60 * 60 * 20) return null;
    return r;
  } catch {
    return null;
  }
};
const saveResume = (job: UploadJob, r: ResumeRecord) => {
  try {
    localStorage.setItem(resumeId(job), JSON.stringify({ ...r, savedAt: Date.now() }));
  } catch {
    /* storage full or private mode — resume just won't survive a reload */
  }
};
const dropResume = (job: UploadJob) => {
  try {
    localStorage.removeItem(resumeId(job));
  } catch {
    /* ignore */
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the page is visible and the device says it's online. */
const waitUntilReady = () =>
  new Promise<void>((resolve) => {
    const ok = () => document.visibilityState === "visible" && navigator.onLine !== false;
    if (ok()) return resolve();
    const check = () => {
      if (ok()) {
        document.removeEventListener("visibilitychange", check);
        window.removeEventListener("online", check);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
  });

const putPart = (url: string, body: Blob, onProgress: (loaded: number) => void, track: (x: XMLHttpRequest | null) => void) =>
  new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    track(xhr);
    xhr.open("PUT", url, true);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      track(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("etag") || xhr.getResponseHeader("ETag");
        if (etag) resolve(etag);
        else reject(Object.assign(new Error("Storage didn't confirm the piece (no ETag) — check the bucket's CORS rule."), { fatal: true }));
      } else reject(Object.assign(new Error(`Storage replied ${xhr.status}`), { status: xhr.status }));
    };
    xhr.onerror = () => {
      track(null);
      reject(new Error("Connection dropped"));
    };
    xhr.onabort = () => {
      track(null);
      reject(new Error("cancelled"));
    };
    xhr.timeout = 5 * 60 * 1000;
    xhr.ontimeout = () => {
      track(null);
      reject(new Error("A piece timed out"));
    };
    xhr.send(body);
  });

const runMultipart = async (job: UploadJob, update: (patch: Partial<UploadJob>) => void): Promise<{ key: string; parentId: string }> => {
  const file = job.file;
  let rec = loadResume(job);
  if (!rec) {
    const s = await api<{ key: string; uploadId: string; partSize: number; partCount: number }>("/api/upload/mp-start", {
      method: "POST",
      json: { scope: job.scope, parentId: job.parentId, name: file.name, mime: file.type, size: file.size },
    });
    rec = { ...s, parentId: job.parentId, etags: {}, savedAt: Date.now() };
    saveResume(job, rec);
  }
  const R = rec;
  const live = new Set<XMLHttpRequest>();
  let cancelled = false;
  update({
    xhr: {
      abort: () => {
        cancelled = true;
        live.forEach((x) => x.abort());
      },
    } as unknown as XMLHttpRequest,
  });

  const partBytes = (n: number) => Math.min(R.partSize, file.size - (n - 1) * R.partSize);
  const inflight = new Map<number, number>();
  const report = () => {
    let loaded = 0;
    for (const n of Object.keys(R.etags)) loaded += partBytes(Number(n));
    inflight.forEach((v) => (loaded += v));
    update({ loaded, progress: Math.min(0.999, loaded / file.size) });
  };
  report();

  const urls = new Map<number, string>();
  const sign = async (wanted: number[]) => {
    const need = wanted.filter((n) => !urls.has(n));
    if (!need.length) return;
    const { urls: got } = await api<{ urls: { n: number; url: string }[] }>("/api/upload/mp-sign", {
      method: "POST",
      json: { scope: job.scope, parentId: R.parentId, key: R.key, uploadId: R.uploadId, parts: need },
    });
    for (const u of got) urls.set(u.n, u.url);
  };

  const todo: number[] = [];
  for (let n = 1; n <= R.partCount; n++) if (!R.etags[n]) todo.push(n);

  const worker = async () => {
    for (;;) {
      if (cancelled) throw new Error("cancelled");
      const n = todo.shift();
      if (n === undefined) return;
      let tries = 0;
      for (;;) {
        if (cancelled) throw new Error("cancelled");
        await waitUntilReady();
        try {
          if (!urls.has(n)) await sign(todo.slice(0, 40).concat(n));
          const start = (n - 1) * R.partSize;
          const etag = await putPart(
            urls.get(n)!,
            file.slice(start, start + partBytes(n)),
            (l) => {
              inflight.set(n, l);
              report();
            },
            (x) => {
              if (x) live.add(x);
              else live.forEach((y) => y.readyState === 4 && live.delete(y));
            },
          );
          inflight.delete(n);
          R.etags[n] = etag;
          saveResume(job, R);
          report();
          break;
        } catch (err: any) {
          inflight.delete(n);
          if (cancelled || String(err?.message) === "cancelled") throw new Error("cancelled");
          if (err?.fatal) throw err;
          if (err?.status === 403) urls.delete(n); // URL expired — sign again
          tries++;
          if (tries >= PART_TRIES) throw new Error(`The connection kept dropping (${err?.message || "network"}). Tap Retry — it will pick up where it stopped.`);
          await sleep(Math.min(15000, 1000 * 2 ** (tries - 1)));
        }
      }
    }
  };

  update({ status: "uploading" });
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, Math.max(1, todo.length)) }, worker));

  await api("/api/upload/mp-finish", {
    method: "POST",
    json: {
      scope: job.scope,
      parentId: R.parentId,
      key: R.key,
      uploadId: R.uploadId,
      parts: Object.entries(R.etags).map(([n, etag]) => ({ n: Number(n), etag })),
    },
  });
  dropResume(job);
  return { key: R.key, parentId: R.parentId };
};

export const runUpload = async (job: UploadJob, update: (patch: Partial<UploadJob>) => void): Promise<unknown> => {
  update({ status: "preparing", progress: 0, loaded: 0, error: undefined });
  const probe = await probeFile(job.file, job.kind);

  let key: string;
  let parentId = job.parentId;
  if (job.file.size >= MULTIPART_MIN) {
    const r = await runMultipart(job, update);
    key = r.key;
    parentId = r.parentId;
  } else {
    const presign = await api<PresignResponse>("/api/upload/presign", {
      method: "POST",
      json: { scope: job.scope, parentId: job.parentId, name: job.file.name, mime: job.file.type, size: job.file.size } as PresignRequest,
    });
    key = presign.key;
    update({ status: "uploading" });
    let attempt = 0;
    for (;;) {
      try {
        await waitUntilReady();
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
        if (attempt >= 5) throw err;
        await sleep(1500 * attempt);
      }
    }
  }

  let posterKey: string | undefined;
  if (probe.poster) {
    try {
      const p = await api<PresignResponse>("/api/upload/presign", {
        method: "POST",
        json: {
          scope: job.scope,
          parentId,
          name: "poster.jpg",
          mime: "image/jpeg",
          size: probe.poster.size,
          poster: true,
          forKey: key,
        } as PresignRequest,
      });
      await putWithProgress(p.url, p.headers, probe.poster);
      posterKey = p.key;
    } catch {
      /* a missing thumbnail is cosmetic */
    }
  }

  update({ status: "registering", progress: 1 });
  let result: unknown;
  for (let i = 0; ; i++) {
    try {
      result = await api("/api/upload/complete", {
        method: "POST",
        json: {
          scope: job.scope,
          parentId,
          key,
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
      break;
    } catch (err) {
      if (i >= 3 || (err instanceof ApiError && err.status && err.status < 500 && err.status !== 409)) throw err;
      await sleep(2000 * (i + 1));
      await waitUntilReady();
    }
  }
  update({ status: "done", result });
  return result;
};

/** Tell the studio an upload failed (best effort, never throws). */
export const reportUploadProblem = (job: UploadJob, message: string) => {
  const ua = navigator.userAgent;
  const device = /iPhone|iPad/.test(ua)
    ? `iPhone/iPad ${(ua.match(/OS (\d+[_\d]*)/)?.[1] || "").replace(/_/g, ".")} ${/CriOS/.test(ua) ? "Chrome" : "Safari"}`
    : /Android/.test(ua)
      ? `Android ${/SamsungBrowser/.test(ua) ? "Samsung Internet" : "Chrome"}`
      : /Mac/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "browser";
  api("/api/upload/report", {
    method: "POST",
    json: { name: job.file.name, size: job.file.size, type: job.file.type, message, device },
  }).catch(() => {});
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
