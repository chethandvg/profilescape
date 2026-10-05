import { levelScale, yearWindow, type CalendarCell, type Level } from '../core/calendar.ts';
import { MONTHS, plural, shortDate } from '../core/format.ts';
import { readOptions } from '../core/options.ts';
import { esc, label, linearGradient, mix, n, shell, textWidth } from '../core/svg.ts';
import { contribRamp } from '../core/themes.ts';
import type { CardDefinition, CardImage, Mode, OptionDoc, Palette, RenderContext } from '../core/types.ts';

/**
 * Animated contribution grid: the familiar weeks x days calendar, celebrated
 * with a CSS-only loop (no SMIL, no script).
 *
 *  - pulse: a soft light wave sweeps left to right. Each column inherits one
 *    animation-delay; as the wave passes, cells swell and brighten in
 *    proportion to their level, led by a thin glowing scanline.
 *  - rain: columns drop into place one after another on load, then the
 *    busiest (level 4) days twinkle with a small glint, in six staggered
 *    groups so the sparkle never looks mechanical.
 *
 * Every keyframe leaves the base values implicit and decorations sit at
 * opacity 0, so the static frame (animations off, reduced motion, PNG
 * renderers) is always the complete, correct grid.
 */

export const GRID_STYLES = ['pulse', 'rain'] as const;
export type GridStyle = (typeof GRID_STYLES)[number];

const FULL_W = 1200;
const PAD = 40;
const MIN_WEEKS = 26;
const MAX_WEEKS = 53;
const MIN_CELL = 8;
const MAX_CELL = 40;
/** Gap between cells as a fraction of the pitch (cell + gap). */
const GAP = 0.2;
const AXIS = 12;

/** Pulse timeline, in seconds. Cells peak at `peak` and settle at `settle` (fractions of the loop). */
const PULSE = { loop: 7, sweep: 3.4, start: 0.6, lead: 0.1, peak: 0.04, settle: 0.15 } as const;
/** Swell at the wave's crest per level; capped so a swollen cell never covers its neighbours. */
const SWELL = [1, 1.08, 1.13, 1.18, 1.24] as const;
/** How far each level moves toward the wave colour at the crest. */
const BOOST = [0.2, 0.36, 0.5, 0.62, 0.8] as const;

/** Rain timeline, in seconds. */
const RAIN = { start: 0.25, sweep: 1.4, drop: 0.7, settle: 0.35, groups: 6, spacing: 0.75 } as const;

export const GRID_OPTIONS: OptionDoc[] = [
  {
    key: 'style',
    type: 'string',
    default: 'pulse',
    description: '"pulse" (a light wave sweeps across your year) or "rain" (columns drop in, then your busiest days twinkle).',
  },
  { key: 'weeks', type: 'number', default: 53, description: 'Weeks to show, 26 to 53, ending today.' },
  {
    key: 'cellSize',
    type: 'number',
    default: 'auto',
    description: 'Cell size in px (8 to 40). By default cells grow to fill the 1200px card; smaller values make a narrower card.',
  },
  { key: 'title', type: 'string', default: 'Contributions · last 12 months', description: 'Header label.' },
  { key: 'hideTitle', type: 'boolean', default: false, description: 'Hide the header label.' },
  { key: 'hideStats', type: 'boolean', default: false, description: 'Hide the total / active days / best day line.' },
  { key: 'loop', type: 'boolean', default: true, description: 'Loop the animation forever; false plays it once.' },
];

interface GridStats {
  total: number;
  active: number;
  best: CalendarCell | null;
}

interface Layout {
  W: number;
  H: number;
  gx: number;
  gy: number;
  pitch: number;
  cell: number;
  rx: number;
  gridW: number;
  gridH: number;
  labelY: number | null;
  statsY: number | null;
  monthY: number;
  footY: number;
}

const safeCount = (c: number): number => (Number.isFinite(c) && c > 0 ? Math.floor(c) : 0);
const fmt = (v: number): string => v.toLocaleString('en-US');

function summarize(cells: CalendarCell[]): GridStats {
  let total = 0;
  let active = 0;
  let best: CalendarCell | null = null;
  for (const c of cells) {
    total += c.count;
    if (c.count > 0) active++;
    // `>=` keeps the most recent day when several tie.
    if (c.count > 0 && (!best || c.count >= best.count)) best = c;
  }
  return { total, active, best };
}

