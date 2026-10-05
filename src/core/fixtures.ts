import { isoDate, lastYear, totalOf } from './calendar.ts';
import type { ContributionDay, LanguageStat, ProfileData, RepoInfo } from './types.ts';

/**
 * Deterministic demo data for tests, previews, the README gallery and the
 * website playground. "Mira Chen" is fictional.
 */

export const DEMO_NOW = new Date('2026-10-05T12:00:00Z');

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  Rust: '#dea584',
  Go: '#00ADD8',
  'C#': '#7355dd',
  Python: '#3572A5',
  Shell: '#89e051',
  JavaScript: '#f1e05a',
  CSS: '#663399',
  HTML: '#e34c26',
};

const lang = (name: string, value: number): LanguageStat => ({ name, color: LANG_COLORS[name] ?? '#8B949E', value });

function repo(partial: Partial<RepoInfo> & { name: string; languages: LanguageStat[] }): RepoInfo {
  const owner = partial.owner ?? 'mira-dev';
  const primary = partial.languages[0];
  return {
    owner,
    nameWithOwner: `${owner}/${partial.name}`,
    description: null,
    url: `https://github.com/${owner}/${partial.name}`,
    homepageUrl: null,
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    openPullRequests: 0,
    primaryLanguage: primary ? { name: primary.name, color: primary.color } : null,
    topics: [],
    license: 'MIT',
    latestRelease: null,
    isArchived: false,
    isFork: false,
    isPrivate: false,
    isTemplate: false,
    pushedAt: '2026-09-28T10:00:00Z',
    createdAt: '2023-02-11T09:00:00Z',
    ...partial,
  };
}

export const DEMO_REPOS: RepoInfo[] = [
  repo({
    name: 'nebula-ui',
    description: 'Accessible, themeable React component library with zero-runtime CSS and first-class dark mode.',
    homepageUrl: 'https://nebula-ui.dev',
    stars: 4821,
    forks: 312,
    watchers: 96,
    openIssues: 41,
    openPullRequests: 9,
    languages: [lang('TypeScript', 812_000), lang('CSS', 96_000), lang('JavaScript', 21_000)],
    topics: ['react', 'design-system', 'accessibility', 'components'],
    latestRelease: { tag: 'v3.4.0', publishedAt: '2026-09-21T15:00:00Z' },
  }),
  repo({
    name: 'quantum-cache',
    description: 'Lock-free, sharded in-memory cache for Rust services. 40M ops/sec on a laptop.',
    stars: 2310,
    forks: 141,
    watchers: 58,
    openIssues: 17,
    languages: [lang('Rust', 402_000), lang('Shell', 4_000)],
    topics: ['rust', 'cache', 'performance', 'concurrency'],
    latestRelease: { tag: 'v0.9.2', publishedAt: '2026-08-30T08:00:00Z' },
  }),
  repo({
    name: 'atlas-api',
    description: 'Opinionated Go starter for production REST APIs: tracing, migrations and graceful shutdown built in.',
    stars: 987,
    forks: 88,
    languages: [lang('Go', 233_000), lang('Shell', 6_000)],
    topics: ['go', 'rest-api', 'starter'],
  }),
  repo({
    name: 'pixel-forge',
    description: 'GPU-accelerated image pipeline for .NET with a fluent API and AOT support.',
    stars: 642,
    forks: 37,
    languages: [lang('C#', 301_000)],
    topics: ['dotnet', 'image-processing', 'gpu'],
    latestRelease: { tag: 'v2.1.0', publishedAt: '2026-07-14T12:00:00Z' },
  }),
  repo({
    name: 'tidy-notes',
    description: 'Local-first markdown notes with semantic search powered by on-device embeddings.',
    stars: 455,
    forks: 29,
    languages: [lang('Python', 154_000), lang('HTML', 22_000)],
    topics: ['python', 'notes', 'embeddings', 'local-first'],
  }),
  repo({
    name: 'orbit-cli',
    description: 'A friendly CLI to scaffold, lint and ship monorepos.',
    stars: 210,
    forks: 12,
    languages: [lang('TypeScript', 88_000), lang('JavaScript', 4_000)],
    topics: ['cli', 'monorepo'],
  }),
  repo({
    name: 'dotfiles',
    description: 'My terminal, editor and shell setup.',
    stars: 64,
    forks: 9,
    languages: [lang('Shell', 18_000)],
  }),
];

