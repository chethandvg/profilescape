import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_NOW, demoProfile, emptyProfile } from '../core/fixtures.ts';
import { applyOverrides, getTheme } from '../core/themes.ts';
import type { CardOptions, Mode, ProfileData } from '../core/types.ts';
import { buildTile, card, computeFacts, DEFAULT_METRICS, METRIC_KEYS, parseMetrics } from './stats.ts';

const theme = getTheme('aurora');
const HOSTILE = `<script>&"'`;

function render(data: ProfileData = demoProfile(), options: CardOptions = {}, mode: Mode = 'dark', animate = true) {
  const images = card.render({ data, theme, palette: applyOverrides(theme[mode]), mode, options, animate, now: DEMO_NOW });
  assert.equal(images.length, 1);
  return images[0]!;
}

const height = (svg: string) => Number(/height="(\d+(?:\.\d+)?)"/.exec(svg)?.[1]);

/** Cheap well-formedness checks: no NaN/undefined leaks, no duplicate attributes, no raw markup injection. */
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

function calendarFrom(now: Date, counts: number[]) {
  // counts[0] is today, counts[1] yesterday, …
  const day = 86_400_000;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return counts.map((count, i) => ({ date: new Date(today - i * day).toISOString().slice(0, 10), count })).reverse();
}