/** Stable pseudo-random twinkle group for a cell, so neighbours rarely share a beat. */
function group(week: number, day: number): number {
  let x = (Math.imul(week + 1, 374_761_393) + Math.imul(day + 1, 668_265_263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1_274_126_177);
  return ((x ^ (x >>> 16)) >>> 0) % RAIN.groups;
}

interface StatsLine {
  svg: string;
  width: number;
}

function statsLine(x: number, y: number, s: GridStats, p: Palette, maxWidth: number): StatsLine {
  const big = fmt(s.total);
  const bigW = textWidth(big, 32, { weight: 800 }) - big.length;
  const unit = ` ${plural(s.total, 'contribution')}`;
  const sep = (gap: number) => `<tspan dx="${gap}" fill="${p.faint}">·</tspan>`;
  const activeVal = fmt(s.active);
  const activeUnit = `${plural(s.active, 'active day')}`;
  let svg =
    `<tspan font-size="32" font-weight="800" letter-spacing="-1" fill="url(#ps-grid-num)">${esc(big)}</tspan>` +
    `<tspan dx="10" fill="${p.muted}">${esc(unit.trim())}</tspan>` +
    sep(16) +
    `<tspan dx="16" font-weight="700" fill="${p.text}">${esc(activeVal)}</tspan>` +
    `<tspan dx="6" fill="${p.muted}">${esc(activeUnit)}</tspan>`;
  let width =
    bigW +
    10 +
    textWidth(unit.trim(), 16) +
    32 +
    textWidth('·', 16) +
    textWidth(activeVal, 16, { weight: 700 }) +
    6 +
    textWidth(activeUnit, 16);
  if (s.best) {
    const bestVal = fmt(s.best.count);
    const when = `on ${shortDate(s.best.date)}`;
    const extra =
      32 + textWidth('·', 16) + textWidth('best day', 16) + 6 + textWidth(bestVal, 16, { weight: 700 }) + 6 + textWidth(when, 16);
    if (width + extra <= maxWidth) {
      svg +=
        sep(16) +
        `<tspan dx="16" fill="${p.muted}">best day</tspan>` +
        `<tspan dx="6" font-weight="700" fill="${p.text}">${esc(bestVal)}</tspan>` +
        `<tspan dx="6" fill="${p.muted}">${esc(when)}</tspan>`;
      width += extra;
    }
  }
  return { svg: `<text x="${n(x)}" y="${n(y)}" class="sans" font-size="16">${svg}</text>`, width };
}

function legendWidth(cell: number): number {
  return textWidth('Less', AXIS, { mono: true }) + 8 + 5 * cell + 4 * 4 + 8 + textWidth('More', AXIS, { mono: true });
}

function layout(o: {
  weeks: number;
  requestedCell: number;
  hideTitle: boolean;
  hideStats: boolean;
  minWidth: number;
}): Layout {
  const gutter = Math.ceil(textWidth('Wed', AXIS, { mono: true })) + 12;
  const fullAvail = FULL_W - 2 * PAD - gutter;
  // gridW = weeks * pitch - gap = pitch * (weeks - GAP)
  const fitPitch = fullAvail / (o.weeks - GAP);
  let pitch = fitPitch;
  let W = FULL_W;
  if (o.requestedCell > 0) {
    const want = Math.min(MAX_CELL, Math.max(MIN_CELL, o.requestedCell)) / (1 - GAP);
    if (want < fitPitch) {
      pitch = want;
      const content = 2 * PAD + gutter + pitch * (o.weeks - GAP);
      W = Math.min(FULL_W, Math.max(o.minWidth, Math.ceil(content)));
    }
  }
  const cell = pitch * (1 - GAP);
  const gridW = pitch * (o.weeks - GAP);
  const gridH = pitch * (7 - GAP);
  let y = PAD;
  let labelY: number | null = null;
  let statsY: number | null = null;
  if (!o.hideTitle) {
    labelY = y + 16;
    y = labelY;
  }
  if (!o.hideStats) {
    statsY = labelY === null ? y + 26 : y + 46;
    y = statsY;
  }
  const monthY = labelY === null && statsY === null ? y + 10 : y + (statsY === null ? 32 : 36);
  const gy = monthY + 12;
  const footY = gy + gridH + 32;
  return {
    W,
    H: Math.ceil(footY + 30),
    gx: PAD + gutter,
    gy,
    pitch,
    cell,
    rx: Math.max(2, cell * 0.22),
    gridW,
    gridH,
    labelY,
    statsY,
    monthY,
    footY,
  };
}

function monthLabels(cells: CalendarCell[], weeks: number, L: Layout, p: Palette): string {
  const starts: { week: number; month: number }[] = [];
  let prev = -1;
  for (let w = 0; w < weeks; w++) {
    const first = cells[w * 7];
    if (!first) continue;
    const month = Number(first.date.slice(5, 7)) - 1;
    if (month !== prev) starts.push({ week: w, month });
    prev = month;
  }
  const minGap = Math.ceil((textWidth('Mmm', AXIS, { mono: true }) + 8) / L.pitch);
  const out: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    if (!s) continue;
    const next = starts[i + 1];
    // A partial first month only gets a label when there is room before the next one.
    if (i === 0 && next && next.week - s.week < minGap) continue;
    const name = MONTHS[s.month] ?? '';
    const x = L.gx + s.week * L.pitch;
    if (x + textWidth(name, AXIS, { mono: true }) > L.gx + L.gridW + 1) continue;
    out.push(`<text x="${n(x)}" y="${n(L.monthY)}">${name}</text>`);
  }
  const days = [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ] as const;
  for (const [d, name] of days) {
    const y = L.gy + d * L.pitch + L.cell / 2 + AXIS * 0.35;
    out.push(`<text x="${n(L.gx - 12)}" y="${n(y)}" text-anchor="end">${name}</text>`);
  }
  return `<g class="mono fade" font-size="${AXIS}" fill="${p.faint}">${out.join('')}</g>`;
}

