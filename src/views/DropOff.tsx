import { useEffect, useMemo, useState } from "react";
import type { RawAsset, RawBatch } from "@shared/types";
import { usePortal } from "@/lib/store";
import { api } from "@/lib/api";
import { DropZone, UploadList, useUploader } from "@/components/Uploader";
import { Button, Empty, Lightbox, MediaTile, useConfirm } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { bytes, fmtDateTime, plural, relative } from "@/lib/format";
import { useReveal } from "@/lib/motion";
import { groupRaw } from "@/lib/groups";

/**
 * CLIENT · Drop Off
 * The simplest possible job: tap, choose, done. A short note per drop tells
 * the studio what the footage is. Everything they've ever sent sits below,
 * newest first, so they never wonder whether it went through.
 */

/** Set while a selection is being handed to the queue; if the page dies in between, the next visit knows. */
const PICK_MARK = "br-pick-pending";

const markPick = (value: { count: number; bytes: number } | null) => {
  try {
    if (value) localStorage.setItem(PICK_MARK, JSON.stringify(value));
    else localStorage.removeItem(PICK_MARK);
  } catch {
    /* private mode — the reload notice just won't show */
  }
};
const readPick = (): { count: number; bytes: number } | null => {
  try {
    const raw = localStorage.getItem(PICK_MARK);
    return raw ? (JSON.parse(raw) as { count: number; bytes: number }) : null;
  } catch {
    return null;
  }
};

const deviceLabel = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return `iPhone/iPad ${(ua.match(/OS (\d+[_\d]*)/)?.[1] || "").replace(/_/g, ".")} ${/CriOS/.test(ua) ? "Chrome" : "Safari"}`;
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "browser";
};

/** Tell the studio's Activity feed about a failure that happened before any file reached the uploader. */
const reportProblem = (name: string, size: number, message: string) => {
  api("/api/upload/report", { method: "POST", json: { name, size, type: "", message, device: deviceLabel() } }).catch(() => {});
};

