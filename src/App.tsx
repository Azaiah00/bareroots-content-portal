import { useEffect } from "react";
import { PortalProvider, usePortal } from "@/lib/store";
import { navigate, useRoute } from "@/lib/router";
import { Shell } from "@/components/Shell";
import { Toasts, Button } from "@/components/ui";
import { Gate } from "@/views/Gate";
import { DropOff } from "@/views/DropOff";
import { Ready } from "@/views/Ready";
import { CalendarView } from "@/views/CalendarView";
import { Ideas } from "@/views/Ideas";
import { ActivityView } from "@/views/ActivityView";
import { Footage } from "@/views/studio/Footage";
import { Composer } from "@/views/studio/Composer";
import { Icon } from "@/components/Icon";

const Loading = () => (
  <div className="gate">
    <div className="gate-card" style={{ gap: "1rem" }}>
      <div className="skeleton" style={{ height: 36, width: 220, margin: "0 auto" }} />
      <div className="skeleton" style={{ height: 14, width: 280, margin: "0 auto" }} />
    </div>
  </div>
);

const Routes = () => {
  const { session, loading, error, refresh } = usePortal();
  const route = useRoute();
  const isStudio = session?.role === "studio";

  // Default landing per role; studio-only routes bounce the client.
  useEffect(() => {
    if (!session) return;
    const p = route.path;
    if (!p) navigate(isStudio ? "/footage" : "/drop", true);
    else if (!isStudio && (p === "footage" || p === "compose")) navigate("/ready", true);
    else if (isStudio && p === "drop") navigate("/footage", true);
  }, [session, route.path, isStudio]);

  // Scroll to top on section change.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.path, route.parts[1]]);

  if (loading) return <Loading />;
  if (!session) return <Gate />;

  let view: JSX.Element;
  switch (route.path) {
    case "drop":
      view = <DropOff />;
      break;
    case "footage":
      view = <Footage />;
      break;
    case "ready":
      view = <Ready />;
      break;
    case "calendar":
      view = <CalendarView />;
      break;
    case "ideas":
      view = <Ideas />;
      break;
    case "activity":
      view = <ActivityView />;
      break;
    case "compose":
      view = <Composer />;
      break;
    default:
      view = isStudio ? <Footage /> : <DropOff />;
  }

  return (
    <Shell route={route}>
      {error ? (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "rgba(180,83,63,0.5)" }}>
          <div className="card-body row row-between">
            <span className="row small">
              <Icon name="alert" style={{ width: 18, height: 18, color: "var(--alert-lift)" }} /> {error}
            </span>
            <Button size="xs" icon="refresh" onClick={() => refresh()}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}
      {view}
    </Shell>
  );
};

export const App = () => (
  <PortalProvider>
    <Routes />
    <Toasts />
  </PortalProvider>
);