function legend(L: Layout, ramp: readonly string[], p: Palette): string {
  const size = 12;
  const right = L.gx + L.gridW;
  const moreW = textWidth('More', AXIS, { mono: true });
  const cellsRight = right - moreW - 8;
  const cellsLeft = cellsRight - (5 * size + 4 * 4);
  const swatches = ramp
    .map(
      (c, i) =>
        `<rect x="${n(cellsLeft + i * (size + 4))}" y="${n(L.footY - 10)}" width="${size}" height="${size}" rx="3" fill="${c}"/>`,
    )
    .join('');
  return (
    `<g class="mono" font-size="${AXIS}" fill="${p.faint}">` +
    `<text x="${n(cellsLeft - 8)}" y="${n(L.footY)}" text-anchor="end">Less</text>${swatches}` +
    `<text x="${n(right)}" y="${n(L.footY)}" text-anchor="end">More</text></g>`
  );
}

function emptyMessage(L: Layout, p: Palette): string {
  const head = 'No contributions yet';
  const sub = 'Every commit, pull request and review lights up a square.';
  const w = Math.min(L.gridW - 16, Math.max(textWidth(head, 16, { weight: 700 }), textWidth(sub, 13)) + 64);
  const h = 70;
  const cx = L.gx + L.gridW / 2;
  const cy = L.gy + L.gridH / 2;
  return (
    `<g class="up" style="animation-delay:.35s">` +
    `<rect x="${n(cx - w / 2)}" y="${n(cy - h / 2)}" width="${n(w)}" height="${h}" rx="14" fill="${p.panel}" fill-opacity=".94" stroke="${p.border}"/>` +
    `<text x="${n(cx)}" y="${n(cy - 5)}" text-anchor="middle" class="sans" font-size="16" font-weight="700" fill="${p.text}">${head}</text>` +
    `<text x="${n(cx)}" y="${n(cy + 17)}" text-anchor="middle" class="sans" font-size="13" fill="${p.muted}">${sub}</text></g>`
  );
}

interface Motion {
  css: string;
  /** Per-column inline style (animation-delay). */
  column: (week: number) => string;
  /** Extra classes for a cell. */
  cellClass: (c: CalendarCell, lv: Level) => string;
  under: string;
  over: string;
}

