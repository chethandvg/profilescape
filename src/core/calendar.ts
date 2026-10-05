import type { ContributionDay } from './types.ts';

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
