import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import pkg from '../package.json' with { type: 'json' };
import { ConfigError, parseConfigJson, resolveConfig, suggest, type RawInputs } from './action/config.ts';
import { formatBytes, loadConfigText, writeFiles } from './action/io.ts';
import { wrapWithMarkers } from './action/readme.ts';
import { CARDS } from './cards/registry.ts';
import { DEMO_NOW, demoProfile } from './core/fixtures.ts';
import { compact } from './core/format.ts';
import { fetchProfile, GitHubError } from './core/github.ts';
import { DEFAULT_THEME, getTheme, themeList } from './core/themes.ts';
import { CARD_IDS, type ProfileData } from './core/types.ts';
import { readmeMarkup, renderCards } from './render.ts';

/**
 * profilescape CLI: render cards locally, with real data (token) or the
 * built-in demo profile (no token, no network).
 */

const SNIPPET_FILE = 'README-snippet.md';

const env = process.env;
const useColor = env.FORCE_COLOR ? env.FORCE_COLOR !== '0' : Boolean(process.stdout.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb';
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');

function swatch(hex: string): string {
  if (!useColor) return '';
  const v = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (Number.isNaN(v)) return '';
  return `\x1b[48;2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}m  \x1b[0m`;
}

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);

/** Word-wrap plain text to the terminal width with a hanging indent. */
function wrapText(text: string, indent: number, first = indent): string {
  const width = Math.max(60, Math.min(process.stdout.columns || 100, 120));
  const lines: string[] = [];
  let line = '';
  let room = width - first;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > room) {
      lines.push(line);
      line = word;
      room = width - indent;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join(`\n${' '.repeat(indent)}`);
}

const HELP = `
${bold('profilescape')} ${dim(`v${pkg.version}`)}  Beautiful, self-hosted GitHub profile cards.

${bold('Usage')}
  profilescape --user <login> [options]     render your cards (needs a token)
  profilescape --demo [options]             render the demo profile, no token needed

${bold('Data')}
  -u, --user <login>          GitHub username (also accepted as the first argument)
  -t, --token <token>         GitHub token; defaults to $GH_TOKEN or $GITHUB_TOKEN
      --demo                  Use built-in demo data instead of the GitHub API
      --history <full|year>   Contribution history to fetch (default: full)
      --no-private            Leave out private repositories
      --hide-languages <list> Languages to hide, e.g. "HTML,CSS"
      --exclude-repos <list>  Repositories to ignore, e.g. "dotfiles,old-site"
      --repos <list>          Repositories for repo cards ("name" or "owner/name")

${bold('Cards')}
  -c, --cards <list>          Cards to render (default: stats,3d,languages,repos; "all" for every card)
      --theme <id>            Theme (default: ${DEFAULT_THEME}); see --list-themes
  -m, --modes <list>          dark, light or dark,light (default: dark,light)
      --config <file.json>    Config file: theme colours, per-card options and more
      --no-animate            Render static SVGs

${bold('Output')}
  -o, --out <dir>             Output directory (default: ./profilescape)
      --base-url <url>        Image URL prefix used in ${SNIPPET_FILE} (default: the output directory)

${bold('Info')}
      --list-themes           Show available themes
      --list-cards            Show available cards and their options
  -h, --help                  Show this help
  -v, --version               Show the version

${bold('Examples')}
  ${dim('# Try every card without a token')}
  profilescape --demo --cards all --theme ${DEFAULT_THEME}

  ${dim('# Your own profile, using the GitHub CLI for a token')}
  GH_TOKEN=$(gh auth token) profilescape --user octocat --out profilescape

  ${dim('# Run without installing')}
  npx github:chethandvg/profilescape --demo

Docs: ${pkg.homepage}
`;

