import { useEffect, useMemo, useState } from "react";
import type { RawAsset, RawBatch } from "@shared/types";
import { usePortal } from "@/lib/store";
import { api } from "@/lib/api";
import { DropZone, UploadList, useUploader } from "@/components/Uploader";
import { Button, Empty, Lightbox, MediaTile } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { bytes, fmtDateTime, plural, relative } from "@/lib/format";
import { useReveal } from "@/lib/motion";

/**
 * CLIENT · Drop Off
 * The simplest possible job: tap, choose, done. A short note per drop tells
 * the studio what the footage is. Everything they've ever sent sits below,
 * newest first, so they never wonder whether it went through.
 */

export const DropOff = () => {
  const { state, refresh, session, preview, toast } = usePortal();
  const uploader = useUploader("raw");
  const [note, setNote] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState<{ asset: RawAsset; url: string } | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const ref = useReveal<HTMLDivElement>([state?.batches.length]);

  const ensureBatch = async (): Promise<string> => {
    if (batchId) return batchId;
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
    try {
      const id = await ensureBatch();
      uploader.add(files, id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't start the drop-off.", "error");
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
    const byBatch = new Map<string, RawAsset[]>();
    for (const r of state.raw) {
      if (!byBatch.has(r.batchId)) byBatch.set(r.batchId, []);
      byBatch.get(r.batchId)!.push(r);
    }
    return state.batches
      .map((batch) => ({ batch, assets: byBatch.get(batch.id) || [] }))
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
          <div className="field">
            <label htmlFor="note">What is this footage? (optional)</label>
            <input
              id="note"
              className="input"
              placeholder="e.g. Sabrina's micro loc retightening, Tues — plus a few DOPE HAIR product shots"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              maxLength={300}
            />
          </div>
          <DropZone onFiles={onFiles} title={starting ? "One moment…" : "Tap to add photos & videos"} />
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
          <p className="xs muted">
            Tips: film vertical (9:16) when you can · keep the original quality, don't send screen recordings · a 10-second clip of a transformation beats a 3-minute one · HEIC photos and .MOV videos are fine.
          </p>
        </div>
      </section>

      <section className="section" data-reveal="" style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
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
                    {assets.some((a) => a.status === "used") ? (
                      <span className="chip chip-gold">
                        <Icon name="sparkle" style={{ width: 12, height: 12 }} /> Used in content
                      </span>
                    ) : (
                      <span className="chip">With the studio</span>
                    )}
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

      {view ? <Lightbox url={view.url} kind={view.asset.kind} name={view.asset.name} onClose={() => setView(null)} /> : null}
    </div>
  );
};
