import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { END_MARKER, missingMarkersHelp, normalizeRepoPath, replaceBetweenMarkers, START_MARKER, updateReadme, wrapWithMarkers } from './readme.ts';

const MARKUP = '<picture>\n  <img src="https://example.com/stats-light.svg" alt="Stats" width="100%" />\n</picture>';

const README = ['# Hi, I am Mira', '', 'Intro text.', '', START_MARKER, 'old stuff', END_MARKER, '', '## Projects', '', 'More text.', ''].join('\n');

describe('replaceBetweenMarkers', () => {
  it('replaces only the content between the markers', () => {
    const { content, status } = replaceBetweenMarkers(README, MARKUP);
    assert.equal(status, 'updated');
    assert.ok(content.startsWith('# Hi, I am Mira\n\nIntro text.\n\n<!-- profilescape:start -->\n\n<picture>'));
    assert.ok(content.endsWith('</picture>\n\n<!-- profilescape:end -->\n\n## Projects\n\nMore text.\n'));
    assert.ok(!content.includes('old stuff'));
  });

  it('is idempotent', () => {
    const once = replaceBetweenMarkers(README, MARKUP).content;
    const twice = replaceBetweenMarkers(once, MARKUP);
    assert.equal(twice.status, 'unchanged');
    assert.equal(twice.content, once);
  });

  it('keeps CRLF line endings throughout', () => {
    const crlf = README.replace(/\n/g, '\r\n');
    const { content, status } = replaceBetweenMarkers(crlf, MARKUP);
    assert.equal(status, 'updated');
    assert.ok(!/[^\r]\n/.test(content), 'every LF is part of a CRLF');
    assert.ok(content.includes('<picture>\r\n  <img'));
    assert.equal(replaceBetweenMarkers(content, MARKUP.replace(/\n/g, '\r\n')).status, 'unchanged');
    assert.equal(content.replace(/\r\n/g, '\n'), replaceBetweenMarkers(README, MARKUP).content);
  });

  it('keeps the exact text of loosely written markers', () => {
    const loose = 'a\n<!--profilescape:START-->\nx\n<!--   profilescape:end   -->\nb';
    const { content, status } = replaceBetweenMarkers(loose, 'NEW');
    assert.equal(status, 'updated');
    assert.equal(content, 'a\n<!--profilescape:START-->\n\nNEW\n\n<!--   profilescape:end   -->\nb');
  });

  it('handles markers on a single line and empty markup', () => {
    const inline = `x ${START_MARKER}${END_MARKER} y`;
    const filled = replaceBetweenMarkers(inline, 'NEW').content;
    assert.equal(filled, `x ${START_MARKER}\n\nNEW\n\n${END_MARKER} y`);
    assert.equal(replaceBetweenMarkers(filled, '').content, `x ${START_MARKER}\n${END_MARKER} y`);
  });

  it('only touches the first marker pair', () => {
    const two = `${START_MARKER}\n1\n${END_MARKER}\nmid\n${START_MARKER}\n2\n${END_MARKER}`;
    const { content } = replaceBetweenMarkers(two, 'NEW');
    assert.ok(content.endsWith(`mid\n${START_MARKER}\n2\n${END_MARKER}`));
  });

  it('reports missing or misordered markers without changing anything', () => {
    assert.deepEqual(replaceBetweenMarkers('# Hello\n', MARKUP), { content: '# Hello\n', status: 'missing-markers' });
    assert.equal(replaceBetweenMarkers(`${START_MARKER}\nno end`, MARKUP).status, 'missing-markers');
    const reversed = `${END_MARKER}\nx\n${START_MARKER}\n`;
    assert.deepEqual(replaceBetweenMarkers(reversed, MARKUP), { content: reversed, status: 'misordered-markers' });
  });

  it('does not interpret $ patterns in the markup', () => {
    const { content } = replaceBetweenMarkers(README, "cost: $& $1 $$ $'");
    assert.ok(content.includes("cost: $& $1 $$ $'"));
  });
});

