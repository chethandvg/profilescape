import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DEMO_NOW, demoProfile, emptyProfile } from '../core/fixtures.ts';
import { GitHubError, type FetchOptions } from '../core/github.ts';
import type { ProfileData } from '../core/types.ts';
import { ACTION_INPUT_DEFAULTS } from './config.ts';
import type { Logger } from './io.ts';
import { branchReadme, repositoryIsPrivate, run, snippetDocument } from './main.ts';
import { START_MARKER } from './readme.ts';

const root = mkdtempSync(join(tmpdir(), 'profilescape-main-'));
after(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
const TOKEN = 'ghs_super_secret_value';

/** A fresh workspace plus the env the runner would provide (all inputs at their action.yml defaults). */
function setup(inputs: Record<string, string> = {}) {
  const workspace = join(root, `ws${counter++}`);
  mkdirSync(workspace, { recursive: true });
  const outputFile = join(workspace, 'output.txt');
  const summaryFile = join(workspace, 'summary.md');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  const env: Record<string, string> = {
    GITHUB_WORKSPACE: workspace,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    GITHUB_REPOSITORY: 'mira-dev/mira-dev',
    GITHUB_REPOSITORY_OWNER: 'mira-dev',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com',
  };
  for (const [k, v] of Object.entries({ ...ACTION_INPUT_DEFAULTS, token: TOKEN, github_token: TOKEN, ...inputs })) {
    env[`INPUT_${k.toUpperCase()}`] = v;
  }
  const lines: string[] = [];
  const log: Logger = {
    info: (m) => lines.push(m),
    debug: () => {},
    warning: (m) => lines.push(`WARNING ${m}`),
    error: (m) => lines.push(`ERROR ${m}`),
    group: (m) => lines.push(`GROUP ${m}`),
    endGroup: () => lines.push('ENDGROUP'),
    mask: (m) => lines.push(`MASK ${m}`),
  };
  const requests: FetchOptions[] = [];
  const fetchProfile = async (o: FetchOptions): Promise<ProfileData> => {
    requests.push(o);
    return o.login === 'new-user' ? emptyProfile(DEMO_NOW) : demoProfile(DEMO_NOW);
  };
  const outputs = () => {
    const text = readFileSync(outputFile, 'utf8');
    const out: Record<string, string> = {};
    const re = /^([a-z_]+)<<(\S+)\n([\s\S]*?)\n\2$/gm;
    for (const m of text.matchAll(re)) out[m[1] as string] = m[3] as string;
    return out;
  };
  return { workspace, env, log, lines, requests, fetchProfile, outputs, summary: () => readFileSync(summaryFile, 'utf8') };
}

describe('action run()', () => {
  it('writes cards, snippet, outputs and summary with publish: none', async () => {
    const t = setup({ publish: 'none', cards: 'stats,3d', history: 'year', hide_languages: 'HTML', repos: 'octocat/hello' });
    const code = await run({ env: t.env, log: t.log, fetchProfile: t.fetchProfile, now: DEMO_NOW });
    assert.equal(code, 0, t.lines.join('\n'));

    // Fetch options are forwarded.
    const req = t.requests[0];
    assert.ok(req);
    assert.equal(req.login, 'mira-dev');
    assert.equal(req.token, TOKEN);
    assert.equal(req.history, 'year');
    assert.deepEqual(req.hideLanguages, ['HTML']);
    assert.deepEqual(req.extraRepos, ['octocat/hello']);

    // Files on disk.
    const dir = join(t.workspace, 'profilescape');
    for (const f of ['stats-dark.svg', 'stats-light.svg', '3d-dark.svg', '3d-light.svg', 'README-snippet.md']) {
      assert.ok(existsSync(join(dir, f)), f);
    }
    assert.match(readFileSync(join(dir, 'stats-dark.svg'), 'utf8'), /^<svg/);

    // Outputs.
    const out = t.outputs();
    assert.deepEqual(JSON.parse(out.files as string), [
      'profilescape/stats-dark.svg',
      'profilescape/stats-light.svg',
      'profilescape/3d-dark.svg',
      'profilescape/3d-light.svg',
      'profilescape/README-snippet.md',
    ]);
    assert.equal(out.base_url, 'profilescape');
    assert.match(out.markup as string, /srcset="profilescape\/stats-dark\.svg"/);
    assert.equal(readFileSync(join(dir, 'README-snippet.md'), 'utf8'), snippetDocument(out.markup as string));

    // Summary and logs.
    assert.match(t.summary(), /## Profilescape/);
    assert.match(t.summary(), /profilescape\/3d-light\.svg/);
    assert.ok(t.lines.includes(`MASK ${TOKEN}`));
    assert.ok(!t.lines.some((l) => !l.startsWith('MASK') && l.includes(TOKEN)), 'token never printed');
  });

  it('publishes to the branch, updates the README and sets base_url', async () => {
    const t = setup({ cards: 'stats', readme: 'README.md', modes: 'dark' });
    const calls: { method: string; url: string; body: any }[] = [];
    const readme = `# Mira\n\n${START_MARKER}\n<!-- profilescape:end -->\n`;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const path = call.url.replace('https://api.github.com/repos/mira-dev/mira-dev', '');
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (path === '/git/ref/heads/profilescape-output') return json(404, { message: 'Not Found' });
      if (path === '/git/blobs') return json(201, { sha: `blob${calls.length}` });
      if (path === '/git/trees') return json(201, { sha: 'tree1' });
      if (path === '/git/commits') return json(201, { sha: 'commit1' });
      if (path === '/git/refs') return json(201, {});
      if (path === '/contents/README.md' && call.method === 'GET') {
        return json(200, { type: 'file', encoding: 'base64', content: Buffer.from(readme).toString('base64'), sha: 'r1' });
      }
      if (path === '/contents/README.md' && call.method === 'PUT') return json(200, { commit: { sha: 'rc1' } });
      throw new Error(`unmocked ${call.method} ${call.url}`);
    }) as typeof fetch;

    const code = await run({ env: t.env, log: t.log, fetchProfile: t.fetchProfile, fetchImpl, now: DEMO_NOW, retryDelayMs: 0 });
    assert.equal(code, 0, t.lines.join('\n'));
    const out = t.outputs();
    assert.equal(out.base_url, 'https://raw.githubusercontent.com/mira-dev/mira-dev/profilescape-output');
    assert.match(out.markup as string, /https:\/\/raw\.githubusercontent\.com\/mira-dev\/mira-dev\/profilescape-output\/stats-dark\.svg/);

    const tree = calls.find((c) => c.url.endsWith('/git/trees'));
    assert.deepEqual(tree?.body.tree.map((e: any) => e.path), ['README-snippet.md', 'README.md', 'stats-dark.svg']);
    const put = calls.find((c) => c.method === 'PUT');
    const updated = Buffer.from(put?.body.content, 'base64').toString('utf8');
    assert.ok(updated.startsWith(`# Mira\n\n${START_MARKER}\n\n<`));
    assert.ok(updated.endsWith(`${out.markup}\n\n<!-- profilescape:end -->\n`));
    assert.match(put?.body.message, /\[skip ci\]$/);
    assert.match(t.summary(), /published them to \[`profilescape-output`\]/);
    assert.match(t.summary(), /Updated `README\.md`/);
  });

  it('lets a config file override inputs left at their defaults', async () => {
    const t = setup({ publish: 'none', config: '.github/profilescape.json' });
    mkdirSync(join(t.workspace, '.github'));
    writeFileSync(join(t.workspace, '.github', 'profilescape.json'), '{ "cards": ["stats"], "modes": ["light"], "theme": "nope" }');
    const code = await run({ env: t.env, log: t.log, fetchProfile: t.fetchProfile, now: DEMO_NOW });
    assert.equal(code, 0, t.lines.join('\n'));
    assert.deepEqual(JSON.parse(t.outputs().files as string), ['profilescape/stats-light.svg', 'profilescape/README-snippet.md']);
    assert.ok(t.lines.some((l) => l.startsWith('WARNING Unknown theme "nope"')));
  });

  it('renders the empty state for a brand-new account', async () => {
    const t = setup({ publish: 'none', username: 'new-user', cards: 'all' });
    const code = await run({ env: t.env, log: t.log, fetchProfile: t.fetchProfile, now: DEMO_NOW });
    assert.equal(code, 0, t.lines.join('\n'));
    for (const f of JSON.parse(t.outputs().files as string) as string[]) {
      const text = readFileSync(join(t.workspace, f), 'utf8');
      assert.ok(!/NaN|undefined|Infinity/.test(text), `${f} has no broken numbers`);
    }
  });

  it('fails with actionable messages', async () => {
    const cases: { inputs: Record<string, string>; fetchProfile?: () => Promise<ProfileData>; env?: Record<string, string>; expect: RegExp }[] = [
      { inputs: { cards: 'stats,bogus' }, expect: /Unknown card.*"bogus".*Valid cards: stats, languages, 3d/ },
      { inputs: { config: '{ "theme": ' }, expect: /Invalid JSON in config input/ },
      { inputs: { config: 'missing.json' }, expect: /Config file "missing\.json" was not found/ },
      { inputs: { token: '', github_token: '' }, expect: /No token/ },
      {
        inputs: { publish: 'none' },
        fetchProfile: async () => {
          throw new GitHubError('GitHub rejected the token (401).', 401);
        },
        expect: /PROFILESCAPE_TOKEN.*expired/s,
      },
      {
        inputs: { publish: 'none' },
        fetchProfile: async () => {
          throw new GitHubError('GitHub user "ghost-x" not found', 404);
        },
        expect: /Check the "username" input/,
      },
      { inputs: {}, env: { GITHUB_REPOSITORY: '' }, expect: /publish: none/ },
    ];
    for (const c of cases) {
      const t = setup(c.inputs);
      const code = await run({ env: { ...t.env, ...c.env }, log: t.log, fetchProfile: c.fetchProfile ?? t.fetchProfile, now: DEMO_NOW });
      assert.equal(code, 1, JSON.stringify(c.inputs));
      const error = t.lines.find((l) => l.startsWith('ERROR'));
      assert.match(error ?? '', c.expect);
    }
  });

  it('reports a failing publish with the permissions fix', async () => {
    const t = setup({ cards: 'stats' });
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/git/ref/heads/profilescape-output')) return new Response('{"message":"Not Found"}', { status: 404 });
      return new Response('{"message":"Resource not accessible by integration"}', { status: 403 });
    }) as typeof fetch;
    const code = await run({ env: t.env, log: t.log, fetchProfile: t.fetchProfile, fetchImpl, now: DEMO_NOW, retryDelayMs: 0 });
    assert.equal(code, 1);
    const errorAt = t.lines.findIndex((l) => l.startsWith('ERROR'));
    assert.match(t.lines[errorAt] ?? '', /permissions:\n\s+contents: write/);
    assert.equal(t.lines[errorAt - 1], 'ENDGROUP', 'the error is printed outside the collapsed publish group');
    assert.equal(t.lines.filter((l) => l.startsWith('GROUP')).length, t.lines.filter((l) => l === 'ENDGROUP').length);
    // Files were still written locally before publishing failed.
    assert.ok(existsSync(join(t.workspace, 'profilescape', 'stats-dark.svg')));
  });
});

describe('repositoryIsPrivate', () => {
  it('reads the event payload and tolerates a missing or broken file', () => {
    const file = join(root, 'event.json');
    writeFileSync(file, JSON.stringify({ repository: { private: true } }));
    assert.equal(repositoryIsPrivate({ GITHUB_EVENT_PATH: file }), true);
    writeFileSync(file, JSON.stringify({ repository: { private: false } }));
    assert.equal(repositoryIsPrivate({ GITHUB_EVENT_PATH: file }), false);
    writeFileSync(file, '{oops');
    assert.equal(repositoryIsPrivate({ GITHUB_EVENT_PATH: file }), false);
    assert.equal(repositoryIsPrivate({}), false);
  });
});

describe('branchReadme', () => {
  it('previews the cards with relative links and shows the snippet', () => {
    const md = branchReadme('mira-dev', [{ card: 'stats', name: 'stats', mode: 'dark', path: 'stats-dark.svg', alt: 'Stats', svg: '<svg/>', layout: 'full' }], 'MARKUP');
    assert.match(md, /src="\.\/stats-dark\.svg"/);
    assert.match(md, /```html\n<!-- profilescape:start -->\n\nMARKUP\n\n<!-- profilescape:end -->\n```/);
  });
});
