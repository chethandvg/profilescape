import { lastYear, levelScale, monthStarts, parseDate, yearTotal, yearWindow, type CalendarCell, type Level } from '../core/calendar.ts';
import { MONTHS, WEEKDAYS, monthYear, plural, shortDate } from '../core/format.ts';
import { readOptions } from '../core/options.ts';
import { esc, fit, fitLabel, label, labelWidth, linearGradient, mix, n, shade, shell, textWidth, tint } from '../core/svg.ts';
import { contribRamp } from '../core/themes.ts';
import type { CardDefinition, CardImage, OptionDoc, Palette, RenderContext } from '../core/types.ts';

/**
 * The flagship card: the last year of contributions as an isometric landscape.
 * Every day is a bar whose height and colour grow with the work done, standing
 * on a slab with a soft shadow, a glow behind the busiest stretch and a pin on
 * the summit. Insights sit in the empty triangle the isometric slope leaves free.
 */

const W = 1200;
const PAD = 40;
/** Inset of each bar inside its cell, in grid units (leaves a hairline of floor between bars). */
const GAP = 0.1;
/** Slab margin around the grid, in grid units. */
const RIM = 0.55;
/** Slab thickness in px. */
const SLAB = 10;
/** Height of a one-contribution day, in px. */
const MIN_H = 3;
/** Breathing room between bars (at their tallest possible) and the header/insights. */
const CLEARANCE = 24;
/** Insights: two columns in the top-right corner. */
const COL_W = 200;
const INS_X = W - PAD - 2 * COL_W;
const ROW_H = 84;
/** Header label baseline, shared by every full-width card. */
const TOP = 56;

const SCALES = ['sqrt', 'linear', 'log'] as const;
type Scale = (typeof SCALES)[number];

const SCALE_NOTE: Record<Scale, string> = {
  sqrt: 'height ∝ √contributions',
  linear: 'height ∝ contributions',
  log: 'height ∝ log contributions',
};

const OPTIONS: OptionDoc[] = [
  { key: 'title', type: 'string', default: 'Contribution landscape', description: 'Header label, shown in small caps above the total.' },
  { key: 'hideTitle', type: 'boolean', default: false, description: 'Hide the header (label and total) for a cleaner embed.' },
  { key: 'insights', type: 'boolean', default: true, description: 'Show best day, busiest month, favourite weekday and active days.' },
  { key: 'peak', type: 'boolean', default: true, description: 'Pin a small callout on the tallest bar (your best day).' },
  { key: 'scale', type: 'string', default: 'sqrt', description: 'Bar height scale: "sqrt" (keeps quiet days visible next to outliers), "linear" or "log".' },
  { key: 'weeks', type: 'number', default: 53, description: 'Number of weeks to show, 26 to 53. Fewer weeks means bigger bars.' },
  { key: 'height', type: 'number', default: 124, description: 'Height of the tallest bar in px, 40 to 240.' },
];

const fmt = (v: number): string => Math.round(v).toLocaleString('en-US');

/** "71%", or "<1%" so a single active day never reads as zero. */
function share(part: number, whole: number): string {
  const pct = whole > 0 ? (part / whole) * 100 : 0;
  return part > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

interface Summary {
  /** Days covered by the summary. */
  days: number;
  total: number;
  peak: number;
  best: CalendarCell | null;
  active: number;
  weekday: { day: number; total: number };
  month: { key: string; total: number };
}

const sanitize = (raw: CalendarCell[]): CalendarCell[] =>
  raw.map((c) => ({ ...c, count: Number.isFinite(c.count) && c.count > 0 ? Math.round(c.count) : 0 }));

function summarize(cells: CalendarCell[]): Summary {
  let total = 0;
  let active = 0;
  let best: CalendarCell | null = null;
  const byDay = [0, 0, 0, 0, 0, 0, 0];
  const byMonth = new Map<string, number>();
  for (const c of cells) {
    total += c.count;
    if (c.count > 0) active++;
    if (c.count > 0 && (!best || c.count > best.count)) best = c;
    byDay[c.day] = (byDay[c.day] ?? 0) + c.count;
    const key = c.date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + c.count);
  }
  const weekday = { day: 0, total: -1 };
  byDay.forEach((t, day) => {
    if (t > weekday.total) Object.assign(weekday, { day, total: t });
  });
  const month = { key: '', total: -1 };
  for (const [key, t] of byMonth) if (t > month.total) Object.assign(month, { key, total: t });
  return { days: cells.length, total, peak: best?.count ?? 0, best, active, weekday, month };
}

