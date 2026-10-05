import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import { CARD_IDS } from '../src/core/types.ts';
import {
  ACTION_OUTPUTS,
  actionInputs,
  findDrift,
  generate,
  loadManifest,
  majorTag,
  mirrorsOf,
  renderActionYml,
  renderMirrorReadme,
  repoCommands,
  ROOT,
  umbrellaOf,
  validateManifest,
  yamlScalar,
  type Manifest,
} from './gen-actions.ts';

// ------------------------------------------------------------------------
// A small, strict YAML reader for the subset our files use (block mappings,
// block sequences, quoted and plain scalars, block scalars, flow lists). No
// YAML package is installed, and a strict reader catches indentation slips.

type Yaml = string | Yaml[] | { [key: string]: Yaml };
type YamlMap = { [key: string]: Yaml };

function parseYaml(src: string): Yaml {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let pos = 0;
  const fail = (msg: string, at = pos): never => {
    throw new Error(`YAML line ${at + 1}: ${msg}\n  > ${lines[at] ?? ''}`);
  };
  const indentOf = (line: string) => {
    const m = /^( *)(\t?)/.exec(line) as RegExpExecArray;
    if (m[2]) fail('tab in indentation');
    return (m[1] as string).length;
  };
  const significant = (line: string) => line.trim() !== '' && !line.trim().startsWith('#') && line.trim() !== '---';
  const peek = (): { indent: number; text: string } | null => {
    while (pos < lines.length && !significant(lines[pos] as string)) pos++;
    if (pos >= lines.length) return null;
    const line = lines[pos] as string;
    return { indent: indentOf(line), text: line.trim() };
  };

  const scalar = (raw: string): Yaml => {
    const v = raw.trim();
    if (v.startsWith('"')) {
      const end = /^"(?:[^"\\]|\\.)*"/.exec(v);
      if (!end) fail('unterminated double-quoted string');
      const rest = v.slice((end as RegExpExecArray)[0].length).trim();
      if (rest && !rest.startsWith('#')) fail('text after a quoted string');
      return JSON.parse((end as RegExpExecArray)[0]) as string;
    }
    if (v.startsWith("'")) {
      const end = /^'(?:[^']|'')*'/.exec(v);
      if (!end) fail('unterminated single-quoted string');
      const rest = v.slice((end as RegExpExecArray)[0].length).trim();
      if (rest && !rest.startsWith('#')) fail('text after a quoted string');
      return (end as RegExpExecArray)[0].slice(1, -1).replace(/''/g, "'");
    }
    if (v.startsWith('[')) {
      const close = v.indexOf(']');
      if (close === -1) fail('unterminated flow sequence');
      const inner = v.slice(1, close).trim();
      return inner ? inner.split(',').map((s) => scalar(s)) : [];
    }
    if (v === '{}') return {};
    if (/^[{&*!%@`|>]/.test(v)) fail(`unsupported YAML syntax "${v}"`);
    const plain = v.replace(/\s+#.*$/, '');
    if (/:(\s|$)/.test(plain)) fail('": " inside a plain scalar must be quoted');
    return plain;
  };

  const blockScalar = (header: string, parentIndent: number): string => {
    const m = /^([|>])([+-]?)$/.exec(header) ?? fail(`bad block scalar header "${header}"`);
    const [, style, chomp] = m as RegExpExecArray;
    const body: string[] = [];
    let blockIndent: number | undefined;
    while (pos < lines.length) {
      const line = lines[pos] as string;
      if (line.trim() === '') {
        body.push('');
        pos++;
        continue;
      }
      const ind = indentOf(line);
      if (ind <= parentIndent) break;
      blockIndent ??= ind;
      if (ind < blockIndent) fail('block scalar line is less indented than the first line');
      body.push(line.slice(blockIndent));
      pos++;
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    const text = style === '|' ? body.join('\n') : body.map((l) => (l === '' ? '\n' : l)).join(' ').replace(/ ?\n ?/g, '\n');
    return chomp === '-' ? text : `${text}\n`;
  };

  const value = (rest: string, indent: number): Yaml => {
    if (rest === '') {
      const next = peek();
      if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')))) return node(next.indent);
      return '';
    }
    if (/^[|>][+-]?$/.test(rest)) return blockScalar(rest, indent);
    return scalar(rest);
  };

  const mapping = (indent: number): YamlMap => {
    const out: YamlMap = {};
    for (;;) {
      const line = peek();
      if (!line || line.indent < indent) return out;
      if (line.indent > indent) fail('unexpected indentation');
      if (line.text.startsWith('- ')) return out;
      const m = /^("[^"]*"|'[^']*'|[^\s"'#][^:#]*?)\s*:(?:\s+(.*))?$/.exec(line.text) ?? fail('expected "key: value"');
      const key = (m[1] as string).replace(/^["']|["']$/g, '');
      if (Object.hasOwn(out, key)) fail(`duplicate key "${key}"`);
      pos++;
      out[key] = value((m[2] ?? '').trim(), indent);
    }
  };

  const sequence = (indent: number): Yaml[] => {
    const out: Yaml[] = [];
    for (;;) {
      const line = peek();
      if (!line || line.indent < indent || !(line.text === '-' || line.text.startsWith('- '))) return out;
      if (line.indent > indent) fail('unexpected indentation');
      const rest = line.text.slice(1).trim();
      if (rest === '') {
        pos++;
        out.push(value('', indent));
      } else if (/^("[^"]*"|'[^']*'|[^\s"'#\[{][^:#]*?)\s*:(\s|$)/.test(rest)) {
        // "- key: value" starts a mapping indented by the dash.
        lines[pos] = `${' '.repeat(indent + 2)}${rest}`;
        out.push(mapping(indent + 2));
      } else {
        pos++;
        out.push(scalar(rest));
      }
    }
  };

  const node = (indent: number): Yaml => {
    const line = peek() as { indent: number; text: string };
    return line.text === '-' || line.text.startsWith('- ') ? sequence(indent) : mapping(indent);
  };

  const first = peek();
  if (!first) return {};
  if (first.indent !== 0) fail('document must start at column 0');
  const doc = node(0);
  if (peek()) fail('unexpected content');
  return doc;
}

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asMap = (v: Yaml | undefined, what: string): YamlMap => {
  assert.ok(v !== undefined && typeof v === 'object' && !Array.isArray(v), `${what} must be a mapping`);
  return v as YamlMap;
};
const asList = (v: Yaml | undefined, what: string): Yaml[] => {
  assert.ok(Array.isArray(v), `${what} must be a list`);
  return v as Yaml[];
};
const yamlFiles = (dir: string) =>
  existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((f) => /\.ya?ml$/.test(f)).map((f) => `${dir}/${f}`) : [];

/** The canonical inputs, in order: kept here independently of the generator on purpose. */
const CANONICAL_INPUTS: [string, string][] = [
  ['username', ''],
  ['token', '${{ github.token }}'],
  ['cards', 'stats,3d,languages,repos'],
  ['theme', 'aurora'],
  ['modes', 'dark,light'],
  ['animate', 'true'],
  ['history', 'full'],
  ['hide_languages', ''],
  ['exclude_repos', ''],
  ['include_private', 'true'],
  ['repos', ''],
  ['config', ''],
  ['output_dir', 'profilescape'],
  ['publish', 'branch'],
  ['branch', 'profilescape-output'],
  ['commit_message', 'chore: update profilescape cards'],
  ['readme', ''],
  ['github_token', '${{ github.token }}'],
];

const manifest = loadManifest();
const tag = majorTag();

// ------------------------------------------------------------------ tests

describe('YAML reader', () => {
  test('parses the subset used by our files', () => {
    const doc = parseYaml(
      [
        '# comment',
        'name: CI # trailing',
        'on:',
        '  push:',
        '    branches: [main, "release/*"]',
        '  workflow_dispatch:',
        'jobs:',
        '  a:',
        '    steps:',
        '      - uses: x/y@abc # v1',
        '        with:',
        "          quoted: 'it''s'",
        '      - run: |',
        '          echo "a: b"',
        '          # not a comment',
        '        env:',
        '          KEY: "${{ github.token }}"',
        '    folded: >-',
        '      one',
        '      two',
        'empty: {}',
      ].join('\n'),
    );
    assert.deepEqual(doc, {
      name: 'CI',
      on: { push: { branches: ['main', 'release/*'] }, workflow_dispatch: '' },
      jobs: {
        a: {
          steps: [
            { uses: 'x/y@abc', with: { quoted: "it's" } },
            { run: 'echo "a: b"\n# not a comment\n', env: { KEY: '${{ github.token }}' } },
          ],
          folded: 'one two',
        },
      },
      empty: {},
    });
  });

  test('rejects indentation slips, tabs and duplicate keys', () => {
    assert.throws(() => parseYaml('a:\n  b: 1\n   c: 2'), /indentation/);
    assert.throws(() => parseYaml('a:\n\tb: 1'), /tab/);
    assert.throws(() => parseYaml('a: 1\na: 2'), /duplicate key/);
    assert.throws(() => parseYaml('a: b: c'), /must be quoted/);
  });
});

describe('manifest', () => {
  test('is valid', () => {
    assert.deepEqual(validateManifest(JSON.parse(read('actions/manifest.json'))), []);
  });

  test('uses only known card ids and includes the umbrella', () => {
    for (const entry of manifest.actions) {
      for (const card of entry.cards) assert.ok((CARD_IDS as readonly string[]).includes(card), `${entry.repo}: unknown card ${card}`);
    }
    assert.deepEqual(umbrellaOf(manifest).cards, ['stats', '3d', 'languages', 'repos']);
    assert.ok(mirrorsOf(manifest).length >= 1);
    assert.ok(mirrorsOf(manifest).every((m) => m.repo !== manifest.umbrella));
  });

  test('reports every kind of problem', () => {
    const bad = structuredClone(manifest) as unknown as { actions: Record<string, unknown>[]; template: Record<string, unknown> };
    const entry = bad.actions[1] as Record<string, unknown>;
    entry.cards = ['snake', 'stats', 'stats'];
    entry.description = 'x'.repeat(130);
    entry.branding = { icon: 'coffee', color: 'pink' };
    entry.keywords = ['Bad Topic'];
    entry.preview = 'preview.png';
    bad.actions.push({ ...(bad.actions[2] as object) });
    bad.template.repo = (bad.actions[0] as { repo: string }).repo;
    const errors = validateManifest(bad).join('\n');
    for (const needle of ['unknown card "snake"', 'lists a card twice', 'limit is 124', '"coffee"', '"pink"', '"Bad Topic"', '-dark.svg', 'listed twice', 'used twice', 'template.repo']) {
      assert.ok(errors.includes(needle), `expected an error mentioning ${needle}\n${errors}`);
    }
    assert.deepEqual(validateManifest(null), ['The manifest must be a JSON object.']);
  });
});

describe('generated files', () => {
  test('are deterministic', () => {
    const a = generate(manifest, tag);
    const b = generate(structuredClone(manifest), tag);
    assert.deepEqual([...a.entries()], [...b.entries()]);
    assert.ok(a.has('action.yml'));
    for (const m of mirrorsOf(manifest)) {
      assert.ok(a.has(`mirrors/${m.repo}/action.yml`));
      assert.ok(a.has(`mirrors/${m.repo}/README.md`));
    }
  });

  test('are committed and up to date (run `npm run gen:actions` if this fails)', () => {
    assert.deepEqual(findDrift(generate(manifest, tag)), []);
  });

  test('drift detection finds missing, outdated and stale files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-actions-'));
    try {
      const files = generate(manifest, tag);
      for (const [path, content] of files) {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), content.replace(/\n/g, '\r\n'));
      }
      assert.deepEqual(findDrift(files, dir), [], 'CRLF checkouts are not drift');
      const [first] = mirrorsOf(manifest);
      writeFileSync(join(dir, 'action.yml'), 'name: edited by hand\n');
      rmSync(join(dir, `mirrors/${first?.repo}/README.md`));
      mkdirSync(join(dir, 'mirrors/profilescape-removed'), { recursive: true });
      writeFileSync(join(dir, 'mirrors/profilescape-removed/action.yml'), 'name: old\n');
      assert.deepEqual(
        findDrift(files, dir).sort((x, y) => x.path.localeCompare(y.path)),
        [
          { path: 'action.yml', problem: 'outdated' },
          { path: `mirrors/${first?.repo}/README.md`, problem: 'missing' },
          { path: 'mirrors/profilescape-removed/action.yml', problem: 'stale' },
        ].sort((x, y) => x.path.localeCompare(y.path)),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('yamlScalar quotes anything ambiguous and round-trips', () => {
    assert.equal(yamlScalar('Profilescape - GitHub Profile Cards'), 'Profilescape - GitHub Profile Cards');
    assert.equal(yamlScalar('node24'), 'node24');
    for (const tricky of ['', 'true', 'No', 'a: b', 'x #y', '${{ github.token }}', "it's", '"quoted"', ' padded ', '- dash', '123']) {
      assert.deepEqual(parseYaml(`k: ${yamlScalar(tricky)}`), { k: tricky }, `round-trip of ${JSON.stringify(tricky)}`);
    }
  });
});

describe('action.yml', () => {
  const action = asMap(parseYaml(read('action.yml')), 'action.yml');

  test('declares exactly the canonical inputs and defaults', () => {
    const inputs = asMap(action.inputs, 'inputs');
    assert.deepEqual(Object.keys(inputs), CANONICAL_INPUTS.map(([name]) => name));
    for (const [name, def] of CANONICAL_INPUTS) {
      const input = asMap(inputs[name], name);
      assert.equal(input.default, def, `${name} default`);
      assert.equal(input.required, 'false', `${name} required`);
      assert.ok(typeof input.description === 'string' && input.description.length > 20, `${name} needs a real description`);
    }
    assert.deepEqual(
      actionInputs(['stats', '3d', 'languages', 'repos']).map((i) => [i.name, i.default]),
      CANONICAL_INPUTS,
    );
  });

  test('declares the outputs, runtime and branding', () => {
    assert.deepEqual(Object.keys(asMap(action.outputs, 'outputs')), ['files', 'markup', 'base_url']);
    assert.deepEqual(ACTION_OUTPUTS.map((o) => o.name), ['files', 'markup', 'base_url']);
    assert.deepEqual(action.runs, { using: 'node24', main: 'dist/index.mjs' });
    const umbrella = umbrellaOf(manifest);
    assert.equal(action.name, umbrella.name);
    assert.equal(action.description, umbrella.description);
    assert.deepEqual(action.branding, umbrella.branding);
  });

  test('lists every card id in the cards description', () => {
    const cards = asMap(asMap(action.inputs, 'inputs').cards, 'cards');
    for (const id of CARD_IDS) assert.ok(String(cards.description).includes(`\`${id}\``), id);
  });

  test('matches the inputs the runtime parses', async (t) => {
    const configPath = join(ROOT, 'src/action/config.ts');
    if (!existsSync(configPath)) return t.skip('src/action/config.ts does not exist yet');
    const runtime = (await import(pathToFileURL(configPath).href)) as { ACTION_INPUT_DEFAULTS?: Record<string, string> };
    assert.ok(runtime.ACTION_INPUT_DEFAULTS, 'config.ts exports ACTION_INPUT_DEFAULTS');
    assert.deepEqual(Object.keys(runtime.ACTION_INPUT_DEFAULTS), CANONICAL_INPUTS.map(([name]) => name));
    for (const [name, def] of CANONICAL_INPUTS) {
      // Token defaults are expressions in action.yml and empty in the runtime.
      if (!def.startsWith('${{')) assert.equal(runtime.ACTION_INPUT_DEFAULTS[name], def, name);
    }
  });
});