function pulseMotion(L: Layout, weeks: number, ramp: readonly string[], p: Palette, mode: Mode, iterations: string): Motion {
  const T = PULSE.loop;
  const dw = PULSE.sweep / Math.max(1, weeks - 1);
  // Dark: the crest is near-white light. Light: a luminous cyan, so even the
  // darkest (busiest) cells visibly light up instead of only shifting hue.
  const wave = mode === 'dark' ? mix(p.accentB, p.text, 0.82) : mix(p.accentB, p.panel, 0.3);
  const pk = n(PULSE.peak * 100, 2);
  const st = n(PULSE.settle * 100, 2);
  const frames = ramp
    .map((base, l) => {
      const hi = mix(base, wave, BOOST[l] ?? 0.5);
      const swell = SWELL[l] ?? 1;
      const grow = swell > 1 ? `;transform:scale(${swell})` : '';
      const back = swell > 1 ? ';transform:none' : '';
      return (
        `.l${l}{animation:ps-p${l} ${T}s cubic-bezier(.3,0,.25,1) ${iterations} backwards}` +
        `@keyframes ps-p${l}{${pk}%{fill:${hi}${grow}}${st}%{fill:${base}${back}}}`
      );
    })
    .join('');

  // The scanline travels from the grid's left edge to its right edge, arriving
  // at each column `lead` seconds after that column's cells start to rise.
  const xa = L.gx - (L.pitch - L.cell) / 2;
  const xb = L.gx + L.gridW + (L.pitch - L.cell) / 2;
  const ta = PULSE.start + PULSE.lead - dw / 2;
  const travel = weeks * dw;
  const tp = (travel / T) * 100;
  const fade = Math.min(4, tp * 0.08);
  const scanFrames =
    `@keyframes ps-scan{0%{transform:translateX(${n(xa)}px);opacity:0}${n(fade, 2)}%{opacity:1}` +
    `${n(tp - fade, 2)}%{opacity:1}${n(tp, 2)}%,100%{transform:translateX(${n(xb)}px);opacity:0}}`;

  const top = L.gy - 8;
  const height = L.gridH + 16;
  const trail = Math.max(L.pitch * 5, 60);
  const line = mode === 'dark' ? mix(p.accentB, p.text, 0.35) : p.accentB;
  const defs =
    `<linearGradient id="ps-grid-trail" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${p.accentB}" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="${p.accentB}" stop-opacity="${mode === 'dark' ? 0.34 : 0.24}"/></linearGradient>` +
    `<linearGradient id="ps-grid-line" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${line}" stop-opacity="0"/><stop offset=".22" stop-color="${line}"/>` +
    `<stop offset=".78" stop-color="${line}"/><stop offset="1" stop-color="${line}" stop-opacity="0"/></linearGradient>`;
  // Trail sits under the cells (it glows through the gaps); the line sits on top.
  const under = `<rect class="scan" opacity="0" x="${n(-trail)}" y="${n(L.gy)}" width="${n(trail)}" height="${n(L.gridH)}" fill="url(#ps-grid-trail)"/>`;
  const over =
    `<g class="scan" opacity="0">` +
    `<rect x="-4" y="${n(top)}" width="8" height="${n(height)}" rx="4" fill="url(#ps-grid-line)" opacity=".28"/>` +
    `<rect x="-1" y="${n(top)}" width="2" height="${n(height)}" rx="1" fill="url(#ps-grid-line)"/></g>`;
  const css =
    '.c>rect{animation-delay:inherit;transform-box:fill-box;transform-origin:center}' +
    frames +
    `.scan{animation:ps-scan ${T}s linear ${iterations} backwards;animation-delay:${n(ta, 3)}s}` +
    scanFrames;
  return {
    css,
    column: (w) => `animation-delay:${n(PULSE.start + w * dw, 3)}s`,
    cellClass: () => '',
    under: `<defs>${defs}</defs>${under}`,
    over,
  };
}

