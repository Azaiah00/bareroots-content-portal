import { useEffect, useMemo, useState } from "react";
import type { Idea, IdeaColor, IdeaStatus } from "@shared/types";
import { IDEA_STATUS_LABEL } from "@shared/types";
import { usePortal } from "@/lib/store";
import { api } from "@/lib/api";
import { navigate, useRoute, withParam } from "@/lib/router";
import { Button, Lightbox, Modal, Segmented, useConfirm } from "@/components/ui";
import { DropZone, UploadList, useUploader } from "@/components/Uploader";
import { Icon } from "@/components/Icon";
import { fmtDateTime, relative, tiltFor } from "@/lib/format";
import { useReveal } from "@/lib/motion";

/**
 * The ideas board — a corkboard both sides pin to. Iisha and Sabrina write
 * "do a video about…", Fred and Azaiah reply, heart it, move it to
 * In production, and turn it into content with one tap.
 */

const COLORS: { value: IdeaColor; label: string }[] = [
  { value: "cream", label: "Cream" },
  { value: "gold", label: "Gold" },
  { value: "sage", label: "Sage" },
  { value: "mauve", label: "Mauve" },
  { value: "plum", label: "Plum" },
];

const STATUSES: IdeaStatus[] = ["new", "exploring", "in-production", "made", "parked"];

type BoardFilter = "all" | "open" | "in-production" | "made";

const Note = ({ idea, onOpen }: { idea: Idea; onOpen: () => void }) => {
  const { preview } = usePortal();
  const img = idea.attachments.find((a) => a.posterKey);
  return (
    <button type="button" className={`note c-${idea.color} ${idea.pinned ? "pinned" : ""}`} style={{ "--tilt": `${tiltFor(idea.id)}deg`, width: "100%", textAlign: "left", display: "block" } as React.CSSProperties} onClick={onOpen}>
      <div className="row row-between" style={{ marginBottom: 6 }}>
        <span className={`status-pill s-${idea.status}`}>{IDEA_STATUS_LABEL[idea.status]}</span>
        {idea.pinned ? <Icon name="pin" style={{ width: 14, height: 14, color: "var(--bronze-ink)" }} /> : null}
      </div>
      <h4>{idea.title}</h4>
      {idea.body ? <p>{idea.body.length > 220 ? `${idea.body.slice(0, 220)}…` : idea.body}</p> : null}
      {img ? (
        <div className="note-img">
          <img src={preview(img.posterKey)} alt="" loading="lazy" />
        </div>
      ) : idea.attachments.length ? (
        <p className="xs muted" style={{ marginTop: 6 }}>
          {idea.attachments.length} attachment{idea.attachments.length === 1 ? "" : "s"}
        </p>
      ) : null}
      <div className="note-foot">
        <span className="muted">
          {idea.author} · {relative(idea.createdAt)}
        </span>
        <span className="row" style={{ gap: 10 }}>
          <span className="row" style={{ gap: 3 }}>
            <Icon name={idea.hearts.length ? "heart-fill" : "heart"} /> {idea.hearts.length || ""}
          </span>
          <span className="row" style={{ gap: 3 }}>
            <Icon name="chat" /> {idea.comments.length || ""}
          </span>
        </span>
      </div>
    </button>
  );
};

