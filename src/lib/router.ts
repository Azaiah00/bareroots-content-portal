import { useEffect, useState } from "react";

/** Hash router — one link for everyone, works on Netlify with zero config. */

export interface Route {
  path: string;
  parts: string[];
  params: URLSearchParams;
}

export const parseHash = (hash = window.location.hash): Route => {
  const h = hash.replace(/^#\/?/, "");
  const [p, q] = h.split("?");
  const parts = p.split("/").filter(Boolean);
  return { path: parts[0] || "", parts, params: new URLSearchParams(q || "") };
};

export const navigate = (to: string, replace = false) => {
  const target = to.startsWith("#") ? to : `#/${to.replace(/^\//, "")}`;
  if (replace) window.history.replaceState(null, "", target);
  else window.location.hash = target;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
};

export const useRoute = (): Route => {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
};

export const withParam = (route: Route, key: string, value: string | null): string => {
  const params = new URLSearchParams(route.params);
  if (value === null) params.delete(key);
  else params.set(key, value);
  const q = params.toString();
  return `#/${route.parts.join("/")}${q ? `?${q}` : ""}`;
};
