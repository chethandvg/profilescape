import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_NOW, demoProfile, emptyProfile } from '../core/fixtures.ts';
import { applyOverrides, getTheme } from '../core/themes.ts';
import type { CardOptions, LanguageStat, Mode, ProfileData } from '../core/types.ts';
import { card, percentLabels, pickSource, prepareLanguages } from './languages.ts';

const theme = getTheme('aurora');
const palette = theme.dark;
const HOSTILE = `<script>&"'`;
const LAYOUTS = ['bar', 'donut', 'compact'] as const;

function render(data: ProfileData = demoProfile(), options: CardOptions = {}, mode: Mode = 'dark') {
  const images = card.render({ data, theme, palette: applyOverrides(theme[mode]), mode, options, animate: true, now: DEMO_NOW });
  assert.equal(images.length, 1);
  return images[0]!;
}

function assertClean(svg: string) {
  assert.ok(svg.startsWith('<svg'), 'starts with <svg');
  assert.doesNotMatch(svg, /NaN|undefined|Infinity|null/);
  assert.doesNotMatch(svg, /<script/i);
  for (const [, tag = '', attrs = ''] of svg.matchAll(/<([a-zA-Z]+)((?:\s[^>]*?)?)\/?>/g)) {
    const names = [...attrs.matchAll(/\s([a-zA-Z:-]+)=/g)].map((m) => m[1]);
    assert.equal(new Set(names).size, names.length, `duplicate attribute in <${tag}${attrs}>`);
  }
  assert.ok(svg.length < 150 * 1024, 'under 150 KB');
}

const sum = (labels: string[]) => Math.round(labels.reduce((s, l) => s + Number.parseFloat(l), 0) * 10) / 10;
const lang = (name: string, value: number, color = '#123456'): LanguageStat => ({ name, color, value });

