import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { contrast, labelColor, lightness, luminance } from './svg.ts';
import { PRESETS } from './theme-presets.ts';
import { applyOverrides, contribRamp, DEFAULT_THEME, getTheme, RAMP_STEP, themeIds, themeList, THEMES } from './themes.ts';
import type { Mode, Palette, SyntaxPalette, Theme } from './types.ts';

const MODES: Mode[] = ['dark', 'light'];
const HEX = /^#[0-9A-F]{6}$/;
const COLOR_KEYS = [
  'bg', 'panel', 'panelAlt', 'border', 'text', 'muted', 'faint', 'accentA', 'accentB',
  'success', 'chipBg', 'empty', 'grid',
] as const satisfies readonly (keyof Palette)[];
const SYNTAX_KEYS = [
  'keyword', 'type', 'string', 'property', 'number', 'punctuation', 'comment',
] as const satisfies readonly (keyof SyntaxPalette)[];
const REQUIRED = [
  'aurora', 'github', 'tokyonight', 'dracula', 'nord', 'catppuccin', 'gruvbox', 'solarized',
  'rosepine', 'onedark', 'everforest', 'kanagawa', 'monochrome', 'sunset',
];

const ALL: Theme[] = Object.values(THEMES);
const cases = ALL.flatMap((t) => MODES.map((mode) => ({ name: `${t.id}/${mode}`, theme: t, mode, p: t[mode] })));

