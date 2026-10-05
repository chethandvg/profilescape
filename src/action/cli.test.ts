import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { CARD_IDS } from '../core/types.ts';

/** End-to-end tests for src/cli.ts, run as a real process (no network: demo data or early failures only). */

const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'profilescape-cli-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function cli(args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', NO_COLOR: '1' };
  delete env.FORCE_COLOR;
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: tmp, encoding: 'utf8', env });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('profilescape CLI', () => {
  it('prints help', () => {
    const { code, stdout } = cli(['--help']);
    assert.equal(code, 0);
    for (const flag of ['--user', '--token', '--demo', '--cards', '--theme', '--modes', '--config', '--out', '--list-themes', '--list-cards']) {
      assert.ok(stdout.includes(flag), flag);
    }
    assert.ok(!stdout.includes('\x1b['), 'no colour codes when NO_COLOR is set');
  });

  it('renders the demo profile deterministically without a token', () => {
    const a = cli(['--demo', '--cards', 'stats,3d', '--out', 'a']);
    const b = cli(['--demo', '--cards', 'stats,3d', '--out', 'b']);
    assert.equal(a.code, 0, a.stderr);
    assert.equal(b.code, 0, b.stderr);
    const files = readdirSync(join(tmp, 'a')).sort();
    assert.deepEqual(files, ['3d-dark.svg', '3d-light.svg', 'README-snippet.md', 'stats-dark.svg', 'stats-light.svg']);
    for (const f of files.filter((x) => x.endsWith('.svg'))) {
      assert.equal(readFileSync(join(tmp, 'a', f), 'utf8'), readFileSync(join(tmp, 'b', f), 'utf8'), f);
    }
    const snippet = readFileSync(join(tmp, 'a', 'README-snippet.md'), 'utf8');
    assert.match(snippet, /^<!-- profilescape:start -->/);
    assert.match(snippet, /srcset="a\/stats-dark\.svg"/);
    assert.match(a.stdout, /Rendered 4 SVGs for @mira-dev/);
  });

  it('honours --modes, --base-url and --config', () => {
    writeFileSync(join(tmp, 'cfg.json'), '{ "cards": ["stats"], // comment\n "options": { "stats": { "chart": "none" } } }');
    const res = cli(['--demo', '--config', 'cfg.json', '--modes', 'light', '--out', 'c', '--base-url', 'https://example.com/cards/']);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(readdirSync(join(tmp, 'c')).sort(), ['README-snippet.md', 'stats-light.svg']);
    assert.match(readFileSync(join(tmp, 'c', 'README-snippet.md'), 'utf8'), /src="https:\/\/example\.com\/cards\/stats-light\.svg"/);
  });

  it('lists themes and cards', () => {
    const themes = cli(['--list-themes']);
    assert.equal(themes.code, 0);
    assert.match(themes.stdout, /aurora\s+Aurora/);
    const cards = cli(['--list-cards']);
    assert.equal(cards.code, 0);
    for (const id of CARD_IDS) assert.match(cards.stdout, new RegExp(`^  ${id}\\b`, 'm'));
  });

  it('explains usage errors with exit code 2', () => {
    const unknown = cli(['--theem', 'aurora']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /Unknown option '--theem'.*did you mean --theme\?/);

    const noUser = cli([]);
    assert.equal(noUser.code, 2);
    assert.match(noUser.stderr, /Missing --user/);
    assert.match(noUser.stderr, /--demo/);

    const noToken = cli(['--user', 'octocat']);
    assert.equal(noToken.code, 2);
    assert.match(noToken.stderr, /No GitHub token.*GH_TOKEN=\$\(gh auth token\)/s);

    const badCard = cli(['--demo', '--cards', 'stats,nope']);
    assert.equal(badCard.code, 2);
    assert.match(badCard.stderr, /Unknown card in --cards: "nope"/);

    writeFileSync(join(tmp, 'broken.json'), '{\n  "theme": "aurora",\n  "cards": [stats]\n}');
    const badJson = cli(['--demo', '--config', 'broken.json']);
    assert.equal(badJson.code, 2);
    assert.match(badJson.stderr, /Invalid JSON in broken\.json at line 3, column 13/);
  });
});