function heightFn(scale: Scale, peak: number, maxH: number): (count: number) => number {
  if (peak <= 0) return () => 0;
  const shape =
    scale === 'linear'
      ? (c: number) => c / peak
      : scale === 'log'
        ? (c: number) => Math.log1p(c) / Math.log1p(peak)
        : (c: number) => Math.sqrt(c / peak);
  return (c) => (c > 0 ? MIN_H + (maxH - MIN_H) * Math.min(1, shape(c)) : 0);
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;

/** Colours for one contribution level: top face, front/right side gradients, top highlight. */
function levelColours(p: Palette, dark: boolean) {
  const ramp = contribRamp(p, dark ? 'dark' : 'light');
  return ramp.map((top) => {
    const front = shade(top, dark ? 0.2 : 0.1);
    const right = shade(top, dark ? 0.38 : 0.22);
    return {
      top,
      front,
      frontLow: shade(front, dark ? 0.22 : 0.08),
      right,
      rightLow: shade(right, dark ? 0.24 : 0.08),
      rim: tint(top, dark ? 0.3 : 0.45),
    };
  });
}

function renderLandscape(ctx: RenderContext): CardImage {
  const p = ctx.palette;
  const dark = ctx.mode === 'dark';
  const o = readOptions(ctx.options);
  const weeks = Math.round(o.number('weeks', 53, { min: 26, max: 53 }));
  const maxH = Math.round(o.number('height', 124, { min: 40, max: 240 }));
  const scaleRaw = o.string('scale', 'sqrt').trim().toLowerCase();
  const scale: Scale = (SCALES as readonly string[]).includes(scaleRaw) ? (scaleRaw as Scale) : 'sqrt';
  const showInsights = o.boolean('insights', true);
  const showPeak = o.boolean('peak', true);
  const hideTitle = o.boolean('hideTitle', false);
  const spanPhrase = weeks >= 52 ? 'in the last year' : `in the last ${weeks} weeks`;
  const titleText = o.string('title', 'Contribution landscape');

  // The landscape draws whole weeks (365 to 371 days), but a full-year card
  // states GitHub's "last year", like the stats card: the total and insights
  // cover lastYear() exactly, whatever the weekday.
  const cells = sanitize(yearWindow(ctx.data.calendar, ctx.now, weeks));
  const fullYear = weeks >= 52;
  const counted = fullYear
    ? sanitize(lastYear(ctx.data.calendar, ctx.now).map((d) => ({ ...d, week: 0, day: parseDate(d.date).getUTCDay() })))
    : cells;
  const sum = summarize(counted);
  const total = fullYear ? yearTotal(ctx.data, ctx.now) : sum.total;
  const { peak, best } = sum;
  const peakAll = Math.max(0, ...cells.map((c) => c.count));
  const empty = peakAll === 0;
  const height = heightFn(scale, peakAll, maxH);
  const level = levelScale(cells.map((c) => c.count));
  const colours = levelColours(p, dark);

  // ── Projection ───────────────────────────────────────────────────────────
  // Weeks run right and slightly down, weekdays left and down. Drawing week by
  // week (and day by day inside a week) is a correct painter's order for this
  // projection: any two bars whose silhouettes overlap are ordered by both axes.
  const s = Math.min(1.4, 964 / (weeks * 17 + 63));
  const wx = 17 * s;
  const wy = 5.5 * s;
  const dx = -9 * s;
  const dy = 8 * s;
  const px = (w: number, d: number) => w * wx + d * dx;
  const py = (w: number, d: number) => w * wy + d * dy;

  // Weekday labels sit off the right edge, beside the most recent week: on the
  // left they would be hidden behind the bars that stand in front of them.
  const dayLabelGap = 12;
  const leftExtent = px(-RIM, 7 + RIM);
  const rightExtent = Math.max(px(weeks + RIM, -RIM), px(weeks + RIM, 1.5) + dayLabelGap + textWidth('Mon', 11, { mono: true }));
  const ox = (W - (rightExtent - leftExtent)) / 2 - leftExtent;

  // ── Header & reserved regions ────────────────────────────────────────────
  const reserved: Rect[] = [];
  const headlineValue = fmt(total);
  const headlineRest = `${plural(total, 'contribution')} ${spanPhrase}`;
  const headlineW = textWidth(headlineValue, 36, { weight: 800 }) + 12 + textWidth(headlineRest, 16);
  const labelText = fitLabel(titleText, INS_X - PAD - 40);
  if (!hideTitle) {
    reserved.push({ x0: PAD, y0: PAD - 8, x1: PAD + Math.max(headlineW, labelWidth(labelText)), y1: TOP + 54 });
  }
  const insightsBlock = !empty && showInsights;
  const emptyBlock = empty;
  if (insightsBlock) reserved.push({ x0: INS_X, y0: PAD - 8, x1: W - PAD, y1: TOP + ROW_H + 52 });
  if (emptyBlock) reserved.push({ x0: INS_X, y0: PAD - 8, x1: W - PAD, y1: TOP + 92 });

  // Lowest origin that keeps the tallest *possible* bar clear of every reserved
  // region, so the layout never depends on the day-to-day data and never
  // collides. An empty year has no bars, so it only reserves a little headroom.
  const roomH = empty ? Math.min(maxH, 56) : maxH;
  let oy = PAD + roomH + 6;
  for (const r of reserved) {
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const x0 = ox + px(w + GAP, d + 1 - GAP);
        const x1 = ox + px(w + 1 - GAP, d + GAP);
        if (x1 < r.x0 - 12 || x0 > r.x1 + 12) continue;
        oy = Math.max(oy, r.y1 + CLEARANCE - (py(w + GAP, d + GAP) - roomH));
      }
    }
  }
  oy = Math.round(oy);
  const P = (w: number, d: number, h = 0): [number, number] => [ox + px(w, d), oy + py(w, d) - h];
  const pt = (w: number, d: number, h = 0) => {
    const [x, y] = P(w, d, h);
    return `${n(x)} ${n(y)}`;
  };

  // ── Month labels (along the front edge, below the slab) ─────────────────
  // Same rule as the grid card (shared monthStarts()), so both frame the year alike.
  const minGap = Math.ceil((textWidth('Mmm', 11, { mono: true }) + 8) / wx);
  const monthLabels = monthStarts(cells, weeks, minGap).map((m) => {
    const [x, y] = P(m.week + 0.5, 7 + RIM);
    return { x, y: y + SLAB + 18, text: MONTHS[m.month] ?? '' };
  });

  // ── Card height ─────────────────────────────────────────────────────────
  const slabBottom = P(weeks + RIM, 7 + RIM)[1] + SLAB;
  let H = slabBottom + 40;
  for (const m of monthLabels) H = Math.max(H, m.y + 26);
  const legend = legendParts(empty, peakAll, scale);
  const legendRight = PAD + legend.width;
  const frontAt = (x: number) => {
    const w = Math.max(-RIM, Math.min(weeks + RIM, (x - ox - px(0, 7 + RIM)) / wx));
    return P(w, 7 + RIM)[1] + SLAB + 22;
  };
  H = Math.max(H, frontAt(legendRight) + 20 + 34);
  H = Math.round(H);
  const legendY = H - 34;

  // ── Defs & style ────────────────────────────────────────────────────────
  const grads = colours
    .slice(1)
    .map(
      (c, i) =>
        linearGradient(`ps3d-f${i + 1}`, c.front, c.frontLow, true) + linearGradient(`ps3d-r${i + 1}`, c.right, c.rightLow, true),
    )
    .join('');
  const defs =
    grads +
    linearGradient('ps3d-accent', p.accentA, p.accentB) +
    `<filter id="ps3d-blur" x="-15%" y="-40%" width="130%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>`;
  const levelCss = colours
    .slice(1)
    .map(
      (c, i) =>
        `.t${i + 1}{fill:${c.top};stroke:${c.rim}}.f${i + 1}{fill:url(#ps3d-f${i + 1})}.r${i + 1}{fill:url(#ps3d-r${i + 1})}`,
    )
    .join('');
  const stagger = 1.05 / weeks;
  const style =
    `.t1,.t2,.t3,.t4{stroke-width:.6;stroke-linejoin:round}${levelCss}` +
    '.wk{animation:ps3d-rise .9s cubic-bezier(.2,.7,.2,1) backwards}@keyframes ps3d-rise{from{opacity:0;transform:translateY(28px)}}' +
    '.pin{animation:ps3d-drop .7s cubic-bezier(.2,.7,.2,1) backwards}@keyframes ps3d-drop{from{opacity:0;transform:translateY(-8px)}}';

  // ── Slab, shadow and floor tiles ────────────────────────────────────────
  const slabTop = mix(p.panel, p.empty, 0.45);
  const slabFront = dark ? mix(p.panel, p.border, 0.75) : shade(p.empty, 0.07);
  const slabRight = dark ? mix(p.panel, p.border, 0.4) : shade(p.empty, 0.14);
  const a0 = pt(-RIM, -RIM);
  const b0 = pt(weeks + RIM, -RIM);
  const c0 = pt(weeks + RIM, 7 + RIM);
  const e0 = pt(-RIM, 7 + RIM);
  const shadowDrop = SLAB + 12;
  const shadow =
    `<path d="M${pt(-RIM, -RIM, -shadowDrop)}L${pt(weeks + RIM, -RIM, -shadowDrop)}L${pt(weeks + RIM, 7 + RIM, -shadowDrop)}L${pt(-RIM, 7 + RIM, -shadowDrop)}Z" ` +
    `fill="${dark ? shade(p.bg, 0.6) : p.text}" opacity="${dark ? 0.7 : 0.13}" filter="url(#ps3d-blur)"/>`;
  const slab =
    `<path d="M${e0}L${c0}l0 ${SLAB}L${pt(-RIM, 7 + RIM, -SLAB)}Z" fill="${slabFront}"/>` +
    `<path d="M${c0}L${b0}l0 ${SLAB}L${pt(weeks + RIM, 7 + RIM, -SLAB)}Z" fill="${slabRight}"/>` +
    `<path d="M${a0}L${b0}L${c0}L${e0}Z" fill="${slabTop}" stroke="${dark ? mix(p.border, p.panel, 0.2) : p.border}" stroke-linejoin="round"/>`;

  const k = 1 - 2 * GAP;
  const rel = (...v: number[]) => v.map((x) => n(x)).join(' ').replace(/ -/g, '-');
  const topLoop = `l${rel(wx * k, wy * k, dx * k, dy * k, -wx * k, -wy * k)}z`;
  const tiles = cells
    .filter((c) => c.count === 0)
    .map((c) => `M${pt(c.week + GAP, c.day + GAP)}${topLoop}`)
    .join('');
  const floor = tiles ? `<path d="${tiles}" fill="${colours[0]?.top ?? p.empty}"/>` : '';

  // ── Bars ────────────────────────────────────────────────────────────────
  const byWeek = new Map<number, string[]>();
  let peakBar: { w: number; d: number; h: number } | null = null;
  const weekHeights = new Array<number>(weeks).fill(0);
  for (const c of cells) {
    if (c.count <= 0) continue;
    const h = height(c.count);
    const lv = Math.max(1, level(c.count)) as Exclude<Level, 0>;
    const w = c.week;
    const d = c.day;
    weekHeights[w] = (weekHeights[w] ?? 0) + h;
    if (best && c.date === best.date) peakBar = { w, d, h };
    const hs = n(h);
    const front = `M${pt(w + GAP, d + 1 - GAP)}l${rel(wx * k, wy * k)}v-${hs}l${rel(-wx * k, -wy * k)}z`;
    const right = `M${pt(w + 1 - GAP, d + 1 - GAP)}l${rel(-dx * k, -dy * k)}v-${hs}l${rel(dx * k, dy * k)}z`;
    const top = `M${pt(w + GAP, d + GAP, h)}${topLoop}`;
    const parts = byWeek.get(w) ?? [];
    parts.push(`<path class="f${lv}" d="${front}"/><path class="r${lv}" d="${right}"/><path class="t${lv}" d="${top}"/>`);
    byWeek.set(w, parts);
  }
  const bars = [...byWeek.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([w, parts]) => `<g class="wk" style="animation-delay:${n(0.15 + w * stagger, 3)}s">${parts.join('')}</g>`)
    .join('');

  // Glow behind the busiest stretch (7-week window with the most height).
  let glowW = weeks / 2;
  if (!empty) {
    let bestSum = -1;
    for (let w = 0; w + 7 <= weeks; w++) {
      let t = 0;
      for (let i = w; i < w + 7; i++) t += weekHeights[i] ?? 0;
      if (t > bestSum) {
        bestSum = t;
        glowW = w + 3.5;
      }
    }
  }
  const [gx, gy] = P(glowW, 3.5, empty ? 0 : maxH * 0.45);

  // ── Axis labels ─────────────────────────────────────────────────────────
  const axis =
    [1, 3, 5]
      .map((d) => {
        const [x, y] = P(weeks + RIM, d + 0.5);
        return `<text x="${n(x + dayLabelGap)}" y="${n(y + 4)}" class="mono" font-size="11" fill="${p.muted}">${(WEEKDAYS[d] ?? '').slice(0, 3)}</text>`;
      })
      .join('') +
    monthLabels
      .map((m) => `<text x="${n(m.x)}" y="${n(m.y)}" text-anchor="middle" class="mono" font-size="11" fill="${p.muted}">${m.text}</text>`)
      .join('');

  // ── Peak pin ────────────────────────────────────────────────────────────
  // A callout on the summit. Tried above the bar first, then beside it; it is
  // dropped rather than ever covering the header or the insights.
  let pin = '';
  if (showPeak && peakBar && best) {
    const [cx, cy] = P(peakBar.w + 0.5, peakBar.d + 0.5, peakBar.h);
    const value = fmt(best.count);
    const when = shortDate(best.date).replace(/, \d{4}$/, '');
    const pw = Math.round(textWidth(value, 12.5, { weight: 700 }) + 7 + textWidth(when, 12) + 24);
    const ph = 26;
    const shift = pw / 2 - 16;
    const candidates: Rect[] = [];
    for (const lift of [34, 52, 70, 88]) {
      for (const off of [0, -shift, shift]) {
        candidates.push({ x0: cx + off - pw / 2, y0: cy - lift - ph, x1: cx + off + pw / 2, y1: cy - lift });
      }
    }
    for (const side of [-1, 1]) {
      for (const lift of [18, 0, 40]) {
        const x0 = side < 0 ? cx - 22 - pw : cx + 22;
        candidates.push({ x0, y0: cy - lift - ph / 2, x1: x0 + pw, y1: cy - lift + ph / 2 });
      }
    }
    const fits = (r: Rect) =>
      r.x0 >= PAD / 2 && r.x1 <= W - PAD / 2 && r.y0 >= PAD / 2 && r.y1 <= H - 70 && !reserved.some((q) => overlaps(r, q, 10));
    const r = candidates.find(fits);
    if (r) {
      // Leader runs from the summit to the nearest point of the pill.
      const lx = Math.max(r.x0 + ph / 2, Math.min(r.x1 - ph / 2, cx));
      const ly = Math.max(r.y0, Math.min(r.y1, cy));
      const tx = cx < r.x0 ? r.x0 : cx > r.x1 ? r.x1 : lx;
      const ty = cy > r.y1 ? r.y1 : cy < r.y0 ? r.y0 : ly;
      pin =
        `<g class="pin" style="animation-delay:${n(0.15 + 1.05 + 0.25, 3)}s">` +
        `<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(tx)}" y2="${n(ty)}" stroke="${p.text}" stroke-opacity=".55" stroke-dasharray="2 3"/>` +
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="2.8" fill="${p.text}"/>` +
        `<rect x="${n(r.x0)}" y="${n(r.y0)}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="${p.panel}" fill-opacity=".94" stroke="${p.border}"/>` +
        `<text x="${n(r.x0 + 12)}" y="${n(r.y0 + 17.5)}" class="sans" font-size="12.5" font-weight="700" fill="${p.text}">${esc(value)}` +
        `<tspan dx="7" font-size="12" font-weight="400" fill="${p.muted}">${esc(when)}</tspan></text></g>`;
    }
  }

  // ── Header ──────────────────────────────────────────────────────────────
  const header = hideTitle
    ? ''
    : `<g class="fade">${label(PAD, TOP, labelText, p)}` +
      `<text x="${PAD}" y="${TOP + 46}" class="sans"><tspan font-size="36" font-weight="800" letter-spacing="-1" fill="url(#ps3d-accent)">${esc(headlineValue)}</tspan>` +
      `<tspan dx="12" font-size="16" fill="${p.muted}">${esc(headlineRest)}</tspan></text></g>`;

  // ── Insights / empty state ──────────────────────────────────────────────
  let side = '';
  if (insightsBlock && best) {
    const items: [string, string, string][] = [
      ['Best day', fmt(best.count), shortDate(best.date)],
      ['Busiest month', monthYear(`${sum.month.key}-01`), `${fmt(sum.month.total)} ${plural(sum.month.total, 'contribution')}`],
      ['Favourite weekday', WEEKDAYS[sum.weekday.day] ?? 'Sunday', `${fmt(sum.weekday.total)} ${plural(sum.weekday.total, 'contribution')}`],
      ['Active days', fmt(sum.active), `of ${fmt(sum.days)} · ${share(sum.active, sum.days)}`],
    ];
    side = items
      .map(([name, value, sub], i) => {
        const x = INS_X + (i % 2) * COL_W;
        const y = TOP + Math.floor(i / 2) * ROW_H;
        return (
          `<g class="fade" style="animation-delay:${n(0.25 + i * 0.08, 3)}s">` +
          `<text x="${x}" y="${y}" class="mono" font-size="11" letter-spacing="1" fill="${p.muted}">${esc(name.toUpperCase())}</text>` +
          `<text x="${x}" y="${y + 29}" class="sans" font-size="23" font-weight="700" letter-spacing="-.3" fill="${p.text}">${esc(fit(value, COL_W - 16, 23, { weight: 700 }))}</text>` +
          `<text x="${x}" y="${y + 49}" class="mono" font-size="11.5" fill="${p.muted}">${esc(fit(sub, COL_W - 12, 11.5, { mono: true }))}</text></g>`
        );
      })
      .join('');
  } else if (emptyBlock) {
    side =
      `<g class="fade" style="animation-delay:.25s">` +
      `<text x="${INS_X}" y="${TOP}" class="mono" font-size="11" letter-spacing="1" fill="${p.muted}">NO ACTIVITY YET</text>` +
      `<text x="${INS_X}" y="${TOP + 30}" class="sans" font-size="23" font-weight="700" letter-spacing="-.3" fill="${p.text}">A blank canvas</text>` +
      `<text x="${INS_X}" y="${TOP + 56}" class="sans" font-size="14" fill="${p.muted}">Every commit, pull request, issue and review</text>` +
      `<text x="${INS_X}" y="${TOP + 76}" class="sans" font-size="14" fill="${p.muted}">raises a bar on this landscape.</text></g>`;
  }

  // ── Legend & footnote ───────────────────────────────────────────────────
  const legendSvg = renderLegend(legend, legendY, colours, p);

  const body =
    shadow +
    slab +
    floor +
    axis +
    bars +
    pin +
    header +
    side +
    legendSvg;

  const who = ctx.data.name?.trim() || ctx.data.login;
  const summary = empty
    ? `No contributions ${spanPhrase}.`
    : `${fmt(total)} ${plural(total, 'contribution')} ${spanPhrase}. Best day: ${fmt(peak)} on ${shortDate(best?.date ?? '')}. ` +
      `Busiest month: ${monthYear(`${sum.month.key}-01`)}. Favourite weekday: ${WEEKDAYS[sum.weekday.day]}. Active on ${sum.active} of ${sum.days} days.`;
  const svg = shell({
    width: W,
    height: H,
    palette: p,
    title: `${who}: 3D contribution landscape`,
    desc: summary,
    body,
    defs,
    style,
    radius: 20,
    animate: ctx.animate,
    glow: { cx: Number(n(gx / W, 3)), cy: Number(n(gy / H, 3)), r: 0.36, color: p.accentA, opacity: p.glowOpacity * (empty ? 0.25 : 0.5) },
  });
  return {
    name: '3d',
    alt: `3D contribution landscape: ${fmt(total)} ${plural(total, 'contribution')} ${spanPhrase}`,
    svg,
    layout: 'full',
  };
}

