import { useMemo, useState } from "react";
import type { Deliverable, Platform } from "@shared/types";
import { PLATFORM_LABEL } from "@shared/types";
import { usePortal } from "@/lib/store";
import { navigate, useRoute, withParam } from "@/lib/router";
import { Button, Empty, PlatformBadge } from "@/components/ui";
import { DeliverableDetail } from "@/components/DeliverableDetail";
import { Icon } from "@/components/Icon";
import { fmtTime, plural } from "@/lib/format";
import { api } from "@/lib/api";

/**
 * Posting calendar. Every platform plan with a date becomes an entry; tapping
 * one opens the post. "This week" on top is the checklist the client actually
 * uses from her phone; the month grid is the overview.
 */

const TZ = "America/New_York";

interface Entry {
  d: Deliverable;
  platform: Platform;
  at: string; // ISO
  dayKey: string; // YYYY-MM-DD in NY
  posted: boolean;
  format?: string;
}

const dayKey = (iso: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
};

const todayKey = () => dayKey(new Date().toISOString());

const addDaysKey = (key: string, n: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
};

const weekdayOfKey = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const labelOfKey = (key: string, opts: Intl.DateTimeFormatOptions): string => {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
};

export const CalendarView = () => {
  const { state, session, patchDeliverable, toast } = usePortal();
  const route = useRoute();
  const [cursor, setCursor] = useState(() => todayKey().slice(0, 7)); // YYYY-MM
  const [busy, setBusy] = useState<string | null>(null);
  const openId = route.params.get("d");
  const open = openId ? state?.deliverables.find((d) => d.id === openId) : undefined;

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const d of state?.deliverables ?? []) {
      if (d.status === "draft") continue;
      for (const p of d.platforms) {
        if (!p.postAt) continue;
        out.push({ d, platform: p.platform, at: p.postAt, dayKey: dayKey(p.postAt), posted: Boolean(p.posted), format: p.format });
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }, [state]);

  const today = todayKey();
  const weekEnd = addDaysKey(today, 7);
  const thisWeek = entries.filter((e) => e.dayKey >= today && e.dayKey < weekEnd);
  const overdue = entries.filter((e) => e.dayKey < today && !e.posted);
  const unscheduled = (state?.deliverables ?? []).filter((d) => d.status !== "draft" && d.platforms.some((p) => !p.postAt && !p.posted));

  // Month grid
  const [cy, cm] = cursor.split("-").map(Number);
  const first = `${cursor}-01`;
  const lead = weekdayOfKey(first);
  const daysInMonth = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const cells: string[] = [];
  for (let i = 0; i < lead; i++) cells.push(addDaysKey(first, i - lead));
  for (let i = 0; i < daysInMonth; i++) cells.push(addDaysKey(first, i));
  while (cells.length % 7) cells.push(addDaysKey(first, cells.length - lead));
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!byDay.has(e.dayKey)) byDay.set(e.dayKey, []);
    byDay.get(e.dayKey)!.push(e);
  }

  const shift = (n: number) => {
    const dt = new Date(Date.UTC(cy, cm - 1 + n, 1));
    setCursor(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  const togglePosted = async (e: Entry) => {
    setBusy(`${e.d.id}-${e.platform}`);
    try {
      const { deliverable } = await api<{ deliverable: Deliverable }>(`/api/deliverables/${e.d.id}/posted`, { method: "POST", json: { platform: e.platform, posted: !e.posted } });
      patchDeliverable(deliverable);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update.", "error");
    } finally {
      setBusy(null);
    }
  };

  const EntryRow = ({ e }: { e: Entry }) => (
    <div className="plan-row">
      <PlatformBadge platform={e.platform} posted={e.posted} />
      <button type="button" style={{ textAlign: "left", minWidth: 0 }} onClick={() => navigate(withParam(route, "d", e.d.id))}>
        <div style={{ fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: e.posted ? "line-through" : undefined }}>{e.d.title}</div>
        <div className="xs muted">
          {labelOfKey(e.dayKey, { weekday: "long", month: "short", day: "numeric" })} · {fmtTime(e.at)} · {PLATFORM_LABEL[e.platform]}
          {e.format ? ` ${e.format}` : ""}
        </div>
      </button>
      <Button size="xs" variant={e.posted ? "ghost" : "gold"} icon={e.posted ? "x" : "check"} busy={busy === `${e.d.id}-${e.platform}`} onClick={() => togglePosted(e)}>
        {e.posted ? "Undo" : "Posted"}
      </Button>
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Calendar</span>
          <h1>
            When to <span className="accent">post.</span>
          </h1>
          <p className="lead">
            {session?.role === "studio" ? "Every scheduled platform post. Dates come from each piece's posting plan." : "Your week at a glance. Tick each one off as you post it — the studio sees it too."}
          </p>
        </div>
      </div>

      {overdue.length ? (
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="card" style={{ borderColor: "rgba(180,83,63,0.45)" }}>
            <div className="card-body">
              <div className="row" style={{ marginBottom: 6 }}>
                <Icon name="alert" style={{ width: 18, height: 18, color: "var(--alert-lift)" }} />
                <strong>{plural(overdue.length, "post")} past the suggested date</strong>
              </div>
              <p className="small muted">No harm done — post them whenever you can, or mark them posted if they already went up.</p>
              {overdue.slice(0, 6).map((e) => (
                <EntryRow key={`${e.d.id}-${e.platform}`} e={e} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head">
          <h2>
            This <span className="accent">week</span>
          </h2>
          <span className="small muted">{thisWeek.filter((e) => !e.posted).length} to go</span>
        </div>
        {thisWeek.length ? (
          <div className="card">
            <div className="card-body">
              {thisWeek.map((e) => (
                <EntryRow key={`${e.d.id}-${e.platform}`} e={e} />
              ))}
            </div>
          </div>
        ) : (
          <Empty icon="calendar" title="Nothing scheduled in the next seven days">
            {unscheduled.length ? `${plural(unscheduled.length, "post")} ready without a date — open them from Ready to Post.` : "New posts appear here with their suggested day and time."}
          </Empty>
        )}
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head">
          <h2 style={{ fontSize: "1.6rem" }}>{labelOfKey(first, { month: "long", year: "numeric" })}</h2>
          <div className="row" style={{ gap: 4 }}>
            <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>
              <Icon name="chevron-left" />
            </button>
            <Button size="xs" onClick={() => setCursor(today.slice(0, 7))}>
              Today
            </Button>
            <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>
              <Icon name="chevron-right" />
            </button>
          </div>
        </div>
        <div className="cal" role="grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div className="dow" key={d}>
              {d}
            </div>
          ))}
          {cells.map((key) => {
            const inMonth = key.startsWith(cursor);
            const items = byDay.get(key) || [];
            return (
              <div className={["day", inMonth ? "" : "out", key === today ? "today" : ""].filter(Boolean).join(" ")} key={key} role="gridcell">
                <span className="num">{Number(key.slice(8))}</span>
                <div className="stack" style={{ gap: 3 }}>
                  {items.map((e) => (
                    <button
                      type="button"
                      className={`cal-item ${e.posted ? "posted" : ""}`}
                      key={`${e.d.id}-${e.platform}`}
                      onClick={() => navigate(withParam(route, "d", e.d.id))}
                      title={`${e.d.title} · ${PLATFORM_LABEL[e.platform]} · ${fmtTime(e.at)}`}
                    >
                      <span className="pb">{e.platform === "instagram" ? "IG" : e.platform === "tiktok" ? "TT" : "FB"}</span>
                      <span className="t">{e.d.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="xs muted" style={{ marginTop: 10 }}>
          Times are Eastern (Richmond). IG = Instagram, TT = TikTok, FB = Facebook. A gold-filled badge means it's been posted.
        </p>
      </section>

      {open ? <DeliverableDetail deliverable={open} onClose={() => navigate(withParam(route, "d", null), true)} /> : null}
    </div>
  );
};
