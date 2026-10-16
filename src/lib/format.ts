export const bytes = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};

export const duration = (s?: number): string => {
  if (!s || !Number.isFinite(s)) return "";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const TZ = "America/New_York";

export const fmtDate = (iso?: string, opts: Intl.DateTimeFormatOptions = {}): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", ...opts }).format(d);
};

export const fmtDateTime = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
};

export const fmtTime = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
};

export const fmtWeekday = (iso?: string): string => {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" }).format(new Date(iso));
};

export const relative = (iso?: string): string => {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const m = Math.round(abs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return future ? `in ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return future ? `in ${h} hr` : `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 7) return future ? `in ${d} day${d === 1 ? "" : "s"}` : `${d} day${d === 1 ? "" : "s"} ago`;
  return fmtDate(iso, { year: abs > 300 * 86400000 ? "numeric" : undefined });
};

/** "Thursday, Oct 16 at 11:00 AM" */
export const fmtPlan = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" }).format(d)} at ${fmtTime(iso)}`;
};

/** Local <input type="datetime-local"> value for an ISO string, in New York time. */
export const toLocalInput = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
};

/** Interpret a datetime-local value as New York wall time → ISO. */
export const fromLocalInput = (value: string): string | undefined => {
  if (!value) return undefined;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  // Find the UTC instant whose New York wall time equals the input, by iterating the offset.
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const hh = get("hour") === 24 ? 0 : get("hour");
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), hh, get("minute"));
    const diff = Date.UTC(y, mo - 1, d, h, mi) - wall;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const initials = (name: string) => (name || "?").trim().slice(0, 1).toUpperCase();

export const hashtagsToText = (tags: string[]) => tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");

/** Deterministic small tilt for sticky notes, from an id. */
export const tiltFor = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const t = ((h % 1000) / 1000) * 3 - 1.5;
  return Math.round(t * 10) / 10;
};
