import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lastYear, monthStarts, yearStart, yearTotal, yearWindow } from './calendar.ts';
import { DEMO_NOW, demoProfile, emptyProfile } from './fixtures.ts';

const DAY = 86_400_000;

describe("GitHub's last year", () => {
  test('runs from the same date a year ago through today (366 days, 367 across 29 February)', () => {
    assert.equal(yearStart(DEMO_NOW), '2025-10-05');
    const days = lastYear([], DEMO_NOW);
    assert.equal(days.length, 366);
    assert.equal(days[0]?.date, '2025-10-05');
    assert.equal(days.at(-1)?.date, '2026-10-05');
    assert.equal(lastYear([], new Date('2028-03-10T08:00:00Z')).length, 367, 'spans 29 February 2028');
    assert.equal(yearStart(new Date('2028-02-29T12:00:00Z')), '2027-02-28');
  });

  test('zero-fills missing days and ignores invalid counts', () => {
    const days = lastYear(
      [
        { date: '2026-10-04', count: 3 },
        { date: '2026-10-03', count: Number.NaN },
        { date: '2026-10-02', count: -2 },
        { date: '2024-01-01', count: 99 },
      ],
      DEMO_NOW,
    );
    assert.equal(days.reduce((s, d) => s + d.count, 0), 3);
  });

  test('yearTotal prefers GitHub’s own figure and falls back to the calendar', () => {
    const demo = demoProfile();
    assert.equal(yearTotal(demo, DEMO_NOW), demo.year.contributions);
    assert.equal(yearTotal({ ...demo, year: { ...demo.year, contributions: 0 } }, DEMO_NOW), demo.year.contributions);
    assert.equal(yearTotal(emptyProfile(), DEMO_NOW), 0);
  });

  test('the demo profile’s yearly total covers exactly that window, on every weekday', () => {
    for (let k = 0; k < 7; k++) {
      const now = new Date(DEMO_NOW.getTime() + k * DAY);
      const data = demoProfile(now);
      assert.equal(data.year.contributions, lastYear(data.calendar, now).reduce((s, d) => s + d.count, 0));
    }
  });
});

describe('monthStarts', () => {
  test('labels a long partial first month and skips a final month shorter than two weeks', () => {
    // 2026-10-05 is a Monday: the window starts on Sunday 2025-10-05 and ends with a single-day October column.
    const cells = yearWindow([], DEMO_NOW, 53);
    const labels = monthStarts(cells, 53, 2);
    assert.deepEqual(labels[0], { week: 0, month: 9 }, 'October 2025 (four weeks) is labelled');
    assert.equal(labels.at(-1)?.month, 8, 'the one-column October 2026 is not');
    assert.equal(labels.length, 12);
  });

  test('drops a short first month when the next label would collide', () => {
    // Saturday 2026-10-31: the first column (Sunday 2025-10-26) is a one-week October.
    const cells = yearWindow([], new Date('2026-10-31T12:00:00Z'), 53);
    const labels = monthStarts(cells, 53, 2);
    assert.equal(labels[0]?.month, 10, 'starts at November');
    assert.equal(labels.at(-1)?.month, 9, 'a four-column final October is labelled');
  });
});
