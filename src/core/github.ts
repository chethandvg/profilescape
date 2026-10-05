import { isoDate } from './calendar.ts';
import type { ContributionDay, LanguageStat, ProfileData, RepoInfo } from './types.ts';

/**
 * GitHub GraphQL data layer. The only module in src/core that talks to the
 * network; uses the global fetch (Node >= 18 and browsers).
 */

export class GitHubError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export interface FetchOptions {
  token: string;
  login: string;
  /** 'full' walks every year since the account was created (needed for all-time totals and longest streak). */
  history?: 'full' | 'year';
  includePrivate?: boolean;
  hideLanguages?: string[];
  excludeRepos?: string[];
  /** Extra repositories for repo cards: "owner/name" or "name" (owner defaults to login). */
  extraRepos?: string[];
  now?: Date;
  fetchImpl?: typeof fetch;
  /** GraphQL endpoint, e.g. for GitHub Enterprise Server. */
  apiUrl?: string;
  /** Upper bound on repository pages (100 repos each). */
  maxRepoPages?: number;
  log?: (message: string) => void;
}

const REPO_FIELDS = `
fragment Repo on Repository {
  name nameWithOwner owner { login } description url homepageUrl
  stargazerCount forkCount isArchived isFork isPrivate isTemplate pushedAt createdAt
  watchers { totalCount }
  issues(states: OPEN) { totalCount }
  pullRequests(states: OPEN) { totalCount }
  licenseInfo { spdxId }
  primaryLanguage { name color }
  repositoryTopics(first: 8) { nodes { topic { name } } }
  latestRelease { tagName publishedAt }
  languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
}`;

const PROFILE_Q = `
query($login: String!) {
  user(login: $login) {
    login name bio location company websiteUrl twitterUsername avatarUrl createdAt
    followers { totalCount }
    following { totalCount }
    pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { ...Repo } } }
    contributionsCollection {
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      totalPullRequestReviewContributions totalRepositoryContributions restrictedContributionsCount
      contributionCalendar { totalContributions }
      commitContributionsByRepository(maxRepositories: 100) {
        contributions { totalCount }
        repository {
          nameWithOwner isPrivate isFork
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
        }
      }
    }
  }
}
${REPO_FIELDS}`;

