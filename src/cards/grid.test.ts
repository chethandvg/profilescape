import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { levelScale, yearWindow } from '../core/calendar.ts';
import { DEMO_NOW, demoProfile, emptyProfile } from '../core/fixtures.ts';
import { shortDate } from '../core/format.ts';
import { contribRamp, getTheme } from '../core/themes.ts';
import type { CardOptions, Mode, ProfileData } from '../core/types.ts';
import { card } from './grid.ts';

const theme = getTheme('aurora');

function render(opts: { data?: ProfileData; mode?: Mode; options?: CardOptions; animate?: boolean } = {}): string {
  const mode = opts.mode ?? 'dark';
  const images = card.render({
    data: opts.data ?? demoProfile(),
    theme,
    palette: theme[mode],
    mode,
    options: opts.options ?? {},
    animate: opts.animate ?? true,
    now: DEMO_NOW,
  });
  assert.equal(images.length, 1);
  const [img] = images;
  assert.ok(img);
  assert.equal(img.name, 'grid');
  assert.equal(img.layout, 'full');
  return img.svg;
}

const cellRects = (svg: string) => [...svg.matchAll(/<rect class="l(\d)[^"]*" x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" rx="[^"]+" fill="(#[0-9A-F]{6})"\/>/g)];
const width = (svg: string) => Number(/width="(\d+)"/.exec(svg)?.[1]);
const height = (svg: string) => Number(/height="(\d+)"/.exec(svg)?.[1]);

describe('grid card', () => {
  it('declares its id and documented options', () => {
    assert.equal(card.id, 'grid');
    const keys = card.options.map((o) => o.key);
    for (const k of ['style', 'weeks', 'cellSize', 'title', 'hideTitle', 'hideStats', 'loop']) assert.ok(keys.includes(k), k);
  });

  for (const mode of ['dark', 'light'] as const) {
    for (const style of ['pulse', 'rain']) {
      it(`renders demo data (${style}, ${mode}) with the full chrome`, () => {
        const data = demoProfile();
        const svg = render({ data, mode, options: { style } });
        const cells = yearWindow(data.calendar, DEMO_NOW, 53);
        const total = cells.reduce((s, c) => s + c.count, 0);
        const active = cells.filter((c) => c.count > 0).length;
        assert.ok(svg.startsWith('<svg'));
        assert.equal(width(svg), 1200);
        assert.ok(svg.includes(total.toLocaleString('en-US')), 'total');
        assert.ok(svg.includes(`>${active}<`), 'active days');
        const best = cells.reduce((b, c) => (c.count >= b.count ? c : b));
        assert.ok(svg.includes(`on ${shortDate(best.date)}`), 'best day date');
        assert.ok(svg.includes(`>${best.count}<`), 'best day count');
        for (const t of ['>Mon<', '>Wed<', '>Fri<', '>Less<', '>More<', 'CONTRIBUTIONS · LAST 12 MONTHS']) {
          assert.ok(svg.includes(t), t);
        }
        assert.ok(svg.length < 120 * 1024, `size ${svg.length}`);
        assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
      });

      it(`static frame is the complete, correctly coloured grid (${style}, ${mode})`, () => {
        const data = demoProfile();
        const svg = render({ data, mode, options: { style } });
        const cells = yearWindow(data.calendar, DEMO_NOW, 53);
        const level = levelScale(cells.map((c) => c.count));
        const ramp = contribRamp(theme[mode], mode);
        const rects = cellRects(svg);
        assert.equal(rects.length, cells.length);
        rects.forEach((m, i) => {
          const c = cells[i];
          assert.ok(c);
          assert.equal(Number(m[1]), level(c.count), c.date);
          assert.equal(m[2], ramp[level(c.count)], c.date);
        });
        // Decorations only exist while animating: their resting state is invisible.
        for (const m of svg.matchAll(/<(?:rect|g|path) class="(?:scan|sp [^"]+)"([^>]*)>/g)) {
          assert.match(m[1] ?? '', /opacity="0"/);
        }
      });
    }
  }

  it('uses CSS keyframes only, one delay per column rather than per cell', () => {
    for (const style of ['pulse', 'rain']) {
      const svg = render({ options: { style } });
      assert.doesNotMatch(svg, /<animate|<set |<animateTransform|<script/);
      assert.equal([...svg.matchAll(/<g class="c" style="animation-delay:[\d.]+s">/g)].length, 53);
      assert.doesNotMatch(svg, /<rect[^>]*style=/);
      assert.match(svg, /@keyframes/);
    }
  });

  it('pulse: per-level keyframes, synced scanline and inherited column delays', () => {
    const svg = render();
    for (let l = 0; l <= 4; l++) assert.ok(svg.includes(`@keyframes ps-p${l}{`), `level ${l}`);
    assert.ok(svg.includes('animation-delay:inherit'));
    assert.ok(svg.includes('transform-box:fill-box'));
    assert.ok(svg.includes('@keyframes ps-scan{'));
    assert.ok(svg.includes(' infinite '));
    // Columns sweep left to right.
    const delays = [...svg.matchAll(/<g class="c" style="animation-delay:([\d.]+)s">/g)].map((m) => Number(m[1]));
    for (let i = 1; i < delays.length; i++) assert.ok((delays[i] ?? 0) > (delays[i - 1] ?? 0));
  });

  it('rain: columns drop in, then the busiest days twinkle in staggered groups', () => {
    const data = demoProfile();
    const svg = render({ data, options: { style: 'rain' } });
    const cells = yearWindow(data.calendar, DEMO_NOW, 53);
    const level = levelScale(cells.map((c) => c.count));
    const busiest = cells.filter((c) => level(c.count) === 4).length;
    assert.ok(busiest > 0);
    assert.ok(svg.includes('@keyframes ps-drop{'));
    assert.ok(svg.includes('@keyframes ps-tw{'));
    assert.equal([...svg.matchAll(/class="l4 tw t\d"/g)].length, busiest);
    assert.equal([...svg.matchAll(/<path class="sp t\d" opacity="0"/g)].length, busiest);
    assert.ok(new Set([...svg.matchAll(/class="sp (t\d)"/g)].map((m) => m[1])).size > 1, 'staggered groups');
    assert.doesNotMatch(svg, /ps-scan/);
  });

  it('renders a friendly empty state without throwing', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const style of ['pulse', 'rain']) {
        const svg = render({ data: emptyProfile(), mode, options: { style } });
        assert.ok(svg.includes('No contributions yet'));
        assert.ok(svg.includes('>0<'));
        assert.ok(svg.includes('contributions'));
        assert.doesNotMatch(svg, /best day/);
        assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
        assert.equal(cellRects(svg).length, yearWindow([], DEMO_NOW, 53).length);
        assert.doesNotMatch(svg, /class="sp /);
      }
    }
  });

  it('survives malformed calendar data', () => {
    const data = { ...demoProfile(), calendar: [{ date: '2026-10-01', count: Number.NaN }, { date: '2026-10-02', count: -4 }, { date: '2026-10-03', count: 2.7 }] };
    const svg = render({ data });
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    assert.ok(svg.includes('>2<'));
  });

  it('escapes hostile text and keeps long titles inside the card', () => {
    const svg = render({ options: { title: `<script>&"'` } });
    assert.ok(svg.includes('&lt;SCRIPT&gt;&amp;&quot;&#39;'));
    assert.doesNotMatch(svg, /<script/i);
    const long = render({ options: { title: 'x'.repeat(400) } });
    assert.ok(long.includes('…'));
    const emoji = render({ options: { title: '🚀'.repeat(200) } });
    assert.ok(emoji.includes('…'));
    assert.doesNotMatch(emoji, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, 'no lone surrogates');
  });

  it('is deterministic', () => {
    for (const style of ['pulse', 'rain']) {
      assert.equal(render({ options: { style } }), render({ options: { style } }));
    }
  });

  it('respects animate=false and loop=false', () => {
    assert.ok(render({ animate: false }).includes('*{animation:none!important}'));
    for (const style of ['pulse', 'rain']) {
      const once = render({ options: { style, loop: false } });
      assert.doesNotMatch(once, /infinite/);
    }
  });

  it('reads options forgivingly', () => {
    const count = (svg: string) => [...svg.matchAll(/<g class="c" /g)].length;
    assert.equal(count(render({ options: { weeks: 10 } })), 26);
    assert.equal(count(render({ options: { weeks: 99 } })), 53);
    assert.equal(count(render({ options: { weeks: '40' } })), 40);
    assert.ok(render({ options: { weeks: 30 } }).includes('LAST 30 WEEKS'));
    assert.ok(render({ options: { style: 'bogus' } }).includes('ps-scan'));
    assert.ok(render({ options: { style: 'RAIN' } }).includes('ps-drop'));
  });

  it('hides the title and stats on request', () => {
    const full = render();
    const bare = render({ options: { hideTitle: true, hideStats: true } });
    assert.doesNotMatch(bare, /CONTRIBUTIONS · LAST/);
    assert.doesNotMatch(bare, /fill="url\(#ps-grid-num\)"|best day</);
    assert.ok(height(bare) < height(full));
    assert.ok(bare.includes('>Mon<'));
  });

  it('sizes cells from cellSize, never exceeding 1200px', () => {
    const small = render({ options: { cellSize: 10 } });
    assert.ok(width(small) < 1200);
    assert.ok(width(small) >= 600, 'room for the chrome');
    assert.ok(small.includes('width="10"'));
    assert.equal(width(render({ options: { cellSize: 500 } })), 1200);
    assert.equal(width(render({ options: { cellSize: 'auto' } })), 1200);
  });
});
