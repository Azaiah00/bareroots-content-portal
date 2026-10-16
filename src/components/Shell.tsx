import type { ReactNode } from "react";
import { usePortal } from "@/lib/store";
import { navigate, type Route } from "@/lib/router";
import { Icon, type IconName } from "./Icon";

interface NavItem {
  path: string;
  label: string;
  short?: string;
  icon: IconName;
  badge?: number;
}

export const Shell = ({ route, children }: { route: Route; children: ReactNode }) => {
  const { session, unread, signOut, state } = usePortal();
  const isStudio = session?.role === "studio";

  const items: NavItem[] = isStudio
    ? [
        { path: "footage", label: "Footage", icon: "inbox", badge: state?.raw.filter((r) => r.status === "new").length || 0 },
        { path: "ready", label: "Content", icon: "sparkle" },
        { path: "calendar", label: "Calendar", icon: "calendar" },
        { path: "ideas", label: "Ideas", icon: "idea" },
        { path: "activity", label: "Activity", icon: "bell", badge: unread },
      ]
    : [
        { path: "drop", label: "Drop Off", short: "Drop", icon: "upload" },
        { path: "ready", label: "Ready to Post", short: "Ready", icon: "sparkle", badge: state?.deliverables.filter((d) => d.status === "published").length || 0 },
        { path: "calendar", label: "Calendar", icon: "calendar" },
        { path: "ideas", label: "Ideas", icon: "idea" },
        { path: "activity", label: "Activity", icon: "bell", badge: unread },
      ];

  const current = route.path || (isStudio ? "footage" : "drop");

  return (
    <div className="app">
      <aside className="rail">
        <a href="#/" aria-label="Bare Roots content portal">
          <img className="wordmark" src="/img/logo-wordmark.png" alt="Bare Roots" />
        </a>
        <nav aria-label="Sections">
          {items.map((it) => (
            <a key={it.path} className="navlink" href={`#/${it.path}`} aria-current={current === it.path ? "page" : undefined}>
              <Icon name={it.icon} />
              <span>{it.label}</span>
              {it.badge ? <span className="badge">{it.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div className="who">
          <div className="row row-between">
            <div>
              <div className="xs muted" style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}>
                {isStudio ? "Couture House" : "Bare Roots"}
              </div>
              <div className="serif" style={{ fontSize: "1.35rem", fontStyle: "italic", color: "var(--gilt)" }}>
                {session?.name}
              </div>
            </div>
            <button
              className="icon-btn"
              aria-label="Switch person or sign out"
              title="Switch person"
              onClick={() => {
                signOut();
                navigate("/", true);
              }}
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <a href="#/" aria-label="Bare Roots content portal">
            <img className="wordmark" src="/img/logo-wordmark.png" alt="Bare Roots" />
          </a>
          <div className="row" style={{ gap: 4 }}>
            <span className="serif" style={{ fontStyle: "italic", color: "var(--gilt)", fontSize: "1.1rem" }}>
              {session?.name}
            </span>
            <button
              className="icon-btn"
              aria-label="Switch person or sign out"
              onClick={() => {
                signOut();
                navigate("/", true);
              }}
            >
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <div className="shell">{children}</div>
      </div>

      <nav className="tabbar" aria-label="Sections">
        {items.map((it) => (
          <a key={it.path} className="tab" href={`#/${it.path}`} aria-current={current === it.path ? "page" : undefined} aria-label={it.label}>
            <Icon name={it.icon} />
            <span>{it.short || it.label}</span>
            {it.badge ? <span className="badge">{it.badge}</span> : null}
          </a>
        ))}
      </nav>
    </div>
  );
};
