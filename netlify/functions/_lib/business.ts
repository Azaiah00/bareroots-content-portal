/**
 * Business-day arithmetic for the "one round of revisions, five business days,
 * then approved" clause of the agreement. Weekends are skipped; the clock is
 * evaluated in America/New_York, where Bare Roots is.
 */

const TZ = "America/New_York";

const weekdayIn = (d: Date): number => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
};

/** Returns an ISO timestamp `days` business days after `from` (same clock time). */
export const addBusinessDays = (from: Date, days: number): string => {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = weekdayIn(d);
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return d.toISOString();
};
