import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FileRole, PresignRequest } from "@shared/types";
import { describeUploadError, makeJob, reportUploadProblem, runUpload, type UploadJob } from "@/lib/upload";
import { bytes } from "@/lib/format";
import { Icon } from "./Icon";
import { Button } from "./ui";
import { usePortal } from "@/lib/store";

/**
 * Queue + drop zone + progress list, shared by every place a file can enter
 * the portal. Two uploads run at a time; big files go up in resumable parts
 * (see lib/upload); the screen is kept awake while anything is sending, and a
 * failure is reported to the studio's Activity feed with the device it was on.
 */

// iPhone Safari runs out of memory when several big videos are processed at once, so it uploads one file at a time.
const IOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const CONCURRENCY = IOS ? 1 : 2;

export const useUploader = (scope: PresignRequest["scope"]) => {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const jobsRef = useRef<UploadJob[]>([]);
  const running = useRef(0);
  const { state, toast, session } = usePortal();
  const skipPoster = session?.role === "client";
  const maxBytes = state?.config.maxUploadBytes ?? 4000 * 1024 * 1024;

  const update = useCallback((id: string, patch: Partial<UploadJob>) => {
    jobsRef.current = jobsRef.current.map((j) => (j.id === id ? { ...j, ...patch } : j));
    setJobs(jobsRef.current);
  }, []);

  const pump = useCallback(() => {
    while (running.current < CONCURRENCY) {
      const next = jobsRef.current.find((j) => j.status === "queued");
      if (!next) break;
      running.current += 1;
      update(next.id, { status: "preparing", attempts: next.attempts + 1 });
      runUpload({ ...next }, (patch) => update(next.id, patch))
        .catch((err) => {
          if (String(err?.message) === "cancelled") update(next.id, { status: "cancelled", error: undefined, xhr: undefined });
          else {
            const msg = describeUploadError(err);
            update(next.id, { status: "error", error: msg, xhr: undefined });
            reportUploadProblem(next, msg);
          }
        })
        .finally(() => {
          running.current -= 1;
          pump();
        });
    }
  }, [update]);

  const add = useCallback(
    (files: File[] | FileList, parentId: string, extra: { label?: string; role?: FileRole } = {}) => {
      const list = Array.from(files);
      const accepted: UploadJob[] = [];
      for (const f of list) {
        if (f.size > maxBytes) {
          toast(`"${f.name}" is ${bytes(f.size)} — larger than the ${bytes(maxBytes)} limit.`, "error");
          continue;
        }
        if (f.size === 0) {
          toast(`"${f.name}" is empty.`, "error");
          continue;
        }
        accepted.push(makeJob(f, scope, parentId, { ...extra, skipPoster }));
      }
      if (!accepted.length) return [];
      jobsRef.current = [...jobsRef.current, ...accepted];
      setJobs(jobsRef.current);
      pump();
      return accepted;
    },
    [scope, maxBytes, pump, toast, skipPoster],
  );

  const retry = useCallback(
    (id: string) => {
      update(id, { status: "queued", error: undefined, progress: 0, loaded: 0 });
      pump();
    },
    [update, pump],
  );

  const cancel = useCallback(
    (id: string) => {
      const j = jobsRef.current.find((x) => x.id === id);
      if (!j) return;
      if (j.xhr) j.xhr.abort();
      else update(id, { status: "cancelled" });
    },
    [update],
  );

  const remove = useCallback((id: string) => {
    const j = jobsRef.current.find((x) => x.id === id);
    if (j?.previewUrl) URL.revokeObjectURL(j.previewUrl);
    jobsRef.current = jobsRef.current.filter((x) => x.id !== id);
    setJobs(jobsRef.current);
  }, []);

  const clearDone = useCallback(() => {
    for (const j of jobsRef.current) if (j.status === "done" && j.previewUrl) URL.revokeObjectURL(j.previewUrl);
    jobsRef.current = jobsRef.current.filter((x) => x.status !== "done");
    setJobs(jobsRef.current);
  }, []);

  // Warn before the tab closes mid-upload.
  useEffect(() => {
    const busy = jobs.some((j) => j.status === "uploading" || j.status === "preparing" || j.status === "registering" || j.status === "queued");
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [jobs]);

  // Keep the phone's screen awake while anything is sending — a locked iPhone pauses the page.
  const sending = jobs.some((j) => ["queued", "preparing", "uploading", "registering"].includes(j.status));
  useEffect(() => {
    if (!sending) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const grab = () => {
      if (document.visibilityState !== "visible") return;
      nav.wakeLock!
        .request("screen")
        .then((l) => {
          if (alive) lock = l;
          else l.release().catch(() => {});
        })
        .catch(() => {});
    };
    grab();
    document.addEventListener("visibilitychange", grab);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", grab);
      lock?.release().catch(() => {});
    };
  }, [sending]);

  const active = jobs.filter((j) => ["queued", "preparing", "uploading", "registering"].includes(j.status));
  const done = jobs.filter((j) => j.status === "done");
  const failed = jobs.filter((j) => j.status === "error");

  return { jobs, add, retry, cancel, remove, clearDone, active, done, failed };
};