describe('mirrors', () => {
  const umbrellaInputs = asMap(asMap(parseYaml(read('action.yml')), 'action.yml').inputs, 'inputs');

  for (const entry of mirrorsOf(manifest)) {
    test(`${entry.repo}: action.yml differs from the umbrella only in metadata and cards`, () => {
      const action = asMap(parseYaml(read(`mirrors/${entry.repo}/action.yml`)), entry.repo);
      assert.equal(action.name, entry.name);
      assert.equal(action.description, entry.description);
      assert.deepEqual(action.branding, entry.branding);
      assert.deepEqual(action.runs, { using: 'node24', main: 'dist/index.mjs' });
      const inputs = asMap(action.inputs, 'inputs');
      assert.deepEqual(Object.keys(inputs), Object.keys(umbrellaInputs));
      for (const [name, input] of Object.entries(inputs)) {
        const expected = name === 'cards' ? { ...asMap(umbrellaInputs.cards, 'cards'), default: entry.cards.join(',') } : umbrellaInputs[name];
        assert.deepEqual(input, expected, `${entry.repo}.${name}`);
      }
    });

    test(`${entry.repo}: README sells the action and links the family`, () => {
      const readme = read(`mirrors/${entry.repo}/README.md`);
      assert.match(readme, new RegExp(`^# ${escapeRe(entry.name)}$`, 'm'));
      assert.ok(readme.includes(entry.description));
      assert.ok(readme.includes(`${manifest.imagesBase}/${entry.preview}`));
      assert.ok(readme.includes(`${manifest.imagesBase}/${entry.preview.replace('-dark.svg', '-light.svg')}`));
      assert.ok(readme.includes(`- uses: ${manifest.owner}/${entry.repo}@${tag}`), 'quickstart uses the mirror');
      assert.ok(readme.includes('<!-- profilescape:start -->') && readme.includes('<!-- profilescape:end -->'));
      for (const [name] of CANONICAL_INPUTS) assert.ok(readme.includes(`| \`${name}\` |`), `inputs table has ${name}`);
      for (const other of manifest.actions) {
        if (other.repo !== entry.repo) assert.ok(readme.includes(`https://github.com/${manifest.owner}/${other.repo})`), `links ${other.repo}`);
      }
      assert.ok(readme.includes(`https://github.com/${manifest.owner}/${manifest.template.repo}`));
      assert.ok(readme.includes('[MIT](LICENSE)'));
      assert.doesNotMatch(readme, /undefined|NaN|\[object Object\]/);
    });

    test(`${entry.repo}: the quickstart workflow is valid YAML`, () => {
      const readme = read(`mirrors/${entry.repo}/README.md`);
      const block = /```yaml\n([\s\S]*?)\n\s*```/.exec(readme)?.[1] ?? '';
      const workflow = asMap(parseYaml(block.replace(/^ {3}/gm, '')), 'quickstart');
      assert.deepEqual(workflow.permissions, { contents: 'write' });
      const steps = asList(asMap(asMap(workflow.jobs, 'jobs').cards, 'cards').steps, 'steps');
      assert.equal(asMap(steps[0], 'step').uses, `${manifest.owner}/${entry.repo}@${tag}`);
    });
  }

  test('rendering is independent of the manifest object identity', () => {
    const copy = structuredClone(manifest) as Manifest;
    const entry = mirrorsOf(copy)[0];
    assert.ok(entry);
    assert.equal(renderActionYml(entry, copy), read(`mirrors/${entry.repo}/action.yml`).replace(/\r\n/g, '\n'));
    assert.equal(renderMirrorReadme(entry, copy, tag), read(`mirrors/${entry.repo}/README.md`).replace(/\r\n/g, '\n'));
  });

  test('preview images referenced by the READMEs exist in docs/images', (t) => {
    const dir = join(ROOT, 'docs/images');
    if (!existsSync(dir)) return t.skip('docs/images has not been generated yet (npm run gallery)');
    for (const entry of manifest.actions) {
      for (const file of [entry.preview, entry.preview.replace(/-dark\.svg$/, '-light.svg')]) {
        assert.ok(existsSync(join(dir, file)), `${entry.repo}: docs/images/${file} is missing`);
      }
    }
  });

  test('repo commands cover every repository and mark the template', () => {
    const commands = repoCommands(manifest);
    for (const entry of manifest.actions) assert.ok(commands.includes(`gh repo edit ${manifest.owner}/${entry.repo} `), entry.repo);
    assert.match(commands, new RegExp(`gh repo edit ${manifest.owner}/${manifest.template.repo} --template`));
    assert.doesNotMatch(commands, new RegExp(`gh repo create ${manifest.owner}/${manifest.umbrella} `));
  });
});