const OPTIONS = {
  user: { type: 'string', short: 'u' },
  token: { type: 'string', short: 't' },
  demo: { type: 'boolean' },
  history: { type: 'string' },
  'no-private': { type: 'boolean' },
  'hide-languages': { type: 'string' },
  'exclude-repos': { type: 'string' },
  repos: { type: 'string' },
  cards: { type: 'string', short: 'c' },
  theme: { type: 'string' },
  modes: { type: 'string', short: 'm' },
  config: { type: 'string' },
  'no-animate': { type: 'boolean' },
  out: { type: 'string', short: 'o' },
  'base-url': { type: 'string' },
  'list-themes': { type: 'boolean' },
  'list-cards': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

class UsageError extends Error {}

function parse(argv: string[]) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    const message = (e as Error).message;
    const flag = /'(-{1,2}[^']+)'/.exec(message)?.[1];
    const name = flag?.replace(/^-+/, '').split('=')[0];
    const near = name ? suggest(name, Object.keys(OPTIONS)) : undefined;
    throw new UsageError(`${message.split('. ')[0]}${near ? ` (did you mean --${near}?)` : ''}.`);
  }
}

function listThemes(): void {
  out(bold('Themes'));
  const themes = themeList();
  const width = Math.max(...themes.map((t) => t.id.length));
  for (const t of themes) {
    const theme = getTheme(t.id);
    const chips = [theme.dark.accentA, theme.dark.accentB, theme.light.accentA, theme.light.accentB].map(swatch).join('');
    const isDefault = t.id === DEFAULT_THEME ? dim('  (default)') : '';
    out(`  ${cyan(t.id.padEnd(width))}  ${chips}${chips ? ' ' : ''}${t.label}${isDefault}`);
  }
  out();
  out(dim('Use --theme <id>, or tweak any colour with "colors", "darkColors" and "lightColors" in a --config file.'));
}

function listCards(): void {
  out(bold('Cards'));
  const width = Math.max(...CARD_IDS.map((id) => id.length));
  for (const id of CARD_IDS) {
    const card = CARDS[id];
    const pad = width + 4;
    out(`  ${cyan(id.padEnd(width))}  ${bold(card.title)}`);
    if (card.description && card.description !== 'TODO') out(`${' '.repeat(pad)}${dim(wrapText(card.description, pad))}`);
    for (const o of card.options) {
      const def = o.default === undefined ? '' : ` = ${JSON.stringify(o.default)}`;
      out(`${' '.repeat(pad)}${o.key} ${dim(`<${o.type}>${def}`)}`);
      out(`${' '.repeat(pad + 2)}${dim(wrapText(o.description, pad + 2))}`);
    }
    out();
  }
  out(dim('Set card options in a --config file: { "options": { "repos": { "layout": "detail" } } }'));
}

function friendly(e: unknown): string {
  if (e instanceof GitHubError) {
    if (e.status === 401) return `${e.message}\nTip: GH_TOKEN=$(gh auth token) profilescape --user <login>`;
    if (e.status === 404) return `${e.message}\nCheck the --user value.`;
    return e.message;
  }
  if (e instanceof ConfigError || e instanceof UsageError) return e.message;
  const error = e as Error;
  return error?.message ?? String(e);
}

