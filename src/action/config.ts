import { DEFAULT_THEME, getTheme, themeIds } from '../core/themes.ts';
import { CARD_IDS, type CardId, type CardOptions, type Mode, type PaletteOverrides, type ProfilescapeConfig } from '../core/types.ts';

/**
 * Turns raw Action inputs / CLI flags plus an optional config JSON into a
 * validated ProfilescapeConfig and runtime settings. Pure and browser-safe
 * (no Node APIs) so the playground can reuse it.
 *
 * Precedence: built-in defaults < config JSON < explicitly provided inputs.
 */

/** Every input declared in action.yml with its default value. */
export const ACTION_INPUT_DEFAULTS = {
  username: '',
  token: '',
  cards: 'stats,3d,languages,repos',
  theme: 'aurora',
  modes: 'dark,light',
  animate: 'true',
  history: 'full',
  hide_languages: '',
  exclude_repos: '',
  include_private: 'true',
  repos: '',
  config: '',
  output_dir: 'profilescape',
  publish: 'branch',
  branch: 'profilescape-output',
  commit_message: 'chore: update profilescape cards',
  readme: '',
  github_token: '',
} as const;

export type InputName = keyof typeof ACTION_INPUT_DEFAULTS;
export type RawInputs = Partial<Record<InputName, string>>;
export const INPUT_NAMES = Object.keys(ACTION_INPUT_DEFAULTS) as InputName[];

export const DEFAULT_CARDS: CardId[] = ['stats', '3d', 'languages', 'repos'];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type History = 'full' | 'year';
export type PublishMode = 'branch' | 'none';

export interface Settings {
  /** Reads profile data (a PAT also sees private contributions and repos). */
  token: string;
  /** Writes the output branch and README; falls back to `token`. */
  githubToken: string;
  history: History;
  outputDir: string;
  publish: PublishMode;
  branch: string;
  commitMessage: string;
  /** Path of a README to update between markers, or "". */
  readme: string;
}

export type Source = 'default' | 'config' | 'input';

export interface ResolvedConfig {
  config: ProfilescapeConfig;
  settings: Settings;
  warnings: string[];
  /** Where each user-facing setting came from, for friendly logs. */
  sources: Record<'cards' | 'theme' | 'modes' | 'animate' | 'history' | 'hideLanguages' | 'excludeRepos' | 'includePrivate' | 'repos', Source>;
}

export interface ResolveOptions {
  /** Fallback login (the Action passes GITHUB_REPOSITORY_OWNER). */
  defaultUsername?: string;
  /**
   * Treat inputs equal to their action.yml default as "not provided", so a
   * config file can still change them. The runner always fills in defaults,
   * which would otherwise make the config JSON unable to override anything.
   */
  ignoreDefaultInputs?: boolean;
  /** Throw when no username can be determined (default true). */
  requireUsername?: boolean;
  /** How to name an input in messages; the CLI passes flag names. Default: 'the <name> input'. */
  inputLabel?: (name: InputName) => string;
}

/** Friendly aliases people are likely to type. */
const CARD_ALIASES: Record<string, CardId> = {
  landscape: '3d',
  '3d-graph': '3d',
  contributions: '3d',
  stat: 'stats',
  overview: 'stats',
  language: 'languages',
  langs: 'languages',
  'top-languages': 'languages',
  repo: 'repos',
  repositories: 'repos',
  projects: 'repos',
  banner: 'hero',
  header: 'hero',
  tech: 'stack',
  'tech-stack': 'stack',
  techstack: 'stack',
  social: 'socials',
  badges: 'socials',
  'contribution-grid': 'grid',
  heatmap: 'grid',
  snake: 'grid',
};

const CONFIG_KEYS = [
  '$schema',
  'theme',
  'colors',
  'darkColors',
  'lightColors',
  'cards',
  'modes',
  'animate',
  'history',
  'hideLanguages',
  'excludeRepos',
  'includePrivate',
  'repos',
  'options',
] as const;

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// ---------------------------------------------------------------- helpers

export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Edit distance where swapping two adjacent letters counts as one typo. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const at = (i: number, j: number) => (d[i] as number[])[j] as number;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, at(i - 2, j - 2) + 1);
      (d[i] as number[])[j] = v;
    }
  }
  return at(a.length, b.length);
}

