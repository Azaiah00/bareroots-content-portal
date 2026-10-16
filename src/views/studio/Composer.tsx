import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Deliverable, DeliverableFile, DeliverableKind, InstagramFormat, Platform, PlatformPlan } from "@shared/types";
import { INSTAGRAM_FORMAT_LABEL, PLATFORM_LABEL } from "@shared/types";
import { usePortal } from "@/lib/store";
import { api } from "@/lib/api";
import { navigate, useRoute } from "@/lib/router";
import { Button, MediaTile, Modal, PlatformBadge, Segmented, TagInput, useConfirm } from "@/components/ui";
import { DropZone, UploadList, useUploader } from "@/components/Uploader";
import { DeliverableDetail } from "@/components/DeliverableDetail";
import { Icon } from "@/components/Icon";
import { bytes, fmtDateTime, fromLocalInput, relative, toLocalInput } from "@/lib/format";
import { CAPTION_LIMITS, PLATFORM_TIPS, suggestTime } from "@/lib/schedule";
import { groupRaw } from "@/lib/groups";

/**
 * STUDIO · Composer
 * One screen to turn a cut into a delivery: files, caption, hashtags, CTA,
 * posting plan per platform, source footage. Autosaves as a draft; Publish
 * makes it visible to the client and starts the five-business-day clock.
 */

const PLATFORMS: Platform[] = ["instagram", "tiktok", "facebook"];

interface Draft {
  title: string;
  kind: DeliverableKind;
  caption: string;
  hashtags: string[];
  cta: string;
  tips: string;
  studioNotes: string;
  platforms: PlatformPlan[];
  sourceRawIds: string[];
}

const toDraft = (d: Deliverable): Draft => ({
  title: d.title,
  kind: d.kind,
  caption: d.caption,
  hashtags: d.hashtags,
  cta: d.cta || "",
  tips: d.tips || "",
  studioNotes: d.studioNotes || "",
  platforms: d.platforms,
  sourceRawIds: d.sourceRawIds,
});

