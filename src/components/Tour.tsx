import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePortal } from "@/lib/store";
import { navigate, useRoute } from "@/lib/router";
import { tourFor, TOUR_SEEN_KEY, type TourStep } from "@/lib/tour";
import { Icon } from "./Icon";
import { Button } from "./ui";

/**
 * Guided walkthrough: spotlight + card, one step at a time, per role.
 * Starts automatically the first time a role signs in on a device; the
 * Guide button (rail, top bar, and a floating button on phones) turns it on
 * again any time; Skip / the X turns it off. "Don't show automatically"
 * is remembered per device.
 */

interface TourCtx {
  active: boolean;
  start: () => void;
  stop: () => void;
}

const Ctx = createContext<TourCtx>({ active: false, start: () => {}, stop: () => {} });

export const useTour = () => useContext(Ctx);

const readSeen = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const writeSeen = (key: string, v: boolean) => {
  try {
    if (v) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

export const TourProvider = ({ children }: { children: ReactNode }) => {
  const { session, state } = usePortal();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const role = session?.role;

  // Auto-start once per role per device, after the first state load.
  useEffect(() => {
    if (!role || !state) return;
    if (!readSeen(TOUR_SEEN_KEY(role))) {
      const t = setTimeout(() => {
        setIndex(0);
        setActive(true);
      }, 900);
      return () => clearTimeout(t);
    }
  }, [role, state]);

  const start = useCallback(() => {
    setIndex(0);
    setActive(true);
  }, []);
  const stop = useCallback(() => setActive(false), []);

  const value = useMemo(() => ({ active, start, stop }), [active, start, stop]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {active && role ? <TourOverlay steps={tourFor(role)} index={index} setIndex={setIndex} onClose={stop} seenKey={TOUR_SEEN_KEY(role)} /> : null}
    </Ctx.Provider>
  );
};

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;

const TourOverlay = ({ steps, index, setIndex, onClose, seenKey }: { steps: TourStep[]; index: number; setIndex: (i: number) => void; onClose: () => void; seenKey: string }) => {
  const route = useRoute();
  const step = steps[Math.min(index, steps.length - 1)];
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const isPhone = typeof window !== "undefined" && window.innerWidth < 720;

  // Go to the step's route if we're not on it.
  useEffect(() => {
    if (route.path !== step.route) navigate(`/${step.route}`);
  }, [step.route, route.path]);

  // Find and track the target element.
  useLayoutEffect(() => {
    let raf = 0;
    let tries = 0;
    const measure = () => {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el) {
        if (tries++ < 40) raf = requestAnimationFrame(measure);
        else setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const scrollThenMeasure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: isPhone ? "start" : "center", inline: "nearest" });
        setTimeout(measure, 450);
      } else measure();
    };
    const t = setTimeout(scrollThenMeasure, route.path === step.route ? 60 : 400);
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [step, route.path, isPhone]);

  // Keyboard: Esc closes, arrows move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Finishing or skipping means it never auto-starts again on this device;
  // the Guide button brings it back on demand.
  const finish = () => {
    writeSeen(seenKey, true);
    onClose();
  };
  const next = () => (index >= steps.length - 1 ? finish() : setIndex(index + 1));
  const back = () => setIndex(Math.max(0, index - 1));

  // Card placement: phones pin to the bottom; desktop sits beside the target.
  const cardStyle = useMemo<React.CSSProperties>(() => {
    if (isPhone || !rect) return {};
    const cardW = 360;
    const cardH = cardRef.current?.offsetHeight ?? 220;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.top + rect.height + 16;
    if (top + cardH > vh - 16) top = Math.max(16, rect.top - cardH - 16);
    let left = rect.left;
    if (left + cardW > vw - 16) left = Math.max(16, vw - cardW - 16);
    return { position: "fixed", top, left, width: cardW };
  }, [rect, isPhone, index]);

  const spot = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label="Portal walkthrough">
      {spot ? <div className="tour-spot" style={spot} /> : <div className="tour-dim" />}
      <div className={`tour-card ${isPhone || !rect ? "tour-card-bottom" : ""}`} style={cardStyle} ref={cardRef}>
        <div className="row row-between" style={{ marginBottom: 8 }}>
          <span className="eyebrow">
            Guide · {index + 1} of {steps.length}
          </span>
          <button className="icon-btn" aria-label="Close the guide" onClick={finish} style={{ width: 36, height: 36 }}>
            <Icon name="x" />
          </button>
        </div>
        <h3 style={{ marginBottom: 6 }}>{step.title}</h3>
        <p className="small" style={{ color: "var(--cream-dim)" }}>
          {step.body}
        </p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <i key={i} className={i === index ? "on" : i < index ? "done" : ""} />
          ))}
        </div>
        <div className="row row-between" style={{ marginTop: 12 }}>
          <span className="xs" style={{ color: "var(--cream-dim)" }}>
            {"The page still works while the guide is on"}
          </span>
          <div className="row" style={{ gap: 6 }}>
            {index > 0 ? (
              <Button size="xs" onClick={back} icon="chevron-left">
                Back
              </Button>
            ) : (
              <Button size="xs" onClick={finish}>
                Skip
              </Button>
            )}
            <Button size="xs" variant="gold" onClick={next} icon={index >= steps.length - 1 ? "check" : "arrow-right"}>
              {index >= steps.length - 1 ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/** Floating Guide button — shown on every page, every size. */
export const GuideButton = () => {
  const { active, start, stop } = useTour();
  return (
    <button type="button" className={`guide-fab ${active ? "on" : ""}`} onClick={active ? stop : start} aria-pressed={active} aria-label={active ? "Turn the guide off" : "Turn the guide on"} title={active ? "Guide: on" : "Guide: show me around"}>
      <Icon name="help" />
      <span>Guide</span>
    </button>
  );
};
