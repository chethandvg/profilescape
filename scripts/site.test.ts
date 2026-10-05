import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resolveConfig } from '../src/action/config.ts';
import { CARDS } from '../src/cards/registry.ts';
import { themeIds } from '../src/core/themes.ts';
import { CARD_IDS } from '../src/core/types.ts';
import { fieldFor, fieldsFor, parseFieldInput } from '../site/src/fields.ts';
import { configFile, inlineConfig, workflowYaml } from '../site/src/output.ts';
import { decodeState, defaultState, stateToHash } from '../site/src/state.ts';
import { buildSite, type SiteBuild } from './site.ts';

describe('site build', () => {
  let dir = '';
  let result: SiteBuild;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'profilescape-site-'));
    result = await buildSite({ outDir: dir, quiet: true });
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('writes index.html, the bundle and static assets', () => {
    for (const f of ['index.html', 'app.js', 'styles.css', 'favicon.svg', 'assets/hero-3d-dark.svg', 'robots.txt', 'sitemap.xml']) {
      assert.ok(existsSync(join(dir, f)), `${f} exists`);
    }
    assert.ok(result.bundle.bytes > 10_000);
  });

  test('the bundle is browser-only: no node: imports', () => {
    const js = readFileSync(join(dir, 'app.js'), 'utf8');
    assert.doesNotMatch(js, /["']node:[a-z]/);
    assert.doesNotMatch(js, /\brequire\(/);
  });

  test('index.html uses relative URLs, fills every placeholder and has SEO tags', () => {
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}|<!-- @[a-z-]+ -->/);
    assert.match(html, /<script type="module" src="app\.js\?v=[0-9a-f]+"><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="styles\.css\?v=[0-9a-f]+"/);
    assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/, 'no root-relative URLs (the site lives under /profilescape/)');
    assert.match(html, /<link rel="canonical" href="https:\/\/chethandvg\.github\.io\/profilescape\/"/);
    assert.match(html, /<meta name="description" content="[^"]{50,}"/);
    assert.match(html, /property="og:title"/);
    assert.match(html, /uses: chethandvg\/profilescape-3d@v1/);
    assert.match(html.replace(/<[^>]+>/g, ''), /Preview uses demo data - your real data is rendered by the Action in your repo/);
  });

  test('the quick start shows a complete workflow and a CLI command that runs anywhere', () => {
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const text = (label: string) => {
      const m = new RegExp(`aria-label="${label}"><code>([\\s\\S]*?)</code>`).exec(html);
      assert.ok(m?.[1], `${label} snippet exists`);
      return m[1].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    };
    const workflow = text('Minimal workflow');
    for (const line of ['name: Profilescape', 'on:', '  schedule:', '  workflow_dispatch:', 'permissions:', '  contents: write', 'jobs:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: chethandvg/profilescape@v1', '          readme: README.md']) {
      assert.ok(workflow.split('\n').some((l) => l === line || l.startsWith(`${line} `)), `minimal workflow has "${line}"`);
    }
    // The CLI must not depend on a clone (its default --out would land inside it).
    assert.match(text('CLI example'), /^npx github:chethandvg\/profilescape --demo\b/);
  });

  test('stays within the size budget', () => {
    assert.ok(result.bundle.gzip < 400 * 1024, `bundle is ${result.bundle.gzip} bytes gzipped`);
  });
});

