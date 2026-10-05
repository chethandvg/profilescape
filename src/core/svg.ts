import type { Palette } from './types.ts';

// Images in READMEs cannot load web fonts, so cards use system font stacks.
export const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Helvetica,Arial,sans-serif";
export const MONO = "ui-monospace,SFMono-Regular,'JetBrains Mono','Cascadia Code',Consolas,Menlo,monospace";

export const REDUCED_MOTION =
  '@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}';

export function esc(value: unknown): string {
  return String(value)
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

/** Truncate a single line to fit `maxWidth` pixels. */
export function fit(s: string, maxWidth: number, size: number, opts: { mono?: boolean; weight?: number } = {}): string {
  if (textWidth(s, size, opts) <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && textWidth(`${out}…`, size, opts) > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
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

export function linearGradient(id: string, from: string, to: string, vertical = false): string {
  const [x2, y2] = vertical ? ['0', '1'] : ['1', '0'];
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
}

export const delay = (seconds: number) => `style="animation-delay:${n(seconds, 3)}s"`;

/** The small uppercase mono label used at the top of every card. */
export function label(x: number, y: number, text: string, p: Palette, opts: { anchor?: 'start' | 'end'; color?: string } = {}): string {
  const anchor = opts.anchor === 'end' ? ' text-anchor="end"' : '';
  return `<text x="${n(x)}" y="${n(y)}"${anchor} class="mono" font-size="12" letter-spacing="1.4" fill="${opts.color ?? p.accentB}">${esc(text.toUpperCase())}</text>`;
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
