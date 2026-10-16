import { useState } from "react";
import type { Deliverable, DeliverableFile, Platform } from "@shared/types";
import { DELIVERABLE_STATUS_LABEL, INSTAGRAM_FORMAT_LABEL, PLATFORM_LABEL } from "@shared/types";
import { usePortal } from "@/lib/store";
import { api } from "@/lib/api";
import { triggerDownload } from "@/lib/clipboard";
import { bytes, fmtDate, fmtDateTime, fmtPlan, hashtagsToText, relative } from "@/lib/format";
import { Icon } from "./Icon";
import { Button, CopyButton, Lightbox, MediaTile, Modal, PlatformBadge, useConfirm } from "./ui";
import { navigate } from "@/lib/router";

/**
 * The deliverable sheet — what the client opens to download a post and copy
 * its caption, and what the studio opens to check status and revisions.
 */

export const statusChip = (d: Deliverable) => {
  const cls =
    d.status === "approved" ? "chip chip-ok" : d.status === "changes" ? "chip chip-alert" : d.status === "published" ? "chip chip-gold" : "chip";
  return (
    <span className={cls}>
      <i className="dot" /> {DELIVERABLE_STATUS_LABEL[d.status]}
    </span>
  );
};

const fileLabel = (f: DeliverableFile) => (f.role === "main" ? (f.kind === "video" ? "Video" : "Image") : f.role === "cover" ? "Cover / thumbnail" : f.label || "Alternate");

