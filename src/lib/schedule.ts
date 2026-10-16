import type { Platform } from "@shared/types";

/**
 * Posting-time suggestions for a Richmond, VA salon audience (Eastern time).
 * Slots are [weekday (0=Sun), hour, minute], ordered by preference. The
 * suggester walks forward from tomorrow and picks the first slot that doesn't
 * collide with something already on the calendar for that platform.
 *
 * Sources of the pattern (general industry best-times studies for beauty /
 * local service brands): Instagram Reels perform on weekday late mornings and
 * early evenings, Tue–Thu strongest; TikTok on weekday evenings and Saturday
 * late morning; Facebook on weekday mornings. Treat these as a starting point
 * and let the studio override by hand.
 */

type Slot = [number, number, number];

const SLOTS: Record<Platform, Slot[]> = {
  instagram: [
    [2, 11, 0],
    [3, 11, 0],
    [4, 11, 0],
    [2, 19, 0],
    [4, 19, 0],
    [5, 12, 0],
    [1, 11, 30],
    [6, 10, 30],
    [0, 18, 0],
  ],
  tiktok: [
    [2, 19, 0],
    [4, 19, 0],
    [5, 17, 30],
    [6, 11, 0],
    [1, 19, 0],
    [3, 20, 0],
    [0, 19, 0],
  ],
  facebook: [
    [2, 9, 30],
    [3, 10, 0],
    [4, 9, 30],
    [1, 10, 0],
    [5, 11, 0],
    [6, 10, 0],
    [0, 12, 0],
  ],
};

const TZ = "America/New_York";

const partsIn = (d: Date) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return { y: Number(g("year")), m: Number(g("month")), d: Number(g("day")), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")) };
};

/** ISO instant for a NY wall-clock time on a given NY calendar date. */
const nyInstant = (y: number, m: number, d: number, h: number, mi: number): string => {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(guess));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value || 0);
    const hh = g("hour") === 24 ? 0 : g("hour");
    const wall = Date.UTC(g("year"), g("month") - 1, g("day"), hh, g("minute"));
    const diff = Date.UTC(y, m - 1, d, h, mi) - wall;
    if (!diff) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
};

const dayKeyOf = (iso: string) => {
  const { y, m, d } = partsIn(new Date(iso));
  return `${y}-${m}-${d}`;
};

/**
 * Suggest a post time for `platform`, starting tomorrow, avoiding days that
 * already have a post for that platform (`taken` = ISO times already planned)
 * and keeping at least `minGapHours` from `anchor` (e.g. the Instagram time,
 * so TikTok isn't posted in the same hour).
 */
export const suggestTime = (platform: Platform, taken: string[] = [], anchor?: string, minGapHours = 3, daysAhead = 1): string => {
  const takenDays = new Set(taken.map(dayKeyOf));
  const start = new Date();
  for (let offset = daysAhead; offset < daysAhead + 21; offset++) {
    const day = new Date(start.getTime() + offset * 86400_000);
    const { y, m, d, wd } = partsIn(day);
    const key = `${y}-${m}-${d}`;
    if (takenDays.has(key)) continue;
    const slots = SLOTS[platform].filter((s) => s[0] === wd);
    for (const [, h, mi] of slots) {
      const iso = nyInstant(y, m, d, h, mi);
      if (anchor && Math.abs(Date.parse(iso) - Date.parse(anchor)) < minGapHours * 3600_000) continue;
      return iso;
    }
  }
  // Fallback: tomorrow 11:00
  const { y, m, d } = partsIn(new Date(start.getTime() + 86400_000));
  return nyInstant(y, m, d, 11, 0);
};

export const PLATFORM_TIPS: Record<Platform, string> = {
  instagram: "Post as a Reel with the cover attached, share it to your Story, and reply to every comment in the first hour.",
  tiktok: "Use a trending sound at low volume if it fits, add 3–5 niche hashtags, and reply to comments with a video when you can.",
  facebook: "Post natively (not a link), tag the location, and pin it to the top of the page for the week.",
};

export const CAPTION_LIMITS: Record<Platform, number> = { instagram: 2200, tiktok: 4000, facebook: 63206 };