/** Closest candidate within a small edit distance, for "did you mean" hints. */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  const needle = input.toLowerCase();
  let best: { c: string; d: number } | undefined;
  for (const c of candidates) {
    const d = editDistance(needle, c.toLowerCase());
    if (d <= Math.max(1, Math.floor(c.length / 3)) && (!best || d < best.d)) best = { c, d };
  }
  return best?.c;
}

const hint = (input: string, candidates: readonly string[]) => {
  const s = suggest(input, candidates);
  return s ? ` (did you mean "${s}"?)` : '';
};

function parseBool(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', 'on', '1'].includes(v)) return true;
  if (['false', 'no', 'n', 'off', '0'].includes(v)) return false;
  throw new ConfigError(`${field} must be true or false, got "${String(value)}".`);
}

function toList(value: unknown, field: string): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (typeof v !== 'string' && typeof v !== 'number') throw new ConfigError(`${field} must be a list of strings.`);
      return String(v).trim();
    }).filter(Boolean);
  }
  if (typeof value === 'string') return splitList(value);
  throw new ConfigError(`${field} must be a list (array or comma-separated string).`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** "hide_languages" / "hide-languages" -> "hideLanguages". */
const camel = (key: string) => key.replace(/[-_]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase());

// ---------------------------------------------------------------- JSON

/** Replace comments and trailing commas with spaces so positions in error messages stay accurate. */
export function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        out += ' ';
        i++;
      }
      i--;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) out += text[i] === '\n' || text[i] === '\r' ? text[i] : ' ';
      i--;
    } else {
      out += ch;
    }
  }
  // Trailing commas, string-aware.
  let result = '';
  inString = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i] as string;
    if (inString) {
      result += ch;
      if (ch === '\\') result += out[++i] ?? '';
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j] as string)) j++;
      if (out[j] === '}' || out[j] === ']') {
        result += ' ';
        continue;
      }
    }
    result += ch;
  }
  return result;
}

interface JsonFault {
  pos: number;
  reason: string;
}

/** Locate the first syntax error in strict JSON text (null when it is valid). */
export function findJsonError(text: string): JsonFault | null {
  let i = 0;
  function fail(reason: string): never {
    throw { pos: i, reason } satisfies JsonFault;
  }
  function ws(): void {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  }
  function str(): void {
    i++;
    while (i < text.length) {
      const c = text[i] as string;
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') i += 2;
      else if (c < ' ') fail('Line breaks are not allowed inside strings');
      else i++;
    }
    fail('Unterminated string');
  }
  function value(): void {
    ws();
    const ch = text[i];
    if (ch === undefined) fail('Unexpected end of JSON (is a closing bracket missing?)');
    if (ch === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('Expected a property name in double quotes');
        str();
        ws();
        if (text[i] !== ':') fail('Expected ":" after the property name');
        i++;
        value();
        const end = i;
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === '}') {
          i++;
          return;
        } else {
          i = end;
          fail('Expected "," or "}" after this value (is a comma missing?)');
        }
      }
    }
    if (ch === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        value();
        const end = i;
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === ']') {
          i++;
          return;
        } else {
          i = end;
          fail('Expected "," or "]" after this list item (is a comma missing?)');
        }
      }
    }
    if (ch === '"') return str();
    const num = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (num) {
      i += num[0].length;
      return;
    }
    for (const lit of ['true', 'false', 'null']) {
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return;
      }
    }
    if (ch === "'") fail('Strings must use double quotes');
    if (/[A-Za-z_]/.test(ch)) fail('Unexpected text; strings must be in double quotes, e.g. "stats"');
    fail(`Unexpected character ${JSON.stringify(ch)}`);
  }
  try {
    value();
    ws();
    if (i < text.length) fail('Unexpected content after the end of the JSON object');
    return null;
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'pos' in e) return e as JsonFault;
    throw e;
  }
}

/**
 * Parse config JSON (comments and trailing commas allowed). Errors point at
 * the exact line and column with a small code frame.
 */
