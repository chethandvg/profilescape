export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** 1,234 · 12.3k · 1.2M */
export function compact(value: number): string {
  const v = Math.round(value);
  if (Math.abs(v) >= 1_000_000) return `${trim(v / 1_000_000)}M`;
  if (Math.abs(v) >= 10_000) return `${trim(v / 1000)}k`;
  return v.toLocaleString('en-US');
}

function trim(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '');
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

export function percent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

function parts(iso: string): { y: number; m: number; d: number } {
  const [y = '1970', m = '1', d = '1'] = iso.slice(0, 10).split('-');
  return { y: Number(y), m: Number(m), d: Number(d) };
}

/** "Jan 30, 2026" */
export function shortDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${MONTHS[m - 1]} ${String(d).padStart(2, '0')}, ${y}`;
}

/** "Jan 2026" */
export function monthYear(iso: string): string {
  const { y, m } = parts(iso);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "3 days ago", "2 months ago", "today" */
export function relativeTime(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ${plural(months, 'month')} ago`;
  const years = Math.floor(days / 365.25);
  return `${years} ${plural(years, 'year')} ago`;
}

/** Whole years between an ISO date and now. */
export function yearsSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / (365.25 * 86_400_000)));
}
