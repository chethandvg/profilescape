import { isoDate, lastYear, streaks, yearTotal } from '../core/calendar.ts';
import { compact, monthYear, MONTHS, plural } from '../core/format.ts';
import { own, readOptions } from '../core/options.ts';
import { delay as at, esc, fit, fitLabel, label, mix, n, shell, textWidth } from '../core/svg.ts';
import { contribRamp } from '../core/themes.ts';
import type { CardDefinition, Palette, ProfileData, RenderContext } from '../core/types.ts';

/**
 * Stats card: a gradient hero number (contributions in the last 12 months),
 * a configurable grid of metric tiles and rolling weekly contribution bars.
 */

const DAY = 86_400_000;
const W = 1200;
const PAD = 40;
const TILE_H = 74;
const GAP = 12;
const HERO_SIZE = 58;
const LABEL_SIZE = 11;
const LABEL_SPACING = 0.8;

export const METRIC_KEYS = [
  'currentStreak',
  'longestStreak',
  'commits',
  'pullRequests',
  'issues',
  'reviews',
  'allTime',
  'bestWeek',
  'bestDay',
  'activeDays',
  'years',
  'stars',
  'followers',
  'repos',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const DEFAULT_METRICS: MetricKey[] = ['currentStreak', 'longestStreak', 'commits', 'allTime', 'bestWeek', 'years'];
export const MAX_METRICS = 9;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

const LOOKUP: Record<string, MetricKey> = {
  ...Object.fromEntries(METRIC_KEYS.map((k) => [normalize(k), k])),
  streak: 'currentStreak',
  prs: 'pullRequests',
  pulls: 'pullRequests',
  pullrequest: 'pullRequests',
  issue: 'issues',
  review: 'reviews',
  total: 'allTime',
  alltimecontributions: 'allTime',
  year: 'years',
  age: 'years',
  yearsongithub: 'years',
  star: 'stars',
  follower: 'followers',
  repo: 'repos',
  repositories: 'repos',
  publicrepos: 'repos',
  publicrepocount: 'repos',
};

/** Resolve user input (any case, kebab/snake case, common aliases) into unique metric keys, max 9. */
export function parseMetrics(input: string[]): MetricKey[] {
  const out: MetricKey[] = [];
  for (const raw of input) {
    const key = own(LOOKUP, normalize(raw));
    if (key && !out.includes(key)) out.push(key);
  }
  return out.slice(0, MAX_METRICS);
}

// ── Facts ───────────────────────────────────────────────────────────────────

export interface StatsFacts {
  /** Contributions in the last 12 months (GitHub's total, falling back to the calendar). */
  yearTotal: number;
  current: number;
  longest: number;
  /** Sum of the whole calendar. */
  allTime: number;
  /** Year the all-time total starts counting from, when known. */
  since: string | null;
  /** 52 rolling 7-day totals, oldest first; the last one ends today. */
  weeks: number[];
  /** First day covered by `weeks`. */
  weeksStart: string;
  bestWeek: number;
  bestDay: { count: number; date: string | null };
  activeDays: number;
  windowDays: number;
  age: { value: number; unit: 'year' | 'month' | 'day' };
  commits: number;
  pullRequests: number;
  issues: number;
  reviews: number;
  stars: number;
  followers: number;
  repos: number;
}

const safe = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function computeFacts(data: ProfileData, now: Date): StatsFacts {
  const today = isoDate(now);
  const calendar = (Array.isArray(data.calendar) ? data.calendar : [])
    .filter((d) => d && typeof d.date === 'string' && d.date.slice(0, 10) <= today)
    .map((d) => ({ date: d.date.slice(0, 10), count: safe(d.count) }));
  // GitHub's "last year" (shared with the 3D and grid cards), so every card states the same figures.
  const year = lastYear(calendar, now);
  const rolling = year.slice(-364); // 52 full weeks ending today
  const weeks = Array.from({ length: 52 }, (_, w) => rolling.slice(w * 7, w * 7 + 7).reduce((s, d) => s + d.count, 0));

  let bestDay: StatsFacts['bestDay'] = { count: 0, date: null };
  for (const d of year) if (d.count > bestDay.count) bestDay = { count: d.count, date: d.date };

  const { current, longest } = streaks(calendar, now);
  const allTime = calendar.reduce((s, d) => s + d.count, 0);

  const created = Date.parse(data.createdAt);
  const ageDays = Number.isFinite(created) ? Math.max(0, Math.floor((now.getTime() - created) / DAY)) : 0;
  const years = Math.floor(ageDays / 365.25);
  const age: StatsFacts['age'] =
    years >= 1
      ? { value: years, unit: 'year' }
      : ageDays >= 31
        ? { value: Math.floor(ageDays / 30.44), unit: 'month' }
        : { value: ageDays, unit: 'day' };

  // The calendar may hold only the last year; never claim more history than it covers.
  const createdYear = Number.isFinite(created) ? new Date(created).toISOString().slice(0, 4) : '';
  const firstYear = calendar[0]?.date.slice(0, 4) ?? '';
  const since = allTime > 0 ? [createdYear, firstYear].filter(Boolean).sort().pop() ?? null : null;

  const y = data.year;
  return {
    yearTotal: yearTotal({ calendar, year: y }, now),
    current,
    longest,
    allTime,
    since,
    weeks,
    weeksStart: rolling[0]?.date ?? today,
    bestWeek: Math.max(0, ...weeks),
    bestDay,
    activeDays: year.filter((d) => d.count > 0).length,
    windowDays: year.length,
    age,
    commits: safe(y?.commits),
    pullRequests: safe(y?.pullRequests),
    issues: safe(y?.issues),
    reviews: safe(y?.reviews),
    stars: safe(data.totalStars),
    followers: safe(data.followers),
    repos: safe(data.publicRepoCount),
  };
}

// ── Tiles ───────────────────────────────────────────────────────────────────

export interface Tile {
  key: MetricKey;
  label: string;
  value: string;
  unit: string;
  icon: string;
}

const PAST_YEAR = 'past year';

function shortDay(iso: string): string {
  const [, m = '1', d = '1'] = iso.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`;
}

export function buildTile(key: MetricKey, f: StatsFacts): Tile {
  const t = (label: string, value: number, unit: string, icon: string): Tile => ({ key, label, value: compact(value), unit, icon });
  switch (key) {
    case 'currentStreak':
      return t('Current streak', f.current, plural(f.current, 'day'), 'flame');
    case 'longestStreak':
      return t('Longest streak', f.longest, plural(f.longest, 'day'), 'trophy');
    case 'commits':
      return t('Commits', f.commits, PAST_YEAR, 'commit');
    case 'pullRequests':
      return t('Pull requests', f.pullRequests, PAST_YEAR, 'pr');
    case 'issues':
      return t('Issues', f.issues, PAST_YEAR, 'issue');
    case 'reviews':
      return t('Reviews', f.reviews, PAST_YEAR, 'eye');
    case 'allTime':
      return t('All-time', f.allTime, f.since ? `since ${f.since}` : 'total', 'layers');
    case 'bestWeek':
      return t('Best week', f.bestWeek, 'in 7 days', 'bars');
    case 'bestDay':
      return t('Best day', f.bestDay.count, f.bestDay.date ? `on ${shortDay(f.bestDay.date)}` : '', 'bolt');
    case 'activeDays':
      return t('Active days', f.activeDays, `of ${f.windowDays}`, 'calendar');
    case 'years':
      return t('On GitHub', f.age.value, plural(f.age.value, f.age.unit), 'clock');
    case 'stars':
      return t('Stars', f.stars, 'earned', 'star');
    case 'followers':
      return t('Followers', f.followers, '', 'people');
    case 'repos':
      return t('Repositories', f.repos, 'public', 'repo');
  }
}

// ── Icons (16×16 line glyphs) ───────────────────────────────────────────────

const ring = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

const ICONS: Record<string, string> = {
  flame: 'M8 1.6c1.4 2.5 4.3 4 4.3 7.7A4.3 4.3 0 0 1 3.7 9.3c0-2 1-3.3 2.2-4.2.1 1.4.8 2.4 1.8 2.8C7.3 5.9 7.3 3.7 8 1.6Z',
  trophy: 'M5 2h6v4a3 3 0 0 1-6 0V2Z M5 3.4H2.6a2.4 2.4 0 0 0 2.7 3.1 M11 3.4h2.4a2.4 2.4 0 0 1-2.7 3.1 M8 9v3.4 M5 14.2h6',
  commit: `${ring(8, 8, 2.7)} M1.2 8h4.1 M10.7 8h4.1`,
  pr: `${ring(4, 3.4, 1.7)} ${ring(4, 12.6, 1.7)} ${ring(12, 12.6, 1.7)} M4 5.1v5.8 M12 10.9V6.4a2 2 0 0 0-2-2H7.2 M8.9 2.7 7.2 4.4l1.7 1.7`,
  issue: `${ring(8, 8, 6.3)} ${ring(8, 8, 0.6)}`,
  eye: `M1.3 8S3.8 3.3 8 3.3 14.7 8 14.7 8 12.2 12.7 8 12.7 1.3 8 1.3 8Z ${ring(8, 8, 2.2)}`,
  layers: 'M8 1.7l6.3 3.2L8 8.1 1.7 4.9 8 1.7Z M1.7 8.1 8 11.3l6.3-3.2 M1.7 11.3 8 14.5l6.3-3.2',
  bars: 'M2 14.3h12 M4.2 11.6V8.2 M8 11.6V2.4 M11.8 11.6V5.6',
  bolt: 'M9.3 1.4 3.4 9.1h4.4l-1 5.5 5.9-7.7H8.3l1-5.5Z',
  calendar: 'M3.6 2.9h8.8a1.6 1.6 0 0 1 1.6 1.6v8.1a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 12.6V4.5a1.6 1.6 0 0 1 1.6-1.6Z M2 6.6h12 M5.3 1.4v2.8 M10.7 1.4v2.8 M5.7 10.3l1.6 1.5 3-3.1',
  clock: `${ring(8, 8, 6.3)} M8 4.4V8l2.4 1.6`,
  star: 'M8 1.5l2 4 4.4.7-3.2 3.1.8 4.4L8 11.6l-4 2.1.8-4.4-3.2-3.1 4.4-.7 2-4Z',
  people: `${ring(6, 5.1, 2.5)} M1.4 13.9a4.6 4.6 0 0 1 9.2 0 M10.7 2.8a2.5 2.5 0 0 1 0 4.7 M12.3 9.5a4.6 4.6 0 0 1 2.3 4.4`,
  repo: 'M3 12.9V3.2a1.7 1.7 0 0 1 1.7-1.7H13v10.1H4.6A1.6 1.6 0 0 0 3 13.2a1.3 1.3 0 0 0 1.3 1.3H13 M6 4.6h4.2',
};

function icon(name: string, x: number, y: number, size: number, color: string): string {
  const d = ICONS[name];
  if (!d) return '';
  return `<path transform="translate(${n(x)} ${n(y)}) scale(${n(size / 16, 3)})" d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function tileSvg(t: Tile, x: number, y: number, w: number, p: Palette, index: number): string {
  const inner = w - 32;
  const labelText = fitLabel(t.label.toUpperCase(), inner - 21, { size: LABEL_SIZE, spacing: LABEL_SPACING });
  const unitW = t.unit ? textWidth(t.unit, 13) + 6 : 0;
  let size = 26;
  const valueW = (s: number) => textWidth(t.value, s, { weight: 700 }) - 0.5 * t.value.length;
  while (size > 18 && valueW(size) + unitW > inner) size--;
  const unit = t.unit && valueW(size) + unitW > inner ? fit(t.unit, Math.max(0, inner - valueW(size) - 6), 13) : t.unit;
  const unitSvg = unit ? `<tspan dx="6" font-size="13" fill="${p.muted}">${esc(unit)}</tspan>` : '';
  return (
    `<g class="up" ${at(0.12 + index * 0.05)}>` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${TILE_H}" rx="12" fill="${p.panelAlt}" stroke="${p.border}"/>` +
    icon(t.icon, x + 16, y + 15, 14, p.accentB) +
    `<text x="${n(x + 37)}" y="${n(y + 26.5)}" class="mono" font-size="${LABEL_SIZE}" letter-spacing="${LABEL_SPACING}" fill="${p.muted}">${esc(labelText)}</text>` +
    `<text x="${n(x + 16)}" y="${n(y + 58)}" class="sans"><tspan font-size="${size}" font-weight="700" letter-spacing="-.5" fill="${p.text}">${esc(t.value)}</tspan>${unitSvg}</text>` +
    '</g>'
  );
}

function tileGrid(tiles: Tile[], x: number, y: number, width: number, p: Palette): { svg: string; height: number } {
  if (!tiles.length) return { svg: '', height: 0 };
  const cols = tiles.length === 4 ? 2 : 3;
  const rows = Math.ceil(tiles.length / cols);
  const w = (width - (cols - 1) * GAP) / cols;
  const svg = tiles
    .map((t, i) => tileSvg(t, x + (i % cols) * (w + GAP), y + Math.floor(i / cols) * (TILE_H + GAP), w, p, i))
    .join('');
  return { svg, height: rows * TILE_H + (rows - 1) * GAP };
}

function heroNumber(value: number): string {
  return value < 1_000_000 ? Math.round(value).toLocaleString('en-US') : compact(value);
}

/** The gradient hero number with its unit; returns markup plus the gradient definition. */
function hero(total: number, x: number, baseline: number, maxWidth: number, p: Palette): { svg: string; defs: string } {
  const text = heroNumber(total);
  const unit = plural(total, 'contribution');
  let size = HERO_SIZE;
  const numberW = (s: number) => textWidth(text, s, { weight: 800 }) - 2 * [...text].length;
  const unitW = textWidth(unit, 18) + 12;
  while (size > 36 && numberW(size) + unitW > maxWidth) size -= 2;
  const defs =
    `<linearGradient id="st-hero" gradientUnits="userSpaceOnUse" x1="${n(x)}" y1="0" x2="${n(x + Math.max(40, numberW(size)))}" y2="0">` +
    `<stop offset="0" stop-color="${p.accentA}"/><stop offset="1" stop-color="${p.accentB}"/></linearGradient>`;
  const svg =
    `<text x="${n(x)}" y="${n(baseline)}" class="sans up" ${at(0.05)}>` +
    `<tspan font-size="${size}" font-weight="800" letter-spacing="-2" fill="url(#st-hero)">${esc(text)}</tspan>` +
    `<tspan dx="12" font-size="18" fill="${p.muted}">${esc(unit)}</tspan></text>`;
  return { svg, defs };
}

interface ChartBox {
  x: number;
  width: number;
  /** Baseline of the optional "WEEKLY CONTRIBUTIONS" header. */
  headerY: number | null;
  top: number;
  bottom: number;
  axisY: number;
}

function weeklyChart(f: StatsFacts, box: ChartBox, ctx: RenderContext): { svg: string; defs: string } {
  const p = ctx.palette;
  const ramp = contribRamp(p, ctx.mode);
  const { x: x0, width: cw, top, bottom } = box;
  const bh = bottom - top;
  const weeks = f.weeks;
  const peak = Math.max(0, ...weeks);
  const step = cw / weeks.length;
  const bw = Math.max(2, step * 0.66);
  const rx = Math.min(3, bw / 2);
  const parts: string[] = [];

  if (box.headerY !== null) {
    parts.push(label(x0, box.headerY, 'Weekly contributions', p, { color: p.muted }));
  }

  // Faint guide lines at half and full peak height.
  if (peak > 0) {
    for (const k of [0.5, 1]) {
      const gy = bottom - bh * k;
      parts.push(`<line x1="${n(x0)}" y1="${n(gy)}" x2="${n(x0 + cw)}" y2="${n(gy)}" stroke="${p.grid}" stroke-opacity="${n(p.gridOpacity * 1.6, 3)}"/>`);
    }
  }

  // Bars: one gradient in chart space so taller weeks reach the brighter end of the ramp.
  const defs =
    `<linearGradient id="st-bars" gradientUnits="userSpaceOnUse" x1="0" y1="${n(bottom)}" x2="0" y2="${n(top)}">` +
    `<stop offset="0" stop-color="${ramp[1]}"/><stop offset=".38" stop-color="${ramp[2]}"/>` +
    `<stop offset=".72" stop-color="${ramp[3]}"/><stop offset="1" stop-color="${ramp[4]}"/></linearGradient>`;
  weeks.forEach((v, i) => {
    const x = x0 + i * step + (step - bw) / 2;
    if (v <= 0 || peak <= 0) {
      parts.push(`<rect x="${n(x)}" y="${n(bottom - 3)}" width="${n(bw)}" height="3" rx="1.5" fill="${p.empty}"/>`);
      return;
    }
    const h = Math.max(4, (v / peak) * bh);
    parts.push(
      `<rect class="st-bar" ${at(0.25 + i * 0.012)} x="${n(x)}" y="${n(bottom - h)}" width="${n(bw)}" height="${n(h)}" rx="${n(rx)}" fill="url(#st-bars)"/>`,
    );
  });

  if (peak > 0) {
    // Dashed average line, with its legend centred in the axis row below.
    const avg = weeks.reduce((s, v) => s + v, 0) / weeks.length;
    const avgY = bottom - (avg / peak) * bh;
    const avgText = `avg ${compact(avg)} / week`;
    const lw = 22 + textWidth(avgText, 11.5, { mono: true });
    const lx = x0 + (cw - lw) / 2;
    parts.push(
      `<line class="fade" ${at(0.9)} x1="${n(x0)}" y1="${n(avgY)}" x2="${n(x0 + cw)}" y2="${n(avgY)}" stroke="${p.muted}" stroke-opacity=".7" stroke-dasharray="3 4"/>`,
      `<g class="fade" ${at(0.9)}><line x1="${n(lx)}" y1="${n(box.axisY - 4)}" x2="${n(lx + 14)}" y2="${n(box.axisY - 4)}" stroke="${p.muted}" stroke-dasharray="3 3"/>` +
        `<text x="${n(lx + 22)}" y="${n(box.axisY)}" class="mono" font-size="11.5" fill="${p.muted}">${esc(avgText)}</text></g>`,
    );

    // Peak annotation above the busiest week (clamped inside the chart).
    const pi = weeks.indexOf(peak);
    const peakText = `peak ${compact(peak)}`;
    const pw = textWidth(peakText, 11, { mono: true });
    const pcx = Math.min(x0 + cw - pw / 2, Math.max(x0 + pw / 2, x0 + pi * step + step / 2));
    parts.push(
      `<text class="mono fade" ${at(0.9)} x="${n(pcx)}" y="${n(top - 8)}" text-anchor="middle" font-size="11" fill="${p.muted}">${esc(peakText)}</text>`,
    );
  } else {
    const cy = top + bh / 2;
    parts.push(
      `<g class="fade" ${at(0.3)}><text x="${n(x0 + cw / 2)}" y="${n(cy - 4)}" text-anchor="middle" class="sans" font-size="16" font-weight="600" fill="${p.text}">No contributions yet</text>` +
        `<text x="${n(x0 + cw / 2)}" y="${n(cy + 18)}" text-anchor="middle" class="sans" font-size="13" fill="${p.muted}">Each week of activity will rise here as a bar.</text></g>`,
    );
  }

  parts.push(
    `<text x="${n(x0)}" y="${n(box.axisY)}" class="mono" font-size="11.5" fill="${p.muted}">${esc(monthYear(f.weeksStart))}</text>`,
    `<text x="${n(x0 + cw)}" y="${n(box.axisY)}" text-anchor="end" class="mono" font-size="11.5" fill="${p.muted}">now</text>`,
  );
  return { svg: parts.join(''), defs };
}

// ── Card ────────────────────────────────────────────────────────────────────

const DEFAULT_TITLE = 'Activity · last 12 months';

function render(ctx: RenderContext) {
  const p = ctx.palette;
  const o = readOptions(ctx.options);
  const chart = o.oneOf('chart', ['weekly', 'none'] as const, 'weekly');
  const showTitle = !o.boolean('hideTitle', false);
  const title = o.optionalString('title') ?? DEFAULT_TITLE;
  const keys = parseMetrics(o.list('metrics', DEFAULT_METRICS));
  const facts = computeFacts(ctx.data, ctx.now);
  const tiles = (keys.length ? keys : DEFAULT_METRICS).map((k) => buildTile(k, facts));

  const heroTop = showTitle ? 80 : PAD;
  const heroBaseline = heroTop + 43;
  const parts: string[] = [];
  const defs: string[] = [];
  let H: number;

  if (chart === 'weekly') {
    const leftW = 504;
    const dividerX = PAD + leftW + 40;
    const chartX = dividerX + 40;
    if (showTitle) parts.push(label(PAD, 56, fitLabel(title, leftW), p));
    const h = hero(facts.yearTotal, PAD, heroBaseline, leftW, p);
    defs.push(h.defs);
    parts.push(h.svg);
    const tilesTop = heroBaseline + 28;
    const grid = tileGrid(tiles, PAD, tilesTop, leftW, p);
    parts.push(grid.svg);
    H = tilesTop + grid.height + PAD;
    parts.push(`<line x1="${dividerX}" y1="${PAD}" x2="${dividerX}" y2="${n(H - PAD)}" stroke="${p.border}"/>`);
    const axisY = H - PAD - 2;
    const top = (showTitle ? 78 : PAD) + 22;
    const c = weeklyChart(facts, { x: chartX, width: W - PAD - chartX, headerY: showTitle ? 56 : null, top, bottom: axisY - 22, axisY }, ctx);
    defs.push(c.defs);
    parts.push(c.svg);
  } else {
    // Compact numbers-only layout: hero on the left, tiles on the right.
    const leftW = 360;
    const dividerX = PAD + leftW + 40;
    const tilesX = dividerX + 40;
    const heroBlock = (showTitle ? 40 : 0) + 43;
    const rows = Math.ceil(tiles.length / (tiles.length === 4 ? 2 : 3));
    const gridH = rows * TILE_H + (rows - 1) * GAP;
    const contentH = Math.max(heroBlock + 14, gridH);
    H = PAD * 2 + contentH;
    const blockTop = PAD + (contentH - heroBlock) / 2 - 4;
    if (showTitle) parts.push(label(PAD, blockTop + 12, fitLabel(title, leftW), p));
    const h = hero(facts.yearTotal, PAD, blockTop + heroBlock, leftW, p);
    defs.push(h.defs);
    parts.push(h.svg);
    parts.push(`<line x1="${dividerX}" y1="${PAD}" x2="${dividerX}" y2="${n(H - PAD)}" stroke="${p.border}"/>`);
    parts.push(tileGrid(tiles, tilesX, PAD + (contentH - gridH) / 2, W - PAD - tilesX, p).svg);
  }

  const who = ctx.data.name || ctx.data.login || 'GitHub user';
  const summary = tiles.map((t) => `${t.label}: ${t.value}${t.unit ? ` ${t.unit}` : ''}`).join(', ');
  const headline = `${heroNumber(facts.yearTotal)} ${plural(facts.yearTotal, 'contribution')} in the last 12 months`;
  const style =
    '.st-bar{transform-box:fill-box;transform-origin:50% 100%;animation:st-grow .9s cubic-bezier(.2,.7,.2,1) backwards}' +
    '@keyframes st-grow{from{transform:scaleY(0)}}';

  const svg = shell({
    width: W,
    height: H,
    palette: p,
    title: `${who}'s GitHub stats: ${headline}`,
    desc: summary,
    defs: defs.join(''),
    style,
    body: parts.join(''),
    radius: 20,
    glow: { cx: 1, cy: 0, r: 1, color: p.accentB, opacity: p.glowOpacity * 0.35 },
    animate: ctx.animate,
  });
  return [{ name: 'stats', alt: `GitHub stats: ${headline}. ${summary}.`, svg, layout: 'full' as const }];
}

export const card: CardDefinition = {
  id: 'stats',
  title: 'Stats',
  description:
    'Your last 12 months at a glance: a gradient hero number, a grid of metric tiles you pick and order (streaks, commits, PRs, stars and more) and a weekly contribution chart.',
  options: [
    {
      key: 'metrics',
      type: 'list',
      default: DEFAULT_METRICS,
      description: `Tiles to show, in order (3 to 9, laid out in rows of 3). Any of: ${METRIC_KEYS.join(', ')}.`,
    },
    { key: 'chart', type: 'string', default: 'weekly', description: '"weekly" shows 52 weekly bars; "none" makes a compact, numbers-only card.' },
    { key: 'title', type: 'string', default: DEFAULT_TITLE, description: 'Header label text.' },
    { key: 'hideTitle', type: 'boolean', default: false, description: 'Hide the header label and tighten the layout.' },
  ],
  render,
};
