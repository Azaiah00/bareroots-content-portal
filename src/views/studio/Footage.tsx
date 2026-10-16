import { useEffect, useMemo, useState } from "react";
import type { RawAsset, RawBatch } from "@shared/types";
import { usePortal } from "@/lib/store";
import { api } from "@/lib/api";
import { useRoute } from "@/lib/router";
import { Button, Empty, Lightbox, MediaTile, Segmented, useConfirm } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { triggerDownload } from "@/lib/clipboard";
import { bytes, fmtDateTime, plural, relative } from "@/lib/format";
import { useReveal } from "@/lib/motion";

/**
 * STUDIO · Footage
 * Everything Bare Roots has dropped off, newest batch first. Select, download,
 * mark as used, archive (deletes the objects, keeps the record) — and keep an
 * eye on the free-tier storage meter.
 */

type StatusFilter = "all" | "new" | "used" | "archived";
type KindFilter = "all" | "video" | "image";

export const Footage = () => {
  const { state, preview, toast, refresh, patchRaw } = usePortal();
  const route = useRoute();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<{ asset: RawAsset; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { confirm, element: confirmEl } = useConfirm();
  const ref = useReveal<HTMLDivElement>([state?.raw.length, status, kind]);
  const focusBatch = route.params.get("b");

  useEffect(() => {
    if (!focusBatch) return;
    const el = document.getElementById(`batch-${focusBatch}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusBatch, state?.batches.length]);

  const groups = useMemo(() => {
    const raw = (state?.raw ?? []).filter((r) => (status === "all" ? r.status !== "archived" : r.status === status)).filter((r) => (kind === "all" ? true : r.kind === kind));
    const byBatch = new Map<string, RawAsset[]>();
    for (const r of raw) {
      if (!byBatch.has(r.batchId)) byBatch.set(r.batchId, []);
      byBatch.get(r.batchId)!.push(r);
    }
    return (state?.batches ?? []).map((batch) => ({ batch, assets: byBatch.get(batch.id) || [] })).filter((g) => g.assets.length);
  }, [state, status, kind]);

  const visibleIds = groups.flatMap((g) => g.assets.map((a) => a.id));
  const selectedAssets = (state?.raw ?? []).filter((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't go through.", "error");
    } finally {
      setBusy(null);
    }
  };

  const downloadOne = (a: RawAsset) =>
    run(`dl-${a.id}`, async () => {
      const { url } = await api<{ url: string }>(`/api/raw/${a.id}/download`);
      triggerDownload(url);
    });

  const downloadSelected = () =>
    run("dl-many", async () => {
      const list = selectedAssets.filter((a) => a.status !== "archived");
      toast(`Starting ${plural(list.length, "download")}. If the browser asks, allow multiple downloads.`);
      for (const a of list) {
        const { url } = await api<{ url: string }>(`/api/raw/${a.id}/download`);
        triggerDownload(url);
        await new Promise((r) => setTimeout(r, 700));
      }
    });

  const setStatusMany = (ids: string[], s: "new" | "used") =>
    run(`status-${s}`, async () => {
      for (const id of ids) {
        const { asset } = await api<{ asset: RawAsset }>(`/api/raw/${id}`, { method: "PATCH", json: { status: s } });
        patchRaw(asset);
      }
      setSelected(new Set());
      toast(`Marked ${plural(ids.length, "file")} as ${s}.`);
    });

  const archiveMany = async (ids: string[]) => {
    const size = (state?.raw ?? []).filter((r) => ids.includes(r.id)).reduce((a, b) => a + b.size, 0);
    if (!(await confirm(`Archive ${plural(ids.length, "file")}?`, { body: `This deletes the originals from storage (${bytes(size)} freed). The record stays in the library marked "archived". Make sure you've downloaded anything you still need.`, action: "Archive & free space", danger: true }))) return;
    run("archive", async () => {
      await api("/api/raw/archive", { method: "POST", json: { ids } });
      setSelected(new Set());
      setView(null);
      await refresh();
      toast(`Archived. ${bytes(size)} freed.`);
    });
  };

  const open = (a: RawAsset) =>
    run(`open-${a.id}`, async () => {
      const { url } = await api<{ url: string }>(`/api/raw/${a.id}/play`);
      setView({ asset: a, url });
    });

  const used = state?.storage.usedBytes ?? 0;
  const budget = state?.config.storageBudgetBytes ?? 10 * 1024 ** 3;
  const pct = Math.min(100, Math.round((used / budget) * 100));
  const newCount = state?.raw.filter((r) => r.status === "new").length ?? 0;

  return (
    <div ref={ref}>
      <div className="page-head" data-reveal="">
        <div>
          <span className="eyebrow">Footage</span>
          <h1>
            The raw <span className="accent">library.</span>
          </h1>
          <p className="lead">Everything Bare Roots has dropped off, by drop. Download what you need, mark it used when it's cut, archive it once it's safe to free the space.</p>
        </div>
        <div className="stack" style={{ minWidth: 220 }}>
          <div className="row row-between">
            <span className="small">Storage</span>
            <span className="small muted">
              {bytes(used)} of {bytes(budget)}
            </span>
          </div>
          <div className={`meter ${pct > 85 ? "warn" : ""}`}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="xs muted">
            Raw {bytes(state?.storage.rawBytes ?? 0)} · Content {bytes(state?.storage.deliverableBytes ?? 0)} · Ideas {bytes(state?.storage.ideaBytes ?? 0)}
          </div>
        </div>
      </div>

      <div className="row row-between" data-reveal="" style={{ marginBottom: "1rem", "--reveal-delay": "60ms" } as React.CSSProperties}>
        <div className="row" style={{ gap: "1.5rem" }}>
          <div className="stat">
            <b>{newCount}</b>
            <span>New files</span>
          </div>
          <div className="stat">
            <b>{state?.raw.filter((r) => r.status === "used").length ?? 0}</b>
            <span>Used</span>
          </div>
          <div className="stat">
            <b>{state?.batches.length ?? 0}</b>
            <span>Drop-offs</span>
          </div>
        </div>
        <div className="row">
          <Segmented value={status} onChange={setStatus} options={[{ value: "all", label: "Active" }, { value: "new", label: "New" }, { value: "used", label: "Used" }, { value: "archived", label: "Archived" }]} />
          <Segmented value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "video", label: "Video" }, { value: "image", label: "Photos" }]} />
        </div>
      </div>

      {selected.size ? (
        <div className="card" style={{ position: "sticky", top: 8, zIndex: 20, marginBottom: "1rem", background: "var(--ink)" }}>
          <div className="card-body row row-between">
            <div className="row">
              <strong>{plural(selected.size, "file")} selected</strong>
              <span className="small muted">{bytes(selectedAssets.reduce((a, b) => a + b.size, 0))}</span>
              <Button size="xs" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button size="xs" onClick={() => setSelected(new Set(visibleIds))}>
                Select all shown
              </Button>
            </div>
            <div className="row">
              <Button size="sm" variant="gold" icon="download" busy={busy === "dl-many"} onClick={downloadSelected}>
                Download
              </Button>
              <Button size="sm" icon="check" busy={busy === "status-used"} onClick={() => setStatusMany([...selected], "used")}>
                Mark used
              </Button>
              <Button size="sm" icon="refresh" busy={busy === "status-new"} onClick={() => setStatusMany([...selected], "new")}>
                Mark new
              </Button>
              <Button size="sm" variant="alert" icon="archive" busy={busy === "archive"} onClick={() => archiveMany([...selected])}>
                Archive
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!groups.length ? (
        <Empty icon="inbox" title={status === "all" ? "No footage yet" : "Nothing in this view"}>
          {status === "all" ? "When Iisha or Sabrina drop files off, each drop shows up here as a group with thumbnails." : "Try another filter."}
        </Empty>
      ) : (
        <div className="stack" style={{ gap: "1.25rem" }}>
          {groups.map(({ batch, assets }) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              assets={assets}
              highlight={batch.id === focusBatch}
              collapsed={collapsed.has(batch.id)}
              onToggleCollapse={() =>
                setCollapsed((s) => {
                  const n = new Set(s);
                  if (n.has(batch.id)) n.delete(batch.id);
                  else n.add(batch.id);
                  return n;
                })
              }
              selected={selected}
              onToggle={toggle}
              onOpen={open}
              onSelectAll={() => setSelected((s) => new Set([...s, ...assets.map((a) => a.id)]))}
              preview={preview}
            />
          ))}
        </div>
      )}

      {view ? (
        <Lightbox
          url={view.url}
          kind={view.asset.kind}
          name={`${view.asset.name} · ${bytes(view.asset.size)}${view.asset.width ? ` · ${view.asset.width}×${view.asset.height}` : ""} · from ${view.asset.uploadedBy}`}
          onClose={() => setView(null)}
          actions={
            <>
              <Button size="xs" variant="gold" icon="download" busy={busy === `dl-${view.asset.id}`} onClick={() => downloadOne(view.asset)}>
                Download
              </Button>
              {view.asset.status !== "archived" ? (
                <>
                  <Button size="xs" icon="check" onClick={() => setStatusMany([view.asset.id], view.asset.status === "used" ? "new" : "used")}>
                    {view.asset.status === "used" ? "Mark new" : "Mark used"}
                  </Button>
                  <Button size="xs" variant="alert" icon="archive" onClick={() => archiveMany([view.asset.id])}>
                    Archive
                  </Button>
                </>
              ) : null}
            </>
          }
        />
      ) : null}
      {confirmEl}
    </div>
  );
};