describe('workflows', () => {
  const files = yamlFiles('.github/workflows');
  const shas = new Map<string, string>();

  test('exist', () => {
    for (const name of ['ci', 'self-test', 'release', 'pages', 'codeql']) assert.ok(files.includes(`.github/workflows/${name}.yml`), name);
  });

  for (const file of files) {
    test(`${file} is valid and hardened`, () => {
      const text = read(file);
      const wf = asMap(parseYaml(text), file);
      assert.ok(typeof wf.name === 'string' && wf.name, 'has a name');
      assert.ok(wf.on, 'has triggers');
      assert.ok('permissions' in wf, 'declares top-level permissions');
      const jobs = asMap(wf.jobs, 'jobs');
      for (const [id, raw] of Object.entries(jobs)) {
        const job = asMap(raw, id);
        assert.ok(job['runs-on'], `${id} has runs-on`);
        assert.ok(job['timeout-minutes'], `${id} has timeout-minutes`);
        if (wf.permissions !== 'read-all' && !(typeof wf.permissions === 'object' && Object.keys(wf.permissions).length > 0)) {
          assert.ok('permissions' in job, `${id} declares its own permissions`);
        }
        for (const [i, s] of (job.steps ? asList(job.steps, 'steps') : []).entries()) {
          const step = asMap(s, `${id} step ${i}`);
          if (typeof step.uses === 'string' && !step.uses.startsWith('./')) {
            assert.match(step.uses, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${id}: ${step.uses} must be pinned to a full commit SHA`);
            const [action, sha] = step.uses.split('@') as [string, string];
            assert.match(text, new RegExp(`${escapeRe(step.uses)} # v\\d+\\.\\d+\\.\\d+`), `${step.uses} needs a "# vX.Y.Z" comment`);
            const seen = shas.get(action);
            assert.ok(!seen || seen === sha, `${action} is pinned to two different SHAs`);
            shas.set(action, sha);
            if (action === 'actions/checkout') {
              assert.equal(asMap(step.with, 'with')['persist-credentials'], 'false', `${id}: checkout must not persist credentials`);
            }
          }
          if (typeof step.run === 'string') {
            assert.doesNotMatch(step.run, /\$\{\{\s*(github\.event\.|github\.head_ref|inputs\.)/, `${id}: pass untrusted values through env, not inline`);
          }
        }
      }
    });
  }

  test('release never runs in forks and publishes after verifying', () => {
    const wf = asMap(parseYaml(read('.github/workflows/release.yml')), 'release');
    assert.deepEqual(asMap(asMap(wf.on, 'on').push, 'push').tags, ['v*.*.*']);
    const jobs = asMap(wf.jobs, 'jobs');
    assert.match(String(asMap(jobs.verify, 'verify').if), /github\.repository == 'chethandvg\/profilescape'/);
    for (const [id, job] of Object.entries(jobs)) {
      if (id === 'verify') continue;
      const needs = asMap(job, id).needs;
      assert.ok(needs === 'verify' || (Array.isArray(needs) && needs.includes('verify')), `${id} needs verify`);
    }
    assert.match(JSON.stringify(asMap(jobs.mirrors, 'mirrors').strategy), /fromJSON\(needs\.verify\.outputs\.mirrors\)/);
  });

  test('pages deploys with the official actions', () => {
    const text = read('.github/workflows/pages.yml');
    assert.match(text, /actions\/upload-pages-artifact@/);
    assert.match(text, /actions\/deploy-pages@/);
    assert.match(text, /npm run site/);
    assert.match(text, /path: site\/dist/);
  });
});

describe('repository files', () => {
  test('dependabot covers npm and GitHub Actions', () => {
    const cfg = asMap(parseYaml(read('.github/dependabot.yml')), 'dependabot');
    assert.equal(cfg.version, '2');
    const ecosystems = asList(cfg.updates, 'updates').map((u) => asMap(u, 'update')['package-ecosystem']);
    assert.deepEqual(ecosystems, ['npm', 'github-actions']);
  });

  test('issue forms are valid', () => {
    const forms = yamlFiles('.github/ISSUE_TEMPLATE').filter((f) => !f.endsWith('config.yml'));
    assert.deepEqual(forms.map((f) => f.split('/').pop()).sort(), ['bug_report.yml', 'feature_request.yml', 'theme_proposal.yml']);
    for (const file of forms) {
      const form = asMap(parseYaml(read(file)), file);
      assert.ok(form.name && form.description, `${file} has name and description`);
      const ids = new Set<string>();
      for (const item of asList(form.body, `${file} body`)) {
        const field = asMap(item, 'field');
        assert.ok(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes'].includes(String(field.type)), `${file}: type ${String(field.type)}`);
        asMap(field.attributes, `${file} attributes`);
        if (field.type === 'markdown') continue;
        assert.ok(typeof field.id === 'string' && !ids.has(field.id), `${file}: unique id ${String(field.id)}`);
        ids.add(field.id as string);
      }
    }
    const config = asMap(parseYaml(read('.github/ISSUE_TEMPLATE/config.yml')), 'config');
    assert.equal(config.blank_issues_enabled, 'false');
    assert.ok(asList(config.contact_links, 'contact_links').length >= 2);
  });

  test('template workflow runs the umbrella action into README.md', () => {
    const wf = asMap(parseYaml(read('template/.github/workflows/profilescape.yml')), 'template workflow');
    const on = asMap(wf.on, 'on');
    assert.ok('schedule' in on && 'workflow_dispatch' in on);
    assert.deepEqual(wf.permissions, { contents: 'write' });
    const job = asMap(asMap(wf.jobs, 'jobs').cards, 'cards');
    const step = asList(job.steps, 'steps').map((s) => asMap(s, 'step')).find((s) => s.uses === `${manifest.owner}/${manifest.umbrella}@${tag}`);
    assert.ok(step, `uses ${manifest.owner}/${manifest.umbrella}@${tag}`);
    const inputs = asMap(step.with, 'with');
    assert.equal(inputs.cards, 'hero,stats,3d,languages,repos,socials');
    assert.equal(inputs.readme, 'README.md');
    for (const key of Object.keys(inputs)) assert.ok(CANONICAL_INPUTS.some(([name]) => name === key), `unknown input ${key}`);
    assert.match(String(job.if), new RegExp(`${manifest.owner}/${manifest.template.repo}`), 'skips the template repository itself');
  });

  test('template README has the markers in order, once', () => {
    const readme = read('template/README.md');
    const start = readme.split('<!-- profilescape:start -->').length - 1;
    const end = readme.split('<!-- profilescape:end -->').length - 1;
    assert.equal(start, 1);
    assert.equal(end, 1);
    assert.ok(readme.indexOf('<!-- profilescape:start -->') < readme.indexOf('<!-- profilescape:end -->'));
    assert.match(readme, /## Getting started/);
  });
});
