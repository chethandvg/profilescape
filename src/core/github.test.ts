import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calendarWindows, fetchProfile, GitHubError, graphql, type FetchOptions } from './github.ts';

/** Mocked GitHub GraphQL API: routes each query by its shape and records the variables. */

interface MockRepo {
  name: string;
  stars: number;
  isPrivate?: boolean;
  isArchived?: boolean;
  topics?: string[];
  language?: string;
}

interface MockUser {
  login: string;
  createdAt: string;
  years: number[];
  repos: MockRepo[];
  pinned?: string[];
  publicTotal?: number;
  commits?: { repo: string; count: number; isPrivate?: boolean; language?: string }[];
  /** Days returned by every calendar request whose range includes them. */
  days?: Record<string, number>;
}

const NOW = new Date('2026-10-05T12:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function rawRepo(login: string, r: MockRepo) {
  const lang = r.language ?? 'TypeScript';
  return {
    id: `id-${r.name}`,
    name: r.name,
    nameWithOwner: `${login}/${r.name}`,
    owner: { login },
    description: `${r.name} description`,
    url: `https://github.com/${login}/${r.name}`,
    homepageUrl: null,
    stargazerCount: r.stars,
    forkCount: 1,
    isArchived: r.isArchived ?? false,
    isFork: false,
    isPrivate: r.isPrivate ?? false,
    isTemplate: false,
    pushedAt: '2026-09-01T00:00:00Z',
    createdAt: '2020-01-01T00:00:00Z',
    primaryLanguage: { name: lang, color: '#3178c6' },
    repositoryTopics: { nodes: (r.topics ?? []).map((name) => ({ topic: { name } })) },
    languages: { edges: [{ size: 1000, node: { name: lang, color: '#3178c6' } }] },
  };
}

const detail = (name: string) => ({
  id: `id-${name}`,
  watchers: { totalCount: 7 },
  issues: { totalCount: 3 },
  pullRequests: { totalCount: 2 },
  licenseInfo: { spdxId: 'MIT' },
  latestRelease: { tagName: 'v1.0.0', publishedAt: '2026-01-01T00:00:00Z' },
});

interface Recorded {
  kind: string;
  variables: Record<string, any>;
}

function mockApi(user: MockUser, hooks: { repos?: (first: number, call: number) => Response | undefined } = {}) {
  const calls: Recorded[] = [];
  let repoCalls = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, any> };
    const kind = query.includes('repositoryOwner')
      ? 'owner'
      : query.includes('pinnedItems')
        ? 'profile'
        : query.includes('commitContributionsByRepository')
          ? 'commits'
          : query.includes('nodes(ids')
            ? 'details'
            : query.includes('contributionCalendar { weeks')
              ? 'calendar'
              : query.includes('repository(owner')
                ? 'repo'
                : query.includes('...RepoListing')
                  ? 'repos'
                  : 'stars';
    calls.push({ kind, variables });
    const sorted = [...user.repos].sort((a, b) => b.stars - a.stars);
    const page = (first: number) => {
      const start = variables.cursor ? Number(variables.cursor) : 0;
      const slice = sorted.slice(start, start + first);
      const end = start + slice.length;
      return { pageInfo: { hasNextPage: end < sorted.length, endCursor: String(end) }, slice };
    };
    switch (kind) {
      case 'profile':
        return json({
          data: {
            user: {
              login: user.login,
              name: 'Mock User',
              bio: null,
              location: null,
              company: null,
              websiteUrl: null,
              twitterUsername: null,
              avatarUrl: 'https://example.com/a.png',
              createdAt: user.createdAt,
              followers: { totalCount: 1 },
              following: { totalCount: 2 },
              publicRepos: { totalCount: user.publicTotal ?? user.repos.filter((r) => !r.isPrivate).length },
              pinnedItems: { nodes: (user.pinned ?? []).map((n) => rawRepo(user.login, user.repos.find((r) => r.name === n) as MockRepo)) },
              contributionsCollection: {
                contributionYears: user.years,
                totalCommitContributions: 10,
                totalPullRequestContributions: 2,
                totalIssueContributions: 1,
                totalPullRequestReviewContributions: 0,
                totalRepositoryContributions: 1,
                restrictedContributionsCount: 0,
                contributionCalendar: { totalContributions: 14 },
              },
            },
          },
        });
      case 'commits':
        return json({
          data: {
            user: {
              contributionsCollection: {
                commitContributionsByRepository: (user.commits ?? []).map((c) => ({
                  contributions: { totalCount: c.count },
                  repository: {
                    nameWithOwner: `${user.login}/${c.repo}`,
                    isPrivate: c.isPrivate ?? false,
                    isFork: false,
                    languages: { edges: [{ size: 10, node: { name: c.language ?? 'Go', color: '#00ADD8' } }] },
                  },
                })),
              },
            },
          },
        });
      case 'repos': {
        const hooked = hooks.repos?.(variables.first, repoCalls++);
        if (hooked) return hooked;
        const { pageInfo, slice } = page(variables.first);
        return json({ data: { user: { repositories: { pageInfo, nodes: slice.map((r) => rawRepo(user.login, r)) } } } });
      }
      case 'stars': {
        const { pageInfo, slice } = page(100);
        const nodes = slice.map((r) => ({ nameWithOwner: `${user.login}/${r.name}`, stargazerCount: r.stars, isPrivate: r.isPrivate ?? false }));
        return json({ data: { user: { repositories: { pageInfo, nodes } } } });
      }
      case 'details':
        return json({ data: { nodes: (variables.ids as string[]).map((id) => detail(id.replace(/^id-/, ''))) } });
      case 'calendar': {
        const from = String(variables.from).slice(0, 10);
        const to = String(variables.to).slice(0, 10);
        const days = Object.entries(user.days ?? {})
          .filter(([d]) => d >= from && d <= to)
          .map(([date, contributionCount]) => ({ date, contributionCount }));
        return json({ data: { user: { contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays: days }] } } } } });
      }
      case 'owner':
        return json({ data: { repositoryOwner: null } });
      default:
        return json({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] });
    }
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const base = (fetchImpl: typeof fetch, extra: Partial<FetchOptions> = {}): FetchOptions => ({
  token: 't',
  login: 'mira',
  history: 'year',
  now: NOW,
  fetchImpl,
  retryDelayMs: 0,
  ...extra,
});

