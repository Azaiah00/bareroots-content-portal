import { useMemo, useState } from "react";
import type { Deliverable, DeliverableStatus } from "@shared/types";
import { usePortal } from "@/lib/store";
import { navigate, useRoute, withParam } from "@/lib/router";
import { Button, Empty, MediaTile, PlatformBadge, Segmented } from "@/components/ui";
import { DeliverableDetail, statusChip } from "@/components/DeliverableDetail";
import { fmtDate, plural, relative } from "@/lib/format";
import { useReveal } from "@/lib/motion";
import { Icon } from "@/components/Icon";

/**
 * CLIENT · Ready to Post      STUDIO · Content
 * Same grid, two audiences. The client sees published work with a clear
 * "needs your OK" count; the studio also sees drafts and the New button.
 */

type Filter = "all" | "published" | "changes" | "approved" | "draft" | "unposted";

export const DeliverableCard = ({ d, onOpen }: { d: Deliverable; onOpen: () => void }) => {
  const { preview } = usePortal();
  const main = d.files.find((f) => f.role === "main");
  const cover = d.files.find((f) => f.role === "cover");
  const poster = preview(cover?.posterKey) || preview(main?.posterKey);
  const next = d.platforms.filter((p) => p.postAt && !p.posted).map((p) => p.postAt!).sort()[0];
  const allPosted = d.platforms.length > 0 && d.platforms.every((p) => p.posted);
  return (
    <article className="card hoverable dcard" data-reveal="">
      <MediaTile src={poster} kind={main?.kind ?? (d.kind === "video" ? "video" : "image")} dur={main?.duration} onClick={onOpen} alt={d.title} />
      <div className="dcard-body">
        <div className="row row-between" style={{ alignItems: "flex-start" }}>
          <h3 style={{ minWidth: 0 }}>{d.title}</h3>
          {statusChip(d)}
        </div>
        <div className="row row-between">
          <div className="platforms">
            {d.platforms.map((p) => (
              <PlatformBadge key={p.platform} platform={p.platform} posted={Boolean(p.posted)} />
            ))}
          </div>
          <span className="xs muted">{d.kind === "video" ? "Video post" : "Static ad"}</span>
        </div>
        <div className="small muted">
          {allPosted ? (
            <span style={{ color: "#a9c89a" }}>Posted everywhere</span>
          ) : next ? (
            <>
              Post next: <span style={{ color: "var(--gilt)" }}>{fmtDate(next, { weekday: "short" })}</span>
            </>
          ) : (
            <>Delivered {relative(d.publishedAt || d.updatedAt)}</>
          )}
        </div>
        <Button size="sm" variant={d.status === "published" ? "gold" : "ghost"} icon={d.status === "published" ? "download" : "eye"} onClick={onOpen} block>
          {d.status === "published" ? "Open & download" : "Open"}
        </Button>
      </div>
    </article>
  );
};

export const Ready = () => {
  const { state, session } = usePortal();
  const route = useRoute();
  const isStudio = session?.role === "studio";
  const [filter, setFilter] = useState<Filter>("all");
  const openId = route.params.get("d");
  const ref = useReveal<HTMLDivElement>([state?.deliverables.length, filter]);

  const list = useMemo(() => {
    const all = state?.deliverables ?? [];
    const by = (s: DeliverableStatus) => all.filter((d) => d.status === s);
    switch (filter) {
      case "published":
        return by("published");
      case "changes":
        return by("changes");
      case "approved":
        return by("approved");
      case "draft":
        return by("draft");
      case "unposted":
        return all.filter((d) => d.status !== "draft" && d.platforms.some((p) => !p.posted));
      default:
        return all;
    }
  }, [state, filter]);

  const open = openId ? state?.deliverables.find((d) => d.id === openId) : undefined;
  const needsOk = state?.deliverables.filter((d) => d.status === "published").length ?? 0;
  const changes = state?.deliverables.filter((d) => d.status === "changes").length ?? 0;
  const drafts = state?.deliverables.filter((d) => d.status === "draft").length ?? 0;
  const month = new Date().toLocaleDateString("en-US", { month: "long", timeZone: "America/New_York" });
  const thisMonth = (state?.deliverables ?? []).filter((d) => d.status !== "draft" && d.publishedAt && new Date(d.publishedAt).getMonth() === new Date().getMonth());

  return (
    <div ref={ref}>
      <div className="page-head" data-reveal="">
        <div>
          <span className="eyebrow">{isStudio ? "Content" : "Ready to post"}</span>
          <h1>
            {isStudio ? (
              <>
                Finished <span className="accent">work.</span>
              </>
            ) : (
              <>
                Your posts, <span className="accent">ready.</span>
              </>
            )}
          </h1>
          <p className="lead">
            {isStudio
              ? "Everything delivered to Bare Roots, plus your drafts. Publish when the file, caption and posting plan are set."
              : "Download the post, copy the caption and hashtags, and post it at the suggested time. Tap Approve when you're happy — or ask for a change."}
          </p>
        </div>
        <div className="row">
          {isStudio ? (
            <Button variant="gold" icon="plus" onClick={() => navigate("/compose/new")}>
              New content
            </Button>
          ) : null}
        </div>
      </div>

      <div className="row row-between" data-reveal="" style={{ marginBottom: "1rem", "--reveal-delay": "60ms" } as React.CSSProperties}>
        <div className="row" style={{ gap: "1.5rem" }}>
          <div className="stat">
            <b>{needsOk}</b>
            <span>{isStudio ? "Awaiting approval" : "Need your OK"}</span>
          </div>
          <div className="stat">
            <b>{thisMonth.filter((d) => d.kind === "video").length}</b>
            <span>Videos in {month}</span>
          </div>
          <div className="stat">
            <b>{thisMonth.filter((d) => d.kind === "static").length}</b>
            <span>Statics in {month}</span>
          </div>
          {changes ? (
            <div className="stat">
              <b style={{ color: "var(--alert-lift)" }}>{changes}</b>
              <span>Changes</span>
            </div>
          ) : null}
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "published", label: isStudio ? "Delivered" : "Needs OK" },
            { value: "unposted", label: "To post" },
            { value: "approved", label: "Approved" },
            ...(changes ? [{ value: "changes" as Filter, label: "Changes" }] : []),
            ...(isStudio ? [{ value: "draft" as Filter, label: `Drafts${drafts ? ` · ${drafts}` : ""}` }] : []),
          ]}
        />
      </div>

      {!list.length ? (
        <Empty icon="sparkle" title={filter === "all" ? (isStudio ? "No content yet" : "Nothing here yet") : "Nothing in this view"}>
          {isStudio ? "Start with New content: upload the finished file, write the caption, set the posting plan, publish." : "Your first finished posts land here with captions, hashtags and posting times attached."}
        </Empty>
      ) : (
        <div className="grid grid-3">
          {list.map((d) => (
            <DeliverableCard key={d.id} d={d} onOpen={() => navigate(withParam(route, "d", d.id))} />
          ))}
        </div>
      )}

      {state && !isStudio && state.deliverables.length ? (
        <p className="xs muted" style={{ marginTop: "1.5rem" }}>
          <Icon name="clock" style={{ width: 14, height: 14, display: "inline", verticalAlign: "-2px", marginRight: 6 }} />
          {plural(state.deliverables.length, "post")} delivered so far. Each one includes one round of changes within five business days.
        </p>
      ) : null}

      {open ? <DeliverableDetail deliverable={open} onClose={() => navigate(withParam(route, "d", null), true)} /> : null}
    </div>
  );
};