const REPOS_Q = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false,
                 orderBy: { field: STARGAZERS, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ...Repo }
    }
  }
}
${REPO_FIELDS}`;

const CALENDAR_Q = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

const REPO_Q = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { ...Repo }
}
${REPO_FIELDS}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function graphql<T>(o: FetchOptions, query: string, variables: Record<string, unknown>): Promise<T> {
  const doFetch = o.fetchImpl ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(800 * 2 ** attempt);
    let res: Response;
    try {
      res = await doFetch(o.apiUrl ?? 'https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `bearer ${o.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'profilescape',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      lastError = err;
      continue;
    }
    if (res.status >= 500) {
      lastError = new GitHubError(`GitHub API responded ${res.status}`, res.status);
      continue;
    }
    const text = await res.text();
    if (res.status === 401) throw new GitHubError('GitHub rejected the token (401). Check that the token is valid and not expired.', 401);
    if (res.status === 403 || res.status === 429) {
      throw new GitHubError(`GitHub API rate limit or permission error (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
    if (!res.ok) throw new GitHubError(`GitHub API responded ${res.status}: ${text.slice(0, 200)}`, res.status);
    let body: { data?: T; errors?: { message: string; type?: string }[] };
    try {
      body = JSON.parse(text);
    } catch {
      lastError = new GitHubError('GitHub API returned invalid JSON');
      continue;
    }
    if (body.errors?.length) {
      const msg = body.errors.map((e) => e.message).join('; ');
      if (body.errors.some((e) => e.type === 'NOT_FOUND')) throw new GitHubError(`Not found: ${msg}`, 404);
      // GitHub occasionally answers heavy queries with a transient "Something went wrong" error.
      if (/something went wrong|timeout/i.test(msg) && attempt < 2) {
        lastError = new GitHubError(msg);
        continue;
      }
      throw new GitHubError(`GitHub GraphQL error: ${msg}`);
    }
    if (!body.data) throw new GitHubError('GitHub API returned no data');
    return body.data;
  }
  throw lastError instanceof Error ? lastError : new GitHubError(String(lastError));
}

interface RawLangEdges {
  edges: { size: number; node: { name: string; color: string | null } }[];
}

interface RawRepo {
  name: string;
  nameWithOwner: string;
  owner: { login: string };
  description: string | null;
  url: string;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  isFork: boolean;
  isPrivate: boolean;
  isTemplate: boolean;
  pushedAt: string | null;
  createdAt: string;
  watchers: { totalCount: number };
  issues: { totalCount: number };
  pullRequests: { totalCount: number };
  licenseInfo: { spdxId: string | null } | null;
  primaryLanguage: { name: string; color: string | null } | null;
  repositoryTopics: { nodes: { topic: { name: string } }[] };
  latestRelease: { tagName: string; publishedAt: string | null } | null;
  languages: RawLangEdges;
}

const FALLBACK_COLOR = '#8B949E';

const langs = (l: RawLangEdges | null | undefined): LanguageStat[] =>
  (l?.edges ?? []).map((e) => ({ name: e.node.name, color: e.node.color ?? FALLBACK_COLOR, value: e.size }));

export function toRepo(r: RawRepo): RepoInfo {
  return {
    owner: r.owner.login,
    name: r.name,
    nameWithOwner: r.nameWithOwner,
    description: r.description,
    url: r.url,
    homepageUrl: r.homepageUrl || null,
    stars: r.stargazerCount,
    forks: r.forkCount,
    watchers: r.watchers.totalCount,
    openIssues: r.issues.totalCount,
    openPullRequests: r.pullRequests.totalCount,
    primaryLanguage: r.primaryLanguage ? { name: r.primaryLanguage.name, color: r.primaryLanguage.color ?? FALLBACK_COLOR } : null,
    languages: langs(r.languages),
    topics: r.repositoryTopics.nodes.map((n) => n.topic.name),
    license: r.licenseInfo?.spdxId && r.licenseInfo.spdxId !== 'NOASSERTION' ? r.licenseInfo.spdxId : null,
    latestRelease: r.latestRelease ? { tag: r.latestRelease.tagName, publishedAt: r.latestRelease.publishedAt ?? r.createdAt } : null,
    isArchived: r.isArchived,
    isFork: r.isFork,
    isPrivate: r.isPrivate,
    isTemplate: r.isTemplate,
    pushedAt: r.pushedAt ?? r.createdAt,
    createdAt: r.createdAt,
  };
}

function aggregate(entries: { weight: number; languages: LanguageStat[] }[], hide: Set<string>): LanguageStat[] {
  const out = new Map<string, LanguageStat>();
  for (const { weight, languages } of entries) {
    const visible = languages.filter((l) => !hide.has(l.name.toLowerCase()));
    const total = visible.reduce((s, l) => s + l.value, 0);
    if (!total || !weight) continue;
    for (const l of visible) {
      const cur = out.get(l.name) ?? { name: l.name, color: l.color, value: 0 };
      cur.value += (weight * l.value) / total;
      out.set(l.name, cur);
    }
  }
  return [...out.values()].sort((a, b) => b.value - a.value);
}

async function fetchCalendar(o: FetchOptions, createdAt: string, now: Date): Promise<ContributionDay[]> {
  const days = new Map<string, number>();
  const yearMs = 365 * 86_400_000;
  let start = o.history === 'year' ? new Date(now.getTime() - 372 * 86_400_000) : new Date(createdAt);
  // Guard against absurd ranges (and keep requests bounded for very old accounts).
  const earliest = new Date(now.getTime() - 25 * yearMs);
  if (start < earliest) start = earliest;
  while (start < now) {
    const end = new Date(Math.min(start.getTime() + yearMs, now.getTime()));
    const data = await graphql<{
      user: { contributionsCollection: { contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number }[] }[] } } };
    }>(o, CALENDAR_Q, { login: o.login, from: start.toISOString(), to: end.toISOString() });
    for (const w of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
    }
    start = end;
  }
  const today = isoDate(now);
  return [...days.entries()]
    .filter(([date]) => date <= today)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ date, count }));
}

async function fetchRepo(o: FetchOptions, spec: string): Promise<RepoInfo | null> {
  const [owner, name] = spec.includes('/') ? (spec.split('/', 2) as [string, string]) : [o.login, spec];
  try {
    const data = await graphql<{ repository: RawRepo | null }>(o, REPO_Q, { owner, name });
    return data.repository ? toRepo(data.repository) : null;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      o.log?.(`Repository ${owner}/${name} not found or not visible to the token; skipping.`);
      return null;
    }
    throw err;
  }
}

/** Fetch everything any card needs in a handful of GraphQL calls. */
export async function fetchProfile(o: FetchOptions): Promise<ProfileData> {
  const now = o.now ?? new Date();
  const includePrivate = o.includePrivate ?? true;
  const hide = new Set((o.hideLanguages ?? []).map((l) => l.toLowerCase()));
  const exclude = new Set((o.excludeRepos ?? []).map((r) => r.toLowerCase()));
  const isExcluded = (nameWithOwner: string) => {
    const lower = nameWithOwner.toLowerCase();
    return exclude.has(lower) || exclude.has(lower.split('/')[1] ?? '');
  };

  const profile = await graphql<{ user: any }>(o, PROFILE_Q, { login: o.login });
  const u = profile.user;
  if (!u) throw new GitHubError(`GitHub user "${o.login}" not found`, 404);

  const repos: RepoInfo[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < (o.maxRepoPages ?? 5); page++) {
    const data: { user: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawRepo[] } } } =
      await graphql(o, REPOS_Q, { login: o.login, cursor });
    repos.push(...data.user.repositories.nodes.map(toRepo));
    if (!data.user.repositories.pageInfo.hasNextPage) break;
    cursor = data.user.repositories.pageInfo.endCursor;
    if (page === (o.maxRepoPages ?? 5) - 1) o.log?.(`Stopped after ${repos.length} repositories (maxRepoPages).`);
  }

  const visible = (r: RepoInfo) => (includePrivate || !r.isPrivate) && !isExcluded(r.nameWithOwner);
  const ownRepos = repos.filter(visible);

  const cc = u.contributionsCollection;
  const profileRepo = `${u.login}/${u.login}`.toLowerCase();
  const committed = (cc.commitContributionsByRepository as any[]).filter(
    (r) =>
      r.repository.nameWithOwner.toLowerCase() !== profileRepo &&
      !r.repository.isFork &&
      (includePrivate || !r.repository.isPrivate) &&
      !isExcluded(r.repository.nameWithOwner),
  );

  const languagesByBytes = aggregate(
    ownRepos.map((r) => ({ weight: r.languages.reduce((s, l) => s + l.value, 0), languages: r.languages })),
    hide,
  );
  const byCommits = aggregate(
    committed.map((r) => ({ weight: r.contributions.totalCount as number, languages: langs(r.repository.languages) })),
    hide,
  );

  const calendar = await fetchCalendar(o, u.createdAt, now);
  const extra = (await Promise.all((o.extraRepos ?? []).map((spec) => fetchRepo(o, spec)))).filter(
    (r): r is RepoInfo => r !== null && (includePrivate || !r.isPrivate),
  );

  return {
    login: u.login,
    name: u.name || null,
    bio: u.bio || null,
    location: u.location || null,
    company: u.company || null,
    websiteUrl: u.websiteUrl || null,
    twitter: u.twitterUsername || null,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt,
    followers: u.followers.totalCount,
    following: u.following.totalCount,
    calendar,
    year: {
      contributions: cc.contributionCalendar.totalContributions,
      commits: cc.totalCommitContributions,
      pullRequests: cc.totalPullRequestContributions,
      issues: cc.totalIssueContributions,
      reviews: cc.totalPullRequestReviewContributions,
      reposCreated: cc.totalRepositoryContributions,
      restricted: cc.restrictedContributionsCount,
    },
    languages: byCommits.length ? byCommits : languagesByBytes,
    languagesByBytes,
    repos: ownRepos,
    pinned: (u.pinnedItems.nodes as RawRepo[]).filter(Boolean).map(toRepo).filter(visible),
    extraRepos: extra,
    totalStars: repos.filter((r) => !r.isPrivate).reduce((s, r) => s + r.stars, 0),
    publicRepoCount: repos.filter((r) => !r.isPrivate).length,
    generatedAt: now.toISOString(),
  };
}