const manyRepos = (n: number): MockRepo[] => Array.from({ length: n }, (_, i) => ({ name: `repo-${String(i).padStart(3, '0')}`, stars: 1000 - i }));

const RESOURCE_LIMITS = (n: number) =>
  json({
    data: { user: { repositories: { nodes: [] } } },
    errors: Array.from({ length: n }, (_, i) => ({ type: 'RESOURCE_LIMITS_EXCEEDED', path: ['user', 'repositories', 'nodes', i], message: 'Resource limits for this query exceeded.' })),
  });

describe('graphql()', () => {
  const once = (res: () => Response | Promise<Response>) => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return res();
    }) as unknown as typeof fetch;
    return { fetchImpl, count: () => calls };
  };

  it('deduplicates repeated error messages', async () => {
    const m = once(() => RESOURCE_LIMITS(190));
    await assert.rejects(graphql(base(m.fetchImpl), 'query{x}', {}), (e: unknown) => {
      assert.ok(e instanceof GitHubError);
      assert.equal(e.type, 'RESOURCE_LIMITS_EXCEEDED');
      assert.equal(e.message, 'GitHub GraphQL error: Resource limits for this query exceeded. (x190)');
      return true;
    });
    assert.equal(m.count(), 1, 'a query that is too heavy is not retried unchanged');
  });

  it('maps GraphQL RATE_LIMITED to status 429', async () => {
    const m = once(() => json({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for user ID 1.' }] }));
    await assert.rejects(graphql(base(m.fetchImpl), 'query{x}', {}), (e: unknown) => e instanceof GitHubError && e.status === 429 && /rate limit/.test(e.message));
  });

  it('wraps network failures in a readable, retried GitHubError', async () => {
    const m = once(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    });
    await assert.rejects(graphql(base(m.fetchImpl), 'query{x}', {}), (e: unknown) => {
      assert.ok(e instanceof GitHubError);
      assert.equal(e.type, 'NETWORK');
      assert.match(e.message, /Could not reach the GitHub API at api\.github\.com \(ENOTFOUND\)/);
      return true;
    });
    assert.equal(m.count(), 3);
  });

  it('times out stalled requests and retries them', async () => {
    let calls = 0;
    const fetchImpl = ((_url: string, init: RequestInit) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }) as unknown as typeof fetch;
    await assert.rejects(graphql(base(fetchImpl, { timeoutMs: 20 }), 'query{x}', {}), (e: unknown) => e instanceof GitHubError && e.type === 'TIMEOUT');
    assert.equal(calls, 3);
  });

  it('retries 5xx answers and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => (++calls < 2 ? new Response('<html>502</html>', { status: 502 }) : json({ data: { ok: 1 } }))) as unknown as typeof fetch;
    assert.deepEqual(await graphql(base(fetchImpl), 'query{x}', {}), { ok: 1 });
  });
});

