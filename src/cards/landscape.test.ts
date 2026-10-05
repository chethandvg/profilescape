import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { yearWindow } from '../core/calendar.ts';
import { DEMO_NOW, demoProfile, emptyProfile } from '../core/fixtures.ts';
import { applyOverrides, getTheme } from '../core/themes.ts';
import type { CardOptions, Mode, ProfileData } from '../core/types.ts';
import { card } from './landscape.ts';

const theme = getTheme('aurora');

function render(data: ProfileData, opts: CardOptions = {}, mode: Mode = 'dark', animate = true): string {
  const images = card.render({ data, theme, palette: applyOverrides(theme[mode]), mode, options: opts, animate, now: DEMO_NOW });
  assert.equal(images.length, 1);
  const [img] = images;
  assert.ok(img);
  assert.equal(img.name, '3d');
  assert.equal(img.layout, 'full');
  return img.svg;
}

const count = (svg: string, needle: string) => svg.split(needle).length - 1;
const sumWindow = (data: ProfileData, weeks = 53) => yearWindow(data.calendar, DEMO_NOW, weeks).reduce((s, c) => s + c.count, 0);

function assertWellFormed(svg: string): void {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="\d+"/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.doesNotMatch(svg, /NaN|undefined|Infinity|null/);
  assert.ok(svg.length < 150 * 1024, `svg is ${svg.length} bytes`);
  // Every opened <g> and <text> is closed.
  assert.equal(count(svg, '<g'), count(svg, '</g>'));
  assert.equal(count(svg, '<text'), count(svg, '</text>'));
}