interface Legend {
  width: number;
  /** Mono text after the swatches, split into separate runs. */
  notes: string[];
}

const LEGEND_SIZE = 11.5;
const CUBES_X = 36;
const CUBE_STEP = 19;

function legendParts(empty: boolean, peak: number, scale: Scale): Legend {
  const notes = empty ? ['each tile is one day'] : [`peak ${fmt(peak)}/day`, SCALE_NOTE[scale], 'each bar is one day'];
  const mono = { mono: true };
  const cubes = CUBES_X + 5 * CUBE_STEP + 6;
  const width = cubes + textWidth('More', LEGEND_SIZE, mono) + notes.reduce((s, t) => s + 24 + textWidth(`·${t}`, LEGEND_SIZE, mono), 0);
  return { width, notes };
}

/** "Less ▱▱▱▱▱ More" with tiny isometric cubes that grow like the bars, then the footnote. */
function renderLegend(legend: Legend, y: number, colours: ReturnType<typeof levelColours>, p: Palette): string {
  const k = 0.62;
  const wv: [number, number] = [17 * k * 0.8, 5.5 * k * 0.8];
  const dv: [number, number] = [-9 * k * 0.8, 8 * k * 0.8];
  const ground = y - 3;
  const cubes = colours
    .map((c, i) => {
      const h = i === 0 ? 1.5 : 2 + i * 3;
      const bx = PAD + CUBES_X + i * CUBE_STEP - dv[0];
      const by = ground - (wv[1] + dv[1]) / 2;
      const q = (a: number, b: number, z = 0) => `${n(bx + a * wv[0] + b * dv[0])} ${n(by + a * wv[1] + b * dv[1] - z)}`;
      const top = `<path d="M${q(0, 0, h)}L${q(1, 0, h)}L${q(1, 1, h)}L${q(0, 1, h)}Z" fill="${c.top}"/>`;
      return (
        `<path d="M${q(0, 1)}L${q(1, 1)}L${q(1, 1, h)}L${q(0, 1, h)}Z" fill="${c.front}"/>` +
        `<path d="M${q(1, 0)}L${q(1, 1)}L${q(1, 1, h)}L${q(1, 0, h)}Z" fill="${c.right}"/>` +
        top
      );
    })
    .join('');
  const moreX = PAD + CUBES_X + 5 * CUBE_STEP + 6;
  const notes = legend.notes.map((t) => `<tspan dx="12" fill-opacity=".6">·</tspan><tspan dx="12">${esc(t)}</tspan>`).join('');
  return (
    `<g class="fade" style="animation-delay:.4s">` +
    `<text x="${PAD}" y="${n(y)}" class="mono" font-size="${LEGEND_SIZE}" fill="${p.muted}">Less</text>` +
    cubes +
    `<text x="${n(moreX)}" y="${n(y)}" class="mono" font-size="${LEGEND_SIZE}" fill="${p.muted}">More${notes}</text></g>`
  );
}

export const card: CardDefinition = {
  id: '3d',
  title: '3D contribution landscape',
  description:
    'Your last year of contributions as an isometric landscape: every day is a bar whose height and colour grow with the work done, ' +
    'with your best day pinned and insights on your busiest month, favourite weekday and active days.',
  options: OPTIONS,
  render: (ctx) => [renderLandscape(ctx)],
};
