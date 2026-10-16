import { useEffect, useRef, useState } from "react";

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveal-on-enter for a container: every descendant with [data-reveal]
 * gets data-reveal="in" when it scrolls into view. One observer per container.
 */
export const useReveal = <T extends HTMLElement>(deps: unknown[] = []) => {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal='in'])"));
    if (!els.length) return;
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.setAttribute("data-reveal", "in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).setAttribute("data-reveal", "in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
};

/** Returns true once, a tick after mount — for enter animations. */
export const useMounted = () => {
  const [m, setM] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return m;
};