export function parseConfigJson(text: string, source = 'config'): unknown {
  const original = text.replace(/^\uFEFF/, '');
  const clean = stripJsonc(original);
  if (!clean.trim()) return {};
  try {
    return JSON.parse(clean);
  } catch (err) {
    const fault = findJsonError(clean);
    if (!fault) throw new ConfigError(`Invalid JSON in ${source}: ${(err as Error).message}`);
    const before = clean.slice(0, fault.pos);
    const line = before.split('\n').length;
    const col = fault.pos - before.lastIndexOf('\n');
    const srcLine = (original.split('\n')[line - 1] ?? '').replace(/\r$/, '').replace(/\t/g, ' ');
    const gutter = String(line);
    const frame = `\n  ${gutter} | ${srcLine.slice(0, 120)}\n  ${' '.repeat(gutter.length)} | ${' '.repeat(Math.max(0, Math.min(col - 1, 120)))}^`;
    throw new ConfigError(`Invalid JSON in ${source} at line ${line}, column ${col}: ${fault.reason}${frame}`);
  }
}

// ---------------------------------------------------------------- validation

export function normalizeCards(list: string[], field: string): CardId[] {
  const valid = CARD_IDS as readonly string[];
  const out: CardId[] = [];
  const unknown: string[] = [];
  for (const raw of list) {
    const key = raw.trim().toLowerCase();
    if (key === 'all') {
      for (const id of CARD_IDS) if (!out.includes(id)) out.push(id);
      continue;
    }
    const id = (valid.includes(key) ? key : CARD_ALIASES[key]) as CardId | undefined;
    if (!id) unknown.push(raw);
    else if (!out.includes(id)) out.push(id);
  }
  if (unknown.length) {
    const details = unknown.map((u) => `"${u}"${hint(u, valid)}`).join(', ');
    throw new ConfigError(`Unknown card${unknown.length > 1 ? 's' : ''} in ${field}: ${details}. Valid cards: ${CARD_IDS.join(', ')} (or "all").`);
  }
  if (!out.length) throw new ConfigError(`${field} must list at least one card. Valid cards: ${CARD_IDS.join(', ')}.`);
  return out;
}

function normalizeModes(list: string[], field: string): Mode[] {
  const out: Mode[] = [];
  for (const raw of list) {
    const key = raw.trim().toLowerCase();
    const modes: Mode[] | undefined = key === 'dark' || key === 'light' ? [key] : key === 'both' || key === 'auto' ? ['dark', 'light'] : undefined;
    if (!modes) throw new ConfigError(`Unknown mode "${raw}" in ${field}. Use "dark", "light" or "dark,light".`);
    for (const m of modes) if (!out.includes(m)) out.push(m);
  }
  if (!out.length) throw new ConfigError(`${field} must contain "dark", "light" or both.`);
  return out;
}

function normalizeHistory(value: string, field: string): History {
  const v = value.trim().toLowerCase();
  if (v === 'full' || v === 'all') return 'full';
  if (v === 'year' || v === '1y') return 'year';
  throw new ConfigError(`${field} must be "full" or "year", got "${value}".`);
}

function normalizeTheme(value: string, field: string, warnings: string[]): string {
  const id = value.trim().toLowerCase();
  const ids = themeIds();
  if (ids.includes(id)) return id;
  warnings.push(`Unknown theme "${value}" in ${field}${hint(id, ids)}; using "${DEFAULT_THEME}". Available themes: ${ids.join(', ')}.`);
  return DEFAULT_THEME;
}

function paletteKeys() {
  const base = getTheme(DEFAULT_THEME).dark;
  const colors: string[] = [];
  const numbers: string[] = [];
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === 'string') colors.push(k);
    else if (typeof v === 'number') numbers.push(k);
  }
  return { colors, numbers, syntax: Object.keys(base.syntax) };
}

function normalizeColor(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HEX_RE.test(value.trim())) {
    throw new ConfigError(`${field} must be a hex colour like "#8B7CFF", got ${JSON.stringify(value)}.`);
  }
  const v = value.trim();
  return v.startsWith('#') ? v : `#${v}`;
}

