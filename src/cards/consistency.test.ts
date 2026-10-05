import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MONTHS } from '../core/format.ts';
import { DEMO_NOW, demoProfile } from '../core/fixtures.ts';
import { getTheme } from '../core/themes.ts';
import type { CardDefinition, CardOptions, ProfileData } from '../core/types.ts';
import { card as grid } from './grid.ts';
import { card as landscape } from './landscape.ts';
import { computeFacts, card as stats } from './stats.ts';

const DAY = 86_400_000;

function svgOf(card: CardDefinition, data: ProfileData, now: Date, options: CardOptions = {}): string {
  const theme = getTheme('aurora');
  const img = card.render({ data, theme, palette: theme.dark, mode: 'dark', options, animate: true, now })[0];
  assert.ok(img);
  return img.svg;
}

const fmt = (v: number) => v.toLocaleString('en-US');

/** Month names drawn along an axis, in order (both cards draw them as bare 3-letter text nodes). */
const monthAxis = (svg: string) => [...svg.matchAll(/>([A-Z][a-z]{2})<\/text>/g)].map((m) => m[1]).filter((m) => (MONTHS as readonly string[]).includes(m ?? ''));

describe('cards agree on "the last year"', () => {
  for (let k = 0; k < 7; k++) {
    const now = new Date(DEMO_NOW.getTime() + k * DAY);
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    test(`stats, 3D and grid state the same total and active days on a ${weekday}`, () => {
      const data = demoProfile(now);
      const f = computeFacts(data, now);
      assert.equal(f.yearTotal, data.year.contributions);
      assert.equal(f.windowDays, 366);
      const total = fmt(f.yearTotal);
      assert.ok(svgOf(stats, data, now).includes(`>${total}</tspan>`), 'stats');
      const land = svgOf(landscape, data, now);
      assert.ok(land.includes(`>${total}</tspan>`), '3D headline');
      assert.ok(land.includes(`Active on ${f.activeDays} of ${f.windowDays} days.`), '3D active days');
      const g = svgOf(grid, data, now);
      assert.ok(g.includes(`>${total}</tspan>`), 'grid total');
      assert.ok(g.includes(`${fmt(f.activeDays)} ${f.activeDays === 1 ? 'active day' : 'active days'}.`), 'grid active days');
    });
  }

  test('GitHub’s own total wins over the calendar sum everywhere', () => {
    const data = demoProfile();
    data.year = { ...data.year, contributions: 4321 };
    for (const card of [stats, landscape, grid]) assert.ok(svgOf(card, data, DEMO_NOW).includes('>4,321</tspan>'), card.id);
  });

  test('shorter 3D and grid windows still count only what they draw', () => {
    const data = demoProfile();
    const land = svgOf(landscape, data, DEMO_NOW, { weeks: 26 });
    const g = svgOf(grid, data, DEMO_NOW, { weeks: 26 });
    const sum = (s: string) => s.match(/>([\d,]+)<\/tspan>/)?.[1];
    assert.equal(sum(land), sum(g));
    assert.notEqual(sum(land), fmt(data.year.contributions));
  });
});

describe('3D and grid frame the year with the same month labels', () => {
  for (const iso of ['2026-10-05', '2026-10-31', '2026-03-01', '2026-07-15']) {
    test(iso, () => {
      const now = new Date(`${iso}T12:00:00Z`);
      const data = demoProfile(now);
      const a = monthAxis(svgOf(landscape, data, now));
      const b = monthAxis(svgOf(grid, data, now));
      assert.ok(a.length >= 11, a.join(' '));
      assert.deepEqual(a, b);
    });
  }
});