const IdeaSheet = ({ idea, onClose }: { idea: Idea; onClose: () => void }) => {
  const { session, patchIdea, refresh, toast, preview } = usePortal();
  const isStudio = session?.role === "studio";
  const mine = idea.author === session?.name;
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(idea.title);
  const [body, setBody] = useState(idea.body);
  const [link, setLink] = useState(idea.link || "");
  const [color, setColor] = useState<IdeaColor>(idea.color);
  const [view, setView] = useState<{ url: string; kind: Idea["attachments"][number]["kind"]; name: string } | null>(null);
  const uploader = useUploader("idea");
  const { confirm, element: confirmEl } = useConfirm();

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

  const patch = (json: Record<string, unknown>, key = "patch") =>
    run(key, async () => {
      const r = await api<{ idea: Idea }>(`/api/ideas/${idea.id}`, { method: "PATCH", json });
      patchIdea(r.idea);
    });

  const addComment = () =>
    run("comment", async () => {
      const r = await api<{ idea: Idea }>(`/api/ideas/${idea.id}/comments`, { method: "POST", json: { body: comment } });
      patchIdea(r.idea);
      setComment("");
    });

  const heart = () =>
    run("heart", async () => {
      const r = await api<{ idea: Idea }>(`/api/ideas/${idea.id}/heart`, { method: "POST", json: {} });
      patchIdea(r.idea);
    });

  const remove = async () => {
    if (!(await confirm("Take this idea off the board?", { action: "Remove", danger: true }))) return;
    run("delete", async () => {
      await api(`/api/ideas/${idea.id}`, { method: "DELETE" });
      onClose();
      refresh();
    });
  };

  const makeContent = () =>
    run("make", async () => {
      const r = await api<{ deliverable: { id: string } }>("/api/deliverables", { method: "POST", json: { title: idea.title, ideaId: idea.id, studioNotes: idea.body } });
      refresh();
      navigate(`/compose/${r.deliverable.id}`);
    });

  const openAttachment = (a: Idea["attachments"][number]) =>
    run(`att-${a.id}`, async () => {
      const { url } = await api<{ url: string }>(`/api/ideas/${idea.id}/attachments/${a.id}`);
      setView({ url, kind: a.kind, name: a.name });
    });

  const removeAttachment = (id: string) =>
    run(`ratt-${id}`, async () => {
      const r = await api<{ idea: Idea }>(`/api/ideas/${idea.id}/attachments/${id}`, { method: "DELETE" });
      patchIdea(r.idea);
    });

  // Refresh once uploads finish so attachments appear.
  const doneCount = uploader.done.length;
  const activeCount = uploader.active.length;
  useEffect(() => {
    if (doneCount && !activeCount) {
      refresh();
      uploader.clearDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount, activeCount]);

  return (
    <Modal
      open
      onClose={onClose}
      light
      title={editing ? "Edit idea" : idea.title}
      footer={
        editing ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="gold" size="sm" icon="check" busy={busy === "patch"} onClick={async () => {
              await patch({ title, body, link, color });
              setEditing(false);
            }}>
              Save
            </Button>
          </>
        ) : (
          <>
            {isStudio || mine ? (
              <Button variant="outline" size="sm" icon="trash" onClick={remove} busy={busy === "delete"}>
                Remove
              </Button>
            ) : null}
            {isStudio || mine ? (
              <Button variant="outline" size="sm" icon="edit" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {isStudio && !idea.deliverableId ? (
              <Button variant="gold" size="sm" icon="sparkle" busy={busy === "make"} onClick={makeContent}>
                Make this content
              </Button>
            ) : null}
          </>
        )
      }
    >
      <div className="stack" style={{ gap: "1rem" }}>
        {editing ? (
          <>
            <div className="field">
              <label htmlFor="it">Title</label>
              <input id="it" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="ib">The idea</label>
              <textarea id="ib" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="il">Link (optional)</label>
              <input id="il" className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="A TikTok or Reel you want to riff on" />
            </div>
            <div className="field">
              <label>Note colour</label>
              <div className="row">
                {COLORS.map((c) => (
                  <button type="button" key={c.value} className={`note c-${c.value}`} style={{ margin: 0, padding: "6px 12px", outline: color === c.value ? "2px solid var(--bronze)" : "none", transform: "none" }} onClick={() => setColor(c.value)}>
                    <span className="xs">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="row row-between">
              <span className={`status-pill s-${idea.status}`}>{IDEA_STATUS_LABEL[idea.status]}</span>
              <span className="xs muted">
                {idea.author} · {fmtDateTime(idea.createdAt)}
              </span>
            </div>
            {idea.body ? <p style={{ whiteSpace: "pre-wrap" }}>{idea.body}</p> : null}
            {idea.link ? (
              <a className="row small" href={idea.link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--bronze-ink)", gap: 6 }}>
                <Icon name="link" style={{ width: 16, height: 16 }} /> {idea.link.replace(/^https?:\/\//, "").slice(0, 60)}
              </a>
            ) : null}
            {idea.deliverableId ? (
              <Button variant="outline" size="xs" icon="sparkle" onClick={() => navigate(`/ready?d=${idea.deliverableId}`)}>
                See the content made from this
              </Button>
            ) : null}

            {idea.attachments.length ? (
              <div className="grid grid-tiles">
                {idea.attachments.map((a) => (
                  <div key={a.id} style={{ position: "relative" }}>
                    <button type="button" className="tile square" style={{ width: "100%" }} onClick={() => openAttachment(a)}>
                      {preview(a.posterKey) ? <img src={preview(a.posterKey)} alt={a.name} /> : <Icon name={a.kind === "video" ? "film" : "file"} style={{ width: 28, height: 28, color: "var(--gold)" }} />}
                    </button>
                    {isStudio || mine ? (
                      <button className="icon-btn" style={{ position: "absolute", top: 2, right: 2, width: 32, height: 32, background: "rgba(28,21,24,0.6)", color: "var(--cream)" }} aria-label="Remove attachment" onClick={() => removeAttachment(a.id)}>
                        <Icon name="x" style={{ width: 14, height: 14 }} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div>
              <DropZone compact onFiles={(f) => uploader.add(f, idea.id)} title="Add a reference photo or clip" hint="A screenshot, a look you love, a product shot." />
              <UploadList jobs={uploader.jobs} onRetry={uploader.retry} onCancel={uploader.cancel} onRemove={uploader.remove} />
            </div>

            <div className="row row-between">
              <Button variant="outline" size="xs" icon={idea.hearts.includes(session?.name || "") ? "heart-fill" : "heart"} busy={busy === "heart"} onClick={heart}>
                {idea.hearts.length ? idea.hearts.join(", ") : "Love it"}
              </Button>
              {isStudio ? (
                <select className="select" style={{ width: "auto", minHeight: 40 }} value={idea.status} onChange={(e) => patch({ status: e.target.value }, "status")} aria-label="Status">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {IDEA_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              ) : null}
              {isStudio ? (
                <Button variant="outline" size="xs" icon="pin" onClick={() => patch({ pinned: !idea.pinned }, "pin")}>
                  {idea.pinned ? "Unpin" : "Pin to top"}
                </Button>
              ) : null}
            </div>

            <hr className="hairline" />
            <div className="stack" style={{ gap: 10 }}>
              <span className="label">Conversation</span>
              {idea.comments.length ? (
                idea.comments.map((c) => (
                  <div key={c.id} className="feed-item" style={{ borderColor: "var(--line)" }}>
                    <div className={`avatar ${c.role === "studio" ? "studio" : ""}`}>{c.author.slice(0, 1)}</div>
                    <div>
                      <div className="small">
                        <strong style={{ fontWeight: 500 }}>{c.author}</strong> <span className="muted xs">· {relative(c.at)}</span>
                      </div>
                      <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                        {c.body}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="small muted">No replies yet.</p>
              )}
              <div className="row" style={{ alignItems: "stretch" }}>
                <input className="input" placeholder="Reply…" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && comment.trim() && addComment()} style={{ flex: 1 }} />
                <Button variant="gold" icon="send" disabled={!comment.trim()} busy={busy === "comment"} onClick={addComment}>
                  Send
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
      {view ? <Lightbox url={view.url} kind={view.kind} name={view.name} onClose={() => setView(null)} /> : null}
      {confirmEl}
    </Modal>
  );
};

const NewIdea = ({ onClose }: { onClose: () => void }) => {
  const { patchIdea, toast, refresh } = usePortal();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [color, setColor] = useState<IdeaColor>("cream");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ idea: Idea }>("/api/ideas", { method: "POST", json: { title, body, link, color } });
      patchIdea(r.idea);
      toast("Pinned to the board.");
      onClose();
      refresh();
      navigate(`/ideas?i=${r.idea.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      light
      title="Pin an idea"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" size="sm" icon="pin" busy={busy} disabled={!title.trim() && !body.trim()} onClick={create}>
            Pin it
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: "1rem" }}>
        <div className="field">
          <label htmlFor="nt">Title</label>
          <input id="nt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Before & after: 6 months of Root Recovery" maxLength={120} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="nb">The idea</label>
          <textarea id="nb" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Anything — a trend you saw, a question clients keep asking, a product to feature, a day to film." />
        </div>
        <div className="field">
          <label htmlFor="nl">Link (optional)</label>
          <input id="nl" className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a TikTok or Reel to riff on" />
        </div>
        <div className="field">
          <label>Note colour</label>
          <div className="row">
            {COLORS.map((c) => (
              <button type="button" key={c.value} className={`note c-${c.value}`} style={{ margin: 0, padding: "6px 12px", outline: color === c.value ? "2px solid var(--bronze)" : "none", transform: "none" }} onClick={() => setColor(c.value)}>
                <span className="xs">{c.label}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="xs muted">You can add photos or clips to the note after pinning it.</p>
      </div>
    </Modal>
  );
};

export const Ideas = () => {
  const { state } = usePortal();
  const route = useRoute();
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [creating, setCreating] = useState(false);
  const ref = useReveal<HTMLDivElement>([state?.ideas.length]);
  const openId = route.params.get("i");
  const open = openId ? state?.ideas.find((i) => i.id === openId) : undefined;

  const list = useMemo(() => {
    const all = [...(state?.ideas ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    if (filter === "open") return all.filter((i) => i.status === "new" || i.status === "exploring");
    if (filter === "in-production") return all.filter((i) => i.status === "in-production");
    if (filter === "made") return all.filter((i) => i.status === "made");
    return all.filter((i) => i.status !== "parked" || filter === "all");
  }, [state, filter]);

  return (
    <div ref={ref}>
      <div className="page-head" data-reveal="">
        <div>
          <span className="eyebrow">Ideas board</span>
          <h1>
            Pin a <span className="accent">thought.</span>
          </h1>
          <p className="lead">A shared corkboard. Trends you spot, questions clients ask, things you want filmed — pin it and the other side replies right here.</p>
        </div>
        <div className="row">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "open", label: "Open" },
              { value: "in-production", label: "In production" },
              { value: "made", label: "Made" },
            ]}
          />
          <Button variant="gold" icon="plus" data-tour="ideas-pin" onClick={() => setCreating(true)}>
            Pin an idea
          </Button>
        </div>
      </div>

      <div className="board on-light" data-reveal="" data-tour="ideas-board" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
        {list.length ? (
          <div className="notes">
            {list.map((i) => (
              <Note key={i.id} idea={i} onOpen={() => navigate(withParam(route, "i", i.id))} />
            ))}
          </div>
        ) : (
          <div className="empty" style={{ borderColor: "rgba(28,21,24,0.2)", color: "var(--ink-soft)" }}>
            <Icon name="idea" style={{ color: "var(--bronze)" }} />
            <h3 style={{ color: "var(--ink)" }}>The board is empty</h3>
            <p className="small">Pin the first idea — even half a thought is enough to start the conversation.</p>
          </div>
        )}
      </div>

      {creating ? <NewIdea onClose={() => setCreating(false)} /> : null}
      {open ? <IdeaSheet idea={open} onClose={() => navigate(withParam(route, "i", null), true)} /> : null}
    </div>
  );
};
