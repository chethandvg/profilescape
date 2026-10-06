import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, test } from 'node:test';
import { ACTION_INPUT_DEFAULTS, INPUT_NAMES, normalizeCards, parseConfigJson, resolveConfig } from '../src/action/config.ts';
import { CARDS } from '../src/cards/registry.ts';
import { themeIds } from '../src/core/themes.ts';
import { CARD_IDS, type CardId } from '../src/core/types.ts';
import {
  applyBlocks,
  cell,
  composeRow,
  descriptiveDefaultKeys,
  DOC_FILES,
  formatDefault,
  galleryFiles,
  IMAGES_DIR,
  logoSvg,
  nest,
  plannedFiles,
  referenceBlocks,
  ROOT,
  SHOTS,
  socialPreviewSvg,
  svgSize,
} from './gallery.ts';
import { loadManifest } from './gen-actions.ts';

const files = galleryFiles();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Every Markdown file the gallery images and reference docs feed. */
const DOCS = ['README.md', 'docs/cards.md', 'docs/configuration.md', 'docs/themes.md', 'docs/faq.md'].filter((f) => existsSync(join(ROOT, f)));

const ids = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);

/** Drop HTML tags, repeating until nothing changes so removing one tag cannot splice another together. */
function stripTags(html: string): string {
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return text;
}

/** Heading anchors as GitHub generates them: lowercase, punctuation dropped, each space a hyphen, repeats numbered. */
function headingAnchors(markdown: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = stripTags(heading[1] as string)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

describe('gallery images', () => {
  test('default images keep the names mirror READMEs and docs rely on', () => {
    for (const stem of ['3d', 'stats', 'languages', 'repos', 'hero', 'grid', 'stack', 'socials', 'logo', 'themes']) {
      for (const mode of ['dark', 'light']) assert.ok(files.has(`${stem}-${mode}.svg`), `${stem}-${mode}.svg`);
    }
    for (const entry of loadManifest().actions) {
      assert.ok(files.has(entry.preview), `${entry.repo} preview ${entry.preview}`);
      assert.ok(files.has(entry.preview.replace(/-dark\.svg$/, '-light.svg')), `${entry.repo} light preview`);
    }
  });

  test('one thumbnail per theme and mode', () => {
    for (const id of themeIds()) for (const mode of ['dark', 'light']) assert.ok(files.has(`theme-${id}-${mode}.svg`), id);
  });

  test('every card appears in the default shots', () => {
    const shown = new Set(SHOTS.map((s) => s.card));
    for (const id of CARD_IDS) assert.ok(shown.has(id), id);
  });

  test('plannedFiles() lists exactly what galleryFiles() renders', () => {
    assert.deepEqual([...files.keys()].sort(), [...plannedFiles()].sort());
  });

  test('renders are deterministic', () => {
    const again = galleryFiles();
    for (const [name, svg] of files) assert.equal(again.get(name), svg, name);
  });

  test('every image is a titled, standalone SVG with unique ids', () => {
    for (const [name, svg] of files) {
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, name);
      assert.match(svg, /<title[^>]*>[^<]+<\/title>/, name);
      assert.equal((svg.match(/<svg\b/g) ?? []).length, (svg.match(/<\/svg>/g) ?? []).length, `${name}: balanced <svg>`);
      const list = ids(svg);
      assert.equal(new Set(list).size, list.length, `${name}: duplicate ids ${list.filter((v, i) => list.indexOf(v) !== i).join(', ')}`);
      assert.doesNotMatch(svg, /NaN|undefined/, name);
    }
  });

  test('composed images reference only ids they define', () => {
    for (const [name, svg] of files) {
      const defined = new Set(ids(svg));
      for (const m of svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) {
        const ref = (m[1] ?? m[2]) as string;
        assert.ok(defined.has(ref), `${name}: dangling reference #${ref}`);
      }
    }
  });

  test('committed docs/images match the plan when generated', (t) => {
    const dir = join(ROOT, IMAGES_DIR);
    if (!existsSync(dir)) return t.skip('docs/images has not been generated yet (npm run gallery)');
    for (const name of plannedFiles()) assert.ok(existsSync(join(dir, name)), `${IMAGES_DIR}/${name} is missing`);
  });
});

