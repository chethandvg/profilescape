/**
 * Shared data model and card contract. Everything under src/core (except
 * github.ts) and src/cards must stay browser-safe: no Node APIs, so the same
 * renderers power the GitHub Action, the CLI and the website playground.
 */

export type Mode = 'dark' | 'light';

export const CARD_IDS = ['stats', 'languages', '3d', 'grid', 'repos', 'hero', 'stack', 'socials'] as const;
export type CardId = (typeof CARD_IDS)[number];

/** One calendar day, `date` is YYYY-MM-DD. */
export interface ContributionDay {
  date: string;
  count: number;
}

/** `value` is a weight (bytes or commit-weighted bytes); renderers normalise it. */
export interface LanguageStat {
  name: string;
  color: string;
  value: number;
}

export interface RepoInfo {
  owner: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  openPullRequests: number;
  primaryLanguage: { name: string; color: string } | null;
  /** By bytes, largest first. */
  languages: LanguageStat[];
  topics: string[];
  license: string | null;
  latestRelease: { tag: string; publishedAt: string } | null;
  isArchived: boolean;
  isFork: boolean;
  isPrivate: boolean;
  isTemplate: boolean;
  pushedAt: string;
  createdAt: string;
}

/** Totals for the last 12 months as reported by GitHub. */
export interface YearTotals {
  contributions: number;
  commits: number;
  pullRequests: number;
  issues: number;
  reviews: number;
  reposCreated: number;
  /** Private contributions GitHub counts but does not itemise. */
  restricted: number;
}

export interface ProfileData {
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  company: string | null;
  websiteUrl: string | null;
  twitter: string | null;
  avatarUrl: string;
  createdAt: string;
  followers: number;
  following: number;
  /** Sorted ascending, never contains future dates. Full history unless fetched with history: 'year'. */
  calendar: ContributionDay[];
  year: YearTotals;
  /** Weighted by the user's commits per repo over the last year (falls back to bytes). Largest first. */
  languages: LanguageStat[];
  /** Raw bytes across owned non-fork repos. Largest first. */
  languagesByBytes: LanguageStat[];
  /** Owned, non-fork repositories visible to the token, most starred first. */
  repos: RepoInfo[];
  pinned: RepoInfo[];
  /** Repositories requested explicitly via config (may belong to other owners). */
  extraRepos: RepoInfo[];
  /** Stars across owned, public, non-fork repositories. */
  totalStars: number;
  publicRepoCount: number;
  /** ISO timestamp of the fetch. */
  generatedAt: string;
}

export interface SyntaxPalette {
  keyword: string;
  type: string;
  string: string;
  property: string;
  number: string;
  punctuation: string;
  comment: string;
}

export interface Palette {
  /** Page-level background used by full-bleed art such as the hero. */
  bg: string;
  /** Card surface. */
  panel: string;
  panelAlt: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  /** Primary accent; gradients run accentA → accentB. */
  accentA: string;
  accentB: string;
  success: string;
  chipBg: string;
  /** Empty contribution cell. */
  empty: string;
  grid: string;
  gridOpacity: number;
  /** Strength of decorative glows (0..1). */
  glowOpacity: number;
  syntax: SyntaxPalette;
}

export interface Theme {
  id: string;
  label: string;
  dark: Palette;
  light: Palette;
}

/** Palette overrides accepted from config: any top-level colour plus partial syntax. */
export type PaletteOverrides = Partial<Omit<Palette, 'syntax'>> & { syntax?: Partial<SyntaxPalette> };

export type CardOptions = Record<string, unknown>;

export interface RenderContext {
  data: ProfileData;
  theme: Theme;
  palette: Palette;
  mode: Mode;
  options: CardOptions;
  /** False when the user disabled animations; shell() already enforces it. */
  animate: boolean;
  /** Injected clock so renders are deterministic in tests and the gallery. */
  now: Date;
}

export interface CardImage {
  /** File stem without mode suffix, e.g. "stats" or "repo-ollama-net". */
  name: string;
  alt: string;
  svg: string;
  /** Where the image should link to in generated markdown. */
  link?: string;
  /**
   * Layout hint for generated markdown: half-width images are paired in a
   * 2-column table; inline images (e.g. badges) flow side by side, centred.
   */
  layout?: 'full' | 'half' | 'inline';
}

export interface OptionDoc {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'list' | 'object';
  default?: unknown;
  description: string;
}

export interface CardDefinition {
  id: CardId;
  title: string;
  description: string;
  options: OptionDoc[];
  render(ctx: RenderContext): CardImage[];
}

/** User-facing configuration shared by the Action, CLI and playground. */
export interface ProfilescapeConfig {
  username: string;
  cards: CardId[];
  theme: string;
  /** Overrides applied to both modes, then darkColors/lightColors on top. */
  colors: PaletteOverrides;
  darkColors: PaletteOverrides;
  lightColors: PaletteOverrides;
  modes: Mode[];
  animate: boolean;
  hideLanguages: string[];
  excludeRepos: string[];
  includePrivate: boolean;
  /** Repo cards to render ("owner/name" or "name"). Empty means pinned, then most starred. */
  repos: string[];
  /** Per-card options keyed by card id. */
  options: Partial<Record<CardId, CardOptions>>;
}