function rainMotion(
  L: Layout,
  weeks: number,
  cells: CalendarCell[],
  level: (c: number) => Level,
  ramp: readonly string[],
  p: Palette,
  mode: Mode,
  iterations: string,
): Motion {
  const dw = RAIN.sweep / Math.max(1, weeks - 1);
  const dist = Math.round(Math.min(40, L.pitch * 1.6));
  const twinkleStart = RAIN.start + RAIN.sweep + RAIN.drop + RAIN.settle;
  const peak = ramp[4] ?? p.accentB;
  const flash = mode === 'dark' ? mix(peak, p.text, 0.3) : mix(peak, p.accentB, 0.55);
  const groups = Array.from({ length: RAIN.groups }, (_, k) => {
    const duration = 4.2 + (k % 3) * 0.8;
    return `.t${k}{animation-duration:${n(duration, 2)}s;animation-delay:${n(twinkleStart + k * RAIN.spacing, 3)}s}`;
  }).join('');
  const css =
    `.c{animation:ps-drop ${RAIN.drop}s cubic-bezier(.34,1.45,.64,1) backwards}` +
    `@keyframes ps-drop{from{opacity:0;transform:translateY(-${dist}px)}}` +
    `.tw,.sp{transform-box:fill-box;transform-origin:center}` +
    `.tw{animation:ps-tw 5s ease-in-out ${iterations} backwards}` +
    `@keyframes ps-tw{7%{fill:${flash};transform:scale(1.2)}17%{fill:${peak};transform:none}}` +
    `.sp{animation:ps-sp 5s ease-in-out ${iterations} backwards}` +
    `@keyframes ps-sp{0%{opacity:0;transform:scale(.2) rotate(-45deg)}7%{opacity:1;transform:scale(1) rotate(0deg)}` +
    `17%{opacity:0;transform:scale(.35) rotate(45deg)}}` +
    groups;

  // A four-point glint over each busiest day; invisible until its twinkle.
  const r = Math.max(5, L.cell * 0.7);
  const k = r * 0.14;
  const rel =
    `q${n(k)} ${n(r - k)} ${n(r)} ${n(r)}q${n(k - r)} ${n(k)} ${n(-r)} ${n(r)}` +
    `q${n(-k)} ${n(k - r)} ${n(-r)} ${n(-r)}q${n(r - k)} ${n(-k)} ${n(r)} ${n(-r)}z`;
  const sparks: string[] = [];
  for (const c of cells) {
    if (level(c.count) !== 4) continue;
    const cx = L.gx + c.week * L.pitch + L.cell / 2;
    const cy = L.gy + c.day * L.pitch + L.cell / 2;
    sparks.push(`<path class="sp t${group(c.week, c.day)}" opacity="0" d="M${n(cx)} ${n(cy - r)}${rel}"/>`);
  }
  const glint = mode === 'dark' ? p.text : p.panel;
  return {
    css,
    column: (w) => `animation-delay:${n(RAIN.start + w * dw, 3)}s`,
    cellClass: (c, lv) => (lv === 4 ? ` tw t${group(c.week, c.day)}` : ''),
    under: '',
    over: sparks.length ? `<g fill="${glint}">${sparks.join('')}</g>` : '',
  };
}