describe('fetchProfile', () => {
  it('halves the repository page size when GitHub finds a page too heavy', async () => {
    const user: MockUser = { login: 'mira', createdAt: '2020-01-01T00:00:00Z', years: [2026], repos: manyRepos(230) };
    const logs: string[] = [];
    const { calls, fetchImpl } = mockApi(user, { repos: (first) => (first > 50 ? RESOURCE_LIMITS(150) : undefined) });
    const data = await fetchProfile(base(fetchImpl, { log: (m) => logs.push(m) }));
    assert.equal(data.repos.length, 230);
    assert.equal(data.publicRepoCount, 230);
    const pages = calls.filter((c) => c.kind === 'repos').map((c) => c.variables.first);
    assert.deepEqual(pages, [100, 50, 50, 50, 50, 50]);
    assert.ok(logs.some((l) => /retrying with 50 per page/.test(l)));
  });

  it('fails with one readable message when even small pages are too heavy', async () => {
    const user: MockUser = { login: 'mira', createdAt: '2020-01-01T00:00:00Z', years: [2026], repos: manyRepos(20) };
    const { fetchImpl } = mockApi(user, { repos: () => RESOURCE_LIMITS(5) });
    await assert.rejects(fetchProfile(base(fetchImpl)), /^GitHubError: GitHub GraphQL error: Resource limits for this query exceeded\. \(x5\)$/);
  });

  it('fetches heavy details only for repositories a card can show', async () => {
    const repos: MockRepo[] = [
      ...manyRepos(20),
      { name: 'private-top', stars: 5000, isPrivate: true },
      { name: 'archived-top', stars: 4000, isArchived: true },
      { name: 'mira', stars: 3000 },
      { name: 'pinned-small', stars: 1 },
    ];
    const { calls, fetchImpl } = mockApi({ login: 'mira', createdAt: '2020-01-01T00:00:00Z', years: [2026], repos, pinned: ['pinned-small'] });
    const data = await fetchProfile(base(fetchImpl));
    const ids = calls.find((c) => c.kind === 'details')?.variables.ids as string[];
    assert.equal(ids[0], 'id-pinned-small', 'pinned repos first');
    assert.equal(ids.length, 13, 'pinned plus the 12 best candidates');
    assert.ok(!ids.includes('id-private-top') && !ids.includes('id-archived-top') && !ids.includes('id-mira'));
    const top = data.repos.find((r) => r.name === 'repo-000');
    assert.deepEqual(
      { watchers: top?.watchers, openIssues: top?.openIssues, openPullRequests: top?.openPullRequests, license: top?.license, release: top?.latestRelease?.tag },
      { watchers: 7, openIssues: 3, openPullRequests: 2, license: 'MIT', release: 'v1.0.0' },
    );
    const tail = data.repos.find((r) => r.name === 'repo-019');
    assert.deepEqual([tail?.watchers, tail?.license, tail?.latestRelease], [0, null, null], 'listing-only repos read as zero / null');
    assert.equal(data.pinned[0]?.openIssues, 3);
  });

  it('counts repositories from GitHub totals and stars beyond the detailed pages', async () => {
    const repos = manyRepos(250);
    const { calls, fetchImpl } = mockApi({ login: 'mira', createdAt: '2020-01-01T00:00:00Z', years: [2026], repos, publicTotal: 250 });
    const logs: string[] = [];
    const data = await fetchProfile(base(fetchImpl, { maxRepoPages: 1, log: (m) => logs.push(m) }));
    assert.equal(data.repos.length, 100, 'languages and topics cover the most starred repositories');
    assert.equal(data.publicRepoCount, 250);
    assert.equal(data.totalStars, repos.reduce((s, r) => s + r.stars, 0));
    assert.equal(calls.filter((c) => c.kind === 'stars').length, 2);
    assert.ok(logs.some((l) => /counting stars of the rest/.test(l)));
  });

  it('applies exclude_repos and include_private to the totals', async () => {
    const repos: MockRepo[] = [
      { name: 'linux', stars: 1000 },
      { name: 'small', stars: 10 },
      { name: 'secret', stars: 50, isPrivate: true },
    ];
    const commits = [
      { repo: 'secret', count: 40, isPrivate: true, language: 'Rust' },
      { repo: 'small', count: 2, language: 'Go' },
    ];
    const { fetchImpl } = mockApi({ login: 'mira', createdAt: '2020-01-01T00:00:00Z', years: [2026], repos, commits });
    const all = await fetchProfile(base(fetchImpl));
    assert.deepEqual([all.totalStars, all.publicRepoCount, all.repos.length], [1010, 2, 3]);
    assert.deepEqual(all.languages.map((l) => l.name), ['Rust', 'Go']);
    const filtered = await fetchProfile(base(fetchImpl, { excludeRepos: ['LINUX'], includePrivate: false }));
    assert.deepEqual([filtered.totalStars, filtered.publicRepoCount], [10, 1]);
    assert.deepEqual(filtered.repos.map((r) => r.name), ['small']);
    assert.deepEqual(filtered.languages.map((l) => l.name), ['Go']);
  });

  it('starts full history on Jan 1 of the first contribution year and merges windows in order', async () => {
    const days: Record<string, number> = { '2011-02-01': 5, '2011-12-31': 1, '2012-01-01': 2, '2026-10-05': 3, '2026-10-06': 9 };
    const { calls, fetchImpl } = mockApi({ login: 'mira', createdAt: '2011-09-04T10:00:00Z', years: [2026, 2012, 2011], repos: [], days });
    const data = await fetchProfile(base(fetchImpl, { history: 'full' }));
    assert.deepEqual(data.calendar, [
      { date: '2011-02-01', count: 5 },
      { date: '2011-12-31', count: 1 },
      { date: '2012-01-01', count: 2 },
      { date: '2026-10-05', count: 3 },
    ]);
    const windows = calls.filter((c) => c.kind === 'calendar');
    assert.equal(windows.length, 16);
    assert.equal(windows.map((w) => w.variables.from).sort()[0], '2011-01-01T00:00:00.000Z');
  });

  it('explains that an organization is not a user', async () => {
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query.includes('repositoryOwner')) return json({ data: { repositoryOwner: { __typename: 'Organization' } } });
      return json({ data: { user: null }, errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a User with the login of 'acme'." }] });
    }) as unknown as typeof fetch;
    await assert.rejects(fetchProfile(base(fetchImpl, { login: 'acme' })), (e: unknown) => {
      assert.ok(e instanceof GitHubError);
      assert.equal(e.type, 'ORGANIZATION');
      assert.match(e.message, /"acme" is an organization/);
      return true;
    });
  });

  it('keeps the original error for a login that does not exist', async () => {
    const { fetchImpl } = mockApi({ login: 'mira', createdAt: '2020-01-01T00:00:00Z', years: [], repos: [] });
    const missing = (async (u: string, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query.includes('pinnedItems')) return json({ data: { user: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a User' }] });
      return fetchImpl(u, init);
    }) as unknown as typeof fetch;
    await assert.rejects(fetchProfile(base(missing)), (e: unknown) => e instanceof GitHubError && e.status === 404 && e.type === 'NOT_FOUND');
  });
});

describe('calendarWindows', () => {
  it('covers full history in calendar-year windows of at most a year', () => {
    const w = calendarWindows('full', '2011-09-04T10:00:00Z', [2026, 2011], NOW);
    assert.equal(w.length, 16);
    assert.equal(w[0]?.from.toISOString(), '2011-01-01T00:00:00.000Z');
    assert.equal(w[0]?.to.toISOString(), '2011-12-31T23:59:59.000Z');
    assert.equal(w.at(-1)?.to.toISOString(), NOW.toISOString());
    for (const x of w) assert.ok(x.to.getTime() - x.from.getTime() < 366 * 86_400_000);
  });

  it('never starts later than the account creation', () => {
    const w = calendarWindows('full', '2015-06-01T00:00:00Z', [2026, 2020], NOW);
    assert.equal(w[0]?.from.toISOString(), '2015-06-01T00:00:00.000Z');
    assert.equal(calendarWindows('full', '2024-03-01T00:00:00Z', [], NOW)[0]?.from.toISOString(), '2024-03-01T00:00:00.000Z');
  });

  it('keeps the last-year window as before', () => {
    const w = calendarWindows('year', '2011-09-04T10:00:00Z', [2026, 2011], NOW);
    assert.equal(w.length, 2);
    assert.equal(w[0]?.from.getTime(), NOW.getTime() - 372 * 86_400_000);
    assert.equal(w.at(-1)?.to.getTime(), NOW.getTime());
  });
});
