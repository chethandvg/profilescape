import { displayName, plural } from '../core/format.ts';
import { readOptions } from '../core/options.ts';
import { delay as at, ensureContrast, esc, fit, fitLabel, label, labelWidth, n, safeColor, shell, textWidth, wrapPx } from '../core/svg.ts';
import { otherColor } from '../core/themes.ts';
import type { CardDefinition, CardImage, LanguageStat, Palette, ProfileData, RenderContext } from '../core/types.ts';

/**
 * Languages card: the user's most used languages, weighted by commits or by
 * code size, as a stacked bar (default), a donut or a compact half-width card.
 */

export type Weighting = 'commits' | 'bytes';
export type Layout = 'bar' | 'donut' | 'compact';

export interface Slice {
  name: string;
  color: string;
  value: number;
  /** Exact fraction of the visible total (0..1). */
  share: number;
  /** Rounded label; all labels sum to exactly 100.0%. */
  pct: string;
  other: boolean;
}

export interface Prepared {
  slices: Slice[];
  /** Visible languages before folding into "Other". */
  count: number;
  /** True when the source had data but `hide` removed all of it. */
  allHidden: boolean;
}

/** Minimum contrast of a language colour against the card surface. */
const MIN_CONTRAST = 1.8;

const validStats = (list: unknown): LanguageStat[] =>
  (Array.isArray(list) ? list : []).filter(
    (l): l is LanguageStat =>
      !!l && typeof l.name === 'string' && l.name.trim() !== '' && typeof l.value === 'number' && Number.isFinite(l.value) && l.value > 0,
  );

/** Largest-remainder rounding to tenths of a percent so labels always add up to 100.0%. */
export function percentLabels(values: number[]): string[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return values.map(() => '0%');
  const raw = values.map((v) => (v / total) * 1000);
  const tenths = raw.map(Math.floor);
  let left = 1000 - tenths.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    tenths[i] = (tenths[i] ?? 0) + 1;
    left--;
  }
  return tenths.map((t, i) => (t === 0 && (values[i] ?? 0) > 0 ? '<0.1%' : `${(t / 10).toFixed(1)}%`));
}

