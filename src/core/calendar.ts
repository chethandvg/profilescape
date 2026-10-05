import type { ContributionDay, ProfileData } from './types.ts';

export interface CalendarCell {
  /** 0-based week column, Sunday-aligned like GitHub's calendar. */
  week: number;
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  date: string;
  count: number;
}

export type Level = 0 | 1 | 2 | 3 | 4;

const DAY = 86_400_000;

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const parseDate = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export function countsByDate(calendar: ContributionDay[]): Map<string, number> {
  return new Map(calendar.map((d) => [d.date, d.count]));
}

/** The last `weeks` calendar weeks ending today (UTC), Sunday-aligned. */
export function yearWindow(calendar: ContributionDay[], now: Date, weeks = 53): CalendarCell[] {
  const today = parseDate(isoDate(now));
  const start = today.getTime() - (today.getUTCDay() + (weeks - 1) * 7) * DAY;
  const counts = countsByDate(calendar);
  const cells: CalendarCell[] = [];
  for (let t = start, i = 0; t <= today.getTime(); t += DAY, i++) {
    const date = isoDate(new Date(t));
    cells.push({ week: Math.floor(i / 7), day: i % 7, date, count: counts.get(date) ?? 0 });
  }
  return cells;
}

/**
 * First day of GitHub's "last year": the same date one year before today
 * (UTC), so the window runs from there through today inclusive (366 days, 367
 * across a 29 February). A 29 February today starts from 28 February.
 */
export function yearStart(now: Date): string {
  const today = parseDate(isoDate(now));
  const y = today.getUTCFullYear() - 1;
  const m = today.getUTCMonth();
  const start = new Date(Date.UTC(y, m, today.getUTCDate()));
  return isoDate(start.getUTCMonth() === m ? start : new Date(Date.UTC(y, m + 1, 0)));
}

const cleanCount = (c: unknown): number => (typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : 0);

/** Every day of GitHub's "last year" (yearStart() through today), zero-filled, with invalid counts read as 0. */
export function lastYear(calendar: ContributionDay[], now: Date): ContributionDay[] {
  const counts = countsByDate(Array.isArray(calendar) ? calendar.filter((d) => d && typeof d.date === 'string') : []);
  const end = parseDate(isoDate(now)).getTime();
  const days: ContributionDay[] = [];
  for (let t = parseDate(yearStart(now)).getTime(); t <= end; t += DAY) {
    const date = isoDate(new Date(t));
    days.push({ date, count: cleanCount(counts.get(date)) });
  }
  return days;
}

/**
 * Contributions in the last year, the one figure every card states: GitHub's
 * own total when the profile carries one, otherwise the calendar summed over
 * lastYear(). Both cover the same window, so the stats, 3D and grid cards
 * always agree with each other and with the profile page.
 */
export function yearTotal(data: Pick<ProfileData, 'calendar' | 'year'>, now: Date): number {
  return cleanCount(data.year?.contributions) || totalOf(lastYear(data.calendar, now));
}

/** A month label on a Sunday-aligned week grid: `week` is the column it starts at, `month` is 0-based. */
export interface MonthStart {
  week: number;
  month: number;
}

/**
 * Month labels for a week grid, shared by the grid and 3D cards so both frame
 * the year the same way. A month is labelled at the first column whose Sunday
 * falls in it. The partial month in the first column is labelled only when the
 * next label is at least `minGap` columns away, and a final month with fewer
 * than `minTail` columns is left unlabelled.
 */
export function monthStarts(cells: CalendarCell[], weeks: number, minGap: number, minTail = 2): MonthStart[] {
  const starts: MonthStart[] = [];
  let prev = -1;
  for (let w = 0; w < weeks; w++) {
    const first = cells.find((c) => c.week === w);
    if (!first) continue;
    const month = Number(first.date.slice(5, 7)) - 1;
    if (month !== prev) starts.push({ week: w, month });
    prev = month;
  }
  return starts.filter((s, i) => {
    const next = starts[i + 1];
    if (i === 0 && next && next.week - s.week < minGap) return false;
    return !(i > 0 && !next && weeks - s.week < minTail);
  });
}

/**
 * Current and longest streaks over the whole calendar. A day without
 * contributions *today* does not break the current streak yet.
 */
export function streaks(calendar: ContributionDay[], now: Date): { current: number; longest: number } {
  const today = isoDate(now);
  const days = calendar.filter((d) => d.date <= today);
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (!d) break;
    if (d.count > 0) current++;
    else if (i === days.length - 1 && d.date === today) continue;
    else break;
  }
  return { current, longest };
}

/** GitHub-style quartile levels computed from the non-zero counts. */
export function levelScale(counts: number[]): (count: number) => Level {
  const nz = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (!nz.length) return () => 0;
  const q = [0.25, 0.5, 0.75].map((p) => nz[Math.min(nz.length - 1, Math.floor(nz.length * p))] ?? 0);
  return (c) => {
    if (c <= 0) return 0;
    if (c <= (q[0] ?? 0)) return 1;
    if (c <= (q[1] ?? 0)) return 2;
    if (c <= (q[2] ?? 0)) return 3;
    return 4;
  };
}

/** Sum per week column. */
export function weeklyTotals(cells: CalendarCell[]): number[] {
  const out: number[] = [];
  for (const c of cells) out[c.week] = (out[c.week] ?? 0) + c.count;
  return Array.from(out, (v) => v ?? 0);
}

export const totalOf = (days: { count: number }[]): number => days.reduce((s, d) => s + d.count, 0);
