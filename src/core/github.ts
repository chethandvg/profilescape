import { isoDate } from './calendar.ts';
import type { ContributionDay, LanguageStat, ProfileData, RepoInfo } from './types.ts';

/**
 * GitHub GraphQL data layer. The only module in src/core that talks to the
 * network; uses the global fetch (Node >= 18 and browsers).
 *
 * GitHub gives every GraphQL query a server-side time budget of roughly ten
 * seconds and answers heavier queries with RESOURCE_LIMITS_EXCEEDED. So the
 * repository list is fetched with light fields only, the expensive per-repo
 * details (open issues, PRs, watchers, licence, latest release) are fetched
 * just for the repositories a repo card can show, and paged queries halve
 * their page size when GitHub still finds them too heavy.
 */

export class GitHubError extends Error {
  status: number | undefined;
  /** GraphQL error type (e.g. RESOURCE_LIMITS_EXCEEDED) or a local code (TIMEOUT, NETWORK, ORGANIZATION). */
  type: string | undefined;
  constructor(message: string, status?: number, type?: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.type = type;
  }
}

export interface FetchOptions {
  token: string;
  login: string;
  /**
   * 'full' walks every year since the first contribution GitHub knows of (or the
   * account's creation, whichever is earlier); needed for all-time totals and the
   * longest streak. 'year' fetches the last 12 months.
   */
  history?: 'full' | 'year';
  /**
   * False leaves private repositories out of repository and language statistics.
   * Contribution counts (calendar and yearly totals) always reflect what the
   * token can see.
   */
  includePrivate?: boolean;
  hideLanguages?: string[];
  excludeRepos?: string[];
  /** Extra repositories for repo cards: "owner/name" or "name" (owner defaults to login). */
  extraRepos?: string[];
  now?: Date;
  fetchImpl?: typeof fetch;
  /** GraphQL endpoint, e.g. for GitHub Enterprise Server. */
  apiUrl?: string;
  /**
   * Repositories fetched with languages and topics, in units of 100 (default 5,
   * i.e. the 500 most starred). Stars of the remaining repositories are still counted.
   */
  maxRepoPages?: number;
  /** Per-request timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /** Base delay between retries in milliseconds (default 800; tests pass 0). */
  retryDelayMs?: number;
  log?: (message: string) => void;
}

/** Cheap per-repository fields: safe to request 100 at a time even for prolific accounts. */
const LISTING_FIELDS = `
fragment RepoListing on Repository {
  id name nameWithOwner owner { login } description url homepageUrl
  stargazerCount forkCount isArchived isFork isPrivate isTemplate pushedAt createdAt
  primaryLanguage { name color }
  repositoryTopics(first: 8) { nodes { topic { name } } }
  languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
}`;

/** Expensive per-repository fields, only requested for repositories a repo card can show. */
const DETAIL_FIELDS = `
fragment RepoDetail on Repository {
  watchers { totalCount }
  issues(states: OPEN) { totalCount }
  pullRequests(states: OPEN) { totalCount }
  licenseInfo { spdxId }
  latestRelease { tagName publishedAt }
}`;

const PROFILE_Q = `
query($login: String!) {
  user(login: $login) {
    login name bio location company websiteUrl twitterUsername avatarUrl createdAt
    followers { totalCount }
    following { totalCount }
    publicRepos: repositories(privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false) { totalCount }
    pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { ...RepoListing } } }
    contributionsCollection {
      contributionYears
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      totalPullRequestReviewContributions totalRepositoryContributions restrictedContributionsCount
      contributionCalendar { totalContributions }
    }
  }
}
${LISTING_FIELDS}`;

const COMMITS_Q = `
query($login: String!, $max: Int!) {
  user(login: $login) {
    contributionsCollection {
      commitContributionsByRepository(maxRepositories: $max) {
        contributions { totalCount }
        repository {
          nameWithOwner isPrivate isFork
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
        }
      }
    }
  }
}`;

const REPOS_Q = `
query($login: String!, $cursor: String, $first: Int!) {
  user(login: $login) {
    repositories(first: $first, after: $cursor, ownerAffiliations: OWNER, isFork: false,
                 orderBy: { field: STARGAZERS, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ...RepoListing }
    }
  }
}
${LISTING_FIELDS}`;