const BatchCard = ({
  batch,
  assets,
  highlight,
  collapsed,
  onToggleCollapse,
  selected,
  onToggle,
  onOpen,
  onSelectAll,
  preview,
}: {
  batch: RawBatch;
  assets: RawAsset[];
  highlight: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (a: RawAsset) => void;
  onSelectAll: () => void;
  preview: (k?: string) => string | undefined;
}) => {
  const total = assets.reduce((a, b) => a + b.size, 0);
  const fresh = assets.filter((a) => a.status === "new").length;
  return (
    <div className="card" id={`batch-${batch.id}`} style={highlight ? { borderColor: "var(--gold)" } : undefined} data-reveal="">
      <div className="card-body">
        <div className="row row-between" style={{ marginBottom: collapsed ? 0 : 10 }}>
          <button type="button" className="row" style={{ textAlign: "left", gap: 10 }} onClick={onToggleCollapse} aria-expanded={!collapsed}>
            <Icon name="chevron-down" style={{ width: 18, height: 18, transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform var(--base) var(--ease)", color: "var(--gold)" }} />
            <div>
              <div style={{ fontWeight: 400 }}>{batch.note || "Untitled drop-off"}</div>
              <div className="xs muted">
                {batch.createdBy} · {fmtDateTime(batch.createdAt)} ({relative(batch.createdAt)}) · {plural(assets.length, "file")} · {bytes(total)}
              </div>
            </div>
          </button>
          <div className="row">
            {fresh ? <span className="chip chip-gold">{fresh} new</span> : <span className="chip">All handled</span>}
            <Button size="xs" onClick={onSelectAll}>
              Select all
            </Button>
          </div>
        </div>
        {!collapsed ? (
          <div className="grid grid-tiles">
            {assets.map((a) => (
              <div key={a.id}>
                <div style={{ position: "relative" }}>
                  <MediaTile src={preview(a.posterKey)} kind={a.kind} dur={a.duration} selectable selected={selected.has(a.id)} onClick={() => onToggle(a.id)} alt={a.name} label={a.status === "archived" ? "Archived" : undefined} />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Preview"
                    onClick={() => onOpen(a)}
                    style={{ position: "absolute", left: 6, bottom: 6, width: 36, height: 36, background: "rgba(28,21,24,0.7)", color: "var(--gilt)" }}
                  >
                    <Icon name={a.kind === "video" ? "play" : "eye"} style={{ width: 16, height: 16 }} />
                  </button>
                </div>
                <div className="tile-caption" title={a.name}>
                  {a.status === "used" ? <span style={{ color: "var(--gilt)" }}>Used · </span> : null}
                  {a.label || a.name}
                </div>
                <div className="xs muted">
                  {bytes(a.size)}
                  {a.width ? ` · ${a.width}×${a.height}` : ""}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