/** CIE76 ΔE in CIELAB: ~2.3 is a just-noticeable difference, 10+ is obvious at a glance. */
function deltaE(a: string, b: string): number {
  const lab = (hex: string): [number, number, number] => {
    const v = Number.parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => {
      const s = x / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * bl);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const ratio = (a: string, b: string) => Math.round(contrast(a, b) * 100) / 100;

describe('theme registry', () => {
  test('ships Aurora plus every required preset', () => {
    assert.ok(ALL.length >= 14, `expected at least 14 themes, got ${ALL.length}`);
    for (const id of REQUIRED) assert.ok(THEMES[id], `missing theme "${id}"`);
    assert.equal(DEFAULT_THEME, 'aurora');
    assert.equal(themeIds()[0], 'aurora', 'the default theme is listed first');
  });

  test('ids are unique, lowercase and space-free; labels are human readable', () => {
    const ids = [THEMES.aurora as Theme, ...PRESETS].map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids.join(', ')}`);
    for (const t of ALL) {
      assert.match(t.id, /^[a-z0-9-]+$/, `id "${t.id}"`);
      assert.ok(t.label.trim().length > 0 && t.label === t.label.trim(), `label of ${t.id}`);
      assert.notEqual(t.label, t.id, `${t.id} label should be human readable`);
    }
    assert.equal(new Set(ALL.map((t) => t.label.toLowerCase())).size, ALL.length, 'labels are unique');
  });

  test('themeIds and themeList cover every theme', () => {
    assert.deepEqual(themeIds(), Object.keys(THEMES));
    assert.deepEqual(
      themeList(),
      ALL.map((t) => ({ id: t.id, label: t.label })),
    );
  });

  test('getTheme resolves ids case-insensitively and falls back to aurora', () => {
    assert.equal(getTheme('dracula'), THEMES.dracula);
    assert.equal(getTheme('Dracula'), THEMES.dracula);
    assert.equal(getTheme('  TOKYONIGHT '), THEMES.tokyonight);
    assert.equal(getTheme('RosePine'), THEMES.rosepine);
    assert.equal(getTheme('does-not-exist'), THEMES.aurora);
    assert.equal(getTheme(''), THEMES.aurora);
    assert.equal(getTheme(undefined), THEMES.aurora);
    assert.equal(getTheme('<script>&"\''), THEMES.aurora);
  });

  // getTheme indexes a plain object, so inherited keys resolve to Object.prototype
  // members instead of falling back. Needs an own-property check in themes.ts.
  test('getTheme ignores inherited object keys', () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.equal(getTheme(key).id, 'aurora', key);
    }
  });
});

describe('palettes', () => {
  for (const { name, p, mode } of cases) {
    describe(name, () => {
      test('every colour is a #RRGGBB hex', () => {
        for (const key of COLOR_KEYS) assert.match(p[key], HEX, `${key} = ${p[key]}`);
        for (const key of SYNTAX_KEYS) assert.match(p.syntax[key], HEX, `syntax.${key} = ${p.syntax[key]}`);
        assert.deepEqual(Object.keys(p.syntax).sort(), [...SYNTAX_KEYS].sort(), 'syntax has exactly the documented keys');
      });

      test('mode matches the surface brightness', () => {
        if (mode === 'dark') {
          assert.ok(luminance(p.panel) < 0.1, `dark panel ${p.panel} is too bright`);
          assert.ok(luminance(p.text) > luminance(p.panel));
        } else {
          assert.ok(luminance(p.panel) > 0.6, `light panel ${p.panel} is too dark`);
          assert.ok(luminance(p.text) < luminance(p.panel));
        }
      });

      test('text tiers meet contrast targets and stay ordered', () => {
        const text = ratio(p.text, p.panel);
        const muted = ratio(p.muted, p.panel);
        const faint = ratio(p.faint, p.panel);
        assert.ok(text >= 7, `text ${p.text} on ${p.panel}: ${text}`);
        assert.ok(muted >= 4.5, `muted ${p.muted} on ${p.panel}: ${muted}`);
        // faint is for separators, placeholders and decoration; informative text uses muted.
        assert.ok(faint >= 3, `faint ${p.faint} on ${p.panel}: ${faint}`);
        assert.ok(text > muted && muted > faint, `tiers out of order: ${text} > ${muted} > ${faint}`);
        // Text also sits on raised tiles.
        assert.ok(ratio(p.text, p.panelAlt) >= 6, `text on panelAlt: ${ratio(p.text, p.panelAlt)}`);
        assert.ok(ratio(p.muted, p.panelAlt) >= 4, `muted on panelAlt: ${ratio(p.muted, p.panelAlt)}`);
      });

      test('accents are legible for labels and large numbers', () => {
        assert.ok(ratio(p.accentA, p.panel) >= 3, `accentA ${p.accentA}: ${ratio(p.accentA, p.panel)}`);
        assert.ok(ratio(p.accentB, p.panel) >= 3, `accentB ${p.accentB}: ${ratio(p.accentB, p.panel)}`);
        assert.ok(ratio(p.success, p.panel) >= 2.5, `success ${p.success}: ${ratio(p.success, p.panel)}`);
        assert.ok(deltaE(p.accentA, p.accentB) >= 10, 'accentA → accentB should read as a gradient');
      });

      test('surfaces layer as distinct but subtle', () => {
        const alt = ratio(p.panelAlt, p.panel);
        const border = ratio(p.border, p.panel);
        const chip = ratio(p.chipBg, p.panel);
        const empty = ratio(p.empty, p.panel);
        assert.ok(alt >= 1.03 && alt <= 1.3, `panelAlt vs panel: ${alt}`);
        assert.ok(chip >= 1.03 && chip <= 1.3, `chipBg vs panel: ${chip}`);
        assert.ok(border >= 1.1 && border <= 1.8, `border vs panel: ${border}`);
        assert.ok(border > alt, 'the border must stand out from raised tiles');
        assert.ok(empty >= 1.08 && empty <= 1.6, `empty cell vs panel: ${empty}`);
      });

      test('decorative strengths stay in range', () => {
        const [lo, hi] = mode === 'dark' ? [0.4, 0.65] : [0.15, 0.32];
        assert.ok(p.glowOpacity >= lo && p.glowOpacity <= hi, `glowOpacity ${p.glowOpacity}`);
        assert.ok(p.gridOpacity > 0 && p.gridOpacity <= 0.08, `gridOpacity ${p.gridOpacity}`);
      });

      test('syntax colours are readable on code surfaces', () => {
        for (const key of SYNTAX_KEYS) {
          const c = p.syntax[key];
          const worst = Math.min(ratio(c, p.panel), ratio(c, p.panelAlt));
          assert.ok(worst >= 2, `syntax.${key} ${c}: ${worst}`);
        }
        const distinct = new Set(SYNTAX_KEYS.filter((k) => k !== 'punctuation').map((k) => p.syntax[k]));
        assert.ok(distinct.size >= 5, 'syntax roles should use at least five distinct colours');
      });

      test('contribution ramp rises visibly from empty to busiest', () => {
        const ramp = contribRamp(p, mode);
        assert.equal(ramp.length, 5);
        assert.equal(ramp[0], p.empty);
        for (const c of ramp) assert.match(c, HEX);
        const [empty, l1] = ramp;
        const first = ratio(l1, empty);
        assert.ok(first >= 1.15, `level 1 vs empty: ${first}`);
        for (let i = 1; i < ramp.length; i++) {
          const a = ramp[i - 1] as string;
          const b = ramp[i] as string;
          assert.notEqual(a, b);
          assert.ok(deltaE(a, b) >= 10, `levels ${i - 1}→${i} (${a} → ${b}) are too similar: ΔE ${deltaE(a, b).toFixed(1)}`);
        }
        for (let i = 2; i < ramp.length; i++) {
          assert.ok(ratio(ramp[i] as string, empty) >= first, `level ${i} must stand out from empty at least as much as level 1`);
        }
      });

      test('contribution ramp gets lighter (dark) or darker (light) at every level', () => {
        const ramp = contribRamp(p, mode);
        for (let i = 1; i < ramp.length; i++) {
          const a = ramp[i - 1] as string;
          const b = ramp[i] as string;
          const step = mode === 'dark' ? lightness(b) - lightness(a) : lightness(a) - lightness(b);
          assert.ok(step >= RAMP_STEP - 0.01, `levels ${i - 1}→${i} (${a} → ${b}): L* step ${step.toFixed(1)}`);
          assert.ok(ratio(a, b) >= 1.2, `levels ${i - 1}→${i} (${a} → ${b}): contrast ${ratio(a, b)}`);
        }
      });

      test('header labels reach small-text contrast', () => {
        const c = labelColor(p);
        assert.ok(ratio(c, p.panel) >= 4.5, `label ${c} on ${p.panel}: ${ratio(c, p.panel)}`);
        if (ratio(p.accentB, p.panel) >= 4.5) assert.equal(c, p.accentB, 'an accent that already passes is used as is');
      });
    });
  }
});

describe('applyOverrides', () => {
  const base = (THEMES.aurora as Theme).dark;

  test('returns a copy and never mutates the preset', () => {
    const before = JSON.stringify(base);
    const out = applyOverrides(base, { accentA: '#FF0000', syntax: { keyword: '#00FF00' } });
    assert.equal(JSON.stringify(base), before);
    assert.notEqual(out, base);
    assert.notEqual(out.syntax, base.syntax);
    assert.deepEqual(applyOverrides(base), base);
  });

  test('merges top-level colours and partial syntax', () => {
    const out = applyOverrides(base, { accentA: '#FF0000', syntax: { keyword: '#00FF00' } });
    assert.equal(out.accentA, '#FF0000');
    assert.equal(out.accentB, base.accentB);
    assert.equal(out.syntax.keyword, '#00FF00');
    for (const key of SYNTAX_KEYS.filter((k) => k !== 'keyword')) assert.equal(out.syntax[key], base.syntax[key]);
  });

  test('applies overrides in order and skips undefined layers', () => {
    const out = applyOverrides(
      base,
      { text: '#111111', syntax: { string: '#222222', number: '#333333' } },
      undefined,
      { text: '#444444', syntax: { number: '#555555' } },
      {},
    );
    assert.equal(out.text, '#444444');
    assert.equal(out.syntax.string, '#222222');
    assert.equal(out.syntax.number, '#555555');
    assert.equal(out.syntax.comment, base.syntax.comment);
  });

  test('overriding without syntax keeps the full syntax palette', () => {
    const out = applyOverrides(base, { panel: '#000000' });
    assert.deepEqual(out.syntax, base.syntax);
    assert.equal(out.panel, '#000000');
  });
});

describe('contribRamp', () => {
  test('is deterministic', () => {
    for (const { p, mode } of cases) assert.deepEqual(contribRamp(p, mode), contribRamp(p, mode));
  });

  test('follows palette overrides', () => {
    const p = applyOverrides((THEMES.nord as Theme).dark, { empty: '#000000' });
    assert.equal(contribRamp(p, 'dark')[0], '#000000');
  });
});