describe('3d landscape card', () => {
  it('is registered under the "3d" id with documented options', () => {
    assert.equal(card.id, '3d');
    const keys = card.options.map((o) => o.key).sort();
    assert.deepEqual(keys, ['height', 'hideTitle', 'insights', 'peak', 'scale', 'title', 'weeks']);
  });

  for (const mode of ['dark', 'light'] as const) {
    it(`renders demo data in ${mode} mode with its key values`, () => {
      const data = demoProfile();
      const svg = render(data, {}, mode);
      assertWellFormed(svg);
      const total = sumWindow(data);
      assert.ok(svg.includes(total.toLocaleString('en-US')), 'total contributions');
      assert.ok(svg.includes('contributions in the last year'));
      assert.ok(svg.includes('CONTRIBUTION LANDSCAPE'));
      for (const label of ['BEST DAY', 'BUSIEST MONTH', 'FAVOURITE WEEKDAY', 'ACTIVE DAYS']) assert.ok(svg.includes(label), label);
      const cells = yearWindow(data.calendar, DEMO_NOW, 53);
      const best = Math.max(...cells.map((c) => c.count));
      assert.ok(svg.includes(`peak ${best}/day`));
      // One bar (three faces) per active day; one week group per active week.
      const active = cells.filter((c) => c.count > 0).length;
      assert.equal(count(svg, '<path class="t'), active);
      assert.equal(count(svg, '<path class="f'), active);
      assert.equal(count(svg, '<path class="r'), active);
      assert.ok(svg.includes(`>${active}</text>`), 'active days value');
      // Peak pin and palette-driven colours.
      assert.ok(svg.includes('class="pin"'));
      assert.ok(svg.includes(theme[mode].panel));
    });

    it(`renders an empty profile in ${mode} mode as a tasteful empty state`, () => {
      const svg = render(emptyProfile(), {}, mode);
      assertWellFormed(svg);
      assert.ok(svg.includes('A blank canvas'));
      assert.ok(svg.includes('>0</tspan>'));
      assert.equal(count(svg, 'class="wk"'), 0, 'no bars');
      assert.equal(count(svg, 'class="pin"'), 0, 'no pin');
      assert.ok(!svg.includes('BEST DAY'));
      assert.ok(svg.includes('each tile is one day'));
    });
  }

  it('treats an all-zero year the same as no data', () => {
    const data = demoProfile();
    data.calendar = data.calendar.map((d) => ({ ...d, count: 0 }));
    const svg = render(data);
    assertWellFormed(svg);
    assert.ok(svg.includes('A blank canvas'));
    assert.equal(count(svg, 'class="wk"'), 0);
  });

  it('escapes hostile user text', () => {
    const data = { ...demoProfile(), name: '<script>alert(1)</script>&"\'' };
    const svg = render(data, { title: '<script>&"\'' });
    assertWellFormed(svg);
    assert.ok(!svg.includes('<script'));
    assert.ok(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;'));
    assert.ok(svg.includes('&lt;SCRIPT&gt;&amp;&quot;&#39;'));
  });

  it('truncates a very long title instead of overflowing', () => {
    const svg = render(demoProfile(), { title: 'x'.repeat(300) });
    assert.ok(svg.includes('…'));
    assert.ok(!svg.includes('X'.repeat(100)));
  });

  it('is deterministic', () => {
    const a = render(demoProfile(), { scale: 'log' }, 'light');
    const b = render(demoProfile(), { scale: 'log' }, 'light');
    assert.equal(a, b);
    assert.equal(render(emptyProfile()), render(emptyProfile()));
  });

  it('supports fewer weeks', () => {
    const data = demoProfile();
    const svg = render(data, { weeks: 26 });
    assertWellFormed(svg);
    assert.ok(svg.includes('contributions in the last 26 weeks'));
    assert.ok(svg.includes(sumWindow(data, 26).toLocaleString('en-US')));
    assert.ok(count(svg, 'class="wk"') <= 26);
    // Out-of-range and junk values fall back or clamp.
    assert.equal(render(data, { weeks: 'abc' }), render(data));
    assert.equal(render(data, { weeks: 500 }), render(data));
    assert.equal(render(data, { weeks: 3 }), render(data, { weeks: 26 }));
  });

  it('supports the three height scales', () => {
    const data = demoProfile();
    const sqrt = render(data);
    const linear = render(data, { scale: 'linear' });
    const log = render(data, { scale: 'LOG' });
    assert.ok(sqrt.includes('height ∝ √contributions'));
    assert.ok(linear.includes('height ∝ contributions'));
    assert.ok(log.includes('height ∝ log contributions'));
    assert.notEqual(sqrt, linear);
    assert.notEqual(sqrt, log);
    assert.equal(render(data, { scale: 'cubic' }), sqrt);
  });

  it('can hide insights, the title and the peak pin', () => {
    const data = demoProfile();
    const svg = render(data, { insights: false, hideTitle: true, peak: false });
    assertWellFormed(svg);
    assert.ok(!svg.includes('BEST DAY'));
    assert.ok(!svg.includes('CONTRIBUTION LANDSCAPE'));
    assert.ok(!svg.includes('class="pin"'));
    // Without a header the landscape moves up, so the card gets shorter.
    const h = (s: string) => Number(/height="(\d+)"/.exec(s)?.[1]);
    assert.ok(h(svg) < h(render(data)));
  });

  it('grows the card with the bar height option', () => {
    const h = (s: string) => Number(/height="(\d+)"/.exec(s)?.[1]);
    const data = demoProfile();
    assert.ok(h(render(data, { height: 240 })) > h(render(data)));
    assert.ok(h(render(data, { height: 40 })) < h(render(data)));
    assert.equal(render(data, { height: 9999 }), render(data, { height: 240 }));
  });

  it('keeps quiet days visible next to a huge outlier', () => {
    const data = demoProfile();
    data.calendar = data.calendar.map((d) => (d.date === '2026-06-10' ? { ...d, count: 5000 } : d));
    const svg = render(data);
    assertWellFormed(svg);
    assert.ok(svg.includes('peak 5,000/day'));
    // The smallest bar is still several px tall with sqrt scaling.
    const heights = [...svg.matchAll(/v-([\d.]+)/g)].map((m) => Number(m[1]));
    assert.ok(Math.min(...heights) >= 3);
    const ones = data.calendar.filter((d) => d.count === 1).length;
    if (ones) assert.ok(heights.some((v) => v > 3 && v < 10));
  });

  it('draws only the days so far in a partial current week', () => {
    const data = demoProfile();
    data.calendar = data.calendar.map((d) => ({ ...d, count: 1 }));
    const svg = render(data);
    // DEMO_NOW is a Monday: 52 full weeks plus Sunday and Monday.
    assert.equal(count(svg, '<path class="t'), 52 * 7 + DEMO_NOW.getUTCDay() + 1);
    assert.ok(svg.length < 150 * 1024);
  });

  it('stays within budget for a maximally busy year', () => {
    const data = demoProfile();
    data.calendar = data.calendar.map((d, i) => ({ ...d, count: 1 + (i % 97) * 13 }));
    const svg = render(data, { weeks: 53, height: 240 });
    assertWellFormed(svg);
  });

  it('ignores non-finite or negative counts', () => {
    const data = demoProfile();
    const last = data.calendar.length - 1;
    data.calendar = data.calendar.map((d, i) => (i === last ? { ...d, count: Number.NaN } : i === last - 1 ? { ...d, count: -4 } : d));
    assertWellFormed(render(data));
  });

  it('respects animate=false and staggers the rise animation otherwise', () => {
    const still = render(demoProfile(), {}, 'dark', false);
    assert.ok(still.includes('*{animation:none!important}'));
    const moving = render(demoProfile());
    assert.ok(!moving.includes('*{animation:none!important}'));
    const delays = [...moving.matchAll(/<g class="wk" style="animation-delay:([\d.]+)s">/g)].map((m) => Number(m[1]));
    assert.ok(delays.length > 40);
    for (let i = 1; i < delays.length; i++) assert.ok((delays[i] ?? 0) > (delays[i - 1] ?? 0), 'week groups rise left to right');
  });
});