/** The long tail beyond maxRepoPages: just enough to count stars. */
const STARS_Q = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false,
                 orderBy: { field: STARGAZERS, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { nameWithOwner stargazerCount isPrivate }
    }
  }
}`;

const DETAILS_Q = `
query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Repository { id ...RepoDetail } }
}
${DETAIL_FIELDS}`;

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
  repository(owner: $owner, name: $name) { ...RepoListing ...RepoDetail }
}
${LISTING_FIELDS}
${DETAIL_FIELDS}`;

const OWNER_Q = `
query($login: String!) {
  repositoryOwner(login: $login) { __typename }
}`;

/** Repositories whose details are fetched for repo cards (the card shows at most 12). */
const DETAIL_CANDIDATES = 12;
/** Upper bound on star-counting pages, so a pathological account cannot stall a run. */
const MAX_TOTAL_REPO_PAGES = 50;
const CALENDAR_CONCURRENCY = 4;
const DAY_MS = 86_400_000;

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

interface GraphqlOptions {
  /** Return partial data (with a log line) when only some fields failed, e.g. an org's SAML policy hides one repository. */
  allowPartial?: boolean;
}

/** "msg (x193)": GitHub repeats the same error once per failing node. */
function summarizeErrors(errors: { message: string }[]): string {
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.message, (counts.get(e.message) ?? 0) + 1);
  const parts = [...counts].map(([m, n]) => (n > 1 ? `${m} (x${n})` : m));
  return parts.length > 3 ? `${parts.slice(0, 3).join('; ')}; and ${parts.length - 3} more` : parts.join('; ');
}

function networkError(err: unknown, timeoutMs: number, endpoint: string): GitHubError {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new GitHubError(`GitHub API did not respond within ${Math.round(timeoutMs / 1000)}s.`, undefined, 'TIMEOUT');
  }
  let host = endpoint;
  try {
    host = new URL(endpoint).host;
  } catch {
    // keep the raw endpoint
  }
  const detail = e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(err);
  return new GitHubError(`Could not reach the GitHub API at ${host} (${detail}). Check the network connection and try again.`, undefined, 'NETWORK');
}