describe('stats card', () => {
  it('declares its contract', () => {
    assert.equal(card.id, 'stats');
    assert.ok(card.description.length > 20);
    assert.deepEqual(
      card.options.map((o) => o.key),
      ['metrics', 'chart', 'title', 'hideTitle'],
    );
  });

  for (const mode of ['dark', 'light'] as const) {
    it(`renders demo data (${mode})`, () => {
      const data = demoProfile();
      const img = render(data, {}, mode);
      assertClean(img.svg);
      assert.equal(img.name, 'stats');
      assert.equal(img.layout, 'full');
      assert.match(img.svg, /width="1200"/);
      const facts = computeFacts(data, DEMO_NOW);
      assert.ok(img.svg.includes(`>${facts.yearTotal.toLocaleString('en-US')}</tspan>`), 'hero number');
      assert.ok(img.svg.includes(`peak ${facts.bestWeek}`), 'peak label');
      assert.ok(img.svg.includes('CURRENT STREAK') && img.svg.includes('ON GITHUB'), 'default tiles');
      assert.equal((img.svg.match(/class="st-bar"/g) ?? []).length, facts.weeks.filter((w) => w > 0).length);
      assert.match(img.alt, /contributions in the last 12 months/);
    });

    it(`renders an empty profile gracefully (${mode})`, () => {
      const img = render(emptyProfile(), {}, mode);
      assertClean(img.svg);
      assert.ok(img.svg.includes('No contributions yet'));
      assert.ok(img.svg.includes('>0</tspan>'));
      assert.ok(!img.svg.includes('st-bar"'), 'no growing bars without data');
      assert.ok(img.svg.includes('>4</tspan><tspan dx="6" font-size="13"'), 'account age in days');
      const compact = render(emptyProfile(), { chart: 'none' }, mode);
      assertClean(compact.svg);
    });
  }

  it('escapes hostile text', () => {
    const data = { ...demoProfile(), name: HOSTILE, login: HOSTILE };
    const img = render(data, { title: HOSTILE });
    assertClean(img.svg);
    assert.ok(img.svg.includes('&lt;SCRIPT&gt;&amp;&quot;&#39;'), 'title label escaped');
    assert.ok(img.svg.includes('&lt;script&gt;&amp;&quot;&#39;'), 'accessible title escaped');
  });

  it('is deterministic', () => {
    const a = render(demoProfile(), { metrics: METRIC_KEYS.slice(0, 9) });
    const b = render(demoProfile(), { metrics: METRIC_KEYS.slice(0, 9) });
    assert.equal(a.svg, b.svg);
  });

  it('parses metric lists forgivingly', () => {
    assert.deepEqual(parseMetrics(['current-streak', 'PRS', 'pull_requests', 'nope', 'stars']), ['currentStreak', 'pullRequests', 'stars']);
    assert.equal(parseMetrics([...METRIC_KEYS]).length, 9);
    const img = render(demoProfile(), { metrics: 'bogus' });
    for (const k of DEFAULT_METRICS) assert.ok(img.svg.includes(buildTile(k, computeFacts(demoProfile(), DEMO_NOW)).label.toUpperCase()));
  });

  it('renders every metric in the catalog, in order', () => {
    const facts = computeFacts(demoProfile(), DEMO_NOW);
    for (let i = 0; i < METRIC_KEYS.length; i += 7) {
      const keys = METRIC_KEYS.slice(i, i + 7);
      const img = render(demoProfile(), { metrics: keys });
      assertClean(img.svg);
      let last = -1;
      for (const k of keys) {
        const t = buildTile(k, facts);
        const at = img.svg.indexOf(`>${t.label.toUpperCase()}<`);
        assert.ok(at > last, `${k} appears after the previous tile`);
        assert.ok(img.svg.includes(`>${t.value}</tspan>`), `${k} value ${t.value}`);
        last = at;
      }
    }
  });

  it('adapts height to the number of tile rows', () => {
    const three = height(render(demoProfile(), { metrics: ['commits', 'stars', 'followers'] }).svg);
    const six = height(render(demoProfile()).svg);
    const nine = height(render(demoProfile(), { metrics: METRIC_KEYS.slice(0, 9) }).svg);
    assert.ok(three < six && six < nine);
    const four = render(demoProfile(), { metrics: ['commits', 'stars', 'followers', 'repos'] }).svg;
    assert.equal(height(four), six, '4 tiles use a 2×2 grid');
  });

  it('supports chart "none" as a compact numbers-only card', () => {
    const full = render(demoProfile());
    const compact = render(demoProfile(), { chart: 'none' });
    assertClean(compact.svg);
    assert.ok(height(compact.svg) < height(full.svg));
    assert.ok(!compact.svg.includes('st-bar"') && !compact.svg.includes('WEEKLY CONTRIBUTIONS'));
  });

  it('supports title and hideTitle', () => {
    assert.ok(render(demoProfile(), { title: 'My year' }).svg.includes('>MY YEAR<'));
    const hidden = render(demoProfile(), { hideTitle: true });
    assert.ok(!hidden.svg.includes('ACTIVITY · LAST 12 MONTHS') && !hidden.svg.includes('WEEKLY CONTRIBUTIONS'));
    assert.ok(height(hidden.svg) < height(render(demoProfile()).svg));
  });

  it('honours animate=false', () => {
    assert.ok(render(demoProfile(), {}, 'dark', false).svg.includes('*{animation:none!important}'));
  });

  it('computes facts from the calendar', () => {
    // Today 0 (does not break the streak), then 3 active days, a gap, then a 5-day run.
    const counts = [0, 2, 9, 1, 0, 4, 4, 4, 4, 4];
    const data = { ...emptyProfile(), calendar: calendarFrom(DEMO_NOW, counts), createdAt: '2025-01-01T00:00:00Z' };
    const f = computeFacts(data, DEMO_NOW);
    assert.equal(f.current, 3);
    assert.equal(f.longest, 5);
    assert.equal(f.allTime, 32);
    assert.equal(f.activeDays, 8);
    assert.equal(f.bestDay.count, 9);
    assert.equal(f.weeks.length, 52);
    assert.equal(f.weeks.at(-1), 2 + 9 + 1 + 0 + 4 + 4, 'last rolling week ends today');
    assert.equal(f.bestWeek, Math.max(...f.weeks));
    assert.equal(f.yearTotal, 32, 'falls back to the calendar when GitHub totals are missing');
    assert.deepEqual(f.age, { value: 1, unit: 'year' });
    assert.equal(f.since, '2026', 'a year-only calendar never claims older history');
    assert.equal(buildTile('allTime', f).unit, 'since 2026');
    assert.equal(buildTile('bestDay', f).unit, `on Oct 3`);
    const full = computeFacts({ ...data, calendar: [{ date: '2024-06-01', count: 1 }, ...data.calendar] }, DEMO_NOW);
    assert.equal(full.since, '2025', 'full history counts from the account creation year');
  });

  it('uses correct singular and plural units', () => {
    const f = computeFacts(demoProfile(), DEMO_NOW);
    assert.equal(buildTile('currentStreak', { ...f, current: 1 }).unit, 'day');
    assert.equal(buildTile('currentStreak', { ...f, current: 23 }).unit, 'days');
    assert.equal(buildTile('longestStreak', { ...f, longest: 0 }).unit, 'days');
    assert.equal(buildTile('years', { ...f, age: { value: 1, unit: 'year' } }).unit, 'year');
    assert.equal(buildTile('years', { ...f, age: { value: 7, unit: 'month' } }).unit, 'months');
    assert.equal(buildTile('stars', { ...f, stars: 12_345 }).value, '12.3k');
    assert.ok(render({ ...emptyProfile(), year: { ...emptyProfile().year, contributions: 1 } }).svg.includes('>contribution</tspan>'));
  });

  it('survives hostile numbers and malformed data', () => {
    const data = {
      ...demoProfile(),
      createdAt: 'not a date',
      totalStars: Number.NaN,
      followers: -5,
      calendar: [{ date: '2026-10-01', count: Number.POSITIVE_INFINITY }, { date: '2026-10-02', count: -3 }],
      year: { ...demoProfile().year, contributions: 9_876_543 },
    };
    const img = render(data, { metrics: [...METRIC_KEYS] });
    assertClean(img.svg);
    assert.ok(img.svg.includes('9.9M'));
  });
});