describe('playground options form', () => {
  test('every documented option becomes a field', () => {
    for (const id of CARD_IDS) assert.equal(fieldsFor(CARDS[id]).length, CARDS[id].options.length, id);
  });

  test('detects choices from option descriptions', () => {
    const layout = fieldFor({ key: 'layout', type: 'string', default: 'bar', description: '"bar" (stacked), "donut" or "compact" (half).' });
    assert.equal(layout.kind, 'choice');
    assert.deepEqual(layout.choices, ['bar', 'donut', 'compact']);
    const code = fieldFor({ key: 'code', type: 'string', default: 'auto', description: '"auto" writes a snippet, "none" hides it, any other text is shown.' });
    assert.equal(code.kind, 'text');
    const weeks = fieldFor({ key: 'weeks', type: 'number', default: 53, description: 'Weeks to show, 26 to 53.' });
    assert.deepEqual([weeks.kind, weeks.min, weeks.max], ['number', 26, 53]);
  });

  test('only non-default values are kept', () => {
    const top = fieldFor({ key: 'top', type: 'number', default: 6, description: 'Languages (1 to 10).' });
    assert.deepEqual(parseFieldInput(top, '6'), { ok: true, value: undefined });
    assert.deepEqual(parseFieldInput(top, '8'), { ok: true, value: 8 });
    assert.equal(parseFieldInput(top, '11').ok, false);
    const hide = fieldFor({ key: 'hideTitle', type: 'boolean', default: false, description: '' });
    assert.deepEqual(parseFieldInput(hide, false), { ok: true, value: undefined });
    assert.deepEqual(parseFieldInput(hide, true), { ok: true, value: true });
  });
});

describe('playground output', () => {
  const custom = () => {
    const s = defaultState();
    s.cards = ['hero', '3d', 'stack'];
    s.theme = 'nord';
    s.animate = false;
    s.options = { '3d': { weeks: 30, title: 'My year' }, stats: { chart: 'none' } };
    s.dark = { accentA: '#FF7A59', panel: '#101010' };
    s.light = { accentA: '#FF7A59' };
    return s;
  };

  test('the default workflow sets only the README input and token', () => {
    const yaml = workflowYaml(defaultState());
    assert.match(yaml, /uses: chethandvg\/profilescape@v1/);
    assert.match(yaml, /readme: README\.md/);
    assert.doesNotMatch(yaml, /^ {10}(cards|theme|animate|config):/m);
    assert.equal(inlineConfig(defaultState()), null);
  });

  test('custom settings become inputs and an inline config the Action accepts', () => {
    const s = custom();
    const yaml = workflowYaml(s);
    assert.match(yaml, /cards: hero,3d,stack/);
    assert.match(yaml, /theme: nord/);
    assert.match(yaml, /animate: false/);
    assert.match(yaml, /config: \|\n {12}\{/);
    const config = inlineConfig(s);
    assert.deepEqual(config, {
      colors: { accentA: '#FF7A59' },
      darkColors: { panel: '#101010' },
      options: { '3d': { weeks: 30, title: 'My year' } },
    });
    const resolved = resolveConfig({ cards: 'hero,3d,stack', theme: 'nord', animate: 'false' }, config, { defaultUsername: 'octocat' });
    assert.deepEqual(resolved.warnings, []);
    assert.deepEqual(resolved.config.options, { '3d': { weeks: 30, title: 'My year' } });
    const file = resolveConfig({}, JSON.parse(configFile(s)), { defaultUsername: 'octocat' });
    assert.deepEqual(file.warnings, []);
    assert.deepEqual(file.config.cards, ['hero', '3d', 'stack']);
    assert.equal(file.config.animate, false);
  });

  test('state survives the URL hash round trip', () => {
    const s = custom();
    s.mode = 'both';
    const back = decodeState(stateToHash(s));
    assert.deepEqual(back.cards, s.cards);
    assert.equal(back.theme, 'nord');
    assert.equal(back.mode, 'both');
    assert.equal(back.animate, false);
    assert.deepEqual(back.dark, s.dark);
    assert.deepEqual(back.options['3d'], { weeks: 30, title: 'My year' });
    assert.equal(stateToHash(defaultState()), '');
  });

  test('a hand-edited hash falls back to safe defaults', () => {
    const s = decodeState('#playground?cards=nope,3d,3d&theme=unknown&opts={broken&dark=accentA:zzz');
    assert.deepEqual(s.cards, ['3d']);
    assert.ok(themeIds().includes(s.theme));
    assert.deepEqual(s.dark, {});
  });
});