export async function graphql<T>(o: FetchOptions, query: string, variables: Record<string, unknown>, opts: GraphqlOptions = {}): Promise<T> {
  const doFetch = o.fetchImpl ?? fetch;
  const endpoint = o.apiUrl ?? 'https://api.github.com/graphql';
  const timeoutMs = o.timeoutMs ?? 30_000;
  const baseDelay = o.retryDelayMs ?? 800;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(baseDelay * 2 ** attempt);
    let res: Response;
    let text: string;
    // A referenced timer (unlike AbortSignal.timeout, which is unref'd) keeps the
    // process alive until a stalled request is aborted, on every Node version.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeoutMs);
    try {
      res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `bearer ${o.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'profilescape',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      lastError = networkError(err, timeoutMs, endpoint);
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500) {
      lastError = new GitHubError(`GitHub API responded ${res.status}`, res.status);
      continue;
    }
    if (res.status === 401) throw new GitHubError('GitHub rejected the token (401). Check that the token is valid and not expired.', 401);
    if (res.status === 403 || res.status === 429) {
      throw new GitHubError(`GitHub API rate limit or permission error (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
    if (!res.ok) throw new GitHubError(`GitHub API responded ${res.status}: ${text.slice(0, 200)}`, res.status);
    let body: { data?: T | null; errors?: { message: string; type?: string }[] };
    try {
      body = JSON.parse(text);
    } catch {
      lastError = new GitHubError('GitHub API returned invalid JSON');
      continue;
    }
    if (body.errors?.length) {
      const msg = summarizeErrors(body.errors);
      const types = new Set(body.errors.map((e) => e.type));
      if (types.has('RATE_LIMITED')) throw new GitHubError(`GitHub API rate limit exceeded: ${msg}`, 429, 'RATE_LIMITED');
      // Callers shrink the query and try again; retrying the same query would fail the same way.
      if (types.has('RESOURCE_LIMITS_EXCEEDED')) throw new GitHubError(`GitHub GraphQL error: ${msg}`, undefined, 'RESOURCE_LIMITS_EXCEEDED');
      // GitHub occasionally answers heavy queries with a transient "Something went wrong" error.
      if (/something went wrong|timeout/i.test(msg)) {
        lastError = new GitHubError(`GitHub GraphQL error: ${msg}`);
        continue;
      }
      if (opts.allowPartial && body.data) {
        o.log?.(`GitHub left out some data: ${msg}`);
        return body.data;
      }
      if (types.has('NOT_FOUND')) throw new GitHubError(`Not found: ${msg}`, 404, 'NOT_FOUND');
      throw new GitHubError(`GitHub GraphQL error: ${msg}`, undefined, [...types][0]);
    }
    if (!body.data) throw new GitHubError('GitHub API returned no data');
    return body.data;
  }
  throw lastError instanceof Error ? lastError : new GitHubError(String(lastError));
}

const isResourceLimit = (err: unknown) => err instanceof GitHubError && err.type === 'RESOURCE_LIMITS_EXCEEDED';

interface RawLangEdges {
  edges: { size: number; node: { name: string; color: string | null } }[];
}

interface RawDetail {
  watchers?: { totalCount: number };
  issues?: { totalCount: number };
  pullRequests?: { totalCount: number };
  licenseInfo?: { spdxId: string | null } | null;
  latestRelease?: { tagName: string; publishedAt: string | null } | null;
}

interface RawRepo extends RawDetail {
  id?: string;
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
  primaryLanguage: { name: string; color: string | null } | null;
  repositoryTopics?: { nodes: { topic: { name: string } }[] };
  languages: RawLangEdges | null;
}

interface RawCommitRepo {
  contributions: { totalCount: number };
  repository: { nameWithOwner: string; isPrivate: boolean; isFork: boolean; languages: RawLangEdges | null } | null;
}

const FALLBACK_COLOR = '#8B949E';

const langs = (l: RawLangEdges | null | undefined): LanguageStat[] =>
  (l?.edges ?? []).map((e) => ({ name: e.node.name, color: e.node.color ?? FALLBACK_COLOR, value: e.size }));

/** Fields from the RepoDetail fragment; absent fields (a listing-only repo) read as zero / null. */
function detailOf(r: RawDetail, createdAt: string): Pick<RepoInfo, 'watchers' | 'openIssues' | 'openPullRequests' | 'license' | 'latestRelease'> {
  return {
    watchers: r.watchers?.totalCount ?? 0,
    openIssues: r.issues?.totalCount ?? 0,
    openPullRequests: r.pullRequests?.totalCount ?? 0,
    license: r.licenseInfo?.spdxId && r.licenseInfo.spdxId !== 'NOASSERTION' ? r.licenseInfo.spdxId : null,
    latestRelease: r.latestRelease ? { tag: r.latestRelease.tagName, publishedAt: r.latestRelease.publishedAt ?? createdAt } : null,
  };
}

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
    ...detailOf(r, r.createdAt),
    primaryLanguage: r.primaryLanguage ? { name: r.primaryLanguage.name, color: r.primaryLanguage.color ?? FALLBACK_COLOR } : null,
    languages: langs(r.languages),
    topics: (r.repositoryTopics?.nodes ?? []).map((n) => n.topic.name),
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The date windows (each at most a year, as GitHub requires) that cover the
 * requested history. Full history starts on Jan 1 of the first year GitHub
 * reports contributions for, or at the account's creation if that is earlier,
 * so contributions pushed with existing history right after signing up count.
 */
export function calendarWindows(history: 'full' | 'year', createdAt: string, contributionYears: number[], now: Date): { from: Date; to: Date }[] {
  const windows: { from: Date; to: Date }[] = [];
  if (history === 'year') {
    let start = new Date(now.getTime() - 372 * DAY_MS);
    while (start < now) {
      const end = new Date(Math.min(start.getTime() + 365 * DAY_MS, now.getTime()));
      windows.push({ from: start, to: end });
      start = end;
    }
    return windows;
  }
  const created = Date.parse(createdAt);
  const years = contributionYears.filter((y) => Number.isInteger(y));
  const firstYearStart = years.length ? Date.UTC(Math.min(...years), 0, 1) : Number.NaN;
  let startMs = Math.min(...[created, firstYearStart].filter(Number.isFinite));
  if (!Number.isFinite(startMs)) startMs = now.getTime() - 372 * DAY_MS;
  // Guard against absurd ranges (and keep requests bounded for very old accounts).
  startMs = Math.max(startMs, Date.UTC(now.getUTCFullYear() - 25, 0, 1));
  let start = new Date(startMs);
  while (start < now) {
    const nextYear = Date.UTC(start.getUTCFullYear() + 1, 0, 1);
    const end = new Date(Math.min(nextYear - 1000, now.getTime()));
    windows.push({ from: start, to: end });
    start = new Date(nextYear);
  }
  return windows;
}

async function fetchCalendar(o: FetchOptions, createdAt: string, contributionYears: number[], now: Date): Promise<ContributionDay[]> {
  type CalendarData = {
    user: { contributionsCollection: { contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number }[] }[] } } };
  };
  const windows = calendarWindows(o.history ?? 'full', createdAt, contributionYears, now);
  const results = await mapLimit(windows, CALENDAR_CONCURRENCY, (w) =>
    graphql<CalendarData>(o, CALENDAR_Q, { login: o.login, from: w.from.toISOString(), to: w.to.toISOString() }),
  );
  // Merge in window order so a day shared by two windows always takes the later answer.
  const days = new Map<string, number>();
  for (const data of results) {
    for (const w of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
    }
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

/** Commits per repository over the last year, shrinking the request if GitHub finds it too heavy. */
async function fetchCommitRepos(o: FetchOptions): Promise<RawCommitRepo[]> {
  for (let max = 100; ; max = Math.floor(max / 2)) {
    try {
      const data = await graphql<{ user: { contributionsCollection: { commitContributionsByRepository: (RawCommitRepo | null)[] } | null } | null }>(
        o,
        COMMITS_Q,
        { login: o.login, max },
        { allowPartial: true },
      );
      const list = data.user?.contributionsCollection?.commitContributionsByRepository ?? [];
      return list.filter((r): r is RawCommitRepo => !!r?.repository);
    } catch (err) {
      if (!isResourceLimit(err) || max <= 12) throw err;
      o.log?.(`Commit statistics were too heavy for one request; retrying with the top ${Math.floor(max / 2)} repositories.`);
    }
  }
}

interface RepoListing {
  /** Detailed listing (languages, topics), most starred first. */
  repos: RawRepo[];
  /** Repositories beyond the detailed listing, for counting stars. */
  tail: { nameWithOwner: string; stargazerCount: number; isPrivate: boolean }[];
}

/** Owned non-fork repositories, most starred first; page size halves on RESOURCE_LIMITS_EXCEEDED. */
async function fetchRepoListing(o: FetchOptions): Promise<RepoListing> {
  type Page<N> = { user: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (N | null)[] } } };
  const detailedLimit = Math.max(1, Math.floor(o.maxRepoPages ?? 5)) * 100;
  const repos: RawRepo[] = [];
  let cursor: string | null = null;
  let size = 100;
  let pages = 0;
  let more = true;
  while (more && repos.length < detailedLimit) {
    const first = Math.min(size, detailedLimit - repos.length);
    let data: Page<RawRepo>;
    try {
      data = await graphql<Page<RawRepo>>(o, REPOS_Q, { login: o.login, cursor, first });
    } catch (err) {
      if (!isResourceLimit(err) || size <= 10) throw err;
      size = Math.max(10, Math.floor(size / 2));
      o.log?.(`GitHub found a page of 100 repositories too heavy; retrying with ${size} per page.`);
      continue;
    }
    pages++;
    repos.push(...data.user.repositories.nodes.filter((n): n is RawRepo => !!n));
    more = data.user.repositories.pageInfo.hasNextPage;
    cursor = data.user.repositories.pageInfo.endCursor;
  }
  const tail: RepoListing['tail'] = [];
  if (more) {
    o.log?.(`Read languages and topics of the ${repos.length} most starred repositories; counting stars of the rest.`);
    while (more && pages < MAX_TOTAL_REPO_PAGES) {
      const data: Page<RepoListing['tail'][number]> = await graphql(o, STARS_Q, { login: o.login, cursor });
      pages++;
      tail.push(...data.user.repositories.nodes.filter((n): n is RepoListing['tail'][number] => !!n));
      more = data.user.repositories.pageInfo.hasNextPage;
      cursor = data.user.repositories.pageInfo.endCursor;
    }
    if (more) o.log?.(`Stopped after ${repos.length + tail.length} repositories; stars of the rest are not counted.`);
  }
  return { repos, tail };
}

