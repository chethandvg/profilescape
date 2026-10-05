import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { displayName } from '../core/format.ts';
import { DEMO_NOW, demoProfile } from '../core/fixtures.ts';
import { own, readOptions } from '../core/options.ts';
import { getTheme } from '../core/themes.ts';
import { CARD_IDS, type CardId, type CardOptions, type ProfileData } from '../core/types.ts';
import { codeLanguageOf } from './hero.ts';
import { resolveIcon } from './icons.ts';
import { CARDS } from './registry.ts';
import { parseMetrics } from './stats.ts';

/** Keys every plain object inherits; user input must never resolve them in a lookup table. */
const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__'];

function renderAll(id: CardId, data: ProfileData, options: CardOptions = {}): string {
  const theme = getTheme('aurora');
  let out = '';
  for (const mode of ['dark', 'light'] as const) {
    for (const img of CARDS[id].render({ data, theme, palette: theme[mode], mode, options, animate: true, now: DEMO_NOW })) {
      out += img.svg + img.alt;
    }
  }
  return out;
}

const LEAKED = /native code|function Object|\[object Object\]|undefined|NaN/;

describe('inherited object keys in user input', () => {
  test('own() and readOptions() only see own entries', () => {
    const table: Record<string, number> = { a: 1 };
    for (const key of INHERITED) assert.equal(own(table, key), undefined, key);
    assert.equal(own(table, 'a'), 1);
    const o = readOptions({});
    for (const key of INHERITED) {
      assert.equal(o.raw(key), undefined, key);
      assert.equal(o.has(key), false, key);
    }
  });

  test('icon, metric, language and display-name lookups ignore them', () => {
    for (const key of INHERITED) {
      const icon = resolveIcon(key);
      assert.equal(icon.known, false, key);
      assert.equal(typeof icon.title, 'string');
      assert.deepEqual(parseMetrics([key]), [], key);
      assert.equal(codeLanguageOf(key), null, key);
      assert.equal(displayName(key), key);
    }
  });

  test('cards render them as plain text instead of crashing', () => {
    const data = demoProfile();
    const lists: Partial<Record<CardId, CardOptions>> = {
      stack: { icons: INHERITED },
      stats: { metrics: INHERITED },
      hero: { codeLanguage: 'constructor', chips: INHERITED },
      socials: { links: Object.fromEntries(INHERITED.map((k) => [k, 'mira-dev'])) },
    };
    for (const [id, options] of Object.entries(lists) as [CardId, CardOptions][]) {
      const out = renderAll(id, data, options);
      assert.doesNotMatch(out, LEAKED, id);
    }
    // String forms ("key:value") take the same path.
    assert.doesNotMatch(renderAll('socials', data, { links: INHERITED.map((k) => `${k}:mira-dev`) }), LEAKED);
    // An object whose own keys are the inherited names, as JSON.parse would build it.
    const parsed = JSON.parse('{"__proto__":"mira-dev","constructor":"x","toString":"y"}') as Record<string, unknown>;
    assert.doesNotMatch(renderAll('socials', data, { links: parsed }), LEAKED);
  });
});

describe('XML-invalid characters in profile text and options', () => {
  // C0 controls other than tab/LF/CR, the two non-characters and lone surrogates.
  const BAD = String.fromCharCode(0, 1, 8, 11, 12, 27, 31, 0xfffe, 0xffff, 0xd800, 0xdc00);
  const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  function hostile(): ProfileData {
    const d: ProfileData = structuredClone(demoProfile());
    d.name = `Mira${BAD}Chen`;
    d.bio = `Builds${BAD} tools. Open source${BAD} at heart.`;
    d.location = `Amster${BAD}dam`;
    d.company = `@nebula${BAD}`;
    for (const l of [...d.languages, ...d.languagesByBytes]) l.name = `${l.name}${BAD}`;
    for (const r of [...d.repos, ...d.pinned]) {
      r.description = `desc${BAD} here`;
      r.topics = [`topic${BAD}`, 'ok'];
      r.license = `MIT${BAD}`;
      if (r.latestRelease) r.latestRelease.tag = `v1${BAD}`;
      for (const l of r.languages) l.name = `${l.name}${BAD}`;
    }
    return d;
  }

  const OPTIONS: Partial<Record<CardId, CardOptions[]>> = {
    hero: [{ status: `busy${BAD}`, tagline: `line${BAD}`, code: `const x = "${BAD}";`, codeFile: `a${BAD}.ts` }, { code: 'none' }],
    repos: [{}, { layout: 'detail' }],
    languages: [{ title: `Langs${BAD}` }, { layout: 'donut' }, { layout: 'compact' }],
    stack: [{ icons: [`rust${BAD}`, `Weird${BAD}:Label${BAD}`], title: `Stack${BAD}` }],
    socials: [{ links: { github: `mira${BAD}`, website: 'https://mira.dev', custom: [{ label: `Blog${BAD}`, url: 'https://b.dev' }] } }],
    stats: [{ title: `Stats${BAD}` }],
    '3d': [{ title: `Land${BAD}` }],
    grid: [{ title: `Grid${BAD}` }],
  };

  for (const id of CARD_IDS) {
    test(`${id}: every SVG stays well-formed XML`, () => {
      const theme = getTheme('aurora');
      for (const options of OPTIONS[id] ?? [{}]) {
        for (const mode of ['dark', 'light'] as const) {
          for (const img of CARDS[id].render({ data: hostile(), theme, palette: theme[mode], mode, options, animate: true, now: DEMO_NOW })) {
            assert.doesNotMatch(img.svg, INVALID, `${id} ${img.name} ${mode}`);
            assert.doesNotThrow(() => new Resvg(img.svg), `${id} ${img.name} ${mode} parses`);
          }
        }
      }
    });
  }
});