describe('composition helpers', () => {
  const card = (w: number, h: number, extra = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="ps-title"><title id="ps-title">t</title><defs><clipPath id="ps-clip"><rect width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#ps-clip)">${extra}</g><use href="#ps-clip"/></svg>\n`;

  test('svgSize reads the root size', () => {
    assert.deepEqual(svgSize(card(400, 200)), { width: 400, height: 200 });
  });

  test('nest prefixes ids and their references, and scales', () => {
    const out = nest(card(400, 200, '<rect fill="url(#elsewhere)"/>'), 'p-', 10, 20, 0.5);
    assert.match(out, /^<svg x="10" y="20" width="200" height="100" viewBox="0 0 400 200">/);
    assert.match(out, /id="p-ps-clip"/);
    assert.match(out, /clip-path="url\(#p-ps-clip\)"/);
    assert.match(out, /href="#p-ps-clip"/);
    assert.match(out, /url\(#elsewhere\)/, 'leaves foreign references alone');
    assert.doesNotMatch(out, /role="img"/);
  });

  test('composeRow places images side by side with a gap', () => {
    const row = composeRow([card(100, 40), card(60, 50)], 10, 'Row');
    assert.deepEqual(svgSize(row), { width: 170, height: 50 });
    assert.match(row, /<svg x="110" y="0"/);
    assert.equal(new Set(ids(row)).size, ids(row).length);
  });

  test('logo and social preview have the documented sizes', () => {
    assert.deepEqual(svgSize(logoSvg('dark')), { width: 500, height: 120 });
    const preview = socialPreviewSvg();
    assert.deepEqual(svgSize(preview), { width: 1280, height: 640 });
    assert.match(preview, />Profilescape</);
    const list = ids(preview);
    assert.equal(new Set(list).size, list.length);
  });
});

describe('reference tables', () => {
  test('option tables cover every option with its default', () => {
    const blocks = referenceBlocks();
    for (const id of CARD_IDS) {
      const table = blocks.get(`options:${id}`) as string;
      for (const o of CARDS[id].options) {
        assert.ok(table.includes(`| \`${o.key}\` | ${o.type} | ${formatDefault(id, o)} |`), `${id}.${o.key}`);
      }
    }
  });

  test('descriptive defaults still exist and are strings', () => {
    for (const key of descriptiveDefaultKeys()) {
      const [card, option] = key.split('.') as [CardId, string];
      const doc = CARDS[card].options.find((o) => o.key === option);
      assert.ok(doc, `${key} is no longer an option`);
      assert.equal(typeof doc.default, 'string', key);
    }
  });

  test('the inputs table lists every action input', () => {
    const table = referenceBlocks().get('inputs') as string;
    const yml = read('action.yml');
    for (const name of INPUT_NAMES) {
      assert.ok(table.includes(`| \`${name}\` |`), name);
      assert.match(yml, new RegExp(`^  ${name}:$`, 'm'), `${name} is in action.yml`);
    }
  });

  test('cell() escapes HTML outside code spans only', () => {
    assert.equal(cell('a <b> `<!-- x -->` | c'), 'a &lt;b&gt; `<!-- x -->` \\| c');
    // Prose backslashes are escaped (so a literal `\|` keeps its backslash); code spans only get their
    // pipes escaped, because GFM's table parser removes exactly one backslash per escaped pipe.
    assert.equal(cell('a\\|b `c\\|d`'), 'a\\\\\\|b `c\\\\|d`');
  });

  test('applyBlocks replaces known blocks and reports unknown ones', () => {
    const blocks = new Map([['x', 'NEW']]);
    const res = applyBlocks('a\n<!-- generated:x -->\nold\n<!-- /generated:x -->\n<!-- generated:y -->\n<!-- /generated:y -->\n', blocks);
    assert.equal(res.text, 'a\n<!-- generated:x -->\nNEW\n<!-- /generated:x -->\n<!-- generated:y -->\n<!-- /generated:y -->\n');
    assert.deepEqual(res.unknown, ['y']);
  });

  for (const rel of DOC_FILES) {
    test(`${rel}: generated tables are up to date (npm run gallery)`, (t) => {
      if (!existsSync(join(ROOT, rel))) return t.skip(`${rel} does not exist yet`);
      const text = read(rel);
      const { text: fresh, unknown } = applyBlocks(text, referenceBlocks());
      assert.deepEqual(unknown, []);
      assert.equal(fresh, text);
    });
  }

  test('docs/cards.md has an options table for every card', (t) => {
    if (!existsSync(join(ROOT, 'docs/cards.md'))) return t.skip('docs/cards.md does not exist yet');
    const text = read('docs/cards.md');
    for (const id of CARD_IDS) assert.ok(text.includes(`<!-- generated:options:${id} -->`), id);
  });
});

/** Fenced code blocks of the given languages. */
function fences(text: string, langs: string[]): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^( *)```(\w+)\r?\n([\s\S]*?)^\1```/gm)) {
    if (langs.includes(m[2] as string)) out.push((m[3] as string).replace(new RegExp(`^${m[1]}`, 'gm'), ''));
  }
  return out;
}

