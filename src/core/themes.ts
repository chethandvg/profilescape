import { contrast, deltaE, lightness, mix, shade } from './svg.ts';
import { PRESETS } from './theme-presets.ts';
import type { Mode, Palette, PaletteOverrides, Theme } from './types.ts';

/** Profilescape's signature theme: violet rising into cyan. */
const aurora: Theme = {
  id: 'aurora',
  label: 'Aurora',
  dark: {
    bg: '#0B0D14',
    panel: '#11141D',
    panelAlt: '#161A26',
    border: '#232838',
    text: '#E6E8F0',
    muted: '#8B93A7',
    faint: '#5C637A',
    accentA: '#8B7CFF',
    accentB: '#3EC6E0',
    success: '#3FB950',
    chipBg: '#171B28',
    empty: '#1A1F2C',
    grid: '#FFFFFF',
    gridOpacity: 0.045,
    glowOpacity: 0.55,
    syntax: {
      keyword: '#C792EA',
      type: '#7FDBCA',
      string: '#C3E88D',
      property: '#82AAFF',
      number: '#F78C6C',
      punctuation: '#89DDFF',
      comment: '#5A6178',
    },
  },
  light: {
    bg: '#FBFBFE',
    panel: '#FFFFFF',
    panelAlt: '#F4F5FA',
    border: '#E3E6EF',
    text: '#0F172A',
    muted: '#525B70',
    faint: '#8A92A6',
    accentA: '#5B4BFF',
    accentB: '#0E9DB8',
    success: '#1A7F37',
    chipBg: '#F1F2F8',
    empty: '#EDEFF5',
    grid: '#0F172A',
    gridOpacity: 0.05,
    glowOpacity: 0.28,
    syntax: {
      keyword: '#8E44C9',
      type: '#0B8A7A',
      string: '#4E8A12',
      property: '#2F5FD0',
      number: '#C2541E',
      punctuation: '#0E7FA0',
      comment: '#8A92A6',
    },
  },
};

export const THEMES: Record<string, Theme> = Object.fromEntries([aurora, ...PRESETS].map((t) => [t.id, t]));

export const DEFAULT_THEME = 'aurora';

export function themeIds(): string[] {
  return Object.keys(THEMES);
}

export function themeList(): { id: string; label: string }[] {
  return Object.values(THEMES).map((t) => ({ id: t.id, label: t.label }));
}

export function getTheme(id: string | undefined): Theme {
  const key = (id ?? DEFAULT_THEME).trim().toLowerCase();
  return (Object.hasOwn(THEMES, key) ? THEMES[key] : THEMES[DEFAULT_THEME]) as Theme;
}

export function applyOverrides(base: Palette, ...overrides: (PaletteOverrides | undefined)[]): Palette {
  let out: Palette = { ...base, syntax: { ...base.syntax } };
  for (const o of overrides) {
    if (!o) continue;
    const { syntax, ...rest } = o;
    out = { ...out, ...rest, syntax: { ...out.syntax, ...(syntax ?? {}) } };
  }
  return out;
}

/** Minimum perceived-lightness step (CIELAB L*) between neighbouring contribution levels. */
export const RAMP_STEP = 7;

/**
 * Five contribution levels (none → busiest). Shared by every contribution
 * visual so colour always means "how much". The hues run empty → accentA →
 * accentB, and lightness always moves one way: each level is at least
 * RAMP_STEP lighter than the one before on a dark panel, or darker on a light
 * one, and visibly different (CIE76 ΔE of 10 or more). A level that falls
 * short is pushed toward white (dark) or black (light) until it does, so a
 * light accentB never makes the busiest days look quieter than the middle ones.
 */
export function contribRamp(p: Palette, mode: Mode): [string, string, string, string, string] {
  const dark = mode === 'dark';
  const peak = dark ? mix(p.accentB, '#FFFFFF', 0.35) : shade(p.accentB, 0.15);
  const ramp: [string, string, string, string, string] = [
    p.empty,
    mix(p.empty, p.accentA, 0.45),
    p.accentA,
    mix(p.accentA, p.accentB, 0.6),
    peak,
  ];
  const toward = dark ? '#FFFFFF' : '#000000';
  const rise = (a: string, b: string) => (dark ? lightness(b) - lightness(a) : lightness(a) - lightness(b));
  for (let i = 1; i < ramp.length; i++) {
    const prev = ramp[i - 1] as string;
    const base = ramp[i] as string;
    let c = base;
    const distinct = (x: string) => rise(prev, x) >= RAMP_STEP && deltaE(prev, x) >= 10;
    for (let s = 1; s <= 40 && !distinct(c); s++) c = mix(base, toward, s / 40);
    ramp[i] = c;
  }
  return ramp;
}

/**
 * Colour for an "Other" slice (several languages folded together): the first
 * neutral from the palette that stays visibly different (CIE76 ΔE of 12 or
 * more) from every named slice, so a language without a GitHub colour, which
 * arrives grey, never looks like "Other". Falls back to the most distinct one.
 */
export function otherColor(p: Palette, used: readonly string[]): string {
  const candidates = [p.faint, mix(p.faint, p.text, 0.45), mix(p.faint, p.panel, 0.45), p.muted];
  let best = p.faint;
  let bestScore = -1;
  for (const c of candidates) {
    if (contrast(c, p.panel) < 1.3) continue;
    const score = Math.min(Number.POSITIVE_INFINITY, ...used.map((u) => deltaE(c, u)));
    if (score >= 12) return c;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
