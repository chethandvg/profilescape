import type { Palette } from './types.ts';

// Images in READMEs cannot load web fonts, so cards use system font stacks.
export const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Helvetica,Arial,sans-serif";
export const MONO = "ui-monospace,SFMono-Regular,'JetBrains Mono','Cascadia Code',Consolas,Menlo,monospace";

export const REDUCED_MOTION =
  '@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}';

/**
 * Characters XML 1.0 forbids: C0 controls other than tab, LF and CR, the
 * non-characters U+FFFE and U+FFFF, and unpaired surrogates. A single one makes
 * the whole SVG unparseable (a broken image), so esc() drops them.
 */
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Escape text for SVG element content and quoted attributes, dropping characters XML cannot hold. */
export function esc(value: unknown): string {
  return String(value)
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Round to at most `digits` decimals and drop trailing zeros, keeping SVG output small. */
export function n(value: number, digits = 1): string {
  const f = 10 ** digits;
  return String(Math.round(value * f) / f);
}

const NARROW = new Set("iljtfr.,:;'|!I ");
const WIDE = new Set('mwMW@');

/** Rough rendered width; good enough to lay out short labels next to each other. */
export function textWidth(s: string, size: number, opts: { mono?: boolean; weight?: number } = {}): number {
  const chars = [...s];
  if (opts.mono) return chars.length * size * 0.6;
  let narrow = 0;
  let wide = 0;
  for (const ch of chars) {
    if (NARROW.has(ch)) narrow++;
    else if (WIDE.has(ch)) wide++;
  }
  const factor = (opts.weight ?? 400) < 600 ? 0.53 : 0.57;
  return (chars.length - narrow * 0.45 + wide * 0.35) * size * factor;
}

/** Greedy word wrap by character count; the last kept line gets an ellipsis when truncated. */
export function wrap(s: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= maxChars) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${(kept[maxLines - 1] ?? '').replace(/[.,;:]+$/, '')}…`;
    return kept;
  }
  return lines;
}

export type TextOpts = { mono?: boolean; weight?: number };

/** Whitespace and separators that should never end a truncated line. */
const TRAILING_SEPARATORS = /[\s.,;:!?·|/-]+$/;

/** Truncate a single line to fit `maxWidth` pixels. */
export function fit(s: string, maxWidth: number, size: number, opts: TextOpts = {}): string {
  if (textWidth(s, size, opts) <= maxWidth) return s;
  // Slice by code point so emoji and other astral characters are never split.
  const chars = [...s];
  while (chars.length > 1 && textWidth(`${chars.join('')}…`, size, opts) > maxWidth) chars.pop();
  // Drop a dangling separator before the ellipsis ("slow ·…" → "slow…").
  const kept = chars.join('');
  return `${kept.replace(TRAILING_SEPARATORS, '') || kept.trimEnd()}…`;
}

/**
 * Word wrap by estimated pixel width. Words wider than a line are split, and
 * when the text needs more than `maxLines` the last kept line ends at a word
 * boundary with an ellipsis.
 */
export function wrapPx(
  text: string,
  maxWidth: number,
  size: number,
  opts: TextOpts = {},
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  const w = (s: string) => textWidth(s, size, opts);
  const words: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (w(word) <= maxWidth) {
      words.push(word);
      continue;
    }
    let rest = [...word];
    while (rest.length) {
      let cut = rest.length;
      while (cut > 1 && w(rest.slice(0, cut).join('')) > maxWidth) cut--;
      words.push(rest.slice(0, cut).join(''));
      rest = rest.slice(cut);
    }
  }
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (!cur || w(next) <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = word;
      if (lines.length > maxLines) break;
    }
  }
  if (cur && lines.length <= maxLines) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const trail = TRAILING_SEPARATORS;
  let last = (kept[maxLines - 1] ?? '').replace(trail, '');
  while (last && w(`${last}…`) > maxWidth) {
    const sp = last.lastIndexOf(' ');
    last = (sp > 0 ? last.slice(0, sp) : [...last].slice(0, -1).join('')).replace(trail, '');
  }
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/** Letter-spaced uppercase mono text, measured like label() draws it (12px, 1.4px tracking by default). */
export interface LabelMetrics {
  size?: number;
  spacing?: number;
}

/** Rendered width of a label() (or another tracked mono label with the given metrics). */
export function labelWidth(text: string, m: LabelMetrics = {}): number {
  return [...text].length * ((m.size ?? 12) * 0.6 + (m.spacing ?? 1.4));
}

/** Truncate label text so the rendered label stays within `maxWidth`. */
export function fitLabel(text: string, maxWidth: number, m: LabelMetrics = {}): string {
  if (labelWidth(text, m) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && labelWidth(`${chars.join('')}…`, m) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `value` (trimmed) when it is a strict #RGB or #RRGGBB colour, else `fallback`. Keeps untrusted colours out of attributes. */
export function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  return HEX_COLOR.test(v) ? v : fallback;
}

function rgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const v = Number.parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(v)) return [136, 136, 136];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function hex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Blend colour a toward b by k (0..1). */
export function mix(a: string, b: string, k: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return hex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

export const shade = (c: string, k: number) => mix(c, '#000000', k);
export const tint = (c: string, k: number) => mix(c, '#FFFFFF', k);

/** WCAG relative luminance. */
export function luminance(c: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(c);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** CIELAB (D65) coordinates of a colour: L* is perceived lightness, 0 (black) to 100 (white). */
export function lab(c: string): [number, number, number] {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(c).map(lin) as [number, number, number];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Perceived lightness (CIELAB L*, 0..100). */
export const lightness = (c: string): number => lab(c)[0];

/** CIE76 colour difference: about 2.3 is just noticeable, 10 or more is obvious at a glance. */
export function deltaE(a: string, b: string): number {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) / 6 : max === G ? ((B - R) / d + 2) / 6 : ((R - G) / d + 4) / 6;
  return [h, s, l];
}

/** CSS Color 4 HSL → RGB, with h, s, l in 0..1. */
function fromHsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (offset: number) => {
    const k = (offset + h * 12) % 12;
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return hex(f(0), f(8), f(4));
}

/**
 * A data colour (language or brand colour) that stays visible on `background`:
 * returned unchanged when it already reaches `min`:1 contrast, otherwise its
 * HSL lightness moves step by step toward `ink` (normally the theme's text
 * colour; without one, toward white or black, whichever contrasts more) until
 * it does. Hue and saturation are kept, so PowerShell's navy stays a blue on a
 * dark panel instead of fading into it.
 */
export function ensureContrast(color: string, background: string, min = 1.8, ink?: string): string {
  const lighter = ink ? luminance(ink) >= luminance(background) : contrast('#FFFFFF', background) >= contrast('#000000', background);
  const extreme = lighter ? '#FFFFFF' : '#000000';
  if (!HEX_COLOR.test(color.trim())) return ink ?? extreme;
  if (contrast(color, background) >= min) return color;
  const [h, s, l] = toHsl(rgb(color));
  const target = lighter ? 1 : 0;
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const out = fromHsl(h, s, l + ((target - l) * i) / steps);
    if (contrast(out, background) >= min) return out;
  }
  return ink ?? extreme;
}

export function linearGradient(id: string, from: string, to: string, vertical = false): string {
  const [x2, y2] = vertical ? ['0', '1'] : ['1', '0'];
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
}

export const delay = (seconds: number) => `style="animation-delay:${n(seconds, 3)}s"`;

/** Small-text contrast target (WCAG AA) for the 12px header labels. */
export const LABEL_CONTRAST = 4.5;

/** The header label colour: the theme's accentB, darkened or lightened just enough to read as small text on the panel. */
export function labelColor(p: Palette): string {
  return ensureContrast(p.accentB, p.panel, LABEL_CONTRAST, p.text);
}

/** The small uppercase mono label used at the top of every card. */
export function label(x: number, y: number, text: string, p: Palette, opts: { anchor?: 'start' | 'end'; color?: string } = {}): string {
  const anchor = opts.anchor === 'end' ? ' text-anchor="end"' : '';
  return `<text x="${n(x)}" y="${n(y)}"${anchor} class="mono" font-size="12" letter-spacing="1.4" fill="${opts.color ?? labelColor(p)}">${esc(text.toUpperCase())}</text>`;
}

export interface ShellOptions {
  width: number;
  height: number;
  palette: Palette;
  /** Accessible title, also used by screen readers. */
  title: string;
  desc?: string;
  body: string;
  defs?: string;
  style?: string;
  radius?: number;
  border?: boolean;
  background?: boolean;
  /** Soft radial glow; cx/cy/r are fractions of the card (0..1). */
  glow?: { cx: number; cy: number; r: number; color: string; opacity: number } | null;
  animate?: boolean;
}

/**
 * Standard card frame: background, optional glow, border, base classes
 * (.sans, .mono, .fade, .up) and reduced-motion handling.
 */
export function shell(o: ShellOptions): string {
  const { width: W, height: H, palette: p } = o;
  const r = o.radius ?? 20;
  const animate = o.animate ?? true;
  const glow = o.glow
    ? `<radialGradient id="ps-glow" cx="${o.glow.cx}" cy="${o.glow.cy}" r="${o.glow.r}"><stop offset="0" stop-color="${o.glow.color}" stop-opacity="${n(o.glow.opacity, 3)}"/><stop offset="1" stop-color="${o.glow.color}" stop-opacity="0"/></radialGradient>`
    : '';
  const base =
    `.sans{font-family:${SANS}}.mono{font-family:${MONO}}` +
    '.fade{animation:ps-fade .6s ease-out backwards}@keyframes ps-fade{from{opacity:0}}' +
    '.up{animation:ps-up .7s cubic-bezier(.2,.7,.2,1) backwards}@keyframes ps-up{from{opacity:0;transform:translateY(10px)}}' +
    REDUCED_MOTION +
    (animate ? '' : '*{animation:none!important}');
  const background =
    o.background === false
      ? ''
      : `<g clip-path="url(#ps-clip)"><rect width="${W}" height="${H}" fill="${p.panel}"/>${glow ? `<rect width="${W}" height="${H}" fill="url(#ps-glow)"/>` : ''}</g>`;
  const border =
    o.border === false
      ? ''
      : `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="${r}" fill="none" stroke="${p.border}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="ps-title">` +
    `<title id="ps-title">${esc(o.title)}</title>${o.desc ? `<desc>${esc(o.desc)}</desc>` : ''}` +
    `<defs><clipPath id="ps-clip"><rect width="${W}" height="${H}" rx="${r}"/></clipPath>${glow}${o.defs ?? ''}<style>${base}${o.style ?? ''}</style></defs>` +
    `${background}${o.body}${border}</svg>\n`
  );
}