describe('docs accuracy', () => {
  test('images referenced by the docs are generated', () => {
    for (const rel of DOCS) {
      for (const m of read(rel).matchAll(/(?:src|srcset)="([^"]+\.(?:svg|png))"|\]\(([^)\s]+\.(?:svg|png))\)/g)) {
        const ref = (m[1] ?? m[2]) as string;
        if (/^https?:/.test(ref)) continue;
        const target = normalize(join(dirname(rel), ref)).split('\\').join('/');
        if (target.startsWith(`${IMAGES_DIR}/`)) assert.ok(files.has(target.slice(IMAGES_DIR.length + 1)), `${rel}: ${ref} is not a gallery image`);
        else assert.ok(existsSync(join(ROOT, target)), `${rel}: ${ref} does not exist`);
      }
    }
  });

  test('relative links point at files that exist', () => {
    for (const rel of DOCS) {
      for (const m of read(rel).matchAll(/\]\((?!https?:|mailto:|#)([^)\s#]+)(?:#[^)\s]*)?\)|href="(?!https?:|mailto:|#)([^"#]+)(?:#[^"]*)?"/g)) {
        const ref = (m[1] ?? m[2]) as string;
        assert.ok(existsSync(join(ROOT, dirname(rel), ref)), `${rel}: link ${ref} is broken`);
      }
    }
  });

  test('section links point at headings that exist', () => {
    let checked = 0;
    for (const rel of DOCS) {
      for (const m of read(rel).matchAll(/\]\((?!https?:|mailto:)([^)\s#]*)#([^)\s]+)\)|href="(?!https?:|mailto:)([^"#]*)#([^"]+)"/g)) {
        const file = (m[1] ?? m[3]) as string;
        const anchor = (m[2] ?? m[4]) as string;
        const target = file ? normalize(join(dirname(rel), file)).split('\\').join('/') : rel;
        if (!target.endsWith('.md') || !existsSync(join(ROOT, target))) continue;
        assert.ok(headingAnchors(read(target)).has(anchor), `${rel}: ${file}#${anchor} matches no heading in ${target}`);
        checked++;
      }
    }
    assert.ok(checked > 0 || !DOCS.length, 'found section links');
  });

  test('config JSON examples are valid and use real option keys', () => {
    let checked = 0;
    for (const rel of DOCS) {
      for (const block of fences(read(rel), ['json', 'jsonc'])) {
        const json = parseConfigJson(block, rel) as Record<string, unknown>;
        const { warnings, config } = resolveConfig({}, json, { requireUsername: false });
        // Options for cards outside the default list are fine in snippets that only show options.
        const real = warnings.filter((w) => !/is set but the "[\w-]+" card is not enabled/.test(w));
        assert.deepEqual(real, [], `${rel}: ${block.slice(0, 60)}`);
        for (const [card, opts] of Object.entries(config.options) as [CardId, Record<string, unknown>][]) {
          const keys = CARDS[card].options.map((o) => o.key);
          for (const key of Object.keys(opts)) assert.ok(keys.includes(key), `${rel}: options.${card}.${key} is not a documented option`);
        }
        checked++;
      }
    }
    assert.ok(checked > 0 || !DOCS.length, 'found config examples');
  });

  test('workflow examples only use real inputs', () => {
    const known = new Set<string>(INPUT_NAMES);
    for (const rel of DOCS) {
      for (const block of fences(read(rel), ['yaml', 'yml'])) {
        const lines = block.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!/uses: chethandvg\/profilescape(?:-[\w-]+)?@/.test(lines[i] as string)) continue;
          const withLine = lines.findIndex((l, j) => j > i && /^\s*with:\s*$/.test(l));
          const next = lines.findIndex((l, j) => j > i && /^\s*- (?:uses|name|run):/.test(l));
          if (withLine === -1 || (next !== -1 && next < withLine)) continue;
          const indent = ((lines[withLine] as string).match(/^\s*/) as RegExpMatchArray)[0].length;
          for (let j = withLine + 1; j < lines.length; j++) {
            const line = lines[j] as string;
            if (!line.trim() || line.trim().startsWith('#')) continue;
            const lead = (line.match(/^\s*/) as RegExpMatchArray)[0].length;
            if (lead <= indent) break;
            const key = /^\s*([\w-]+):/.exec(line)?.[1];
            if (key && lead === indent + 2) assert.ok(known.has(key), `${rel}: unknown input "${key}"`);
          }
        }
      }
    }
  });

  test('"Key options" in the README gallery name real options', (t) => {
    if (!existsSync(join(ROOT, 'README.md'))) return t.skip('README.md does not exist yet');
    let checked = 0;
    for (const section of read('README.md').split(/^### /m)) {
      const id = /· `([\w-]+)`/.exec(section.split('\n')[0] ?? '')?.[1] as CardId | undefined;
      const line = section.split('\n').find((l) => l.startsWith('Key options:'));
      if (!id || !line) continue;
      assert.ok((CARD_IDS as readonly string[]).includes(id), `README gallery section for unknown card "${id}"`);
      // Values live in parentheses; the list itself ends at the first sentence break.
      const list = line.replace(/\([^)]*\)/g, '').split(/\.\s/)[0] as string;
      const keys = CARDS[id].options.map((o) => o.key);
      for (const m of list.matchAll(/`([^`]+)`/g)) assert.ok(keys.includes(m[1] as string), `README ${id}: "${m[1]}" is not an option`);
      checked++;
    }
    assert.equal(checked, CARD_IDS.length, 'one "Key options" line per card');
  });

  test('documented input defaults match the runtime', () => {
    // The README quick start relies on these defaults.
    assert.equal(ACTION_INPUT_DEFAULTS.branch, 'profilescape-output');
    assert.equal(ACTION_INPUT_DEFAULTS.cards, 'stats,3d,languages,repos');
    assert.equal(ACTION_INPUT_DEFAULTS.theme, 'aurora');
  });

  test('card aliases mentioned in the docs resolve', () => {
    assert.deepEqual(normalizeCards(['landscape', 'banner', 'heatmap', 'all'], 'test').slice(0, 3), ['3d', 'hero', 'grid']);
  });

  test('every theme is documented in docs/themes.md', (t) => {
    if (!existsSync(join(ROOT, 'docs/themes.md'))) return t.skip('docs/themes.md does not exist yet');
    const text = read('docs/themes.md');
    for (const id of themeIds()) assert.ok(text.includes(`\`${id}\``), id);
  });
});