describe('languages card', () => {
  it('declares its contract', () => {
    assert.equal(card.id, 'languages');
    assert.deepEqual(
      card.options.map((o) => o.key),
      ['weighting', 'layout', 'top', 'hide', 'title', 'hideTitle'],
    );
  });

  it('rounds percentages so they add up to exactly 100%', () => {
    assert.deepEqual(percentLabels([1, 1, 1]), ['33.4%', '33.3%', '33.3%']);
    assert.equal(sum(percentLabels([46, 21, 12, 9, 7, 3, 2])), 100);
    assert.equal(sum(percentLabels([812_000, 402_000, 301_000, 233_000, 154_000, 96_000, 28_000, 25_000, 22_000])), 100);
    assert.deepEqual(percentLabels([100_000, 1]), ['100.0%', '<0.1%']);
    assert.deepEqual(percentLabels([0, 0]), ['0%', '0%']);
  });

  it('folds the tail into Other, hides case-insensitively and merges duplicates', () => {
    const list = [lang('A', 50), lang('B', 20), lang('c', 10), lang('C', 5), lang('D', 8), lang('E', 4), lang('F', 3)];
    const p = prepareLanguages(list, { hide: ['b'], top: 2 }, palette);
    assert.deepEqual(
      p.slices.map((s) => s.name),
      ['A', 'c', 'Other'],
    );
    assert.equal(p.slices[1]!.value, 15, 'c and C merged');
    assert.equal(p.slices[2]!.color, palette.faint);
    assert.equal(p.count, 5);
    assert.equal(sum(p.slices.map((s) => s.pct)), 100);
    // A single leftover language keeps its own name instead of becoming "Other".
    const one = prepareLanguages([lang('A', 3), lang('B', 2), lang('C', 1)], { hide: [], top: 2 }, palette);
    assert.deepEqual(
      one.slices.map((s) => s.name),
      ['A', 'B', 'C'],
    );
  });

  it('sanitises colours and ignores invalid entries', () => {
    const p = prepareLanguages(
      [lang('X', 5, 'red;"><script>'), lang('', 3), lang('Y', Number.NaN), lang('Z', -1), lang('W', 2, '#ABC')],
      { hide: [], top: 6 },
      palette,
    );
    assert.deepEqual(
      p.slices.map((s) => [s.name, s.color]),
      [
        ['X', palette.muted],
        ['W', '#ABC'],
      ],
    );
  });

  it('falls back to code size when commit weighting has no data', () => {
    const data = { ...demoProfile(), languages: [] };
    assert.equal(pickSource(data, 'commits').weighting, 'bytes');
    assert.ok(render(data).svg.includes('LANGUAGES · BY CODE SIZE'));
  });

  for (const mode of ['dark', 'light'] as const) {
    for (const layout of LAYOUTS) {
      it(`renders demo data as ${layout} (${mode})`, () => {
        const img = render(demoProfile(), { layout }, mode);
        assertClean(img.svg);
        assert.equal(img.name, 'languages');
        assert.equal(img.layout, layout === 'compact' ? 'half' : 'full');
        assert.match(img.svg, new RegExp(`width="${layout === 'compact' ? 400 : 1200}"`));
        assert.ok(img.svg.includes('LANGUAGES · WEIGHTED BY COMMITS'));
        for (const [name, pct] of [
          ['TypeScript', '46.0%'],
          ['Rust', '21.0%'],
          ['Shell', '2.0%'],
        ] as const) {
          assert.ok(img.svg.includes(`>${name}<`), name);
          assert.ok(img.svg.includes(`>${pct}<`), pct);
        }
        assert.ok(img.svg.includes('fill="#3178c6"') || img.svg.includes('stroke="#3178c6"'), 'real language colour');
        assert.match(img.alt, /TypeScript 46\.0%/);
      });

      it(`renders an empty profile as ${layout} (${mode})`, () => {
        const img = render(emptyProfile(), { layout }, mode);
        assertClean(img.svg);
        assert.ok(img.svg.includes('No language data yet'));
      });
    }
  }

  it('states the weighting honestly', () => {
    const bytes = render(demoProfile(), { weighting: 'bytes' });
    assert.ok(bytes.svg.includes('LANGUAGES · BY CODE SIZE'));
    assert.ok(bytes.svg.includes('7 repositories'));
    const custom = render(demoProfile(), { title: 'Polyglot' });
    assert.ok(custom.svg.includes('>POLYGLOT<') && custom.svg.includes('by commits ·'));
  });

  it('supports top, hide and hideTitle', () => {
    const top2 = render(demoProfile(), { top: 2 });
    assert.ok(top2.svg.includes('>Other<') && !top2.svg.includes('>Go<'));
    const hidden = render(demoProfile(), { hide: 'typescript, RUST' });
    assert.ok(!hidden.svg.includes('>TypeScript<') && !hidden.svg.includes('>Rust<') && hidden.svg.includes('>Go<'));
    const all = render(demoProfile(), { hide: ['TypeScript', 'Rust', 'Go', 'C#', 'Python', 'CSS', 'Shell'], layout: 'compact' });
    assertClean(all.svg);
    assert.ok(all.svg.includes('All languages are hidden'));
    const untitled = render(demoProfile(), { hideTitle: true, layout: 'donut' });
    assert.ok(!untitled.svg.includes('WEIGHTED BY COMMITS'));
  });

  it('escapes hostile text', () => {
    const data = { ...demoProfile(), name: HOSTILE, languages: [lang(HOSTILE, 5, `"/><script>`), lang('Go', 3, '#00ADD8')] };
    for (const layout of LAYOUTS) {
      const img = render(data, { layout, title: HOSTILE });
      assertClean(img.svg);
      assert.ok(img.svg.includes('&lt;script&gt;&amp;&quot;&#39;'));
      assert.ok(img.svg.includes('&lt;SCRIPT&gt;&amp;&quot;&#39;'));
    }
  });

  it('is deterministic', () => {
    for (const layout of LAYOUTS) {
      assert.equal(render(demoProfile(), { layout, top: 3 }).svg, render(demoProfile(), { layout, top: 3 }).svg);
    }
  });

  it('handles a single language and the maximum number of slices', () => {
    const single = render({ ...demoProfile(), languages: [lang('Rust', 1, '#dea584')] }, { layout: 'donut' });
    assertClean(single.svg);
    assert.ok(single.svg.includes('>100.0%<'));
    const many = Array.from({ length: 14 }, (_, i) => lang(`Lang${i}`, 100 - i * 5));
    for (const layout of LAYOUTS) {
      const img = render({ ...demoProfile(), languages: many }, { layout, top: 10 });
      assertClean(img.svg);
      assert.ok(img.svg.includes('>Lang9<') && img.svg.includes('>Other<') && !img.svg.includes('>Lang10<'));
    }
  });
});