export const Composer = () => {
  const route = useRoute();
  const { state, refresh, toast, patchDeliverable, preview } = usePortal();
  const idParam = route.parts[1];
  const [id, setId] = useState<string | null>(idParam && idParam !== "new" ? idParam : null);
  const existing = useMemo(() => (id ? state?.deliverables.find((d) => d.id === id) : undefined), [state, id]);
  const [draft, setDraft] = useState<Draft | null>(existing ? toDraft(existing) : null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [pickingSource, setPickingSource] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [fixNote, setFixNote] = useState("");
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const uploader = useUploader("deliverable");
  const { confirm, element: confirmEl } = useConfirm();

  // Create the draft record up front so file uploads have a parent id.
  useEffect(() => {
    if (id || idParam !== "new") return;
    let cancelled = false;
    (async () => {
      try {
        const { deliverable } = await api<{ deliverable: Deliverable }>("/api/deliverables", { method: "POST", json: { title: "Untitled" } });
        if (cancelled) return;
        patchDeliverable(deliverable);
        setId(deliverable.id);
        setDraft(toDraft(deliverable));
        navigate(`/compose/${deliverable.id}`, true);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't start a new piece.", "error");
        navigate("/ready");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam]);

  // Hydrate the form once the record is known (and when files change server-side).
  useEffect(() => {
    if (existing && !draft) setDraft(toDraft(existing));
  }, [existing, draft]);

  const save = useCallback(
    async (patch?: Partial<Draft>) => {
      if (!id || !draft) return;
      const body = { ...draft, ...patch };
      setSaving(true);
      try {
        const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${id}`, { method: "PATCH", json: body });
        patchDeliverable(deliverable);
        setSavedAt(new Date().toISOString());
        dirty.current = false;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't save.", "error");
      } finally {
        setSaving(false);
      }
    },
    [id, draft, patchDeliverable, toast],
  );

  const draftRef = useRef<Draft | null>(draft);
  draftRef.current = draft;

  const update = (patch: Partial<Draft>) => {
    const next = draftRef.current ? { ...draftRef.current, ...patch } : null;
    draftRef.current = next;
    setDraft(next);
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const d = draftRef.current;
      if (!d || !id) return;
      api<{ deliverable: Deliverable }>(`/api/deliverables/${id}`, { method: "PATCH", json: d })
        .then(({ deliverable }) => {
          patchDeliverable(deliverable);
          setSavedAt(new Date().toISOString());
          dirty.current = false;
        })
        .catch(() => {
          /* the explicit Save button reports errors */
        });
    }, 1400);
  };

  // Flush a pending autosave when leaving the composer.
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      const d = draftRef.current;
      if (dirty.current && d && id) {
        api(`/api/deliverables/${id}`, { method: "PATCH", json: d }).catch(() => {});
      }
    },
    [id],
  );

  const setAltLabel = async (f: DeliverableFile, label: string) => {
    if (!id || (f.label || "") === label.trim()) return;
    try {
      const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${id}/files/${f.id}`, { method: "PATCH", json: { label } });
      patchDeliverable(deliverable);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the label.", "error");
    }
  };

  // Refresh after uploads so files appear.
  const doneCount = uploader.done.length;
  const activeCount = uploader.active.length;
  useEffect(() => {
    if (doneCount && !activeCount) {
      refresh();
      uploader.clearDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount, activeCount]);

  const removeFile = async (f: DeliverableFile) => {
    if (!id) return;
    if (!(await confirm(`Remove ${f.name}?`, { action: "Remove", danger: true }))) return;
    try {
      const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${id}/files/${f.id}`, { method: "DELETE" });
      patchDeliverable(deliverable);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove.", "error");
    }
  };

  const publish = async () => {
    if (!id || !draft) return;
    if (!existing?.files.some((f) => f.role === "main")) {
      toast("Add the finished file first.", "error");
      return;
    }
    if (!draft.caption.trim()) {
      if (!(await confirm("Publish without a caption?", { body: "The client will see an empty caption box.", action: "Publish anyway" }))) return;
    }
    setPublishing(true);
    try {
      await save();
      const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${id}/publish`, { method: "POST", json: { note: fixNote } });
      patchDeliverable(deliverable);
      toast(existing?.status === "changes" ? "Revised version delivered." : "Delivered to Bare Roots.");
      await refresh();
      navigate(`/ready?d=${id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't publish.", "error");
    } finally {
      setPublishing(false);
    }
  };

  const setPlatform = (platform: Platform, on: boolean) => {
    if (!draft) return;
    const has = draft.platforms.some((p) => p.platform === platform);
    if (on && !has) update({ platforms: [...draft.platforms, { platform, ...(platform === "instagram" ? { format: "reel" as InstagramFormat } : {}) }] });
    if (!on && has) update({ platforms: draft.platforms.filter((p) => p.platform !== platform) });
  };
  const patchPlan = (platform: Platform, patch: Partial<PlatformPlan>) => {
    if (!draft) return;
    update({ platforms: draft.platforms.map((p) => (p.platform === platform ? { ...p, ...patch } : p)) });
  };

  const suggestAll = () => {
    if (!draft) return;
    const takenBy = (platform: Platform) =>
      (state?.deliverables ?? [])
        .filter((d) => d.id !== id && d.status !== "draft")
        .flatMap((d) => d.platforms.filter((p) => p.platform === platform && p.postAt).map((p) => p.postAt!));
    let anchor: string | undefined;
    const next = draft.platforms.map((p) => {
      const at = suggestTime(p.platform, takenBy(p.platform), anchor, 3, 1);
      anchor = anchor || at;
      return { ...p, postAt: at, tip: p.tip || PLATFORM_TIPS[p.platform] };
    });
    update({ platforms: next });
    toast("Suggested times filled in — adjust anything by hand.");
  };

  if (!draft || !existing) {
    return (
      <div className="section">
        <div className="skeleton" style={{ height: 48, width: 260, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  const main = existing.files.find((f) => f.role === "main");
  const cover = existing.files.find((f) => f.role === "cover");
  const alts = existing.files.filter((f) => f.role === "alt");
  const captionLimit = Math.min(...draft.platforms.map((p) => CAPTION_LIMITS[p.platform]), CAPTION_LIMITS.instagram);
  const sources = (state?.raw ?? []).filter((r) => draft.sourceRawIds.includes(r.id));
  const openRevision = existing.revisions.find((r) => !r.resolvedAt);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">{existing.status === "draft" ? "Draft" : existing.status === "changes" ? "Change requested" : "Editing delivered content"}</span>
          <h1>
            {existing.status === "changes" ? (
              <>
                Fix & <span className="accent">redeliver.</span>
              </>
            ) : (
              <>
                Build the <span className="accent">post.</span>
              </>
            )}
          </h1>
        </div>
        <div className="row">
          <span className="xs muted">{saving ? "Saving…" : savedAt ? `Saved ${relative(savedAt)}` : ""}</span>
          <Button size="sm" onClick={() => navigate("/ready")}>
            Back
          </Button>
          <Button size="sm" icon="eye" onClick={() => setPreviewing(true)}>
            Preview as client
          </Button>
          <Button size="sm" icon="check" busy={saving} onClick={() => save()}>
            Save
          </Button>
          <Button variant="gold" size="sm" icon="send" busy={publishing} onClick={publish}>
            {existing.status === "draft" ? "Publish to Bare Roots" : existing.status === "changes" ? "Deliver the fix" : "Republish"}
          </Button>
        </div>
      </div>

      {openRevision ? (
        <div className="rev" style={{ marginBottom: "1.25rem" }}>
          <div className="by">
            {openRevision.by} asked for a change · {fmtDateTime(openRevision.at)}
          </div>
          <p>{openRevision.message}</p>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="fixnote">What you changed (shown to the client with the revised version)</label>
            <input id="fixnote" className="input" value={fixNote} onChange={(e) => setFixNote(e.target.value)} placeholder="e.g. Price text enlarged; swapped clip two for the gold wrap shot." />
          </div>
        </div>
      ) : null}

      <div className="compose-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "1.5rem", alignItems: "start" }}>
        {/* ── Left: files ─────────────────────────────────────────────── */}
        <div className="stack" style={{ gap: "1.25rem" }}>
          <div className="card">
            <div className="card-body stack">
              <div className="row row-between">
                <span className="label">Finished file</span>
                <Segmented value={draft.kind} onChange={(v) => update({ kind: v })} options={[{ value: "video", label: "Video post" }, { value: "static", label: "Static ad" }]} />
              </div>
              {main ? (
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ width: 120 }}>
                    <MediaTile src={preview(main.posterKey)} kind={main.kind} dur={main.duration} alt={main.name} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {main.name}
                    </div>
                    <div className="xs muted">
                      {bytes(main.size)}
                      {main.width ? ` · ${main.width}×${main.height}` : ""}
                      {main.width && main.height ? (main.height / main.width > 1.7 ? " · 9:16 vertical" : main.width === main.height ? " · square" : main.width > main.height ? " · landscape — consider a vertical cut" : "") : ""}
                    </div>
                    <Button size="xs" variant="alert" icon="trash" onClick={() => removeFile(main)} style={{ marginTop: 8 }}>
                      Replace
                    </Button>
                  </div>
                </div>
              ) : (
                <DropZone compact multiple={false} accept={draft.kind === "video" ? "video/*" : "image/*"} onFiles={(f) => id && uploader.add(f.slice(0, 1), id, { role: "main" })} title={draft.kind === "video" ? "Add the exported video" : "Add the finished graphic"} hint="MP4 (H.264) 1080×1920 for Reels/TikTok · PNG or JPG for statics" />
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-body stack">
              <span className="label">Cover / thumbnail {draft.kind === "video" ? "" : "(optional)"}</span>
              {cover ? (
                <div className="row">
                  <div style={{ width: 80 }}>
                    <MediaTile src={preview(cover.posterKey)} kind="image" shape="square" alt="Cover" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }} className="small">
                    {cover.name}
                    <div className="xs muted">{bytes(cover.size)}</div>
                  </div>
                  <Button size="xs" variant="alert" icon="trash" onClick={() => removeFile(cover)}>
                    Replace
                  </Button>
                </div>
              ) : (
                <DropZone compact multiple={false} accept="image/*" onFiles={(f) => id && uploader.add(f.slice(0, 1), id, { role: "cover" })} title="Add the cover image" hint="1080×1920 with the title inside the centre 1080×1350 so it survives the grid crop" />
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-body stack">
              <span className="label">Alternate versions (optional)</span>
              {alts.map((f) => (
                <div className="row" key={f.id}>
                  <div style={{ width: 64 }}>
                    <MediaTile src={preview(f.posterKey)} kind={f.kind} shape="square" alt={f.label || f.name} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input className="input" style={{ minHeight: 40 }} defaultValue={f.label || ""} placeholder="Label, e.g. Square crop / No music" onBlur={(e) => setAltLabel(f, e.target.value)} aria-label="Alternate label" />
                    <div className="xs muted">{f.name}</div>
                  </div>
                  <Button size="xs" variant="alert" icon="trash" onClick={() => removeFile(f)}>
                    Remove
                  </Button>
                </div>
              ))}
              <DropZone compact onFiles={(f) => id && uploader.add(f, id, { role: "alt" })} title="Add alternates" hint="A square crop for the feed, a version without music, a second static colourway." />
            </div>
          </div>

          <UploadList jobs={uploader.jobs} onRetry={uploader.retry} onCancel={uploader.cancel} onRemove={uploader.remove} />

          <div className="card">
            <div className="card-body stack">
              <div className="row row-between">
                <span className="label">Cut from</span>
                <Button size="xs" icon="inbox" onClick={() => setPickingSource(true)}>
                  Choose footage
                </Button>
              </div>
              {sources.length ? (
                <div className="grid grid-tiles">
                  {sources.map((r) => (
                    <div key={r.id}>
                      <MediaTile src={preview(r.posterKey)} kind={r.kind} dur={r.duration} shape="square" alt={r.name} />
                      <div className="tile-caption">{r.label || r.name}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="xs muted">Linking the raw files marks them "used" in the library and shows Bare Roots which drop-off this came from.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: words & plan ─────────────────────────────────────── */}
        <div className="stack" style={{ gap: "1.25rem" }}>
          <div className="card">
            <div className="card-body stack" style={{ gap: "1rem" }}>
              <div className="field">
                <label htmlFor="title">Title (what the client sees)</label>
                <input id="title" className="input" value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="e.g. Micro loc retightening — 30s transformation" maxLength={140} />
              </div>
              <div className="field">
                <div className="row row-between">
                  <label htmlFor="caption">Caption</label>
                  <span className={`counter ${draft.caption.length > captionLimit ? "over" : ""}`}>
                    {draft.caption.length.toLocaleString()} / {captionLimit.toLocaleString()}
                  </span>
                </div>
                <textarea id="caption" className="textarea" style={{ minHeight: 180 }} value={draft.caption} onChange={(e) => update({ caption: e.target.value })} placeholder={"Hook in the first line.\n\nThen the story — what happened in the chair, why it matters, who it's for.\n\nEnd with the call to action."} />
                <span className="hint">Instagram shows the first ~125 characters before "more". Keep the hook there.</span>
              </div>
              <div className="field">
                <label>Hashtags</label>
                <TagInput value={draft.hashtags} onChange={(v) => update({ hashtags: v })} />
                <span className="hint">{draft.hashtags.length} tags · 3–5 niche + 2–3 local (#RichmondVA #RVAhair) outperforms 30 generic ones.</span>
              </div>
              <div className="field">
                <label htmlFor="cta">Call to action</label>
                <input id="cta" className="input" value={draft.cta} onChange={(e) => update({ cta: e.target.value })} placeholder="e.g. Book Sabrina — link in bio, or call (804) 615-4054" maxLength={300} />
              </div>
              <div className="field">
                <label htmlFor="tips">Posting tips for the client (optional)</label>
                <textarea id="tips" className="textarea" style={{ minHeight: 80 }} value={draft.tips} onChange={(e) => update({ tips: e.target.value })} placeholder="Anything they should know when posting this one." />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body stack" style={{ gap: "1rem" }}>
              <div className="row row-between">
                <span className="label">Posting plan</span>
                <Button size="xs" icon="sparkle" onClick={suggestAll}>
                  Suggest times
                </Button>
              </div>
              <div className="row">
                {PLATFORMS.map((p) => {
                  const on = draft.platforms.some((x) => x.platform === p);
                  return (
                    <label className="check" key={p}>
                      <input type="checkbox" checked={on} onChange={(e) => setPlatform(p, e.target.checked)} />
                      <PlatformBadge platform={p} /> {PLATFORM_LABEL[p]}
                    </label>
                  );
                })}
              </div>
              {draft.platforms.map((p) => (
                <div key={p.platform} className="stack" style={{ gap: 8, paddingTop: 8, borderTop: "1px solid var(--line-dark)" }}>
                  <div className="row row-between">
                    <strong style={{ fontWeight: 500 }}>{PLATFORM_LABEL[p.platform]}</strong>
                    {p.platform === "instagram" ? (
                      <select className="select" style={{ width: "auto", minHeight: 40 }} value={p.format || "reel"} onChange={(e) => patchPlan("instagram", { format: e.target.value as InstagramFormat })} aria-label="Instagram format">
                        {(Object.keys(INSTAGRAM_FORMAT_LABEL) as InstagramFormat[]).map((f) => (
                          <option key={f} value={f}>
                            {INSTAGRAM_FORMAT_LABEL[f]}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                  <div className="row" style={{ alignItems: "stretch" }}>
                    <input type="datetime-local" className="input" style={{ flex: 1, minWidth: 200 }} value={toLocalInput(p.postAt)} onChange={(e) => patchPlan(p.platform, { postAt: fromLocalInput(e.target.value) })} aria-label={`${PLATFORM_LABEL[p.platform]} post time`} />
                    <Button size="sm" onClick={() => patchPlan(p.platform, { postAt: suggestTime(p.platform, [], draft.platforms.find((x) => x.platform !== p.platform)?.postAt) })}>
                      Next best slot
                    </Button>
                  </div>
                  <input className="input" style={{ minHeight: 40 }} value={p.tip || ""} onChange={(e) => patchPlan(p.platform, { tip: e.target.value })} placeholder={`Tip for ${PLATFORM_LABEL[p.platform]} (optional) — e.g. ${PLATFORM_TIPS[p.platform].slice(0, 60)}…`} />
                  <details>
                    <summary className="xs muted" style={{ cursor: "pointer" }}>
                      Different caption for {PLATFORM_LABEL[p.platform]}?
                    </summary>
                    <textarea className="textarea" style={{ minHeight: 90, marginTop: 6 }} value={p.caption || ""} onChange={(e) => patchPlan(p.platform, { caption: e.target.value })} placeholder="Leave empty to use the main caption." />
                  </details>
                </div>
              ))}
              <p className="xs muted">Times are Eastern. Suggestions avoid days that already have a post on that platform and keep TikTok a few hours from Instagram.</p>
            </div>
          </div>

          <div className="card">
            <div className="card-body stack">
              <label className="label" htmlFor="notes">
                Studio notes (never shown to the client)
              </label>
              <textarea id="notes" className="textarea" style={{ minHeight: 80 }} value={draft.studioNotes} onChange={(e) => update({ studioNotes: e.target.value })} placeholder="Project file location, music licence, what to try next time…" />
            </div>
          </div>
        </div>
      </div>

      {pickingSource ? (
        <SourcePicker
          selected={draft.sourceRawIds}
          onClose={() => setPickingSource(false)}
          onSave={(ids) => {
            update({ sourceRawIds: ids });
            setPickingSource(false);
          }}
        />
      ) : null}
      {previewing ? <DeliverableDetail preview deliverable={{ ...existing, ...draft, cta: draft.cta || undefined, tips: draft.tips || undefined }} onClose={() => setPreviewing(false)} /> : null}
      {confirmEl}
    </div>
  );
};

const SourcePicker = ({ selected, onClose, onSave }: { selected: string[]; onClose: () => void; onSave: (ids: string[]) => void }) => {
  const { state, preview } = usePortal();
  const [ids, setIds] = useState<Set<string>>(new Set(selected));
  const groups = useMemo(() => {
    return groupRaw(state?.batches ?? [], (state?.raw ?? []).filter((r) => r.status !== "archived")).filter((g) => g.assets.length);
  }, [state]);
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Which footage was this cut from?"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="gold" icon="check" onClick={() => onSave([...ids])}>
            Link {ids.size ? `${ids.size} file${ids.size === 1 ? "" : "s"}` : "none"}
          </Button>
        </>
      }
    >
      {!groups.length ? (
        <p className="muted">No footage in the library yet.</p>
      ) : (
        <div className="stack" style={{ gap: "1.25rem" }}>
          {groups.map(({ batch, assets }) => (
            <div key={batch.id}>
              <div className="small" style={{ marginBottom: 8 }}>
                {batch.note || "Untitled drop-off"} <span className="muted xs">· {batch.createdBy} · {fmtDateTime(batch.createdAt)}</span>
              </div>
              <div className="grid grid-tiles">
                {assets.map((a) => (
                  <MediaTile
                    key={a.id}
                    src={preview(a.posterKey)}
                    kind={a.kind}
                    dur={a.duration}
                    shape="square"
                    selectable
                    selected={ids.has(a.id)}
                    onClick={() =>
                      setIds((s) => {
                        const n = new Set(s);
                        if (n.has(a.id)) n.delete(a.id);
                        else n.add(a.id);
                        return n;
                      })
                    }
                    alt={a.name}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="xs muted" style={{ marginTop: 12 }}>
        <Icon name="check" style={{ width: 12, height: 12, display: "inline", verticalAlign: "-1px" }} /> Linked files are marked "used" in the library automatically.
      </p>
    </Modal>
  );
};