function renderGrid(ctx: RenderContext): CardImage {
  const o = readOptions(ctx.options);
  const styleRaw = o.string('style', 'pulse').trim().toLowerCase();
  const style: GridStyle = (GRID_STYLES as readonly string[]).includes(styleRaw) ? (styleRaw as GridStyle) : 'pulse';
  const weeks = Math.round(o.number('weeks', MAX_WEEKS, { min: MIN_WEEKS, max: MAX_WEEKS }));
  const requestedCell = o.number('cellSize', 0);
  const hideTitle = o.boolean('hideTitle', false);
  const hideStats = o.boolean('hideStats', false);
  const iterations = o.boolean('loop', true) ? 'infinite' : '1';
  const period = weeks >= 52 ? 'last 12 months' : `last ${weeks} weeks`;
  const title = o.string('title', `Contributions · ${period}`);

  const p = ctx.palette;
  const ramp = contribRamp(p, ctx.mode);
  const cells = yearWindow(ctx.data.calendar ?? [], ctx.now, weeks).map((c) => ({ ...c, count: safeCount(c.count) }));
  const level = levelScale(cells.map((c) => c.count));
  const stats = summarize(cells);
  const first = cells[0];
  const last = cells[cells.length - 1];
  const range = first && last ? `${shortDate(first.date)} – ${shortDate(last.date)}` : '';

  // Narrow (explicit cellSize) cards still need room for their chrome.
  const probe = statsLine(0, 0, stats, p, Number.POSITIVE_INFINITY);
  const chrome = Math.max(
    hideStats ? 0 : Math.min(probe.width, 760),
    hideTitle ? 0 : Math.min(labelWidth(title), 760),
    textWidth(range, AXIS, { mono: true }) + 32 + legendWidth(12),
    460,
  );
  const L = layout({ weeks, requestedCell, hideTitle, hideStats, minWidth: Math.ceil(chrome + 2 * PAD) });
  const contentRight = L.W - PAD;

  const motion =
    style === 'rain'
      ? rainMotion(L, weeks, cells, level, ramp, p, ctx.mode, iterations)
      : pulseMotion(L, weeks, ramp, p, ctx.mode, iterations);

  const columns: string[] = [];
  const size = n(L.cell);
  const rx = n(L.rx);
  for (let w = 0; w < weeks; w++) {
    const parts: string[] = [];
    for (let d = 0; d < 7; d++) {
      const c = cells[w * 7 + d];
      if (!c) break;
      const lv = level(c.count);
      const x = L.gx + w * L.pitch;
      const y = L.gy + d * L.pitch;
      parts.push(
        `<rect class="l${lv}${motion.cellClass(c, lv)}" x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" rx="${rx}" fill="${ramp[lv]}"/>`,
      );
      if (stats.best && c.date === stats.best.date) {
        const off = 2.5;
        parts.push(
          `<rect x="${n(x - off)}" y="${n(y - off)}" width="${n(L.cell + off * 2)}" height="${n(L.cell + off * 2)}" rx="${n(L.rx + off)}" fill="none" stroke="${p.text}" stroke-opacity=".7" stroke-width="1.5"/>`,
        );
      }
    }
    if (parts.length) columns.push(`<g class="c" style="${motion.column(w)}">${parts.join('')}</g>`);
  }

  const body: string[] = [];
  if (L.labelY !== null) {
    const text = fitLabel(title, contentRight - PAD);
    body.push(`<g class="fade">${label(PAD, L.labelY, text, p)}</g>`);
  }
  if (L.statsY !== null) {
    const line = statsLine(PAD, L.statsY, stats, p, contentRight - PAD);
    body.push(`<g class="up" style="animation-delay:.08s">${line.svg}</g>`);
  }
  body.push(monthLabels(cells, weeks, L, p));
  body.push(motion.under);
  body.push(`<g>${columns.join('')}</g>`);
  body.push(motion.over);
  if (stats.total === 0) body.push(emptyMessage(L, p));
  if (range) {
    body.push(
      `<text x="${n(L.gx)}" y="${n(L.footY)}" class="mono fade" font-size="${AXIS}" fill="${p.faint}">${esc(range)}</text>`,
    );
  }
  body.push(`<g class="fade">${legend(L, ramp, p)}</g>`);

  const summary = `${fmt(stats.total)} ${plural(stats.total, 'contribution')} in the ${period}`;
  const desc = stats.best
    ? `${fmt(stats.active)} ${plural(stats.active, 'active day')}. Best day: ${shortDate(stats.best.date)} with ${fmt(stats.best.count)} ${plural(stats.best.count, 'contribution')}.`
    : 'No contributions yet.';
  const svg = shell({
    width: L.W,
    height: L.H,
    palette: p,
    title: `Contribution grid: ${summary}`,
    desc,
    radius: L.W <= 600 ? 16 : 20,
    glow: { cx: 0.08, cy: 0, r: 0.9, color: p.accentA, opacity: p.glowOpacity * 0.22 },
    defs: linearGradient('ps-grid-num', p.accentA, p.accentB),
    style: motion.css,
    body: body.join(''),
    animate: ctx.animate,
  });
  return { name: 'grid', alt: `Contribution grid: ${summary}`, svg, layout: 'full' };
}

/** Rendered width of a label(): 12px mono, upper-cased, 1.4px tracking. */
const labelWidth = (s: string): number => textWidth(s.toUpperCase(), 12, { mono: true }) + [...s].length * 1.4;

/** Keep long custom titles inside the card. */
function fitLabel(text: string, maxWidth: number): string {
  if (labelWidth(text) <= maxWidth) return text;
  // Slice by code point so emoji are never split into lone surrogates.
  const chars = [...text];
  while (chars.length > 1 && labelWidth(`${chars.join('')}…`) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

export const card: CardDefinition = {
  id: 'grid',
  title: 'Contribution grid',
  description:
    'Your contribution calendar, animated: a light wave pulses across your year, or columns rain into place and your busiest days twinkle.',
  options: GRID_OPTIONS,
  render: (ctx) => [renderGrid(ctx)],
};