export function prepareLanguages(
  list: LanguageStat[],
  opts: { hide: string[]; top: number },
  p: Palette,
): Prepared {
  const hidden = new Set(opts.hide.map((h) => h.trim().toLowerCase()));
  const source = validStats(list);
  const merged = new Map<string, LanguageStat>();
  for (const l of source) {
    const name = l.name.trim();
    const key = name.toLowerCase();
    if (hidden.has(key)) continue;
    const cur = merged.get(key);
    if (cur) cur.value += l.value;
    // Real GitHub colours, nudged only when they would vanish into the panel (PowerShell navy on dark).
    else merged.set(key, { name, color: ensureContrast(safeColor(l.color, p.muted), p.panel, MIN_CONTRAST, p.text), value: l.value });
  }
  const visible = [...merged.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const top = Math.max(1, Math.min(10, Math.round(opts.top)));
  // Folding a single language into "Other" hides its name for nothing, so only fold two or more.
  const kept = visible.length > top + 1 ? visible.slice(0, top) : visible;
  const rest = visible.slice(kept.length).reduce((s, l) => s + l.value, 0);
  const items = kept.map((l) => ({ ...l, other: false }));
  if (rest > 0) {
    const existing = items.find((l) => l.name.toLowerCase() === 'other');
    if (existing) existing.value += rest;
    else items.push({ name: 'Other', color: otherColor(p, items.map((l) => l.color)), value: rest, other: true });
  }
  const total = items.reduce((s, l) => s + l.value, 0);
  const pcts = percentLabels(items.map((l) => l.value));
  return {
    slices: items.map((l, i) => ({ ...l, share: total > 0 ? l.value / total : 0, pct: pcts[i] ?? '0%' })),
    count: visible.length,
    allHidden: visible.length === 0 && source.length > 0,
  };
}

/** Commits weighting falls back to code size when the commit-weighted list is empty. */
export function pickSource(data: ProfileData, wanted: Weighting): { weighting: Weighting; list: LanguageStat[] } {
  const commits = validStats(data.languages);
  const bytes = validStats(data.languagesByBytes);
  if (wanted === 'commits' && !commits.length && bytes.length) return { weighting: 'bytes', list: bytes };
  if (wanted === 'bytes' && !bytes.length && commits.length) return { weighting: 'commits', list: commits };
  return { weighting: wanted, list: wanted === 'commits' ? commits : bytes };
}

// ── Shared drawing helpers ──────────────────────────────────────────────────

/** The official name when it fits, else the short display name ("Jupyter"), truncated only as a last resort. */
function legendName(name: string, maxWidth: number, size: number): string {
  const opts = { weight: 600 };
  if (textWidth(name, size, opts) <= maxWidth) return name;
  return fit(displayName(name), maxWidth, size, opts);
}

const STYLE =
  '.lg-seg{transform-box:fill-box;transform-origin:0 50%;animation:lg-grow .8s cubic-bezier(.2,.7,.2,1) backwards}' +
  '@keyframes lg-grow{from{transform:scaleX(0)}}';

interface Header {
  title: string;
  info: string;
}

/** Header label on the left, optional info on the right; the title yields space so they never touch. */
function header(h: Header, x: number, y: number, width: number, p: Palette): string {
  // The info is a second label (same style as the stack card's count), in muted.
  const infoW = h.info ? labelWidth(h.info) : 0;
  const room = width - infoW - 32;
  const showInfo = h.info && room >= Math.min(220, labelWidth(h.title));
  const title = fitLabel(h.title, showInfo ? room : width);
  return label(x, y, title, p) + (showInfo ? label(x + width, y, h.info, p, { anchor: 'end', color: p.muted }) : '');
}

/** Stacked horizontal bar of all slices with small gaps, clipped to a pill. */
function stackedBar(slices: Slice[], x: number, y: number, width: number, height: number, p: Palette, id: string): { svg: string; defs: string } {
  const r = height / 2;
  const defs = `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${height}" rx="${n(r)}"/></clipPath>`;
  const gap = slices.length > 1 ? 3 : 0;
  let cx = x;
  const segs = slices.map((s, i) => {
    const w = s.share * width;
    const last = i === slices.length - 1;
    const seg = `<rect class="lg-seg" ${at(0.1 + i * 0.08)} x="${n(cx, 2)}" y="${n(y)}" width="${n(Math.max(1.5, last ? w : w - gap), 2)}" height="${height}" fill="${s.color}"/>`;
    cx += w;
    return seg;
  });
  const svg =
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${height}" rx="${n(r)}" fill="${p.empty}"/>` +
    `<g clip-path="url(#${id})">${segs.join('')}</g>`;
  return { svg, defs };
}

function emptyMessage(prepared: Prepared): { title: string; sub: string } {
  return prepared.allHidden
    ? { title: 'All languages are hidden', sub: 'Remove some names from the hide option to bring them back.' }
    : { title: 'No language data yet', sub: 'Your languages will appear here once your repositories have code.' };
}

// ── Layouts ─────────────────────────────────────────────────────────────────

interface LayoutArgs {
  prepared: Prepared;
  head: Header | null;
  p: Palette;
}

interface Drawn {
  width: number;
  height: number;
  body: string;
  defs: string;
  style?: string;
}

function barLayout({ prepared, head, p }: LayoutArgs): Drawn {
  const W = 1200;
  const PAD = 40;
  const parts: string[] = [];
  if (head) parts.push(header(head, PAD, 56, W - PAD * 2, p));
  const barY = head ? 80 : PAD;
  const { slices } = prepared;
  const bar = stackedBar(slices, PAD, barY, W - PAD * 2, 16, p, 'lg-bar');
  parts.push(bar.svg);

  if (!slices.length) {
    const msg = emptyMessage(prepared);
    parts.push(
      `<g class="fade" ${at(0.2)}><text x="${PAD}" y="${barY + 58}" class="sans" font-size="16" font-weight="600" fill="${p.text}">${esc(msg.title)}</text>` +
        `<text x="${PAD}" y="${barY + 80}" class="sans" font-size="13" fill="${p.muted}">${esc(msg.sub)}</text></g>`,
    );
    return { width: W, height: barY + 80 + PAD, body: parts.join(''), defs: bar.defs };
  }

  const cols = 4;
  const colW = (W - PAD * 2) / cols;
  const first = barY + 16 + 42;
  const pitch = 34;
  slices.forEach((s, i) => {
    const lx = PAD + (i % cols) * colW;
    const ly = first + Math.floor(i / cols) * pitch;
    const pctW = textWidth(s.pct, 13, { mono: true });
    const name = legendName(s.name, colW - 20 - 8 - pctW - 20, 15);
    parts.push(
      `<g class="fade" ${at(0.35 + i * 0.05)}><circle cx="${n(lx + 6)}" cy="${n(ly - 5)}" r="6" fill="${s.color}"/>` +
        `<text x="${n(lx + 20)}" y="${n(ly)}"><tspan class="sans" font-size="15" font-weight="600" fill="${s.other ? p.muted : p.text}">${esc(name)}</tspan>` +
        `<tspan dx="8" class="mono" font-size="13" fill="${p.muted}">${esc(s.pct)}</tspan></text></g>`,
    );
  });
  const rows = Math.ceil(slices.length / cols);
  return { width: W, height: first + (rows - 1) * pitch + 36, body: parts.join(''), defs: bar.defs };
}

function donutLayout({ prepared, head, p }: LayoutArgs): Drawn {
  const W = 1200;
  const PAD = 40;
  const R = 96;
  const T = 24;
  const r = R - T / 2;
  const C = 2 * Math.PI * r;
  const parts: string[] = [];
  const top = head ? 84 : PAD;
  const cx = PAD + R + 16;
  const cy = top + R;
  const H = cy + R + PAD;
  if (head) parts.push(header(head, PAD, 56, W - PAD * 2, p));
  const { slices } = prepared;

  // Track, then one stroked circle per slice: rotate to its start angle, dash to its length.
  parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${p.empty}" stroke-width="${T}"/>`);
  const gap = slices.length > 1 ? 3 : 0;
  let start = 0;
  const sweep = 0.9;
  const style = `.lg-arc{animation:lg-sweep .5s linear backwards}@keyframes lg-sweep{from{stroke-dasharray:0 ${n(C, 2)}}}`;
  for (const s of slices) {
    const len = Math.max(1, s.share * C - gap);
    const timing = `style="animation-delay:${n(0.15 + start * sweep, 3)}s;animation-duration:${n(Math.max(0.12, s.share * sweep), 3)}s"`;
    parts.push(
      `<circle class="lg-arc" ${timing} cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${s.color}" stroke-width="${T}" ` +
        `stroke-dasharray="${n(len, 2)} ${n(C, 2)}" transform="rotate(${n(-90 + start * 360, 2)} ${n(cx)} ${n(cy)})"/>`,
    );
    start += s.share;
  }

  const lead = slices[0];
  const innerW = (R - T) * 2 - 44;
  if (lead) {
    const size = lead.pct.length > 5 ? 28 : 32;
    parts.push(
      `<g class="fade" ${at(0.5)}><text x="${n(cx)}" y="${n(cy + 6)}" text-anchor="middle" class="sans" font-size="${size}" font-weight="800" letter-spacing="-1" fill="${p.text}">${esc(lead.pct)}</text>` +
        `<text x="${n(cx)}" y="${n(cy + 28)}" text-anchor="middle" class="sans" font-size="13" fill="${p.muted}">${esc(fit(lead.name, innerW, 13))}</text></g>`,
    );
  } else {
    parts.push(`<text x="${n(cx)}" y="${n(cy + 7)}" text-anchor="middle" class="mono" font-size="20" fill="${p.faint}">${esc('</>')}</text>`);
  }

  const lx0 = cx + R + 72;
  const areaW = W - PAD - lx0;
  if (!slices.length) {
    const msg = emptyMessage(prepared);
    parts.push(
      `<g class="fade" ${at(0.2)}><text x="${n(lx0)}" y="${n(cy - 4)}" class="sans" font-size="16" font-weight="600" fill="${p.text}">${esc(msg.title)}</text>` +
        `<text x="${n(lx0)}" y="${n(cy + 18)}" class="sans" font-size="13" fill="${p.muted}">${esc(msg.sub)}</text></g>`,
    );
    return { width: W, height: H, body: parts.join(''), defs: '', style };
  }

  // Legend rows with bars on the right: one column up to 6 languages, two beyond.
  const cols = slices.length > 6 ? 2 : 1;
  const colGap = 56;
  const colW = (areaW - (cols - 1) * colGap) / cols;
  const rows = Math.ceil(slices.length / cols);
  const pitch = Math.min(38, (R * 2 + 8) / Math.max(1, rows));
  const firstY = cy - ((rows - 1) * pitch) / 2 + 5;
  const pctW = 64;
  // Name column sized to the longest name (full names stay readable), leaving the bars at least 96px.
  const longest = Math.max(0, ...slices.map((s) => textWidth(s.name, 15, { weight: 600 })));
  const nameW = Math.min(colW - pctW - 16 - 96, Math.max(cols === 1 ? 200 : 150, Math.ceil(longest) + 42));
  const trackW = colW - nameW - pctW - 16;
  slices.forEach((s, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const x = lx0 + col * (colW + colGap);
    const y = firstY + row * pitch;
    const tx = x + nameW;
    const w = Math.max(3, s.share * trackW);
    parts.push(
      `<g class="fade" ${at(0.3 + i * 0.05)}><circle cx="${n(x + 5)}" cy="${n(y - 5)}" r="5" fill="${s.color}"/>` +
        `<text x="${n(x + 18)}" y="${n(y)}" class="sans" font-size="15" font-weight="600" fill="${s.other ? p.muted : p.text}">${esc(legendName(s.name, nameW - 30, 15))}</text>` +
        `<rect x="${n(tx)}" y="${n(y - 9)}" width="${n(trackW)}" height="8" rx="4" fill="${p.empty}"/>` +
        `<text x="${n(x + colW)}" y="${n(y)}" text-anchor="end" class="mono" font-size="13" fill="${p.muted}">${esc(s.pct)}</text></g>` +
        `<rect class="lg-seg" ${at(0.35 + i * 0.06)} x="${n(tx)}" y="${n(y - 9)}" width="${n(w)}" height="8" rx="4" fill="${s.color}"/>`,
    );
  });
  return { width: W, height: H, body: parts.join(''), defs: '', style };
}

function compactLayout({ prepared, head, p }: LayoutArgs): Drawn {
  const W = 400;
  const PAD = 24;
  const parts: string[] = [];
  if (head) parts.push(label(PAD, 40, fitLabel(head.title, W - PAD * 2), p));
  const barY = head ? 56 : PAD;
  const { slices } = prepared;
  const bar = stackedBar(slices, PAD, barY, W - PAD * 2, 10, p, 'lg-bar');
  parts.push(bar.svg);

  if (!slices.length) {
    const msg = emptyMessage(prepared);
    // A little narrower than the card so the second line never holds a lone word.
    const lines = wrapPx(msg.sub, 300, 12.5, {}, 2);
    parts.push(
      `<g class="fade" ${at(0.2)}><text x="${PAD}" y="${barY + 44}" class="sans" font-size="15" font-weight="600" fill="${p.text}">${esc(msg.title)}</text>` +
        lines.map((l, i) => `<text x="${PAD}" y="${barY + 66 + i * 18}" class="sans" font-size="12.5" fill="${p.muted}">${esc(l)}</text>`).join('') +
        '</g>',
    );
    return { width: W, height: barY + 66 + (lines.length - 1) * 18 + PAD, body: parts.join(''), defs: bar.defs };
  }

  const cols = 2;
  const colW = (W - PAD * 2) / cols;
  const first = barY + 10 + 32;
  const pitch = 27;
  slices.forEach((s, i) => {
    const lx = PAD + (i % cols) * colW;
    const ly = first + Math.floor(i / cols) * pitch;
    const pctW = textWidth(s.pct, 12, { mono: true });
    const name = legendName(s.name, colW - 16 - 6 - pctW - 12, 13.5);
    parts.push(
      `<g class="fade" ${at(0.3 + i * 0.05)}><circle cx="${n(lx + 5)}" cy="${n(ly - 4.5)}" r="5" fill="${s.color}"/>` +
        `<text x="${n(lx + 16)}" y="${n(ly)}"><tspan class="sans" font-size="13.5" font-weight="600" fill="${s.other ? p.muted : p.text}">${esc(name)}</tspan>` +
        `<tspan dx="6" class="mono" font-size="12" fill="${p.muted}">${esc(s.pct)}</tspan></text></g>`,
    );
  });
  const rows = Math.ceil(slices.length / cols);
  return { width: W, height: first + (rows - 1) * pitch + 22, body: parts.join(''), defs: bar.defs };
}

// ── Card ────────────────────────────────────────────────────────────────────

const WEIGHT_LABEL: Record<Weighting, { title: string; short: string }> = {
  commits: { title: 'Languages · weighted by commits', short: 'by commits' },
  bytes: { title: 'Languages · by code size', short: 'by code size' },
};

function render(ctx: RenderContext): CardImage[] {
  const p = ctx.palette;
  const o = readOptions(ctx.options);
  const layout = o.oneOf('layout', ['bar', 'donut', 'compact'] as const, 'bar');
  const { weighting, list } = pickSource(ctx.data, o.oneOf('weighting', ['commits', 'bytes'] as const, 'commits'));
  const prepared = prepareLanguages(list, { hide: o.list('hide', []), top: o.number('top', 6, { min: 1, max: 10 }) }, p);
  const customTitle = o.optionalString('title');
  const showTitle = !o.boolean('hideTitle', false);

  const scope =
    weighting === 'commits'
      ? 'last 12 months'
      : ctx.data.repos?.length
        ? `${ctx.data.repos.length} ${plural(ctx.data.repos.length, 'repository', 'repositories')}`
        : '';
  const info = [
    customTitle ? WEIGHT_LABEL[weighting].short : '',
    prepared.count ? `${prepared.count} ${plural(prepared.count, 'language')}` : '',
    prepared.count ? scope : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const head = showTitle ? { title: customTitle ?? WEIGHT_LABEL[weighting].title, info } : null;

  const args = { prepared, head, p };
  const drawn = layout === 'donut' ? donutLayout(args) : layout === 'compact' ? compactLayout(args) : barLayout(args);

  const summary = prepared.slices.length
    ? prepared.slices.map((s) => `${s.name} ${s.pct}`).join(', ')
    : emptyMessage(prepared).title;
  const what = `Most used languages (${WEIGHT_LABEL[weighting].short})`;

  const svg = shell({
    width: drawn.width,
    height: drawn.height,
    palette: p,
    title: what,
    desc: summary,
    defs: drawn.defs,
    style: STYLE + (drawn.style ?? ''),
    body: drawn.body,
    radius: layout === 'compact' ? 16 : 20,
    glow: layout === 'compact' ? null : { cx: 0, cy: 0, r: 0.9, color: p.accentA, opacity: p.glowOpacity * 0.18 },
    animate: ctx.animate,
  });
  return [{ name: 'languages', alt: `${what}: ${summary}`, svg, layout: layout === 'compact' ? 'half' : 'full' }];
}

export const card: CardDefinition = {
  id: 'languages',
  title: 'Languages',
  description:
    'Your most used languages in their real GitHub colours, weighted by your commits or by code size, as a stacked bar, a donut or a compact half-width card.',
  options: [
    {
      key: 'weighting',
      type: 'string',
      default: 'commits',
      description: '"commits" weights each repo\'s languages by your commits in the last 12 months; "bytes" uses raw code size.',
    },
    { key: 'layout', type: 'string', default: 'bar', description: '"bar" (stacked bar + legend), "donut" (donut + legend with bars) or "compact" (half-width card).' },
    { key: 'top', type: 'number', default: 6, description: 'Languages to show (1 to 10); the rest fold into "Other".' },
    { key: 'hide', type: 'list', default: [], description: 'Language names to leave out (case-insensitive), e.g. ["Jupyter Notebook", "HTML"].' },
    { key: 'title', type: 'string', description: 'Header label text. Defaults to a label that states the weighting.' },
    { key: 'hideTitle', type: 'boolean', default: false, description: 'Hide the header row and tighten the layout.' },
  ],
  render,
};