describe('helpers', () => {
  it('wrapWithMarkers produces a block replaceBetweenMarkers treats as up to date', () => {
    const block = wrapWithMarkers(MARKUP);
    assert.ok(block.startsWith(START_MARKER) && block.endsWith(END_MARKER));
    assert.equal(replaceBetweenMarkers(`# Me\n\n${block}\n`, MARKUP).status, 'unchanged');
    assert.equal(wrapWithMarkers(''), `${START_MARKER}\n${END_MARKER}`);
  });

  it('explains how to add markers', () => {
    const help = missingMarkersHelp('README.md');
    assert.ok(help.includes(START_MARKER) && help.includes(END_MARKER) && help.includes('README.md'));
  });

  it('normalizes repository paths', () => {
    assert.equal(normalizeRepoPath('./README.md'), 'README.md');
    assert.equal(normalizeRepoPath('/docs\\README.md'), 'docs/README.md');
  });
});

describe('updateReadme', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const base = {
    token: 'tok',
    repository: 'mira-dev/mira-dev',
    path: 'README.md',
    markup: MARKUP,
    message: 'chore: update profilescape cards',
    retryDelayMs: 0,
  };

  function mock(handler: (method: string, url: string, body: any) => { status: number; body?: unknown }) {
    const calls: { method: string; url: string; body: any }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const res = handler(call.method, call.url, call.body);
      return new Response(res.body === undefined ? '' : JSON.stringify(res.body), { status: res.status });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('updates the README on the default branch with [skip ci]', async () => {
    const { calls, fetchImpl } = mock((method) =>
      method === 'GET'
        ? { status: 200, body: { type: 'file', encoding: 'base64', content: b64(README), sha: 'abc' } }
        : { status: 200, body: { commit: { sha: 'c1' } } },
    );
    const result = await updateReadme({ ...base, fetchImpl });
    assert.deepEqual(result, { status: 'updated', path: 'README.md', commitSha: 'c1' });
    assert.equal(calls[0]?.url, 'https://api.github.com/repos/mira-dev/mira-dev/contents/README.md');
    const put = calls[1];
    assert.equal(put?.method, 'PUT');
    assert.equal(put?.body.sha, 'abc');
    assert.equal(put?.body.message, 'chore: update profilescape cards [skip ci]');
    assert.equal(put?.body.branch, undefined);
    assert.equal(Buffer.from(put?.body.content, 'base64').toString('utf8'), replaceBetweenMarkers(README, MARKUP).content);
  });

  it('does not commit when nothing changed or markers are missing', async () => {
    const current = replaceBetweenMarkers(README, MARKUP).content;
    for (const [text, status] of [
      [current, 'unchanged'],
      ['# No markers\n', 'missing-markers'],
    ] as const) {
      const { calls, fetchImpl } = mock(() => ({ status: 200, body: { type: 'file', encoding: 'base64', content: b64(text), sha: 's' } }));
      const result = await updateReadme({ ...base, fetchImpl });
      assert.equal(result.status, status);
      assert.equal(calls.length, 1);
    }
  });

  it('retries once on a write conflict', async () => {
    let puts = 0;
    const { calls, fetchImpl } = mock((method) => {
      if (method === 'GET') return { status: 200, body: { type: 'file', encoding: 'base64', content: b64(README), sha: `s${puts}` } };
      return ++puts === 1 ? { status: 409, body: { message: 'conflict' } } : { status: 200, body: { commit: { sha: 'c2' } } };
    });
    const result = await updateReadme({ ...base, fetchImpl });
    assert.equal(result.status, 'updated');
    assert.equal(calls.length, 4);
    assert.equal(calls[3]?.body.sha, 's1');
  });

  it('gives actionable errors', async () => {
    const notFound = mock(() => ({ status: 404, body: { message: 'Not Found' } }));
    await assert.rejects(updateReadme({ ...base, path: 'docs/README.md', fetchImpl: notFound.fetchImpl }), /docs\/README\.md" was not found/);
    const forbidden = mock((method) =>
      method === 'GET'
        ? { status: 200, body: { type: 'file', encoding: 'base64', content: b64(README), sha: 'abc' } }
        : { status: 403, body: { message: 'Resource not accessible by integration' } },
    );
    await assert.rejects(updateReadme({ ...base, fetchImpl: forbidden.fetchImpl }), /contents: write/);
    await assert.rejects(updateReadme({ ...base, path: '../x' }), /Invalid readme path/);
  });
});