async function main(argv: string[]): Promise<number> {
  const { values: v, positionals } = parse(argv);
  if (v.help) {
    out(HELP);
    return 0;
  }
  if (v.version) {
    out(pkg.version);
    return 0;
  }
  if (v['list-themes'] || v['list-cards']) {
    if (v['list-themes']) listThemes();
    if (v['list-themes'] && v['list-cards']) out();
    if (v['list-cards']) listCards();
    return 0;
  }
  if (positionals.length > 1) throw new UsageError(`Unexpected arguments: ${positionals.slice(1).join(' ')}`);
  if (positionals[0] && v.user) throw new UsageError('Pass the username either as an argument or with --user, not both.');

  const demo = Boolean(v.demo);
  const user = v.user ?? positionals[0] ?? '';
  if (!demo && !user) {
    throw new UsageError(`Missing --user <login>. Try ${cyan('profilescape --demo')} to render the demo profile without a token.`);
  }

  const inputs: RawInputs = {
    username: demo ? '' : user,
    cards: v.cards,
    theme: v.theme,
    modes: v.modes,
    animate: v['no-animate'] ? 'false' : undefined,
    history: v.history,
    include_private: v['no-private'] ? 'false' : undefined,
    hide_languages: v['hide-languages'],
    exclude_repos: v['exclude-repos'],
    repos: v.repos,
    output_dir: v.out,
    publish: 'none',
  };
  const loaded = v.config ? loadConfigText(v.config, process.cwd()) : null;
  const json = loaded ? parseConfigJson(loaded.text, loaded.source) : undefined;
  const { config, settings, warnings } = resolveConfig(inputs, json, {
    requireUsername: !demo,
    inputLabel: (name) => `--${name === 'output_dir' ? 'out' : name.replace(/_/g, '-')}`,
  });
  for (const w of warnings) err(`${yellow('warning')} ${w}`);
  if (demo && user) err(`${yellow('warning')} --demo renders the demo profile; ignoring user "${user}".`);

  let data: ProfileData;
  let now: Date;
  if (demo) {
    now = DEMO_NOW;
    data = demoProfile(now);
  } else {
    const token = (v.token ?? env.GH_TOKEN ?? env.GITHUB_TOKEN ?? '').trim();
    if (!token) {
      throw new UsageError(
        `No GitHub token. Pass --token, or set GH_TOKEN, e.g.\n  GH_TOKEN=$(gh auth token) profilescape --user ${config.username}\nOr try ${cyan('profilescape --demo')}.`,
      );
    }
    now = new Date();
    out(dim(`Fetching @${config.username} from GitHub${settings.history === 'full' ? ' (full history)' : ''}...`));
    data = await fetchProfile({
      token,
      login: config.username,
      history: settings.history,
      includePrivate: config.includePrivate,
      hideLanguages: config.hideLanguages,
      excludeRepos: config.excludeRepos,
      extraRepos: config.repos,
      now,
      log: (m) => out(dim(m)),
    });
    out(dim(`@${data.login}: ${compact(data.year.contributions)} contributions in the last year, ${data.repos.length} repositories.`));
  }

  const files = renderCards({
    data,
    cards: config.cards,
    theme: config.theme,
    colors: config.colors,
    darkColors: config.darkColors,
    lightColors: config.lightColors,
    modes: config.modes,
    options: config.options,
    animate: config.animate,
    now,
  });

  const outDir = resolve(settings.outputDir);
  const rel = relative(process.cwd(), outDir).split('\\').join('/');
  const baseUrl = v['base-url']?.trim() || (rel && !rel.startsWith('..') ? rel : outDir.split('\\').join('/'));
  const snippet = `${wrapWithMarkers(readmeMarkup(files, baseUrl))}\n`;
  writeFiles(outDir, [...files.map((f) => ({ path: f.path, content: f.svg })), { path: SNIPPET_FILE, content: snippet }]);

  const shown = rel && !rel.startsWith('..') ? rel : outDir;
  out();
  out(`${green('Rendered')} ${bold(String(files.length))} SVGs for ${bold(`@${data.login}`)} ${dim(`(${getTheme(config.theme).label} theme${demo ? ', demo data' : ''})`)}`);
  const width = Math.max(...files.map((f) => f.path.length), SNIPPET_FILE.length);
  for (const f of files) out(`  ${f.path.padEnd(width)}  ${dim(formatBytes(Buffer.byteLength(f.svg)).padStart(9))}`);
  out(`  ${SNIPPET_FILE.padEnd(width)}  ${dim(formatBytes(Buffer.byteLength(snippet)).padStart(9))}`);
  out();
  out(`Saved to ${cyan(shown)}. Open an SVG in your browser, or paste ${cyan(`${shown}/${SNIPPET_FILE}`)} into your README.`);
  if (!v['base-url']) out(dim(`Tip: --base-url sets the image URL prefix in ${SNIPPET_FILE} (e.g. a raw.githubusercontent.com URL).`));
  return 0;
}

// Piping into `head` closes stdout early; that is not an error.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  err(`${red('error')} ${friendly(e)}`);
  const usage = e instanceof UsageError || e instanceof ConfigError;
  if (usage) err(dim('Run profilescape --help for usage.'));
  process.exitCode = usage ? 2 : 1;
}
