import { useEffect } from "react";
import type { Activity } from "@shared/types";
import { usePortal } from "@/lib/store";
import { navigate } from "@/lib/router";
import { Empty } from "@/components/ui";
import { fmtDateTime, relative } from "@/lib/format";

/** What's new — the in-portal substitute for email. */

const target = (a: Activity, isStudio: boolean): string | null => {
  if (!a.ref) return null;
  switch (a.ref.kind) {
    case "deliverable":
      return `/ready?d=${a.ref.id}`;
    case "idea":
      return `/ideas?i=${a.ref.id}`;
    case "batch":
    case "raw":
      return isStudio ? `/footage?b=${a.ref.id}` : "/drop";
  }
};

export const ActivityView = () => {
  const { state, session, markRead } = usePortal();
  useEffect(() => {
    markRead();
  }, [markRead, state?.activity.length]);
  const items = (state?.activity ?? []).filter((a) => a.type !== "session.joined");
  const isStudio = session?.role === "studio";

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Activity</span>
          <h1>
            What's <span className="accent">new.</span>
          </h1>
          <p className="lead">Every drop-off, delivery, approval, change request and reply — newest first.</p>
        </div>
      </div>
      {!items.length ? (
        <Empty icon="bell" title="Quiet so far">The feed fills as footage comes in and content goes out.</Empty>
      ) : (
        <div className="card">
          <div className="card-body feed">
            {items.map((a) => {
              const to = target(a, isStudio);
              const row = (
                <>
                  <div className={`avatar ${a.role === "studio" ? "studio" : ""}`}>{a.who.slice(0, 1)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 400 }}>
                      {a.message}
                    </div>
                    <div className="when" title={fmtDateTime(a.at)}>
                      {relative(a.at)} · {a.role === "studio" ? "Couture House" : "Bare Roots"}
                    </div>
                  </div>
                </>
              );
              return to ? (
                <button type="button" className="feed-item" key={a.id} onClick={() => navigate(to)} style={{ textAlign: "left", width: "100%" }}>
                  {row}
                </button>
              ) : (
                <div className="feed-item" key={a.id}>
                  {row}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