export function normalizePalette(value: unknown, field: string, warnings: string[]): PaletteOverrides {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new ConfigError(`${field} must be an object of colours, e.g. { "accentA": "#FF7A59" }.`);
  const keys = paletteKeys();
  const all = [...keys.colors, ...keys.numbers, 'syntax'];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (keys.colors.includes(k)) out[k] = normalizeColor(v, `${field}.${k}`);
    else if (keys.numbers.includes(k)) {
      const num = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
      if (!Number.isFinite(num) || num < 0 || num > 1) throw new ConfigError(`${field}.${k} must be a number between 0 and 1.`);
      out[k] = num;
    } else if (k === 'syntax') {
      if (!isObject(v)) throw new ConfigError(`${field}.syntax must be an object of colours.`);
      const syntax: Record<string, string> = {};
      for (const [sk, sv] of Object.entries(v)) {
        if (keys.syntax.includes(sk)) syntax[sk] = normalizeColor(sv, `${field}.syntax.${sk}`);
        else warnings.push(`Ignoring unknown colour "${field}.syntax.${sk}"${hint(sk, keys.syntax)}.`);
      }
      out.syntax = syntax;
    } else {
      warnings.push(`Ignoring unknown colour "${field}.${k}"${hint(k, all)}. Known colours: ${all.join(', ')}.`);
    }
  }
  return out as PaletteOverrides;
}

function normalizeOptions(value: unknown, warnings: string[]): Partial<Record<CardId, CardOptions>> {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new ConfigError('options must be an object keyed by card id, e.g. { "repos": { "layout": "detail" } }.');
  const out: Partial<Record<CardId, CardOptions>> = {};
  for (const [k, v] of Object.entries(value)) {
    const key = k.trim().toLowerCase();
    const id = ((CARD_IDS as readonly string[]).includes(key) ? key : CARD_ALIASES[key]) as CardId | undefined;
    if (!id) {
      warnings.push(`Ignoring options for unknown card "${k}"${hint(key, CARD_IDS)}. Valid cards: ${CARD_IDS.join(', ')}.`);
      continue;
    }
    if (!isObject(v)) throw new ConfigError(`options.${k} must be an object.`);
    out[id] = { ...(out[id] ?? {}), ...v };
  }
  return out;
}

export function isValidBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) &&
    !name.includes('..') &&
    !name.includes('@{') &&
    !name.includes('//') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.startsWith('-') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.split('/').some((part) => part.startsWith('.'))
  );
}

// ---------------------------------------------------------------- resolve