function demoCalendar(now: Date, since: string): ContributionDay[] {
  const rand = mulberry32(20261005);
  const days: ContributionDay[] = [];
  const end = new Date(`${isoDate(now)}T00:00:00Z`).getTime();
  const weekdayFactor = [0.3, 1, 1.1, 1.15, 1.05, 0.8, 0.35];
  let burst = 1;
  let vacation = 0;
  for (let t = new Date(`${since}T00:00:00Z`).getTime(), i = 0; t <= end; t += 86_400_000, i++) {
    const d = new Date(t);
    if (i % 14 === 0) burst = 0.35 + rand() * 1.6;
    if (vacation > 0) vacation--;
    else if (rand() < 0.006) vacation = 5 + Math.floor(rand() * 9);
    const quiet = vacation > 0 || rand() < 0.16;
    const base = 7 * (weekdayFactor[d.getUTCDay()] ?? 1) * burst;
    const spike = rand() < 0.02 ? 2.5 + rand() * 3 : 1;
    const count = quiet ? 0 : Math.max(0, Math.round(base * spike * (0.25 + rand() ** 1.4 * 1.9)));
    days.push({ date: isoDate(d), count });
  }
  return days;
}

export function demoProfile(now: Date = DEMO_NOW): ProfileData {
  const createdAt = '2021-03-14T10:00:00Z';
  const calendar = demoCalendar(now, createdAt.slice(0, 10));
  // GitHub's "last year": the same date a year ago through today.
  const contributions = totalOf(lastYear(calendar, now));
  const totalBytes = new Map<string, LanguageStat>();
  for (const r of DEMO_REPOS) {
    for (const l of r.languages) {
      const cur = totalBytes.get(l.name) ?? { ...l, value: 0 };
      cur.value += l.value;
      totalBytes.set(l.name, cur);
    }
  }
  return {
    login: 'mira-dev',
    name: 'Mira Chen',
    bio: 'Building delightful developer tools. Open source at heart.',
    location: 'Amsterdam, NL',
    company: '@nebula-labs',
    websiteUrl: 'https://mira.dev',
    twitter: 'miradev',
    avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4',
    createdAt,
    followers: 1834,
    following: 127,
    calendar,
    year: {
      contributions,
      commits: Math.round(contributions * 0.72),
      pullRequests: 214,
      issues: 63,
      reviews: 148,
      reposCreated: 6,
      restricted: 0,
    },
    languages: [
      lang('TypeScript', 46),
      lang('Rust', 21),
      lang('Go', 12),
      lang('C#', 9),
      lang('Python', 7),
      lang('CSS', 3),
      lang('Shell', 2),
    ],
    languagesByBytes: [...totalBytes.values()].sort((a, b) => b.value - a.value),
    repos: DEMO_REPOS,
    pinned: DEMO_REPOS.slice(0, 4),
    extraRepos: [],
    totalStars: DEMO_REPOS.reduce((s, r) => s + r.stars, 0),
    publicRepoCount: 42,
    generatedAt: now.toISOString(),
  };
}

/** A brand-new account with no activity, for edge-case tests. */
export function emptyProfile(now: Date = DEMO_NOW): ProfileData {
  return {
    ...demoProfile(now),
    login: 'new-user',
    name: null,
    bio: null,
    location: null,
    company: null,
    websiteUrl: null,
    twitter: null,
    createdAt: '2026-10-01T10:00:00Z',
    followers: 0,
    following: 0,
    calendar: [],
    year: { contributions: 0, commits: 0, pullRequests: 0, issues: 0, reviews: 0, reposCreated: 0, restricted: 0 },
    languages: [],
    languagesByBytes: [],
    repos: [],
    pinned: [],
    extraRepos: [],
    totalStars: 0,
    publicRepoCount: 0,
  };
}