export const DropOff = () => {
  const { state, refresh, session, preview, toast } = usePortal();
  const uploader = useUploader("raw");
  const [note, setNote] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState<{ asset: RawAsset; url: string } | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, element: confirmEl } = useConfirm();
  const ref = useReveal<HTMLDivElement>([state?.batches.length]);
  const [picking, setPicking] = useState<{ count: number; bytes: number } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [lostPick, setLostPick] = useState<{ count: number; bytes: number } | null>(null);

  // If the last selection was still being handed over when the page went away, say so, and tell the studio once.
  useEffect(() => {
    const p = readPick();
    if (!p) return;
    markPick(null);
    reportProblem(`${p.count} file${p.count === 1 ? "" : "s"} selected`, p.bytes, "The page reloaded before the files reached the upload queue (likely the phone running low on memory)");
    setLostPick(p);
  }, []);

  const deleteAsset = async (asset: RawAsset) => {
    if (!(await confirm(`Delete ${asset.label || asset.name}?`, { body: "It's removed from storage for good. The studio won't be able to use it.", action: "Delete", danger: true }))) return;
    setBusy(asset.id);
    try {
      await api(`/api/raw/${asset.id}`, { method: "DELETE" });
      setView(null);
      toast("Deleted.");
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete that.", "error");
    } finally {
      setBusy(null);
    }
  };

  const deleteBatch = async (batch: RawBatch, count: number) => {
    if (!(await confirm(`Delete this whole drop-off?`, { body: `${plural(count, "file")} will be removed from storage for good.`, action: "Delete drop-off", danger: true }))) return;
    setBusy(batch.id);
    try {
      await api(`/api/raw/batches/${batch.id}`, { method: "DELETE" });
      if (batchId === batch.id) startFresh();
      toast("Drop-off deleted.");
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete that.", "error");
    } finally {
      setBusy(null);
    }
  };

  const ensureBatch = async (): Promise<string> => {
    if (batchId && state?.batches.some((b) => b.id === batchId)) return batchId;
    setStarting(true);
    try {
      const { batch } = await api<{ batch: RawBatch }>("/api/raw/batches", { method: "POST", json: { note } });
      setBatchId(batch.id);
      return batch.id;
    } finally {
      setStarting(false);
    }
  };

  const onFiles = async (files: File[]) => {
    const total = files.reduce((a, f) => a + f.size, 0);
    const summary = { count: files.length, bytes: total };
    setLostPick(null);
    setPickError(null);
    setPicking(summary);
    markPick(summary);
    try {
      const id = await ensureBatch();
      const accepted = uploader.add(files, id);
      if (!accepted.length) setPickError("None of those files could be added. Check the size note above, or try a shorter clip.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't start the drop-off.";
      setPickError(msg);
      reportProblem(`${files.length} file${files.length === 1 ? "" : "s"} selected`, total, msg);
    } finally {
      markPick(null);
      setPicking(null);
    }
  };

  // When the whole queue finishes, refresh and celebrate once.
  const doneCount = uploader.done.length;
  const activeCount = uploader.active.length;
  useEffect(() => {
    if (doneCount > 0 && activeCount === 0) {
      setCelebrate(true);
      refresh();
      const t = setTimeout(() => setCelebrate(false), 4000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount, activeCount]);

  const saveNote = async () => {
    if (!batchId) return;
    try {
      await api(`/api/raw/batches/${batchId}`, { method: "PATCH", json: { note } });
      refresh();
    } catch {
      /* non-critical */
    }
  };

  const startFresh = () => {
    uploader.clearDone();
    setBatchId(null);
    setNote("");
  };

  const myBatches = useMemo(() => {
    if (!state) return [] as { batch: RawBatch; assets: RawAsset[] }[];
    return groupRaw(state.batches, state.raw)
      .filter((b) => b.assets.length || b.batch.id === batchId)
      .slice(0, 30);
  }, [state, batchId]);

  const open = async (asset: RawAsset) => {
    try {
      const { url } = await api<{ url: string }>(`/api/raw/${asset.id}/play`);
      setView({ asset, url });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't open that file.", "error");
    }
  };

  return (
    <div ref={ref}>
      <div className="page-head" data-reveal="">
        <div>
          <span className="eyebrow">Drop off</span>
          <h1>
            Send us the <span className="accent">raw.</span>
          </h1>
          <p className="lead">
            Clips from the chair, before-and-afters, product shots, the studio on a quiet morning. Add anything, in any order — {session?.role === "client" ? "Fred and Azaiah" : "the studio"} pick it up from here and turn it into posts.
          </p>
        </div>
      </div>

      <section className="section" data-reveal="" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
        <div className="stack" style={{ gap: "1rem" }}>
          <div data-tour="drop-zone">
            <DropZone
              onFiles={onFiles}
              title={starting ? "One moment…" : "Tap to add photos & videos"}
            />
          </div>
          {picking ? (
            <p className="small" role="status" style={{ margin: 0 }}>
              Got {plural(picking.count, "file")} ({bytes(picking.bytes)}). Preparing the upload…
            </p>
          ) : null}
          {pickError ? (
            <div className="card" role="alert">
              <div className="card-body row row-between" style={{ gap: 12 }}>
                <p className="small" style={{ margin: 0, color: "var(--alert-lift)" }}>
                  That didn&apos;t go through: {pickError} The studio has been told. Try again with one file.
                </p>
                <Button size="xs" onClick={() => setPickError(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}
          {lostPick ? (
            <div className="card" role="alert">
              <div className="card-body row row-between" style={{ gap: 12 }}>
                <p className="small" style={{ margin: 0 }}>
                  Your last selection didn&apos;t reach the upload queue — the page reloaded while it was being prepared. The studio has been told. Please add one file at a time.
                </p>
                <Button size="xs" onClick={() => setLostPick(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}
          {uploader.jobs.length ? (
            <div className="card">
              <div className="card-body">
                <div className="row row-between" style={{ marginBottom: 8 }}>
                  <strong>
                    {uploader.active.length ? `Sending ${plural(uploader.active.length, "file")}…` : celebrate ? "All received." : `${plural(uploader.done.length, "file")} received`}
                  </strong>
                  {!uploader.active.length ? (
                    <Button size="xs" icon="plus" onClick={startFresh}>
                      Start another drop
                    </Button>
                  ) : null}
                </div>
                <UploadList jobs={uploader.jobs} onRetry={uploader.retry} onCancel={uploader.cancel} onRemove={uploader.remove} />
                {celebrate ? (
                  <p className="small" style={{ marginTop: 10, color: "var(--gilt)" }}>
                    <Icon name="crown" style={{ width: 16, height: 16, display: "inline", verticalAlign: "-3px", marginRight: 6 }} />
                    Received. The studio has been notified in the activity feed.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="field" data-tour="drop-note">
            <label htmlFor="note">Notes about these files (optional)</label>
            <input
              id="note"
              className="input"
              placeholder="e.g. Sabrina's micro loc retightening, Tues — plus a few DOPE HAIR product shots"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNote();
              }}
              maxLength={300}
            />
            <span className="xs muted">Add your notes after the files upload. They're saved when you tap away.</span>
          </div>
          <p className="xs muted">
            Tips: film vertical (9:16) when you can · keep the original quality, don't send screen recordings · a 10-second clip of a transformation beats a 3-minute one · HEIC photos and .MOV videos are fine.
          </p>
        </div>
      </section>

      <section className="section" data-reveal="" data-tour="drop-history" style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
        <div className="section-head">
          <h2>
            Your <span className="accent">drop-offs</span>
          </h2>
          <span className="small muted">{state ? plural(state.raw.length, "file") : ""}</span>
        </div>
        {!myBatches.length ? (
          <Empty icon="inbox" title="Nothing dropped off yet">
            Your first drop-off will show up here with a thumbnail of every file.
          </Empty>
        ) : (
          <div className="stack" style={{ gap: "1.25rem" }}>
            {myBatches.map(({ batch, assets }) => (
              <div className="card" key={batch.id}>
                <div className="card-body">
                  <div className="row row-between" style={{ marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 400 }}>{batch.note || "Untitled drop-off"}</div>
                      <div className="xs muted">
                        {batch.createdBy} · {fmtDateTime(batch.createdAt)} ({relative(batch.createdAt)}) · {plural(assets.length, "file")} · {bytes(assets.reduce((a, b) => a + b.size, 0))}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      {assets.some((a) => a.status === "used") ? (
                        <span className="chip chip-gold">
                          <Icon name="sparkle" style={{ width: 12, height: 12 }} /> Used in content
                        </span>
                      ) : (
                        <span className="chip">With the studio</span>
                      )}
                      <Button size="xs" variant="alert" icon="trash" busy={busy === batch.id} onClick={() => deleteBatch(batch, assets.length)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-tiles">
                    {assets.map((a) => (
                      <div key={a.id}>
                        <MediaTile src={preview(a.posterKey)} kind={a.kind} dur={a.duration} onClick={() => open(a)} alt={a.name} />
                        <div className="tile-caption">{a.label || a.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {view ? (
        <Lightbox
          url={view.url}
          kind={view.asset.kind}
          name={view.asset.name}
          onClose={() => setView(null)}
          actions={
            <Button size="xs" variant="alert" icon="trash" busy={busy === view.asset.id} onClick={() => deleteAsset(view.asset)}>
              Delete
            </Button>
          }
        />
      ) : null}
      {confirmEl}
    </div>
  );
};
