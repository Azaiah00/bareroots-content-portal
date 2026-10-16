import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Deliverable, Idea, RawAsset, Session, StateResponse } from "@shared/types";
import { api, ApiError, getToken, onUnauthorized, setToken } from "./api";

/**
 * One context for the whole portal: session, the full state document, a
 * refresh function and a few optimistic helpers. The state is small (a few
 * hundred records) so re-fetching it after each action is simpler and more
 * reliable than patching caches.
 */

export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
}

interface PortalCtx {
  session: Session | null;
  state: StateResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signIn: (pin: string, name: string) => Promise<void>;
  signOut: () => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
  /** Resolve a poster key to a URL from the last state load. */
  preview: (key?: string) => string | undefined;
  /** Replace one record in-place (optimistic UI), then refresh quietly. */
  patchDeliverable: (d: Deliverable) => void;
  patchIdea: (i: Idea) => void;
  patchRaw: (r: RawAsset) => void;
  unread: number;
  markRead: () => void;
}

const Ctx = createContext<PortalCtx | null>(null);

const LAST_SEEN_KEY = "br-portal-last-seen";

export const PortalProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(getToken()));
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastSeen, setLastSeen] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
    } catch {
      return 0;
    }
  });
  const inflight = useRef<Promise<void> | null>(null);

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setSession(null);
      setState(null);
      setLoading(false);
      return;
    }
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        const s = await api<StateResponse>("/api/state");
        setState(s);
        setSession(s.session);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setSession(null);
          setState(null);
        } else {
          setError(err instanceof Error ? err.message : "Could not load the portal.");
        }
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    refresh();
    const off = onUnauthorized(() => {
      setSession(null);
      setState(null);
    });
    return () => {
      off();
    };
  }, [refresh]);

  // Keep the portal fresh while it's open: refetch on focus and every 90s.
  useEffect(() => {
    if (!session) return;
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 90_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearInterval(t);
    };
  }, [session, refresh]);

  const signIn = useCallback(
    async (pin: string, name: string) => {
      const res = await api<{ token: string; session: Session }>("/api/auth", { method: "POST", json: { pin, name } });
      setToken(res.token);
      setSession(res.session);
      setLoading(true);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    setToken(null);
    setSession(null);
    setState(null);
  }, []);

  const preview = useCallback((key?: string) => (key && state?.previews[key]) || undefined, [state]);

  const patchDeliverable = useCallback((d: Deliverable) => {
    setState((s) => (s ? { ...s, deliverables: s.deliverables.some((x) => x.id === d.id) ? s.deliverables.map((x) => (x.id === d.id ? d : x)) : [d, ...s.deliverables] } : s));
  }, []);
  const patchIdea = useCallback((i: Idea) => {
    setState((s) => (s ? { ...s, ideas: s.ideas.some((x) => x.id === i.id) ? s.ideas.map((x) => (x.id === i.id ? i : x)) : [i, ...s.ideas] } : s));
  }, []);
  const patchRaw = useCallback((r: RawAsset) => {
    setState((s) => (s ? { ...s, raw: s.raw.some((x) => x.id === r.id) ? s.raw.map((x) => (x.id === r.id ? r : x)) : [r, ...s.raw] } : s));
  }, []);

  const unread = useMemo(() => {
    if (!state || !session) return 0;
    return state.activity.filter((a) => Date.parse(a.at) > lastSeen && a.who !== session.name && a.type !== "session.joined").length;
  }, [state, session, lastSeen]);

  const markRead = useCallback(() => {
    const now = Date.now();
    setLastSeen(now);
    try {
      localStorage.setItem(LAST_SEEN_KEY, String(now));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<PortalCtx>(
    () => ({ session, state, loading, error, refresh, signIn, signOut, toasts, toast, preview, patchDeliverable, patchIdea, patchRaw, unread, markRead }),
    [session, state, loading, error, refresh, signIn, signOut, toasts, toast, preview, patchDeliverable, patchIdea, patchRaw, unread, markRead],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const usePortal = (): PortalCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePortal outside provider");
  return c;
};