/** Fetch the RepoDetail fields for the given repositories (by node id). */
async function fetchDetails(o: FetchOptions, ids: string[]): Promise<Map<string, RawDetail>> {
  const out = new Map<string, RawDetail>();
  if (!ids.length) return out;
  const data = await graphql<{ nodes: ((RawDetail & { id?: string }) | null)[] }>(o, DETAILS_Q, { ids }, { allowPartial: true });
  for (const n of data.nodes ?? []) if (n?.id) out.set(n.id, n);
  return out;
}

/** A NOT_FOUND user may be an organization; say so instead of "could not resolve". */
async function explainMissingUser(o: FetchOptions, original: GitHubError): Promise<never> {
  let kind: string | undefined;
  try {
    kind = (await graphql<{ repositoryOwner: { __typename: string } | null }>(o, OWNER_Q, { login: o.login })).repositoryOwner?.__typename;
  } catch {
    // keep the original error
  }
  if (kind === 'Organization') {
    throw new GitHubError(
      `"${o.login}" is an organization. Profilescape renders personal profiles, so set the username to a user account.`,
      404,
      'ORGANIZATION',
    );
  }
  throw original;
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

  let u: any;
  try {
    u = (await graphql<{ user: any }>(o, PROFILE_Q, { login: o.login })).user;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return explainMissingUser(o, err);
    throw err;
  }
  if (!u) return explainMissingUser(o, new GitHubError(`GitHub user "${o.login}" not found`, 404, 'NOT_FOUND'));
  const cc = u.contributionsCollection;

  const [commitRepos, listing] = await Promise.all([fetchCommitRepos(o), fetchRepoListing(o)]);

  const visible = (r: { nameWithOwner: string; isPrivate: boolean }) => (includePrivate || !r.isPrivate) && !isExcluded(r.nameWithOwner);
  const profileRepo = `${u.login}/${u.login}`.toLowerCase();
  const rawPinned = (u.pinnedItems.nodes as (RawRepo | null)[]).filter((r): r is RawRepo => !!r?.nameWithOwner).filter(visible);
  const rawOwn = listing.repos.filter(visible);

  // Details for what a repo card can show: pinned repos, then the most starred
  // public, active repos (the same ranking the repos card uses).
  const ranked = rawOwn
    .filter((r) => !r.isPrivate && !r.isArchived && r.nameWithOwner.toLowerCase() !== profileRepo)
    .sort((a, b) => b.stargazerCount - a.stargazerCount || ((b.pushedAt ?? '') > (a.pushedAt ?? '') ? 1 : (b.pushedAt ?? '') < (a.pushedAt ?? '') ? -1 : 0))
    .slice(0, DETAIL_CANDIDATES);
  const ids = [...new Set([...rawPinned, ...ranked].map((r) => r.id).filter((id): id is string => !!id))];

  const [calendar, extraFetched, details] = await Promise.all([
    fetchCalendar(o, u.createdAt, (cc.contributionYears as number[] | undefined) ?? [], now),
    Promise.all((o.extraRepos ?? []).map((spec) => fetchRepo(o, spec))),
    fetchDetails(o, ids),
  ]);
  const withDetail = (r: RawRepo): RepoInfo => {
    const d = r.id ? details.get(r.id) : undefined;
    return toRepo(d ? { ...r, ...d } : r);
  };
  const ownRepos = rawOwn.map(withDetail);
  const extra = extraFetched.filter((r): r is RepoInfo => r !== null && (includePrivate || !r.isPrivate));

  const committed = commitRepos.filter((r) => {
    const repo = r.repository;
    return (
      !!repo &&
      repo.nameWithOwner.toLowerCase() !== profileRepo &&
      !repo.isFork &&
      (includePrivate || !repo.isPrivate) &&
      !isExcluded(repo.nameWithOwner)
    );
  });

  const languagesByBytes = aggregate(
    ownRepos.map((r) => ({ weight: r.languages.reduce((s, l) => s + l.value, 0), languages: r.languages })),
    hide,
  );
  const byCommits = aggregate(
    committed.map((r) => ({ weight: r.contributions.totalCount, languages: langs(r.repository?.languages) })),
    hide,
  );

  // Totals honour exclude_repos. The repository count comes from GitHub's own
  // total, so it stays right for accounts with more repositories than we list.
  const everyRepo = [...listing.repos, ...listing.tail];
  const publicIncluded = everyRepo.filter((r) => !r.isPrivate && !isExcluded(r.nameWithOwner));
  const excludedPublic = everyRepo.length - publicIncluded.length - everyRepo.filter((r) => r.isPrivate).length;
  const publicTotal = typeof u.publicRepos?.totalCount === 'number' ? (u.publicRepos.totalCount as number) : everyRepo.filter((r) => !r.isPrivate).length;

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
    pinned: rawPinned.map(withDetail),
    extraRepos: extra,
    totalStars: publicIncluded.reduce((s, r) => s + r.stargazerCount, 0),
    publicRepoCount: Math.max(0, publicTotal - excludedPublic),
    generatedAt: now.toISOString(),
  };
}