export function resolveConfig(inputs: RawInputs, json?: unknown, opts: ResolveOptions = {}): ResolvedConfig {
  const warnings: string[] = [];

  // Normalise the config JSON: camelCase keys, warn on unknown ones.
  if (json !== undefined && json !== null && !isObject(json)) {
    throw new ConfigError('The config must be a JSON object, e.g. { "theme": "aurora", "cards": ["stats", "3d"] }.');
  }
  const file: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries((json as Record<string, unknown> | undefined) ?? {})) {
    const key = rawKey === '$schema' ? rawKey : camel(rawKey);
    if ((CONFIG_KEYS as readonly string[]).includes(key)) file[key] = value;
    else if (key === 'username' || key === 'user' || key === 'login') {
      warnings.push('"username" in the config JSON is ignored; set the username input (Action) or --user (CLI).');
    } else warnings.push(`Ignoring unknown config key "${rawKey}"${hint(key, CONFIG_KEYS)}.`);
  }

  const explicit = (name: InputName): string | undefined => {
    const v = (inputs[name] ?? '').trim();
    if (!v) return undefined;
    if (opts.ignoreDefaultInputs) {
      const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      if (norm(v) === norm(ACTION_INPUT_DEFAULTS[name])) return undefined;
    }
    return v;
  };
  const has = (key: string) => file[key] !== undefined && file[key] !== null;
  const sources = {} as ResolvedConfig['sources'];

  /** Pick input > config > default and record where it came from. */
  function pick<T>(
    key: keyof ResolvedConfig['sources'],
    input: InputName,
    fromInput: (v: string, field: string) => T,
    fromConfig: (v: unknown, field: string) => T,
    fallback: T,
  ): T {
    const v = explicit(input);
    if (v !== undefined) {
      sources[key] = 'input';
      return fromInput(v, opts.inputLabel ? opts.inputLabel(input) : `the ${input} input`);
    }
    if (has(key)) {
      sources[key] = 'config';
      return fromConfig(file[key], `config.${key}`);
    }
    sources[key] = 'default';
    return fallback;
  }

  const cards = pick(
    'cards',
    'cards',
    (v, f) => normalizeCards(splitList(v.replace(/\s+/g, ',')), f),
    (v, f) => normalizeCards(toList(v, f), f),
    [...DEFAULT_CARDS],
  );
  const theme = pick(
    'theme',
    'theme',
    (v, f) => normalizeTheme(v, f, warnings),
    (v, f) => {
      if (typeof v !== 'string') throw new ConfigError(`${f} must be a string (a theme id).`);
      return normalizeTheme(v, f, warnings);
    },
    DEFAULT_THEME,
  );
  const modes = pick(
    'modes',
    'modes',
    (v, f) => normalizeModes(splitList(v.replace(/\s+/g, ',')), f),
    (v, f) => normalizeModes(toList(v, f), f),
    ['dark', 'light'] as Mode[],
  );
  const animate = pick('animate', 'animate', parseBool, parseBool, true);
  const history = pick(
    'history',
    'history',
    normalizeHistory,
    (v, f) => normalizeHistory(String(v), f),
    'full' as History,
  );
  const hideLanguages = pick('hideLanguages', 'hide_languages', (v) => splitList(v), toList, [] as string[]);
  const excludeRepos = pick('excludeRepos', 'exclude_repos', (v) => splitList(v), toList, [] as string[]);
  const includePrivate = pick('includePrivate', 'include_private', parseBool, parseBool, true);
  const repos = pick('repos', 'repos', (v) => splitList(v), toList, [] as string[]);
  for (const r of repos) {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$|^[A-Za-z0-9._-]+$/.test(r)) {
      throw new ConfigError(`Invalid repository "${r}" in repos. Use "name" (your own repo) or "owner/name".`);
    }
  }

  const colors = normalizePalette(file.colors, 'colors', warnings);
  const darkColors = normalizePalette(file.darkColors, 'darkColors', warnings);
  const lightColors = normalizePalette(file.lightColors, 'lightColors', warnings);
  const options = normalizeOptions(file.options, warnings);
  for (const id of Object.keys(options) as CardId[]) {
    if (!cards.includes(id)) warnings.push(`options.${id} is set but the "${id}" card is not enabled (cards: ${cards.join(', ')}).`);
  }

  // Username: input > GITHUB_REPOSITORY_OWNER.
  const username = ((inputs.username ?? '').trim() || (opts.defaultUsername ?? '').trim()).replace(/^@/, '');
  if (username && !LOGIN_RE.test(username)) {
    throw new ConfigError(`"${username}" is not a valid GitHub username.`);
  }
  if (!username && (opts.requireUsername ?? true)) {
    throw new ConfigError('No username: set the username input (it defaults to the repository owner when running in GitHub Actions).');
  }

  // Runtime settings (inputs only; not part of the shareable config).
  const token = (inputs.token ?? '').trim();
  const publishRaw = (inputs.publish ?? '').trim().toLowerCase() || 'branch';
  const publish: PublishMode | undefined = ['branch', 'true', 'yes', 'on'].includes(publishRaw)
    ? 'branch'
    : ['none', 'false', 'no', 'off'].includes(publishRaw)
      ? 'none'
      : undefined;
  if (!publish) throw new ConfigError(`publish must be "branch" or "none", got "${inputs.publish}".`);
  const branch = (inputs.branch ?? '').trim() || ACTION_INPUT_DEFAULTS.branch;
  if (!isValidBranchName(branch)) throw new ConfigError(`"${branch}" is not a valid branch name.`);
  const outputDir = (inputs.output_dir ?? '').trim() || ACTION_INPUT_DEFAULTS.output_dir;

  return {
    config: { username, cards, theme, colors, darkColors, lightColors, modes, animate, hideLanguages, excludeRepos, includePrivate, repos, options },
    settings: {
      token,
      githubToken: (inputs.github_token ?? '').trim() || token,
      history,
      outputDir,
      publish,
      branch,
      commitMessage: (inputs.commit_message ?? '').trim() || ACTION_INPUT_DEFAULTS.commit_message,
      readme: (inputs.readme ?? '').trim(),
    },
    warnings,
    sources,
  };
}