/* ───────────────────────── Drop zone ──────────────────────────────────── */

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
  capture?: boolean;
}

export const DropZone = ({ onFiles, accept = "image/*,video/*", multiple = true, title, hint, compact }: DropZoneProps) => {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (list: FileList | null) => {
    if (!list || !list.length) return;
    onFiles(Array.from(list));
    if (inputRef.current) inputRef.current.value = "";
  };
  return (
    <div
      className={["dropzone", over ? "over" : ""].filter(Boolean).join(" ")}
      style={compact ? { minHeight: 140, padding: "1.25rem" } : undefined}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
    >
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} onChange={(e) => pick(e.target.files)} aria-label="Choose files to upload" />
      <div className="ring">
        <Icon name="upload" />
      </div>
      <div>
        <h3>{title ?? "Tap to add photos & videos"}</h3>
        <p className="muted small" style={{ marginTop: 6 }}>
          {hint ?? "or drag them here. Big files are fine — they go straight to secure storage."}
        </p>
      </div>
    </div>
  );
};

/* ───────────────────────── Progress list ──────────────────────────────── */

const statusText = (j: UploadJob): string => {
  switch (j.status) {
    case "queued":
      return "Waiting";
    case "preparing":
      return "Preparing";
    case "uploading":
      return `${Math.round(j.progress * 100)}% · ${bytes(j.loaded)} of ${bytes(j.file.size)}`;
    case "registering":
      return "Saving";
    case "done":
      return "Received";
    case "error":
      return j.error || "Failed";
    case "cancelled":
      return "Cancelled";
  }
};

export const UploadList = ({ jobs, onRetry, onCancel, onRemove }: { jobs: UploadJob[]; onRetry: (id: string) => void; onCancel: (id: string) => void; onRemove: (id: string) => void }) => {
  if (!jobs.length) return null;
  const sending = jobs.some((j) => ["queued", "preparing", "uploading", "registering"].includes(j.status));
  return (
    <div>
      {sending ? (
        <p className="xs muted" role="status" style={{ margin: "0 0 0.6rem", display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="alert" style={{ width: 14, height: 14, flex: "none", color: "var(--gold)" }} />
          Keep this screen open until each file says Sent. If anything stops, tap Retry — it carries on from where it left off.
        </p>
      ) : null}
      {jobs.map((j) => (
        <div className="uprow" key={j.id}>
          <div className="thumb">{j.previewUrl ? <img src={j.previewUrl} alt="" /> : <Icon name={j.kind === "video" ? "film" : j.kind === "audio" ? "audio" : "file"} />}</div>
          <div style={{ minWidth: 0 }}>
            <div className="name">{j.file.name}</div>
            <div className={`xs ${j.status === "error" ? "" : "muted"}`} style={j.status === "error" ? { color: "var(--alert-lift)" } : undefined}>
              {statusText(j)}
            </div>
            {j.status !== "done" && j.status !== "cancelled" ? (
              <div className={`progress ${j.status === "error" ? "error" : ""}`}>
                <i style={{ width: `${Math.max(2, j.progress * 100)}%` }} />
              </div>
            ) : (
              <div className="progress done">
                <i style={{ width: "100%" }} />
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 4 }}>
            {j.status === "error" || j.status === "cancelled" ? (
              <>
                <Button size="xs" icon="refresh" onClick={() => onRetry(j.id)}>
                  Retry
                </Button>
                <button className="icon-btn" aria-label="Remove" onClick={() => onRemove(j.id)}>
                  <Icon name="x" />
                </button>
              </>
            ) : j.status === "done" ? (
              <span className="chip chip-ok">
                <Icon name="check" style={{ width: 12, height: 12 }} /> Sent
              </span>
            ) : (
              <button className="icon-btn" aria-label="Cancel upload" onClick={() => onCancel(j.id)}>
                <Icon name="x" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