export const DeliverableDetail = ({ deliverable: d, onClose, preview: previewMode = false }: { deliverable: Deliverable; onClose: () => void; preview?: boolean }) => {
  const { session, preview, toast, patchDeliverable, refresh } = usePortal();
  const isStudio = session?.role === "studio";
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<{ url: string; file: DeliverableFile } | null>(null);
  const { confirm, element: confirmEl } = useConfirm();

  const main = d.files.find((f) => f.role === "main");
  const cover = d.files.find((f) => f.role === "cover");
  const alts = d.files.filter((f) => f.role === "alt");
  const openRevision = d.revisions.find((r) => !r.resolvedAt);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't go through.", "error");
    } finally {
      setBusy(null);
    }
  };

  const download = (f: DeliverableFile) =>
    act(`dl-${f.id}`, async () => {
      const { url } = await api<{ url: string }>(`/api/deliverables/${d.id}/download?file=${f.id}`);
      triggerDownload(url);
      toast(`Downloading ${fileLabel(f).toLowerCase()}…`);
    });

  const play = (f: DeliverableFile) =>
    act(`play-${f.id}`, async () => {
      const { url } = await api<{ url: string }>(`/api/deliverables/${d.id}/play?file=${f.id}`);
      setView({ url, file: f });
    });

  const approve = () =>
    act("approve", async () => {
      const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${d.id}/approve`, { method: "POST", json: {} });
      patchDeliverable(deliverable);
      toast("Approved. Thank you!");
      refresh();
    });

  const requestChange = () =>
    act("changes", async () => {
      const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${d.id}/changes`, { method: "POST", json: { message } });
      patchDeliverable(deliverable);
      setAsking(false);
      setMessage("");
      toast("Sent to the studio.");
      refresh();
    });

  const togglePosted = (platform: Platform, posted: boolean) =>
    act(`posted-${platform}`, async () => {
      const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${d.id}/posted`, { method: "POST", json: { platform, posted } });
      patchDeliverable(deliverable);
      if (posted) toast(`Marked as posted on ${PLATFORM_LABEL[platform]}.`);
    });

  const remove = async () => {
    if (!(await confirm(`Delete "${d.title}"?`, { body: "The files are removed from storage. This can't be undone.", action: "Delete", danger: true }))) return;
    await act("delete", async () => {
      await api(`/api/deliverables/${d.id}`, { method: "DELETE" });
      toast("Deleted.");
      onClose();
      refresh();
    });
  };

  const unpublish = () =>
    act("unpublish", async () => {
      const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${d.id}/unpublish`, { method: "POST", json: {} });
      patchDeliverable(deliverable);
      toast("Back to draft.");
    });

  const captionFor = (p?: Platform) => (p && d.platforms.find((x) => x.platform === p)?.caption) || d.caption;
  const fullText = (p?: Platform) => [captionFor(p), d.hashtags.length ? hashtagsToText(d.hashtags) : ""].filter(Boolean).join("\n\n");

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={
        <span className="row" style={{ gap: 10 }}>
          <span>{d.title}</span>
          {statusChip(d)}
        </span>
      }
      footer={
        previewMode ? (
          <span className="small muted">This is how Bare Roots will see it. Close to keep editing.</span>
        ) : isStudio ? (
          <>
            <Button variant="alert" size="sm" icon="trash" onClick={remove} busy={busy === "delete"}>
              Delete
            </Button>
            {d.status !== "draft" ? (
              <Button size="sm" onClick={unpublish} busy={busy === "unpublish"}>
                Unpublish
              </Button>
            ) : null}
            <Button variant="gold" size="sm" icon="edit" onClick={() => navigate(`/compose/${d.id}`)}>
              {d.status === "changes" ? "Fix & republish" : "Edit"}
            </Button>
          </>
        ) : d.status === "published" ? (
          <>
            <Button size="sm" icon="chat" onClick={() => setAsking((v) => !v)}>
              Request a change
            </Button>
            <Button variant="gold" size="sm" icon="check" onClick={approve} busy={busy === "approve"}>
              Approve
            </Button>
          </>
        ) : null
      }
    >
      <div className="stack" style={{ gap: "1.25rem" }}>
        {/* Status lines */}
        {d.status === "published" && d.autoApproveAt ? (
          <p className="small muted">
            <Icon name="clock" style={{ width: 15, height: 15, display: "inline", verticalAlign: "-3px", marginRight: 6 }} />
            Delivered {relative(d.publishedAt)}. One free round of changes is included — ask by {fmtDate(d.autoApproveAt, { weekday: "short" })} or it's approved automatically.
          </p>
        ) : null}
        {d.status === "approved" ? (
          <p className="small muted">
            Approved {d.approvedBy === "auto" ? "automatically" : `by ${d.approvedBy}`} {relative(d.approvedAt)}.
          </p>
        ) : null}
        {openRevision ? (
          <div className="rev">
            <div className="by">
              Change requested by {openRevision.by} · {relative(openRevision.at)}
            </div>
            <p>{openRevision.message}</p>
            {!isStudio ? <p className="small muted" style={{ marginTop: 8 }}>The studio is on it. You'll see the revised version here.</p> : null}
          </div>
        ) : null}

        {asking ? (
          <div className="card">
            <div className="card-body stack">
              <label className="label" htmlFor="change-msg">
                What should we change?
              </label>
              <textarea id="change-msg" className="textarea" placeholder="e.g. Can the price text be bigger, and swap the second clip for the one with the gold wrap?" value={message} onChange={(e) => setMessage(e.target.value)} />
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Button size="sm" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="gold" icon="send" disabled={!message.trim()} busy={busy === "changes"} onClick={requestChange}>
                  Send request
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Files */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)", gap: "1.25rem" }} className="detail-grid">
          <div className="stack">
            {main ? (
              <>
                <MediaTile src={preview(main.posterKey) || (main.kind === "image" ? undefined : undefined)} kind={main.kind} dur={main.duration} onClick={() => play(main)} alt={d.title} />
                <Button variant="gold" block icon="download" onClick={() => download(main)} busy={busy === `dl-${main.id}`}>
                  Download {main.kind === "video" ? "video" : "image"} · {bytes(main.size)}
                </Button>
              </>
            ) : (
              <div className="empty" style={{ padding: "2rem 1rem" }}>
                <Icon name="film" />
                <p className="small">No finished file attached yet.</p>
              </div>
            )}
            {cover ? (
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 64 }}>
                  <MediaTile src={preview(cover.posterKey)} kind="image" shape="square" onClick={() => play(cover)} alt="Cover" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small">Cover / thumbnail</div>
                  <div className="xs muted">Upload as the Reel cover so your grid stays on brand.</div>
                </div>
                <Button size="xs" icon="download" onClick={() => download(cover)} busy={busy === `dl-${cover.id}`}>
                  Cover
                </Button>
              </div>
            ) : null}
            {alts.map((f) => (
              <div className="row" style={{ gap: 10 }} key={f.id}>
                <div style={{ width: 64 }}>
                  <MediaTile src={preview(f.posterKey)} kind={f.kind} shape="square" onClick={() => play(f)} alt={f.label || "Alternate"} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small">{f.label || "Alternate version"}</div>
                  <div className="xs muted">{bytes(f.size)}</div>
                </div>
                <Button size="xs" icon="download" onClick={() => download(f)} busy={busy === `dl-${f.id}`}>
                  Get
                </Button>
              </div>
            ))}
          </div>

          <div className="stack" style={{ gap: "1rem" }}>
            <div>
              <div className="row row-between" style={{ marginBottom: 8 }}>
                <span className="label">Caption</span>
                <div className="row" style={{ gap: 6 }}>
                  <CopyButton text={d.caption} label="Caption" />
                  {d.hashtags.length ? <CopyButton text={hashtagsToText(d.hashtags)} label="Hashtags" /> : null}
                  <CopyButton text={fullText()} label="Copy all" variant="gold" />
                </div>
              </div>
              <div className="caption-box">
                {d.caption || <span className="muted">No caption yet.</span>}
                {d.hashtags.length ? (
                  <>
                    {"\n\n"}
                    <span className="tags">{hashtagsToText(d.hashtags)}</span>
                  </>
                ) : null}
              </div>
            </div>

            {d.cta ? (
              <dl className="kv">
                <dt>Call to action</dt>
                <dd>{d.cta}</dd>
              </dl>
            ) : null}

            <div>
              <span className="label">Where & when to post</span>
              <div style={{ marginTop: 4 }}>
                {d.platforms.length ? (
                  d.platforms.map((p) => (
                    <div className="plan-row" key={p.platform}>
                      <PlatformBadge platform={p.platform} posted={Boolean(p.posted)} />
                      <div style={{ minWidth: 0 }}>
                        <div className="when">
                          {PLATFORM_LABEL[p.platform]}
                          {p.format ? <span className="muted"> · {INSTAGRAM_FORMAT_LABEL[p.format]}</span> : null}
                        </div>
                        <div className="small">{p.postAt ? <i style={{ color: "var(--gilt)", fontStyle: "normal" }}>{fmtPlan(p.postAt)}</i> : <span className="muted">Any time this week</span>}</div>
                        {p.tip ? <div className="xs muted">{p.tip}</div> : null}
                        {p.caption ? (
                          <div className="row" style={{ marginTop: 6 }}>
                            <CopyButton text={fullText(p.platform)} label={`${PLATFORM_LABEL[p.platform]} caption`} />
                          </div>
                        ) : null}
                        {p.posted ? (
                          <div className="xs muted">
                            Posted by {p.posted.by} · {fmtDateTime(p.posted.at)}
                          </div>
                        ) : null}
                      </div>
                      <Button size="xs" variant={p.posted ? "ghost" : "gold"} icon={p.posted ? "x" : "check"} onClick={() => togglePosted(p.platform, !p.posted)} busy={busy === `posted-${p.platform}`}>
                        {p.posted ? "Undo" : "Posted"}
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="small muted">No posting plan yet.</p>
                )}
              </div>
            </div>

            {d.tips ? (
              <div>
                <span className="label">Posting tips</span>
                <p className="small" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                  {d.tips}
                </p>
              </div>
            ) : null}

            {isStudio && d.studioNotes ? (
              <div className="card">
                <div className="card-body">
                  <span className="label">Studio notes (private)</span>
                  <p className="small" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                    {d.studioNotes}
                  </p>
                </div>
              </div>
            ) : null}

            {d.revisions.filter((r) => r.resolvedAt).length ? (
              <div className="stack" style={{ gap: 8 }}>
                <span className="label">Past changes</span>
                {d.revisions
                  .filter((r) => r.resolvedAt)
                  .map((r) => (
                    <div className="rev resolved" key={r.id}>
                      <div className="by">
                        {r.by} · {fmtDate(r.at)} · fixed {fmtDate(r.resolvedAt)}
                      </div>
                      <p className="small">{r.message}</p>
                      {r.resolvedNote ? <p className="xs muted">Studio: {r.resolvedNote}</p> : null}
                    </div>
                  ))}
              </div>
            ) : null}

            <p className="xs muted">
              Version {d.version} · created by {d.createdBy} {relative(d.createdAt)}
            </p>
          </div>
        </div>
      </div>
      {view ? (
        <Lightbox
          url={view.url}
          kind={view.file.kind}
          name={`${d.title} — ${fileLabel(view.file)}`}
          onClose={() => setView(null)}
          actions={
            <Button size="xs" variant="gold" icon="download" onClick={() => download(view.file)}>
              Download
            </Button>
          }
        />
      ) : null}
      {confirmEl}
    </Modal>
  );
};
