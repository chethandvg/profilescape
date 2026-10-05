import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gitBlobSha, gitTreeSha, publishToBranch, PublishError, rawBaseUrl, withSkipCi, type PublishFile } from './publish.ts';

interface Call {
  method: string;
  path: string;
  body: any;
  headers: Record<string, string>;
}

type Handler = (call: Call) => { status: number; body?: unknown } | undefined;

/** Tiny REST mock: routes "METHOD /path" to handlers and records every call. */
function mockGitHub(routes: Record<string, Handler | { status: number; body?: unknown }>, root = 'https://api.github.com') {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith(root), `unexpected host in ${url}`);
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.slice(root.length),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const key = `${call.method} ${call.path}`;
    const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
    const res = typeof route === 'function' ? route(call) : route;
    if (!res) throw new Error(`Unmocked request: ${key}`);
    return new Response(res.body === undefined ? '' : JSON.stringify(res.body), { status: res.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const FILES: PublishFile[] = [
  { path: 'b.svg', content: 'hello' },
  { path: 'a-dark.svg', content: '<svg/>' },
  { path: 'README.md', content: 'x' },
];
const REPO = '/repos/mira-dev/mira-dev';

/** Answers blob uploads with the real git sha of the uploaded bytes. */
const blobRoute: Handler = (c) => ({ status: 201, body: { sha: gitBlobSha(Buffer.from(c.body.content, 'base64')) } });

describe('git hashing', () => {
  it('computes blob shas exactly like git', () => {
    assert.equal(gitBlobSha('hello'), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
    assert.equal(gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    assert.equal(gitBlobSha(new TextEncoder().encode('<svg/>')), '950ddbbd87f70356e400dbd9eb234b9447dfccab');
  });

  it('computes flat tree shas exactly like git (order independent)', () => {
    const entries = FILES.map((f) => ({ path: f.path, sha: gitBlobSha(f.content) }));
    assert.equal(gitTreeSha(entries), '9a7e6d949cb80fdccfd5dbb69edce7727e68bcdb');
    assert.equal(gitTreeSha([...entries].reverse()), '9a7e6d949cb80fdccfd5dbb69edce7727e68bcdb');
    assert.equal(gitTreeSha([]), '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    assert.equal(gitTreeSha([{ path: 'dir/file.svg', sha: gitBlobSha('x') }]), null);
  });
});

describe('rawBaseUrl', () => {
  it('uses raw.githubusercontent.com on github.com', () => {
    assert.equal(rawBaseUrl('mira-dev/mira-dev', 'profilescape-output'), 'https://raw.githubusercontent.com/mira-dev/mira-dev/profilescape-output');
    assert.equal(rawBaseUrl('o/r', 'cards/out', 'https://github.com/'), 'https://raw.githubusercontent.com/o/r/cards/out');
  });

  it('derives the raw URL from the server URL on GHES', () => {
    assert.equal(rawBaseUrl('o/r', 'out', 'https://ghe.example.com'), 'https://ghe.example.com/o/r/raw/out');
  });
});

describe('withSkipCi', () => {
  it('appends [skip ci] once', () => {
    assert.equal(withSkipCi('chore: update cards'), 'chore: update cards [skip ci]');
    assert.equal(withSkipCi('chore: update [skip ci]'), 'chore: update [skip ci]');
  });
});

describe('publishToBranch', () => {
  const base = { token: 't0k3n', repository: 'mira-dev/mira-dev', branch: 'profilescape-output', message: 'chore: update profilescape cards', retryDelayMs: 0 };

  it('creates a new branch with an orphan commit', async () => {
    const { calls, fetchImpl } = mockGitHub({
      [`GET ${REPO}/git/ref/heads/profilescape-output`]: { status: 404, body: { message: 'Not Found' } },
      [`POST ${REPO}/git/blobs`]: blobRoute,
      [`POST ${REPO}/git/trees`]: { status: 201, body: { sha: 'tree1' } },
      [`POST ${REPO}/git/commits`]: { status: 201, body: { sha: 'commit1' } },
      [`POST ${REPO}/git/refs`]: { status: 201, body: { ref: 'refs/heads/profilescape-output' } },
    });
    const result = await publishToBranch({ ...base, files: FILES, fetchImpl });
    assert.equal(result.status, 'created');
    assert.equal(result.commitSha, 'commit1');
    assert.equal(result.baseUrl, 'https://raw.githubusercontent.com/mira-dev/mira-dev/profilescape-output');

    const blobs = calls.filter((c) => c.path.endsWith('/git/blobs'));
    assert.equal(blobs.length, 3);
    for (const b of blobs) assert.equal(b.body.encoding, 'base64');
    assert.deepEqual(blobs.map((b) => Buffer.from(b.body.content, 'base64').toString()).sort(), ['<svg/>', 'hello', 'x']);

    const tree = calls.find((c) => c.path.endsWith('/git/trees'));
    assert.ok(tree);
    assert.equal(tree.body.base_tree, undefined, 'tree must not build on the old tree');
    assert.deepEqual(tree.body.tree.map((e: any) => e.path), ['README.md', 'a-dark.svg', 'b.svg']);
    for (const e of tree.body.tree) {
      assert.equal(e.mode, '100644');
      assert.equal(e.type, 'blob');
    }

    const commit = calls.find((c) => c.path.endsWith('/git/commits'));
    assert.deepEqual(commit?.body.parents, []);
    assert.equal(commit?.body.tree, 'tree1');
    assert.match(commit?.body.message, /\[skip ci\]$/);

    const ref = calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/refs'));
    assert.deepEqual(ref?.body, { ref: 'refs/heads/profilescape-output', sha: 'commit1' });
    assert.equal(calls[0]?.headers.Authorization, 'Bearer t0k3n');
  });

  it('force-updates an existing branch', async () => {
    const { calls, fetchImpl } = mockGitHub({
      [`GET ${REPO}/git/ref/heads/profilescape-output`]: { status: 200, body: { object: { sha: 'old-commit', type: 'commit' } } },
      [`GET ${REPO}/git/commits/old-commit`]: { status: 200, body: { tree: { sha: 'old-tree' } } },
      [`POST ${REPO}/git/blobs`]: blobRoute,
      [`POST ${REPO}/git/trees`]: { status: 201, body: { sha: 'new-tree' } },
      [`POST ${REPO}/git/commits`]: { status: 201, body: { sha: 'new-commit' } },
      [`PATCH ${REPO}/git/refs/heads/profilescape-output`]: { status: 200, body: {} },
    });
    const result = await publishToBranch({ ...base, files: FILES, fetchImpl });
    assert.equal(result.status, 'updated');
    assert.equal(result.commitSha, 'new-commit');
    const commit = calls.find((c) => c.path.endsWith('/git/commits') && c.method === 'POST');
    assert.deepEqual(commit?.body.parents, [], 'commit is an orphan so the branch never grows');
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.deepEqual(patch?.body, { sha: 'new-commit', force: true });
  });

  it('skips everything when the local tree matches the branch', async () => {
    const localTree = gitTreeSha(FILES.map((f) => ({ path: f.path, sha: gitBlobSha(f.content) })));
    const { calls, fetchImpl } = mockGitHub({
      [`GET ${REPO}/git/ref/heads/profilescape-output`]: { status: 200, body: { object: { sha: 'c1', type: 'commit' } } },
      [`GET ${REPO}/git/commits/c1`]: { status: 200, body: { tree: { sha: localTree } } },
    });
    const result = await publishToBranch({ ...base, files: FILES, fetchImpl });
    assert.equal(result.status, 'unchanged');
    assert.equal(result.commitSha, 'c1');
    assert.equal(calls.length, 2, 'no blobs, trees, commits or ref updates');
  });

  it('skips the commit when the API tree sha equals the existing tree', async () => {
    const { calls, fetchImpl } = mockGitHub({
      [`GET ${REPO}/git/ref/heads/profilescape-output`]: { status: 200, body: { object: { sha: 'c1', type: 'commit' } } },
      [`GET ${REPO}/git/commits/c1`]: { status: 200, body: { tree: { sha: 'same-tree' } } },
      [`POST ${REPO}/git/blobs`]: blobRoute,
      [`POST ${REPO}/git/trees`]: { status: 201, body: { sha: 'same-tree' } },
    });
    const result = await publishToBranch({ ...base, files: FILES, fetchImpl });
    assert.equal(result.status, 'unchanged');
    assert.ok(!calls.some((c) => c.path.endsWith('/git/commits') && c.method === 'POST'));
    assert.ok(!calls.some((c) => c.method === 'PATCH'));
  });

  it('turns a 403 into a permissions hint', async () => {
    const { fetchImpl } = mockGitHub({
      [`GET ${REPO}/git/ref/heads/profilescape-output`]: { status: 404, body: { message: 'Not Found' } },
      [`POST ${REPO}/git/blobs`]: { status: 403, body: { message: 'Resource not accessible by integration' } },
    });
    await assert.rejects(publishToBranch({ ...base, files: FILES, fetchImpl }), (e: unknown) => {
      assert.ok(e instanceof PublishError);
      assert.equal(e.status, 403);
      assert.match(e.message, /Resource not accessible by integration/);
      assert.match(e.message, /permissions:\n\s+contents: write/);
      assert.ok(!e.message.includes('t0k3n'), 'never leaks the token');
      return true;
    });
  });

  it('distinguishes rate limits from permission errors', async () => {
    const { fetchImpl } = mockGitHub({
      [`GET ${REPO}/git/ref/heads/profilescape-output`]: { status: 403, body: { message: 'API rate limit exceeded' } },
    });
    await assert.rejects(publishToBranch({ ...base, files: FILES, fetchImpl }), /rate limit/);
  });

  it('takes over a branch created concurrently (422 already exists)', async () => {
    const { calls, fetchImpl } = mockGitHub({
      [`GET ${REPO}/git/ref/heads/profilescape-output`]: { status: 404 },
      [`POST ${REPO}/git/blobs`]: blobRoute,
      [`POST ${REPO}/git/trees`]: { status: 201, body: { sha: 't' } },
      [`POST ${REPO}/git/commits`]: { status: 201, body: { sha: 'c' } },
      [`POST ${REPO}/git/refs`]: { status: 422, body: { message: 'Reference already exists' } },
      [`PATCH ${REPO}/git/refs/heads/profilescape-output`]: { status: 200, body: {} },
    });
    const result = await publishToBranch({ ...base, files: FILES, fetchImpl });
    assert.equal(result.status, 'updated');
    assert.ok(calls.some((c) => c.method === 'PATCH'));
  });

  it('retries transient 5xx failures', async () => {
    let attempts = 0;
    const { fetchImpl } = mockGitHub({
      [`GET ${REPO}/git/ref/heads/profilescape-output`]: () => (++attempts < 2 ? { status: 502, body: { message: 'Bad gateway' } } : { status: 404 }),
      [`POST ${REPO}/git/blobs`]: blobRoute,
      [`POST ${REPO}/git/trees`]: { status: 201, body: { sha: 't' } },
      [`POST ${REPO}/git/commits`]: { status: 201, body: { sha: 'c' } },
      [`POST ${REPO}/git/refs`]: { status: 201, body: {} },
    });
    const result = await publishToBranch({ ...base, files: FILES, fetchImpl });
    assert.equal(result.status, 'created');
    assert.equal(attempts, 2);
  });

  it('uploads identical content once and honours GITHUB_API_URL (GHES)', async () => {
    const root = 'https://ghe.example.com/api/v3';
    const { calls, fetchImpl } = mockGitHub(
      {
        [`GET ${REPO}/git/ref/heads/out/cards`]: { status: 404 },
        [`POST ${REPO}/git/blobs`]: blobRoute,
        [`POST ${REPO}/git/trees`]: { status: 201, body: { sha: 't' } },
        [`POST ${REPO}/git/commits`]: { status: 201, body: { sha: 'c' } },
        [`POST ${REPO}/git/refs`]: { status: 201, body: {} },
      },
      root,
    );
    const files = [
      { path: 'one.svg', content: 'same' },
      { path: 'two.svg', content: 'same' },
    ];
    const result = await publishToBranch({
      ...base,
      branch: 'out/cards',
      files,
      fetchImpl,
      apiUrl: `${root}/`,
      serverUrl: 'https://ghe.example.com',
    });
    assert.equal(calls.filter((c) => c.path.endsWith('/git/blobs')).length, 1);
    const tree = calls.find((c) => c.path.endsWith('/git/trees'));
    assert.equal(tree?.body.tree.length, 2);
    assert.equal(result.baseUrl, 'https://ghe.example.com/mira-dev/mira-dev/raw/out/cards');
  });

  it('validates its input', async () => {
    await assert.rejects(publishToBranch({ ...base, repository: 'nope', files: FILES }), /owner\/repo/);
    await assert.rejects(publishToBranch({ ...base, files: [] }), /Nothing to publish/);
    await assert.rejects(publishToBranch({ ...base, files: [FILES[0] as PublishFile, FILES[0] as PublishFile] }), /Duplicate/);
  });
});
