import { levelScale, streaks, yearWindow } from '../core/calendar.ts';
import { compact, displayName, plural } from '../core/format.ts';
import { own, readOptions } from '../core/options.ts';
import { delay, ensureContrast, esc, fit, label, linearGradient, n, safeColor, shell, textWidth, type TextOpts, wrapPx } from '../core/svg.ts';
import { contribRamp } from '../core/themes.ts';
import type { CardDefinition, Palette, ProfileData, RenderContext, SyntaxPalette } from '../core/types.ts';
import { drawIcon, legible, resolveIcon, slugify } from './icons.ts';

const W = 1200;
const H = 400;
const X0 = 60;

// ── Code languages ───────────────────────────────────────────────────────────

export const CODE_LANGUAGES = [
  'csharp', 'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'swift', 'ruby', 'php', 'json',
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

const FILES: Record<CodeLanguage, string> = {
  csharp: 'Program.cs', typescript: 'profile.ts', javascript: 'profile.js', python: 'me.py', go: 'main.go',
  rust: 'main.rs', java: 'Main.java', kotlin: 'Main.kt', swift: 'main.swift', ruby: 'me.rb', php: 'me.php',
  json: 'profile.json',
};

/** Icon shown next to the file name in the editor title bar. */
const FILE_ICONS: Record<CodeLanguage, string> = {
  csharp: 'csharp', typescript: 'typescript', javascript: 'javascript', python: 'python', go: 'go', rust: 'rust',
  java: 'java', kotlin: 'kotlin', swift: 'swift', ruby: 'ruby', php: 'php', json: 'json',
};

/** Slugified names (GitHub languages and common aliases) → code language. */
const LANG_ALIASES: Record<string, CodeLanguage> = {
  csharp: 'csharp', cs: 'csharp', dotnet: 'csharp', typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  vue: 'typescript', svelte: 'typescript', astro: 'typescript', javascript: 'javascript', js: 'javascript',
  jsx: 'javascript', nodedotjs: 'javascript', node: 'javascript', python: 'python', py: 'python',
  jupyternotebook: 'python', go: 'go', golang: 'go', rust: 'rust', rs: 'rust', java: 'java', kotlin: 'kotlin',
  kt: 'kotlin', swift: 'swift', ruby: 'ruby', rb: 'ruby', php: 'php', json: 'json',
};

export function codeLanguageOf(name: string): CodeLanguage | null {
  return own(LANG_ALIASES, slugify(name)) ?? null;
}

/** First of the user's top languages that has a snippet template; JSON otherwise. */
export function detectLanguage(data: ProfileData): CodeLanguage {
  for (const l of data.languages) {
    const lang = codeLanguageOf(l.name);
    if (lang) return lang;
  }
  return 'json';
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

export type TokenKind = keyof SyntaxPalette | 'plain';
export interface Token {
  kind: TokenKind;
  text: string;
}

interface Syntax {
  keywords: Set<string>;
  types: Set<string>;
  literals: Set<string>;
  comments: string[];
  quotes: string;
  blockComments: boolean;
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
const C_LIKE = { comments: ['//'], quotes: '"\'', blockComments: true };

const SYNTAX: Record<CodeLanguage, Syntax> = {
  csharp: {
    ...C_LIKE,
    keywords: words(
      'var new await async public private protected internal static class record struct interface void return using namespace if else for foreach in while get set init readonly const this base override virtual sealed partial required',
    ),
    types: words('string int long bool double decimal object dynamic Task List'),
    literals: words('true false null'),
  },
  typescript: {
    ...C_LIKE,
    quotes: '"\'`',
    keywords: words(
      'const let var function return await async new export import from default interface type class extends implements as satisfies readonly public private protected if else for of in while typeof keyof',
    ),
    types: words('string number boolean void unknown any never object'),
    literals: words('true false null undefined'),
  },
  javascript: {
    ...C_LIKE,
    quotes: '"\'`',
    keywords: words('const let var function return await async new export import from default class extends if else for of in while typeof'),
    types: words(''),
    literals: words('true false null undefined'),
  },
  python: {
    comments: ['#'],
    quotes: '"\'',
    blockComments: false,
    keywords: words('def class return import from as with for in if elif else while await async lambda pass yield and or not is self'),
    types: words('str int bool float list dict'),
    literals: words('True False None'),
  },
  go: {
    ...C_LIKE,
    quotes: '"\'`',
    keywords: words('package import func var const type struct interface return if else for range go defer chan map select switch case'),
    types: words('string int int64 bool error byte rune float64 any'),
    literals: words('true false nil'),
  },
  rust: {
    ...C_LIKE,
    quotes: '"',
    keywords: words('let mut fn struct impl pub use mod return if else for in while loop match async await move const static enum trait where self Self'),
    types: words('String str Vec Option Result u8 u32 u64 i32 i64 usize bool'),
    literals: words('true false'),
  },
  java: {
    ...C_LIKE,
    keywords: words('var new public private protected static final class record interface void return import package if else for while this extends implements'),
    types: words('String int long boolean double List Map'),
    literals: words('true false null'),
  },
  kotlin: {
    ...C_LIKE,
    keywords: words('val var fun class data object return import package if else for in while when suspend this'),
    types: words('String Int Long Boolean List'),
    literals: words('true false null'),
  },
  swift: {
    ...C_LIKE,
    quotes: '"',
    keywords: words('let var func struct class enum return import if else for in while guard try await async throws self init'),
    types: words('String Int Bool Double'),
    literals: words('true false nil'),
  },
  ruby: {
    comments: ['#'],
    quotes: '"\'',
    blockComments: false,
    keywords: words('def end class module return require do if else elsif unless while self attr_reader'),
    types: words(''),
    literals: words('true false nil'),
  },
  php: {
    ...C_LIKE,
    comments: ['//', '#'],
    keywords: words('function return new class public private protected static use namespace echo fn if else foreach as readonly'),
    types: words('string int bool array'),
    literals: words('true false null'),
  },
  json: {
    comments: [],
    quotes: '"',
    blockComments: false,
    keywords: words(''),
    types: words(''),
    literals: words('true false null'),
  },
};

const PUNCT = new Set(['{', '}', '[', ']', '(', ')', ';', ',', ':', '=', '?']);
const OPS = ['=>', '->', ':=', '::', '??', '?.', '==', '!=', '<=', '>='];

/** A small, forgiving single-line highlighter: good enough for short, idiomatic snippets. */
export function tokenize(line: string, lang: CodeLanguage): Token[] {
  const spec = SYNTAX[lang];
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  const first = line.search(/\S/);
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (spec.comments.some((c) => rest.startsWith(c)) && !(lang === 'php' && rest.startsWith('#['))) {
      push('comment', rest);
      break;
    }
    if (spec.blockComments && rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      const text = end < 0 ? rest : rest.slice(0, end + 2);
      push('comment', text);
      i += text.length;
      continue;
    }
    if (lang === 'php' && rest.startsWith('<?php')) {
      push('keyword', '<?php');
      i += 5;
      continue;
    }
    const str = new RegExp(`^(?:[$@]{1,2}|[fFrRbB]{1,2})?([${spec.quotes.replace(/[\]\\^-]/g, '\\$&')}])`).exec(rest);
    if (str) {
      const quote = str[1] as string;
      let j = str[0].length;
      while (j < rest.length && rest[j] !== quote) j += rest[j] === '\\' ? 2 : 1;
      const text = rest.slice(0, Math.min(rest.length, j + 1));
      const next = rest.slice(text.length).trimStart();
      push(i === first && next.startsWith(':') && !next.startsWith('::') ? 'property' : 'string', text);
      i += text.length;
      continue;
    }
    const num = /^(?:0x[\da-f_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)[a-z]*/i.exec(rest);
    if (num) {
      push('number', num[0]);
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (id) {
      const word = id[0];
      const next = rest.slice(word.length).trimStart();
      const before = line.slice(0, i).trimEnd();
      const member = before.endsWith('.') || before.endsWith('->');
      let kind: TokenKind = 'plain';
      if (spec.keywords.has(word) && (!member || (lang === 'rust' && word === 'await'))) kind = 'keyword';
      else if (spec.literals.has(word)) kind = 'number';
      else if (spec.types.has(word)) kind = 'type';
      else if (next.startsWith('(') || (lang === 'rust' && next.startsWith('!'))) kind = 'type';
      else if (member) kind = 'property';
      else if (first > 0 && i === first && ((next.startsWith(':') && !next.startsWith('::')) || /^=(?![=>])/.test(next)))
        kind = 'property';
      else if (/^[A-Z]/.test(word) && lang !== 'json') kind = 'type';
      push(kind, word);
      i += word.length;
      continue;
    }
    const ws = /^\s+/.exec(rest);
    if (ws) {
      push('plain', ws[0]);
      i += ws[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      push(op === '?.' ? 'plain' : 'punctuation', op);
      i += op.length;
      continue;
    }
    const ch = rest[0] as string;
    push(PUNCT.has(ch) ? 'punctuation' : 'plain', ch);
    i += 1;
  }
  return out;
}

// ── Auto snippet ─────────────────────────────────────────────────────────────

export interface Facts {
  name: string;
  login: string;
  base?: string;
  stack: string[];
  /** A phrase from the bio, or topic names (rendered as a list of whole items). */
  focus?: string | string[];
  since: number;
}

const BUILD_VERB =
  /^(i\s*(am|'m)\s+)?(building|making|creating|crafting|shipping|writing|developing|designing|exploring|working\s+on|i\s+build|i\s+make|i\s+create|i\s+craft|i\s+ship|i\s+write|i\s+develop|i\s+design)\s+/i;

/**
 * A bio split into clauses: lines, then " | ", " — ", " – " and " - ", then
 * sentences. A sentence ends at . ! ? followed by whitespace, so ".NET" or
 * "v2.1" never split. Clauses keep their own punctuation.
 */
export function bioClauses(bio: string | null | undefined): string[] {
  const out: string[] = [];
  for (const line of (bio ?? '').split(/\r?\n/)) {
    for (const segment of line.split(/\s*\|\s*|\s+[—–-]\s+/)) {
      for (const sentence of segment.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
        const clause = sentence.trim();
        if (/[\p{L}\p{N}]/u.test(clause)) out.push(clause);
      }
    }
  }
  return out;
}

const stripEnd = (s: string) => s.replace(/[\s.!?,;:·]+$/, '').trim();
/** Comparison key: lower case letters and digits only. */
const keyOf = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The role line from a bio clause: the whole clause when it fits, otherwise
 * the longest run of whole "·" (or "•", " / ") items that does. Never cuts
 * mid-word; returns "" when nothing fits.
 */
export function roleFrom(clause: string, fits: (s: string) => boolean): string {
  const text = stripEnd(clause);
  if (!text) return '';
  if (fits(text)) return text;
  const cuts = [...text.matchAll(/\s+[·•/]\s+/g)].map((m) => m.index).reverse();
  for (const at of cuts) {
    const head = stripEnd(text.slice(0, at));
    if (head && fits(head)) return head;
  }
  return '';
}

/** True when a bio clause only states a place: "📍 Tokyo", or "Germany" for the location "Berlin, Germany". */
function isLocation(clause: string, location: string): boolean {
  if (/^\s*(?:📍|🌍|🌎|🌏)/u.test(clause)) return true;
  const key = keyOf(clause.replace(/^\s*(?:based\s+in|living\s+in|located\s+in|from)\s+/i, ''));
  if (!key || !location.trim()) return false;
  const parts = location.split(/[,/·|]/).map(keyOf).filter(Boolean);
  return key === keyOf(location) || parts.includes(key);
}

/**
 * True when one clause starts with the other: the role itself, or the role cut
 * down to its first list items. A one-word role ("Developer") only matches exactly.
 */
const restates = (a: string, b: string) => {
  const [x, y] = [keyOf(a), keyOf(b)];
  if (!x || !y) return false;
  if (!x.includes(' ') || !y.includes(' ')) return x === y;
  return `${x} `.startsWith(`${y} `) || `${y} `.startsWith(`${x} `);
};

const ROLE_SIZE = 25;
const ROLE_WEIGHT = 600;
const DEFAULT_ROLE = 'Developer';

export interface Copy {
  role: string;
  /** Bio clauses not used for the role, in order. */
  rest: string[];
}

/**
 * Role and remaining bio clauses for a text column `colW` wide. An explicit
 * role option wins; otherwise the first clause that is not a place becomes
 * the role when it (or its leading list items) fits on the line.
 */
function deriveCopy(data: Pick<ProfileData, 'bio' | 'location'>, colW: number, roleOption?: string): Copy {
  const clauses = bioClauses(data.bio);
  if (roleOption) return { role: roleOption, rest: clauses.filter((c) => !restates(c, roleOption)) };
  const fits = (s: string) => textWidth(s, ROLE_SIZE, { weight: ROLE_WEIGHT }) <= colW;
  const at = clauses.findIndex((c) => !isLocation(c, data.location ?? ''));
  const role = at >= 0 ? roleFrom(clauses[at] ?? '', fits) : '';
  return role ? { role, rest: clauses.filter((_, i) => i !== at) } : { role: DEFAULT_ROLE, rest: clauses };
}

/** Join clauses: sentences flow on, bare fragments ("Open source | Coffee") are separated by " · ". */
function joinClauses(parts: string[]): string {
  let out = '';
  for (const part of parts) out = !out ? part : `${out}${/[.!?]$/.test(out) ? ' ' : ' · '}${part}`;
  return out;
}

/** True when every word of `text` also appears in `location` (a bare place fragment such as "Germany"). */
function onlyPlaceWords(text: string, location: string): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const place = new Set(words(location));
  const own = words(text);
  return own.length > 0 && own.every((w) => place.has(w));
}

/** Topics that never describe a focus area. */
const NOISE_TOPICS = new Set([
  'hacktoberfest', 'github', 'awesome', 'awesome-list', 'github-profile', 'profile-readme', 'readme', 'github-readme',
  'github-actions', 'github-action', 'svg', 'template', 'open-source', 'opensource', 'portfolio', 'cli', 'library',
]);

/**
 * The most common topics across the public, active repositories the user owns
 * (ties keep the order of the most starred repos). Language topics are left
 * out because the snippet already lists the stack.
 */
export function topTopics(data: ProfileData, limit = 3): string[] {
  const profileRepo = `${data.login}/${data.login}`.toLowerCase();
  const counts = new Map<string, number>();
  for (const repo of data.repos ?? []) {
    if (repo.isPrivate || repo.isFork || repo.isArchived || repo.nameWithOwner.toLowerCase() === profileRepo) continue;
    for (const topic of new Set((repo.topics ?? []).map((t) => t.trim().toLowerCase()))) {
      if (!topic || NOISE_TOPICS.has(topic) || codeLanguageOf(topic) || resolveIcon(topic).category === 'language') continue;
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  // Map iteration keeps first-seen order, and Array.prototype.sort is stable.
  // A focus is something several repositories share; a topic seen once only
  // describes that one project, so it is not offered as a focus.
  return [...counts]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

/**
 * The snippet's focus line. It never repeats the role or the location: it
 * comes from what remains of the bio (preferring the sentence that says what
 * you build), else from the most common repository topics, else it is omitted.
 */
export function focusOf(data: ProfileData, copy: Copy): string | string[] | undefined {
  const location = data.location?.trim() ?? '';
  const left = copy.rest.filter((c) => !restates(c, copy.role) && !isLocation(c, location));
  const sentence = left.find((s) => BUILD_VERB.test(s)) ?? left[0];
  if (sentence) {
    const text = stripEnd(sentence.replace(BUILD_VERB, '')) || stripEnd(sentence);
    if (text && !restates(text, copy.role)) return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const topics = topTopics(data);
  return topics.length ? topics : undefined;
}

/** Truncate at a word boundary when that keeps most of the text, else mid-word. */
function fitWords(s: string, maxW: number, size: number, opts: TextOpts = {}): string {
  const cut = fit(s, maxW, size, opts);
  if (cut === s) return s;
  const kept = cut.slice(0, -1);
  const space = kept.search(/[\s·,;:/-]+\S*$/);
  return space >= kept.length * 0.55 ? `${kept.slice(0, space).replace(/[\s·,;:/-]+$/, '')}…` : cut;
}

/** Top languages under their short display names, without duplicates. */
function languageNames(data: ProfileData, limit: number): string[] {
  return [...new Set(data.languages.map((l) => displayName(l.name)).filter(Boolean))].slice(0, limit);
}

/**
 * Facts for the auto snippet. `copy` is the role and leftover bio shown next
 * to it (by default derived from the bio exactly as the banner does), so the
 * focus line never repeats the role.
 */
export function factsFrom(data: ProfileData, name: string, now: Date, copy?: Copy): Facts {
  const year = Number(data.createdAt.slice(0, 4));
  return {
    name,
    login: data.login,
    base: data.location?.trim() || undefined,
    stack: languageNames(data, 3),
    focus: focusOf(data, copy ?? deriveCopy(data, CODE_COL_W)),
    since: Number.isFinite(year) && year > 1990 ? year : now.getUTCFullYear(),
  };
}

type Value = { kind: 'str'; v: string } | { kind: 'num'; v: number } | { kind: 'list'; v: string[] };

interface Template {
  open: string[];
  close: string[];
  indent: string;
  key: (k: string) => string;
  /** Format one field; `last` for languages without trailing commas. */
  field: (key: string, value: string, last: boolean, keyWidth: number) => string;
  quote: '"' | "'";
  list: (items: string[]) => string;
  /** Characters the list syntax adds around the items. */
  listOverhead: number;
}

const pascal = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

const TEMPLATES: Record<CodeLanguage, Template> = {
  csharp: {
    open: ['var me = new Developer', '{'],
    close: ['};', 'await me.ShipAsync();'],
    indent: '    ',
    key: pascal,
    field: (k, v, _l, w) => `    ${k.padEnd(w)} = ${v},`,
    quote: '"',
    list: (xs) => `[${xs.join(', ')}]`,
    listOverhead: 2,
  },
  typescript: {
    open: ['const me: Developer = {'],
    close: ['};', 'await ship(me);'],
    indent: '  ',
    key: (k) => k,
    field: (k, v) => `  ${k}: ${v},`,
    quote: '"',
    list: (xs) => `[${xs.join(', ')}]`,
    listOverhead: 2,
  },
  javascript: {
    open: ['const me = {'],
    close: ['};', 'export default me;'],
    indent: '  ',
    key: (k) => k,
    field: (k, v) => `  ${k}: ${v},`,
    quote: '"',
    list: (xs) => `[${xs.join(', ')}]`,
    listOverhead: 2,
  },
  python: {
    open: ['me = Developer('],
    close: [')', 'me.ship()'],
    indent: '    ',
    key: (k) => k,
    field: (k, v) => `    ${k}=${v},`,
    quote: '"',
    list: (xs) => `[${xs.join(', ')}]`,
    listOverhead: 2,
  },
  go: {
    open: ['me := Developer{'],
    close: ['}', 'me.Ship()'],
    indent: '    ',
    key: pascal,
    field: (k, v, _l, w) => `    ${`${k}:`.padEnd(w + 1)} ${v},`,
    quote: '"',
    list: (xs) => `[]string{${xs.join(', ')}}`,
    listOverhead: 10,
  },
  rust: {
    open: ['let me = Developer {'],
    close: ['};', 'me.ship().await?;'],
    indent: '    ',
    key: (k) => k,
    field: (k, v) => `    ${k}: ${v},`,
    quote: '"',
    list: (xs) => `vec![${xs.join(', ')}]`,
    listOverhead: 6,
  },
  java: {
    open: ['var me = Developer.builder()'],
    close: ['    .build();', 'me.ship();'],
    indent: '    ',
    key: (k) => k,
    field: (k, v) => `    .${k}(${v})`,
    quote: '"',
    list: (xs) => `List.of(${xs.join(', ')})`,
    listOverhead: 9,
  },
  kotlin: {
    open: ['val me = Developer('],
    close: [')', 'me.ship()'],
    indent: '    ',
    key: (k) => k,
    field: (k, v) => `    ${k} = ${v},`,
    quote: '"',
    list: (xs) => `listOf(${xs.join(', ')})`,
    listOverhead: 8,
  },
  swift: {
    open: ['let me = Developer('],
    close: [')', 'try await me.ship()'],
    indent: '    ',
    key: (k) => k,
    field: (k, v, last) => `    ${k}: ${v}${last ? '' : ','}`,
    quote: '"',
    list: (xs) => `[${xs.join(', ')}]`,
    listOverhead: 2,
  },
  ruby: {
    open: ['me = Developer.new('],
    close: [')', 'me.ship!'],
    indent: '  ',
    key: (k) => k,
    field: (k, v, last) => `  ${k}: ${v}${last ? '' : ','}`,
    quote: '"',
    list: (xs) => `[${xs.join(', ')}]`,
    listOverhead: 2,
  },
  php: {
    open: ['<?php', '$me = new Developer('],
    close: [');', '$me->ship();'],
    indent: '    ',
    key: (k) => k,
    field: (k, v) => `    ${k}: ${v},`,
    quote: "'",
    list: (xs) => `[${xs.join(', ')}]`,
    listOverhead: 2,
  },
  json: {
    open: ['{'],
    close: ['}'],
    indent: '  ',
    key: (k) => `"${k}"`,
    field: (k, v, last) => `  ${k}: ${v}${last ? '' : ','}`,
    quote: '"',
    list: (xs) => `[${xs.join(', ')}]`,
    listOverhead: 2,
  },
};

/** Quote and escape `s` for a code string literal no longer than `budget` characters (quotes included). */
function quoted(s: string, quote: '"' | "'", budget: number): string {
  const escape = (x: string) => x.replace(/\\/g, '\\\\').replace(quote === '"' ? /"/g : /'/g, `\\${quote}`);
  let body = escape(s);
  if (body.length + 2 > budget) {
    let cut = [...s];
    while (cut.length > 1 && escape(`${cut.join('').trimEnd()}…`).length + 2 > budget) cut = cut.slice(0, -1);
    let kept = cut.join('');
    const space = kept.search(/[\s·,;:/-]+\S*$/);
    if (space >= kept.length * 0.55) kept = kept.slice(0, space);
    body = escape(`${kept.replace(/[\s·,;:/-]+$/, '')}…`);
  }
  return `${quote}${body}${quote}`;
}

/** A short, idiomatic snippet describing the profile, at most 9 lines of `maxChars`. */
export function autoCode(f: Facts, lang: CodeLanguage, maxChars: number): string[] {
  const t = TEMPLATES[lang];
  const fields: [string, Value][] = [['name', { kind: 'str', v: f.name }]];
  if (f.base) fields.push(['base', { kind: 'str', v: f.base }]);
  if (f.stack.length) fields.push(['stack', { kind: 'list', v: f.stack }]);
  if (f.focus?.length) fields.push(['focus', typeof f.focus === 'string' ? { kind: 'str', v: f.focus } : { kind: 'list', v: f.focus }]);
  if (fields.length < 3 && f.login) fields.push(['github', { kind: 'str', v: `@${f.login}` }]);
  fields.push(['since', { kind: 'num', v: f.since }]);
  const maxFields = 9 - t.open.length - t.close.length;
  const used = fields.slice(0, Math.max(1, maxFields));
  const keyWidth = Math.max(...used.map(([k]) => t.key(k).length));
  const lines = used.map(([k, value], idx) => {
    const key = t.key(k);
    const last = idx === used.length - 1;
    const overhead = t.field(key, '', last, keyWidth).length;
    const budget = Math.max(6, maxChars - overhead);
    let literal: string;
    if (value.kind === 'num') literal = String(value.v);
    else if (value.kind === 'str') literal = quoted(value.v, t.quote, budget);
    else {
      const items: string[] = [];
      for (const item of value.v) {
        const q = quoted(item, t.quote, 99);
        const next = [...items, q];
        if (next.join(', ').length + t.listOverhead <= budget) items.push(q);
        else break;
      }
      if (!items.length) items.push(quoted(value.v[0] ?? '', t.quote, budget - t.listOverhead));
      literal = t.list(items);
    }
    return t.field(key, literal, last, keyWidth);
  });
  return [...t.open, ...lines, ...t.close].map((l) => clampLine(l, maxChars));
}

function clampLine(line: string, maxChars: number): string {
  const chars = [...line];
  return chars.length <= maxChars ? line : `${chars.slice(0, maxChars - 1).join('')}…`;
}

/** User-supplied code: tabs → 4 spaces, at most 9 lines, each clamped. */
export function customCode(code: string, maxChars: number): string[] {
  const lines = code.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').map((l) => l.trimEnd());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  const kept = lines.slice(0, 9);
  while (kept.length && !kept[kept.length - 1]) kept.pop();
  return kept.map((l) => clampLine(l, maxChars));
}

// ── Text content ─────────────────────────────────────────────────────────────

interface Content {
  name: string;
  role: string;
  /** Role plus the bio clauses it did not use; feeds the snippet's focus line. */
  copy: Copy;
  tagline: string[];
  chips: string[];
  status: string;
}

function content(ctx: RenderContext, colW: number): Content {
  const d = ctx.data;
  const o = readOptions(ctx.options);
  const name = o.string('name', d.name?.trim() || d.login || 'Hello, world');
  const copy = deriveCopy(d, colW, o.optionalString('role')?.trim());
  const role = copy.role;

  const statusRaw = o.string('status', '');
  const location = d.location?.trim() ?? '';
  const status = /^(none|false|off|hide)$/i.test(statusRaw.trim())
    ? ''
    : statusRaw || ['open to collaboration', location].filter(Boolean).join(' · ');

  let tagline: string[];
  const rawTag = o.raw('tagline');
  if (Array.isArray(rawTag)) tagline = rawTag.map((s) => String(s).trim()).filter(Boolean).slice(0, 2);
  else if (typeof rawTag === 'string' && rawTag.trim()) tagline = wrapPx(rawTag.trim(), colW, 17, {}, 2);
  else {
    // The location is said once: in the status line, else in the tagline. A
    // status that names the city ("Berlin, DE" for "Berlin, Germany") counts.
    const city = (location.split(',')[0] ?? '').trim().toLowerCase();
    const statusLower = status.toLowerCase();
    const locationShown = !!location && (statusLower.includes(location.toLowerCase()) || (city.length > 2 && statusLower.includes(city)));
    const parts = copy.rest.filter((c) => !(locationShown && (isLocation(c, location) || onlyPlaceWords(c, location))));
    const company = d.company?.trim() ?? '';
    const bioKey = keyOf(d.bio ?? '');
    if (company && !` ${bioKey} `.includes(` ${keyOf(company)} `)) parts.push(`Currently at ${company}.`);
    if (location && !locationShown && !parts.some((c) => isLocation(c, location))) parts.push(`Based in ${location}.`);
    const text = joinClauses(parts);
    tagline = wrapPx(text || `Building in public on GitHub since ${factsFrom(d, name, ctx.now, copy).since}.`, colW, 17, {}, 2);
  }
  const chips = o.has('chips') ? o.list('chips', []) : languageNames(d, 6);
  return { name, role, copy, tagline, chips: chips.slice(0, 12), status };
}

/** Largest name size (76 → 48) that fits, then truncate. */
function nameFit(name: string, maxW: number): { text: string; size: number } {
  const width = (s: string, size: number) => textWidth(s, size, { weight: 800 }) - size * 0.033 * Math.max(0, [...s].length - 1);
  for (let size = 76; size >= 48; size -= 2) if (width(name, size) <= maxW) return { text: name, size };
  return { text: fitWords(name, maxW, 48, { weight: 800 }), size: 48 };
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** Small dots need a little more contrast than large shapes to read. */
const DOT_CONTRAST = 2.2;

/** A brand or language colour for a small dot on `bg`, sanitised and kept visible. */
function dotColor(color: string | undefined, bg: string, p: Palette): string {
  return ensureContrast(safeColor(color, p.accentB), bg, DOT_CONTRAST, p.text);
}

function chipRow(chips: string[], x0: number, y: number, maxX: number, ctx: RenderContext): string {
  const p = ctx.palette;
  const out: string[] = [];
  let x = x0;
  chips.forEach((chip, i) => {
    const text = fit(chip, 220, 13, { mono: true });
    const icon = resolveIcon(chip);
    const key = chip.trim().toLowerCase();
    const lang = ctx.data.languages.find((l) => l.name.toLowerCase() === key || displayName(l.name).toLowerCase() === key);
    const w = Math.ceil(12 + 14 + 8 + textWidth(text, 13, { mono: true }) + 14);
    if (x + w > maxX) return;
    // Logos, and the monogram tiles of brands without one (C#, Java, PowerShell),
    // match the stack card; anything unknown gets a dot in its language colour.
    const glyph = icon.path
      ? drawIcon(icon, x + 12, y + 8, 14, { color: legible(icon.hex, p.chipBg, p.text), inks: [p.panel, p.text] })
      : icon.monogram && icon.known
        ? drawIcon(icon, x + 11, y + 7, 16, { color: legible(icon.hex, p.chipBg, p.text), inks: [p.panel, p.text] })
        : `<circle cx="${n(x + 19, 2)}" cy="${y + 15}" r="4.5" fill="${dotColor(icon.hex || lang?.color, p.chipBg, p)}"/>`;
    out.push(
      `<g class="up" ${delay(0.55 + i * 0.07)}>` +
        `<rect x="${n(x, 2)}" y="${y}" width="${w}" height="30" rx="15" fill="${p.chipBg}" stroke="${p.border}"/>${glyph}` +
        `<text x="${n(x + 34, 2)}" y="${y + 19.5}" class="mono" font-size="13" fill="${p.text}">${esc(text)}</text></g>`,
    );
    x += w + 10;
  });
  return out.join('');
}

function textColumn(c: Content, colW: number, ctx: RenderContext, statusColor: string): string {
  const p = ctx.palette;
  const name = nameFit(c.name, colW);
  const role = fitWords(c.role, colW, 25, { weight: 600 });
  const tagline = c.tagline.map((l) => fit(l, colW, 17));
  const blocks: { h: number; gap: number; draw: (top: number) => string }[] = [];
  if (c.status) {
    const text = fit(c.status, colW - 22, 14, { mono: true });
    blocks.push({
      h: 19,
      gap: 22,
      draw: (top) =>
        `<g class="up" ${delay(0.05)}>` +
        `<circle class="h-ring" cx="${X0 + 6}" cy="${top + 9}" r="4" fill="none" stroke="${statusColor}" stroke-width="1.5"/>` +
        `<circle class="h-pulse" cx="${X0 + 6}" cy="${top + 9}" r="4" fill="${statusColor}"/>` +
        `<text x="${X0 + 20}" y="${top + 14}" class="mono" font-size="14" fill="${p.muted}">${esc(text)}</text></g>`,
    });
  }
  blocks.push({
    h: name.size,
    gap: 10,
    draw: (top) =>
      `<text class="sans up" ${delay(0.15)} x="${X0 - 2}" y="${n(top + name.size * 0.8)}" font-size="${name.size}" font-weight="800" letter-spacing="${n(-name.size * 0.033, 2)}" fill="url(#h-accent)">${esc(name.text)}</text>`,
  });
  blocks.push({
    h: 29,
    gap: 16,
    draw: (top) =>
      `<text class="sans up" ${delay(0.28)} x="${X0}" y="${top + 22}" font-size="25" font-weight="600" letter-spacing="-.3" fill="${p.text}">${esc(role)}</text>`,
  });
  if (tagline.length) {
    blocks.push({
      h: 22 + 26 * (tagline.length - 1),
      gap: 20,
      draw: (top) =>
        `<g class="up" ${delay(0.4)}>${tagline
          .map((l, i) => `<text x="${X0}" y="${top + 16 + i * 26}" class="sans" font-size="17" fill="${p.muted}">${esc(l)}</text>`)
          .join('')}</g>`,
    });
  }
  const chips = c.chips.length ? (top: number) => chipRow(c.chips, X0, top, X0 + colW, ctx) : null;
  if (chips) blocks.push({ h: 30, gap: 0, draw: chips });
  const last = blocks[blocks.length - 1];
  if (last) last.gap = 0;
  const total = blocks.reduce((s, b) => s + b.h + b.gap, 0);
  let top = Math.round(H / 2 - total / 2 + 2);
  return blocks
    .map((b) => {
      const out = b.draw(top);
      top += b.h + b.gap;
      return out;
    })
    .join('');
}

const PANEL = { x: 700, y: 52, w: 452, h: 300 };
/** Text column width when the code panel is shown. */
const CODE_COL_W = PANEL.x - 40 - X0;
const CODE_SIZE = 14.5;
const CHAR_W = CODE_SIZE * 0.6;
const CODE_X = PANEL.x + 50;
export const MAX_CODE_CHARS = Math.floor((PANEL.x + PANEL.w - 18 - CODE_X) / CHAR_W);

function codePanel(lines: string[], lang: CodeLanguage, file: string, ctx: RenderContext): string {
  const p = ctx.palette;
  const s = p.syntax;
  const color = (k: TokenKind) => (k === 'plain' ? p.text : s[k]);
  const { x, y, w, h } = PANEL;
  const lineH = 24;
  const firstBase = y + 44 + (h - 44 - lines.length * lineH) / 2 + 17;
  const body = lines
    .map((line, i) => {
      const by = n(firstBase + i * lineH);
      const num = `<text x="${x + 34}" y="${by}" text-anchor="end" class="mono" font-size="12" fill="${p.faint}" fill-opacity=".7">${i + 1}</text>`;
      if (!line.trim()) return num;
      // Each line starts at the code column and keeps its spaces as written
      // (xml:space="preserve"), so indentation and the gaps between tokens follow
      // whatever monospace font the viewer has instead of an assumed glyph width.
      const spans = tokenize(line, lang).map((t) => (t.kind === 'plain' ? esc(t.text) : `<tspan fill="${color(t.kind)}">${esc(t.text)}</tspan>`));
      // The cursor is a block glyph ending the last line, so it always sits right after the text.
      if (i === lines.length - 1) spans.push(`<tspan class="h-cur" dx="2" fill="${p.accentB}">\u2588</tspan>`);
      return (
        num +
        `<text class="mono h-code h-type" ${delay(0.55 + i * 0.3)} x="${CODE_X}" y="${by}" font-size="${CODE_SIZE}" fill="${p.text}" xml:space="preserve">${spans.join('')}</text>`
      );
    })
    .join('');
  const fileIcon = resolveIcon(FILE_ICONS[lang]);
  const fileName = fit(file, w - 160, 12.5, { mono: true });
  const fw = textWidth(fileName, 12.5, { mono: true });
  const fx = x + w / 2 - (fw + 20) / 2;
  const glyph = fileIcon.path
    ? drawIcon(fileIcon, fx, y + 15, 13, { color: legible(fileIcon.hex, p.panelAlt, p.text), inks: [p.panel, p.text] })
    : fileIcon.monogram && fileIcon.known
      ? drawIcon(fileIcon, fx - 1, y + 14, 15, { color: legible(fileIcon.hex, p.panelAlt, p.text), inks: [p.panel, p.text] })
      : `<circle cx="${n(fx + 6.5, 2)}" cy="${y + 21.5}" r="4" fill="${dotColor(fileIcon.hex, p.panelAlt, p)}"/>`;
  return (
    `<g class="up" ${delay(0.3)}>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${p.panel}" fill-opacity=".86" stroke="${p.border}"/>` +
    `<path d="M${x} ${y + 16}a16 16 0 0 1 16-16h${w - 32}a16 16 0 0 1 16 16v28H${x}z" fill="${p.panelAlt}" fill-opacity=".92"/>` +
    `<circle cx="${x + 22}" cy="${y + 22}" r="5.5" fill="#FF5F57"/><circle cx="${x + 40}" cy="${y + 22}" r="5.5" fill="#FEBC2E"/><circle cx="${x + 58}" cy="${y + 22}" r="5.5" fill="#28C840"/>` +
    glyph +
    `<text x="${n(fx + 20, 2)}" y="${y + 26}" class="mono" font-size="12.5" fill="${p.muted}">${esc(fileName)}</text>` +
    `<line x1="${x}" y1="${y + 44}" x2="${x + w}" y2="${y + 44}" stroke="${p.border}"/>` +
    body +
    '</g>'
  );
}

/** Right-hand decoration when the code panel is off: recent activity as a small heatmap. */
function activity(ctx: RenderContext): string {
  const p = ctx.palette;
  const ramp = contribRamp(p, ctx.mode);
  const weeks = 18;
  const cell = 15;
  const gap = 4;
  const gw = weeks * (cell + gap) - gap;
  const gh = 7 * (cell + gap) - gap;
  const x0 = 1140 - gw;
  const y0 = Math.round(H / 2 - gh / 2) + 4;
  const cells = yearWindow(ctx.data.calendar, ctx.now, weeks);
  const total = cells.reduce((s, c) => s + c.count, 0);
  const level = levelScale(cells.map((c) => c.count));
  const empty = total === 0;
  const rects = cells
    .map((c) => {
      // No data yet: a soft decorative ramp instead of a blank grid.
      const lv = empty ? Math.max(0, Math.min(4, Math.round((c.week / (weeks - 1)) * 4.6 - Math.abs(c.day - 3) * 0.45))) : level(c.count);
      const x = x0 + c.week * (cell + gap);
      const y = y0 + c.day * (cell + gap);
      return `<rect class="h-cell" ${delay(0.5 + c.week * 0.03 + c.day * 0.02)} x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3.5" fill="${ramp[lv]}"${empty ? ' fill-opacity=".45"' : ''}/>`;
    })
    .join('');
  const { current } = streaks(ctx.data.calendar, ctx.now);
  const caption = empty
    ? 'Your first contribution lights this up'
    : `${compact(total)} ${plural(total, 'contribution')}${current > 1 ? ` · ${current}-day streak` : ''}`;
  // Legend, right-aligned: "less ▪▪▪▪▪ more".
  const right = x0 + gw;
  const squaresEnd = right - textWidth('more', 11, { mono: true }) - 7;
  const squaresStart = squaresEnd - (5 * 11 + 4 * 3);
  const legend = ramp
    .map((c, i) => `<rect x="${n(squaresStart + i * 14, 2)}" y="${y0 - 31}" width="11" height="11" rx="2.5" fill="${c}"/>`)
    .join('');
  return (
    `<g class="fade" ${delay(0.35)}>${label(x0, y0 - 21, `Last ${weeks} weeks`, p)}` +
    `<text x="${n(squaresStart - 7, 2)}" y="${y0 - 21.5}" text-anchor="end" class="mono" font-size="11" fill="${p.muted}">less</text>${legend}` +
    `<text x="${right}" y="${y0 - 21.5}" text-anchor="end" class="mono" font-size="11" fill="${p.muted}">more</text></g>` +
    rects +
    `<text class="mono fade" ${delay(0.9)} x="${x0}" y="${y0 + gh + 30}" font-size="13" fill="${p.muted}">${esc(caption)}</text>`
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

const TOKENS = ['accentA', 'accentB', 'success', 'text', 'muted'] as const;

function statusColorOf(value: string | undefined, p: Palette): string {
  if (!value) return p.success;
  const v = value.trim();
  if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v.startsWith('#') ? v : `#${v}`;
  const token = TOKENS.find((t) => t.toLowerCase() === v.toLowerCase());
  return token ? p[token] : p.success;
}

export const card: CardDefinition = {
  id: 'hero',
  title: 'Hero banner',
  description:
    'An animated banner: status line, gradient name, role, tagline, tech chips and a code editor that types out a snippet about you in your top language.',
  options: [
    { key: 'name', type: 'string', default: 'profile name or login', description: 'Big gradient headline.' },
    { key: 'role', type: 'string', default: 'first sentence of your bio, or "Developer"', description: 'Line under the name.' },
    { key: 'tagline', type: 'list', default: 'rest of your bio, company and location', description: 'One string (wrapped to two lines) or a list of up to two lines.' },
    { key: 'chips', type: 'list', default: 'top languages', description: 'Small pills under the tagline; known technologies get their logo.' },
    { key: 'status', type: 'string', default: '"open to collaboration · <location>"', description: 'Status line with a pulsing dot; "none" hides it.' },
    { key: 'statusColor', type: 'string', default: 'palette success', description: 'Dot colour: hex (#3FB950) or a palette token (accentA, accentB, success).' },
    { key: 'code', type: 'string', default: 'auto', description: '"auto" writes a snippet from your profile, "none" hides the editor, any other text is shown as code (max 9 lines).' },
    { key: 'codeLanguage', type: 'string', default: 'top language', description: `Highlighting and snippet language: ${CODE_LANGUAGES.join(', ')}.` },
    { key: 'codeFile', type: 'string', default: 'per language (Program.cs, profile.ts, me.py…)', description: 'File name in the editor title bar.' },
  ],
  render(ctx) {
    const p = ctx.palette;
    const o = readOptions(ctx.options);
    const codeOpt = o.string('code', 'auto');
    const showCode = !/^(none|false|off|hide)$/i.test(codeOpt.trim());
    const colW = showCode ? CODE_COL_W : 740 - X0;
    const c = content(ctx, colW);
    const langOpt = o.optionalString('codeLanguage');
    const lang = (langOpt && langOpt.toLowerCase() !== 'auto' && codeLanguageOf(langOpt)) || detectLanguage(ctx.data);
    const file = o.string('codeFile', FILES[lang]);
    const lines = !showCode
      ? []
      : codeOpt.trim().toLowerCase() === 'auto'
        ? autoCode(factsFrom(ctx.data, c.name, ctx.now, c.copy), lang, MAX_CODE_CHARS)
        : customCode(codeOpt, MAX_CODE_CHARS);
    const statusColor = statusColorOf(o.optionalString('statusColor'), p);

    const defs =
      linearGradient('h-accent', p.accentA, p.accentB) +
      `<radialGradient id="h-orbA"><stop offset="0" stop-color="${p.accentA}" stop-opacity="${n(p.glowOpacity, 3)}"/><stop offset="1" stop-color="${p.accentA}" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="h-orbB"><stop offset="0" stop-color="${p.accentB}" stop-opacity="${n(p.glowOpacity, 3)}"/><stop offset="1" stop-color="${p.accentB}" stop-opacity="0"/></radialGradient>` +
      `<pattern id="h-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="${p.grid}" stroke-opacity="${n(p.gridOpacity, 3)}"/></pattern>` +
      '<radialGradient id="h-fade" cx="0.3" cy="0.35" r="0.85"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      `<mask id="h-mask"><rect width="${W}" height="${H}" fill="url(#h-fade)"/></mask>`;
    const style =
      '.h-orbA{animation:h-driftA 16s ease-in-out infinite alternate}.h-orbB{animation:h-driftB 19s ease-in-out infinite alternate}' +
      '@keyframes h-driftA{to{transform:translate(140px,50px)}}@keyframes h-driftB{to{transform:translate(-160px,-40px)}}' +
      '.h-scan{opacity:.5;animation:h-scan 6s ease-in-out infinite}@keyframes h-scan{0%,100%{opacity:0}50%{opacity:.9}}' +
      '.h-pulse{animation:h-pulse 2.4s ease-in-out infinite}@keyframes h-pulse{50%{opacity:.35}}' +
      '.h-ring{opacity:0;transform-box:fill-box;transform-origin:center;animation:h-ring 2.4s ease-out infinite}' +
      '@keyframes h-ring{0%{opacity:.6;transform:scale(1)}100%{opacity:0;transform:scale(2.8)}}' +
      '.h-type{animation:h-type .5s steps(20,end) backwards}@keyframes h-type{from{clip-path:inset(0 100% 0 0)}}' +
      '.h-code{font-variant-ligatures:none;white-space:pre}.h-cur{animation:h-blink 1.1s steps(1) infinite}@keyframes h-blink{50%{fill-opacity:0}}' +
      '.h-cell{transform-box:fill-box;transform-origin:center;animation:h-cell .45s ease-out backwards}@keyframes h-cell{from{opacity:0;transform:scale(.3)}}';
    const background =
      '<g clip-path="url(#ps-clip)">' +
      `<rect width="${W}" height="${H}" fill="${p.bg}"/>` +
      `<rect width="${W}" height="${H}" fill="url(#h-grid)" mask="url(#h-mask)"/>` +
      '<circle class="h-orbA" cx="180" cy="40" r="320" fill="url(#h-orbA)"/>' +
      '<circle class="h-orbB" cx="1060" cy="380" r="340" fill="url(#h-orbB)"/>' +
      `<rect class="h-scan" width="${W}" height="2" fill="url(#h-accent)"/>` +
      '</g>';
    const body =
      background +
      textColumn(c, colW, ctx, statusColor) +
      (showCode ? codePanel(lines.length ? lines : ['// hello, world'], lang, file, ctx) : activity(ctx));
    const title = `${c.name} — ${c.role}`;
    return [
      {
        name: 'hero',
        alt: title,
        layout: 'full',
        svg: shell({
          width: W,
          height: H,
          palette: p,
          title,
          desc: [c.status, ...c.tagline].filter(Boolean).join(' '),
          defs,
          style,
          body,
          background: false,
          radius: 20,
          animate: ctx.animate,
        }),
      },
    ];
  },
};
