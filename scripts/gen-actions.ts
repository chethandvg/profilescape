import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CARD_IDS, type CardId } from '../src/core/types.ts';

/**
 * Generates the Action metadata for the umbrella repository and every
 * single-purpose mirror from actions/manifest.json:
 *
 *   action.yml                      umbrella action (this repository)
 *   mirrors/<repo>/action.yml       same inputs, that mirror's `cards` default
 *   mirrors/<repo>/README.md        Marketplace-facing README
 *
 *   node scripts/gen-actions.ts            write files (removes stale mirror files)
 *   node scripts/gen-actions.ts --check    exit 1 when committed files drifted (CI)
 *   node scripts/gen-actions.ts --matrix   JSON array of mirror repos (release workflow)
 *   node scripts/gen-actions.ts --repo-commands   gh commands that create/describe the repos
 *
 * Output is a pure function of the manifest, package.json's major version and
 * CARD_IDS, so it is byte-for-byte deterministic.
 */

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const MANIFEST_PATH = 'actions/manifest.json';
export const MIRRORS_DIR = 'mirrors';

// ------------------------------------------------------------------ model

export interface ActionEntry {
  /** Repository name under the owner, e.g. "profilescape-3d". */
  repo: string;
  /** Marketplace name (must be unique on the Marketplace). */
  name: string;
  /** Short label used in cross-links, e.g. "3D contribution graph". */
  short: string;
  /** Marketplace description, under 125 characters. */
  description: string;
  cards: CardId[];
  branding: { icon: string; color: string };
  /** Repository topics (lowercase, hyphenated). */
  keywords: string[];
  /** "What it does" paragraph for the README. */
  about: string;
  /** Dark preview file under docs/images/, e.g. "3d-dark.svg"; the light twin is derived. */
  preview: string;
}

export interface Manifest {
  owner: string;
  /** Repository that holds the source and the umbrella action. */
  umbrella: string;
  author: string;
  site: string;
  imagesBase: string;
  template: { repo: string; description: string };
  actions: ActionEntry[];
}

export interface InputSpec {
  name: string;
  default: string;
  description: string;
}

/**
 * The canonical Action inputs. src/action/config.ts implements exactly these;
 * the tests compare both lists. Backticks mark code in rendered docs.
 */
export function actionInputs(cardsDefault: readonly string[]): InputSpec[] {
  return [
    {
      name: 'username',
      default: '',
      description: 'GitHub username to render cards for. Empty uses the owner of the repository running the workflow.',
    },
    {
      name: 'token',
      default: '${{ github.token }}',
      description:
        'Token used to read profile data from the GitHub API. The default workflow token sees public activity; pass a personal access token (for example `${{ secrets.PROFILESCAPE_TOKEN }}`) to include private repositories and contributions.',
    },
    {
      name: 'cards',
      default: cardsDefault.join(','),
      description: `Comma-separated cards to render, in README order. Available: ${CARD_IDS.map((id) => `\`${id}\``).join(', ')}.`,
    },
    {
      name: 'theme',
      default: 'aurora',
      description: 'Colour theme id, for example `aurora`. Preview every theme in the playground at https://chethandvg.github.io/profilescape.',
    },
    {
      name: 'modes',
      default: 'dark,light',
      description:
        "Colour modes to render: `dark`, `light` or both. With both, the README markup follows each viewer's GitHub theme automatically.",
    },
    {
      name: 'animate',
      default: 'true',
      description: 'Add subtle CSS animations. Viewers who prefer reduced motion always get the static final frame.',
    },
    {
      name: 'history',
      default: 'full',
      description: 'Contribution history to fetch: `full` (every year since the account was created) or `year` (the last 12 months, faster).',
    },
    {
      name: 'hide_languages',
      default: '',
      description: 'Comma-separated languages to leave out of language statistics, for example `HTML,Jupyter Notebook`.',
    },
    {
      name: 'exclude_repos',
      default: '',
      description: 'Comma-separated repositories (`name` or `owner/name`) to ignore in every card.',
    },
    {
      name: 'include_private',
      default: 'true',
      description: 'Include private repositories the token can read in aggregated statistics. Set to `false` for public data only.',
    },
    {
      name: 'repos',
      default: '',
      description: 'Comma-separated repositories for repo cards (`name` or `owner/name`). Empty uses your pinned repositories, then your most starred.',
    },
    {
      name: 'config',
      default: '',
      description:
        'Optional JSON config with per-card options and colour overrides: a path relative to the repository root (requires `actions/checkout`) or inline JSON.',
    },
    {
      name: 'output_dir',
      default: 'profilescape',
      description: 'Workspace directory the SVG files and a ready-to-paste `README-snippet.md` are written to, for use by later steps.',
    },
    {
      name: 'publish',
      default: 'branch',
      description:
        'Where to publish the SVG files: `branch` commits them to the output branch (only when something changed), `none` only writes them to `output_dir`.',
    },
    {
      name: 'branch',
      default: 'profilescape-output',
      description: 'Branch that holds the published SVG files. Created on first run and kept to a single commit, so it never bloats your history.',
    },
    {
      name: 'commit_message',
      default: 'chore: update profilescape cards',
      description: 'Commit message for the output branch and README updates.',
    },
    {
      name: 'readme',
      default: '',
      description:
        'README to keep up to date, for example `README.md`. The cards are written between `<!-- profilescape:start -->` and `<!-- profilescape:end -->` markers. Empty leaves READMEs untouched.',
    },
    {
      name: 'github_token',
      default: '${{ github.token }}',
      description: 'Token used to push the output branch and README update to this repository. Needs `contents: write`.',
    },
  ];
}

export const ACTION_OUTPUTS: { name: string; description: string }[] = [
  { name: 'files', description: 'JSON array of the files written to `output_dir`, relative to the workspace: every SVG plus `README-snippet.md`.' },
  { name: 'markup', description: "Ready-to-paste README HTML for the rendered cards, switching between dark and light with the viewer's theme." },
  { name: 'base_url', description: 'Where the cards are served from: the raw URL of the output branch with `publish: branch`, otherwise `output_dir`.' },
];

// ------------------------------------------------------------- validation

/** Feather icons GitHub does not support in action branding. */
const UNSUPPORTED_ICONS = new Set([
  'coffee', 'columns', 'divide-circle', 'divide-square', 'divide', 'frown', 'hexagon', 'key', 'meh', 'mouse-pointer', 'smile', 'tool', 'x-octagon',
]);
export const BRANDING_COLORS = ['white', 'black', 'yellow', 'blue', 'green', 'orange', 'red', 'purple', 'gray-dark'] as const;

const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

/** Every problem in a parsed manifest, as human-readable messages. */
export function validateManifest(raw: unknown): string[] {
  const errors: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const str = (v: unknown, where: string, opts: { max?: number } = {}) => {
    if (typeof v !== 'string' || !v.trim()) errors.push(`${where} must be a non-empty string.`);
    else if (opts.max !== undefined && v.length > opts.max) errors.push(`${where} is ${v.length} characters; the limit is ${opts.max}.`);
  };
  if (!isObj(raw)) return ['The manifest must be a JSON object.'];
  str(raw.owner, 'owner');
  str(raw.umbrella, 'umbrella');
  str(raw.author, 'author');
  str(raw.site, 'site');
  str(raw.imagesBase, 'imagesBase');
  if (!isObj(raw.template)) errors.push('template must be an object with repo and description.');
  else {
    str(raw.template.repo, 'template.repo');
    str(raw.template.description, 'template.description', { max: 350 });
  }
  if (!Array.isArray(raw.actions) || raw.actions.length === 0) return [...errors, 'actions must be a non-empty array.'];

  const seenRepos = new Set<string>();
  const seenNames = new Set<string>();
  raw.actions.forEach((entry: unknown, i: number) => {
    const at = (key: string) => `actions[${i}]${isObj(entry) && typeof entry.repo === 'string' ? ` (${entry.repo})` : ''}.${key}`;
    if (!isObj(entry)) {
      errors.push(`actions[${i}] must be an object.`);
      return;
    }
    str(entry.repo, at('repo'));
    if (typeof entry.repo === 'string') {
      if (!REPO_RE.test(entry.repo)) errors.push(`${at('repo')} "${entry.repo}" is not a valid repository name.`);
      if (seenRepos.has(entry.repo)) errors.push(`${at('repo')} "${entry.repo}" is listed twice.`);
      seenRepos.add(entry.repo);
    }
    str(entry.name, at('name'));
    if (typeof entry.name === 'string') {
      const key = entry.name.toLowerCase();
      if (seenNames.has(key)) errors.push(`${at('name')} "${entry.name}" is used twice; Marketplace names must be unique.`);
      seenNames.add(key);
    }
    str(entry.short, at('short'));
    // GitHub Marketplace truncates descriptions longer than 125 characters.
    str(entry.description, at('description'), { max: 124 });
    str(entry.about, at('about'));
    if (!Array.isArray(entry.cards) || entry.cards.length === 0) errors.push(`${at('cards')} must be a non-empty array of card ids.`);
    else {
      for (const c of entry.cards) {
        if (!(CARD_IDS as readonly unknown[]).includes(c)) errors.push(`${at('cards')} has unknown card "${String(c)}" (valid: ${CARD_IDS.join(', ')}).`);
      }
      if (new Set(entry.cards).size !== entry.cards.length) errors.push(`${at('cards')} lists a card twice.`);
    }
    if (!isObj(entry.branding)) errors.push(`${at('branding')} must be an object with icon and color.`);
    else {
      const { icon, color } = entry.branding;
      if (typeof icon !== 'string' || !/^[a-z0-9-]+$/.test(icon) || UNSUPPORTED_ICONS.has(icon)) {
        errors.push(`${at('branding.icon')} "${String(icon)}" is not a Feather icon GitHub supports.`);
      }
      if (typeof color !== 'string' || !(BRANDING_COLORS as readonly string[]).includes(color)) {
        errors.push(`${at('branding.color')} "${String(color)}" must be one of ${BRANDING_COLORS.join(', ')}.`);
      }
    }
    if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) errors.push(`${at('keywords')} must be a non-empty array.`);
    else {
      if (entry.keywords.length > 20) errors.push(`${at('keywords')} has ${entry.keywords.length} topics; GitHub allows 20.`);
      for (const k of entry.keywords) {
        if (typeof k !== 'string' || !TOPIC_RE.test(k)) errors.push(`${at('keywords')} "${String(k)}" is not a valid GitHub topic (lowercase letters, digits, hyphens).`);
      }
      if (new Set(entry.keywords).size !== entry.keywords.length) errors.push(`${at('keywords')} lists a topic twice.`);
    }
    if (typeof entry.preview !== 'string' || !/^[a-z0-9][a-z0-9-]*-dark\.svg$/.test(entry.preview)) {
      errors.push(`${at('preview')} must be a file name under docs/images ending in "-dark.svg".`);
    }
  });
  if (typeof raw.umbrella === 'string' && !seenRepos.has(raw.umbrella)) errors.push(`actions must include the umbrella repository "${raw.umbrella}".`);
  if (isObj(raw.template) && typeof raw.template.repo === 'string' && seenRepos.has(raw.template.repo)) {
    errors.push('template.repo must not also be an action repository.');
  }
  return errors;
}

export function loadManifest(root = ROOT): Manifest {
  const path = join(root, MANIFEST_PATH);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${MANIFEST_PATH}: ${(err as Error).message}`);
  }
  const errors = validateManifest(raw);
  if (errors.length) throw new Error(`${MANIFEST_PATH} is invalid:\n  - ${errors.join('\n  - ')}`);
  return raw as Manifest;
}

/** "v1" for package.json version 1.x.y: the moving tag users reference. */
export function majorTag(root = ROOT): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
  const major = typeof pkg.version === 'string' ? /^(\d+)\./.exec(pkg.version)?.[1] : undefined;
  if (!major) throw new Error('package.json must have a semver "version".');
  return `v${major}`;
}

export const mirrorsOf = (m: Manifest) => m.actions.filter((a) => a.repo !== m.umbrella);
export const umbrellaOf = (m: Manifest) => m.actions.find((a) => a.repo === m.umbrella) as ActionEntry;

// ------------------------------------------------------------------- YAML

const RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i;

/** A YAML scalar: plain when unambiguous, otherwise double-quoted (JSON strings are valid YAML). */
export function yamlScalar(value: string): string {
  return /^[A-Za-z][A-Za-z0-9 ._/-]*$/.test(value) && !value.endsWith(' ') && !RESERVED.test(value) ? value : JSON.stringify(value);
}

function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  // Code spans stay on one line: `<!-- profilescape:start -->` must not be split.
  const words = text.match(/(?:`[^`]*`|[^\s`])+/g) ?? [];
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** `key: value` at `indent`, folding long text into a `>-` block so the file stays readable. */
function yamlField(key: string, value: string, indent: number, width = 100): string {
  const pad = ' '.repeat(indent);
  const inline = `${pad}${key}: ${yamlScalar(value)}`;
  if (inline.length <= width || /\n/.test(value)) return inline;
  const body = wrapWords(value, width - indent - 2).map((l) => `${pad}  ${l}`);
  return [`${pad}${key}: >-`, ...body].join('\n');
}

export function renderActionYml(entry: ActionEntry, m: Manifest): string {
  const umbrella = entry.repo === m.umbrella;
  const source = `https://github.com/${m.owner}/${m.umbrella}`;
  const header = umbrella
    ? ['# Generated by scripts/gen-actions.ts from actions/manifest.json. Do not edit by hand:', '# run `npm run gen:actions` after changing the manifest or the inputs.']
    : [
        `# ${entry.name}: a single-purpose build of Profilescape (${source}).`,
        '# Generated from actions/manifest.json there; issues and pull requests are welcome upstream.',
      ];
  const out: string[] = [
    ...header,
    yamlField('name', entry.name, 0),
    yamlField('description', entry.description, 0, Number.POSITIVE_INFINITY),
    yamlField('author', m.author, 0),
    'branding:',
    yamlField('icon', entry.branding.icon, 2),
    yamlField('color', entry.branding.color, 2),
    '',
    'inputs:',
  ];
  for (const input of actionInputs(entry.cards)) {
    out.push(`  ${input.name}:`, yamlField('description', input.description, 4), '    required: false', `    default: ${JSON.stringify(input.default)}`);
  }
  out.push('', 'outputs:');
  for (const output of ACTION_OUTPUTS) out.push(`  ${output.name}:`, yamlField('description', output.description, 4));
  out.push('', 'runs:', '  using: node24', '  main: dist/index.mjs', '');
  return out.join('\n');
}

// --------------------------------------------------------------- Markdown

/** Escape text for a Markdown table cell (code spans keep their content). */
const cell = (text: string) => text.replace(/\|/g, '\\|');
const code = (text: string) => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``);
const repoUrl = (m: Manifest, repo: string) => `https://github.com/${m.owner}/${repo}`;
const uses = (m: Manifest, entry: ActionEntry, tag: string) => `${m.owner}/${entry.repo}@${tag}`;

export function renderMirrorReadme(entry: ActionEntry, m: Manifest, tag: string): string {
  const upstream = repoUrl(m, m.umbrella);
  const umbrella = umbrellaOf(m);
  const dark = `${m.imagesBase}/${entry.preview}`;
  const light = `${m.imagesBase}/${entry.preview.replace(/-dark\.svg$/, '-light.svg')}`;
  const plural = entry.cards.length > 1;
  const cardList = entry.cards.map(code).join(', ');
  const step = (yaml: string[]) => yaml.map((l) => (l ? `   ${l}` : '')).join('\n');

  const workflow = [
    '```yaml',
    'name: Profilescape',
    '',
    'on:',
    '  schedule:',
    '    - cron: "0 3 * * *" # every day at 03:00 UTC',
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: write',
    '',
    'jobs:',
    '  cards:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    `      - uses: ${uses(m, entry, tag)}`,
    '        with:',
    '          readme: README.md',
    '```',
  ];

  const inputs = actionInputs(entry.cards).map(
    (i) => `| ${code(i.name)} | ${i.default === '' ? '_empty_' : code(i.default)} | ${cell(i.description)} |`,
  );
  const outputs = ACTION_OUTPUTS.map((o) => `| ${code(o.name)} | ${cell(o.description)} |`);
  const family = m.actions.map((a) => {
    const label = a.repo === entry.repo ? `**${a.name}** (this action)` : `[${a.name}](${repoUrl(m, a.repo)})`;
    const what = a.repo === m.umbrella ? `any card (default: ${a.cards.map(code).join(', ')})` : a.cards.map(code).join(', ');
    return `| ${label} | ${what} | ${code(uses(m, a, tag))} |`;
  });

  return [
    '<!--',
    `  Generated by scripts/gen-actions.ts in ${upstream}`,
    '  from actions/manifest.json. Edits made here are overwritten by the next release.',
    '-->',
    '',
    `# ${entry.name}`,
    '',
    `**${entry.description}**`,
    '',
    '<p align="center">',
    '  <picture>',
    `    <source media="(prefers-color-scheme: dark)" srcset="${dark}">`,
    `    <img alt="${entry.name} preview" src="${light}">`,
    '  </picture>',
    '</p>',
    '',
    '<p align="center">',
    '  <a href="#quickstart-60-seconds">Quickstart</a> ·',
    '  <a href="#inputs">Inputs</a> ·',
    `  <a href="${m.site}">Playground</a> ·`,
    `  <a href="${upstream}">Profilescape</a>`,
    '</p>',
    '',
    entry.about,
    '',
    '- **Your token, your data.** Runs inside your own workflow against the GitHub API: no shared servers, no rate limits, nothing to host.',
    "- **Dark and light.** Both variants are rendered, and the README markup switches with each viewer's GitHub theme.",
    '- **Always fresh.** A daily schedule re-renders your cards and only commits when something actually changed.',
    '- **Yours to theme.** Pick a built-in theme or override any colour with a small JSON config.',
    '',
    '## Quickstart (60 seconds)',
    '',
    `1. In your profile repository (the one named after your username, for example \`octocat/octocat\`), add these markers to \`README.md\` where the ${plural ? 'cards' : 'card'} should appear:`,
    '',
    step(['```md', '<!-- profilescape:start -->', '<!-- profilescape:end -->', '```']),
    '',
    '2. Create `.github/workflows/profilescape.yml`:',
    '',
    step(workflow),
    '',
    `3. Open the **Actions** tab, choose **Profilescape** and click **Run workflow**. Your ${plural ? 'cards appear' : 'card appears'} between the markers moments later and ${plural ? 'refresh' : 'refreshes'} every day.`,
    '',
    '> [!TIP]',
    `> Starting from scratch? [Create your profile from the template](${repoUrl(m, m.template.repo)}/generate) to get a ready-made README and workflow in one click.`,
    '',
    '### Include private contributions',
    '',
    `The default workflow token only sees public activity. To count private work, create a [personal access token](https://github.com/settings/personal-access-tokens/new) with read-only access to your repositories, save it as a repository secret named \`PROFILESCAPE_TOKEN\` and pass it as \`token\`:`,
    '',
    '```yaml',
    `      - uses: ${uses(m, entry, tag)}`,
    '        with:',
    '          token: ${{ secrets.PROFILESCAPE_TOKEN }}',
    '          readme: README.md',
    '```',
    '',
    '### Without a README update',
    '',
    `Leave \`readme\` empty and the SVG files are published to the \`profilescape-output\` branch only. The \`markup\` output holds ready-to-paste HTML, and the job summary shows it after every run.`,
    '',
    '## Inputs',
    '',
    `This action renders ${cardList} by default; every input below works exactly as in [Profilescape](${upstream}).`,
    '',
    '| Input | Default | Description |',
    '| --- | --- | --- |',
    ...inputs,
    '',
    '## Outputs',
    '',
    '| Output | Description |',
    '| --- | --- |',
    ...outputs,
    '',
    '## Part of Profilescape',
    '',
    `${entry.name} is one of a family of focused actions built from the same engine, so every card shares one design language and one set of themes. Mix and match them, or use [${umbrella.name}](${upstream}) to render any combination of cards in a single step.`,
    '',
    '| Action | Renders | Use it |',
    '| --- | --- | --- |',
    ...family,
    '',
    `Prefer clicking to configuring? Try every card and theme in the [playground](${m.site}), or start from the [profile template](${repoUrl(m, m.template.repo)}).`,
    '',
    '## Security',
    '',
    `Profilescape only reads data with \`token\`, and only writes to the repository running the workflow (the output branch and, if set, the README) with \`github_token\`. For extra supply-chain safety, pin the action to the full commit SHA of a release tag, for example \`${m.owner}/${entry.repo}@<commit-sha> # ${tag}.x.y\`. See the [security policy](${upstream}/blob/main/SECURITY.md).`,
    '',
    '## Support',
    '',
    `This repository is published automatically from [${m.owner}/${m.umbrella}](${upstream}), where the source code lives. Please [open issues](${upstream}/issues/new/choose) and [start discussions](${upstream}/discussions) there.`,
    '',
    '## License',
    '',
    `[MIT](LICENSE) © ${m.author}`,
    '',
  ].join('\n');
}

// --------------------------------------------------------------- generate

/** Every generated file, keyed by its repository-relative POSIX path. */
export function generate(m: Manifest, tag: string): Map<string, string> {
  const files = new Map<string, string>();
  files.set('action.yml', renderActionYml(umbrellaOf(m), m));
  for (const entry of mirrorsOf(m)) {
    files.set(`${MIRRORS_DIR}/${entry.repo}/action.yml`, renderActionYml(entry, m));
    files.set(`${MIRRORS_DIR}/${entry.repo}/README.md`, renderMirrorReadme(entry, m, tag));
  }
  return files;
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    return d.isDirectory() ? listFiles(path) : [path];
  });
}

const toPosix = (p: string) => p.split('\\').join('/');
const normalise = (text: string) => text.replace(/\r\n/g, '\n');

export interface Drift {
  path: string;
  problem: 'missing' | 'outdated' | 'stale';
}

/** Differences between the generated files and what is on disk under `root`. */
export function findDrift(files: Map<string, string>, root = ROOT): Drift[] {
  const drift: Drift[] = [];
  for (const [path, content] of files) {
    const abs = join(root, path);
    if (!existsSync(abs)) drift.push({ path, problem: 'missing' });
    else if (normalise(readFileSync(abs, 'utf8')) !== content) drift.push({ path, problem: 'outdated' });
  }
  for (const abs of listFiles(join(root, MIRRORS_DIR))) {
    const path = toPosix(relative(root, abs));
    if (!files.has(path)) drift.push({ path, problem: 'stale' });
  }
  return drift;
}

/** Shell-quote for the printed gh commands. */
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function repoCommands(m: Manifest): string {
  const lines = ['# One-time: create the mirror and template repositories (skip any that exist).'];
  for (const entry of mirrorsOf(m)) lines.push(`gh repo create ${m.owner}/${entry.repo} --public --description ${sh(entry.description)} --homepage ${sh(m.site)}`);
  lines.push(`gh repo create ${m.owner}/${m.template.repo} --public --description ${sh(m.template.description)} --homepage ${sh(m.site)}`);
  lines.push('', '# Safe to re-run: descriptions, topics, and issues routed to the umbrella repository.');
  for (const entry of m.actions) {
    const mirror = entry.repo !== m.umbrella;
    lines.push(
      `gh repo edit ${m.owner}/${entry.repo} --description ${sh(entry.description)} --homepage ${sh(m.site)} --add-topic ${entry.keywords.join(',')}` +
        (mirror ? ' --enable-issues=false --enable-wiki=false --enable-projects=false' : ''),
    );
  }
  const templateTopics = ['github-profile', 'profile-readme', 'readme-template', 'github-profile-template', 'profilescape'];
  lines.push(
    `gh repo edit ${m.owner}/${m.template.repo} --template --description ${sh(m.template.description)} --homepage ${sh(m.site)} --add-topic ${templateTopics.join(',')} --enable-wiki=false --enable-projects=false`,
  );
  return `${lines.join('\n')}\n`;
}

// -------------------------------------------------------------------- CLI

function main(): void {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      matrix: { type: 'boolean', default: false },
      'repo-commands': { type: 'boolean', default: false },
    },
  });
  const manifest = loadManifest();
  if (values.matrix) {
    process.stdout.write(`${JSON.stringify(mirrorsOf(manifest).map((e) => e.repo))}\n`);
    return;
  }
  if (values['repo-commands']) {
    process.stdout.write(repoCommands(manifest));
    return;
  }
  const files = generate(manifest, majorTag());
  const drift = findDrift(files);
  if (values.check) {
    if (!drift.length) {
      console.log(`gen-actions: ${files.size} generated files are up to date.`);
      return;
    }
    for (const d of drift) console.error(`  ${d.problem.padEnd(8)} ${d.path}`);
    console.error('gen-actions: generated files are out of date. Run "npm run gen:actions" and commit the result.');
    process.exitCode = 1;
    return;
  }
  for (const d of drift) {
    const abs = join(ROOT, d.path);
    if (d.problem === 'stale') {
      rmSync(abs);
      console.log(`removed  ${d.path}`);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, files.get(d.path) as string, 'utf8');
      console.log(`${d.problem === 'missing' ? 'created ' : 'updated '} ${d.path}`);
    }
  }
  // Drop mirror folders left empty by removed manifest entries.
  const mirrorsRoot = join(ROOT, MIRRORS_DIR);
  if (existsSync(mirrorsRoot)) {
    for (const d of readdirSync(mirrorsRoot, { withFileTypes: true })) {
      const dir = join(mirrorsRoot, d.name);
      if (d.isDirectory() && listFiles(dir).length === 0) rmSync(dir, { recursive: true });
    }
  }
  console.log(drift.length ? `gen-actions: ${drift.length} file(s) changed.` : `gen-actions: ${files.size} generated files already up to date.`);
}

/** True when run as a script (not imported by the tests). Windows paths compare case-insensitively. */
function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  const [a, b] = [resolve(process.argv[1]), fileURLToPath(import.meta.url)];
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isEntryPoint()) {
  try {
    main();
  } catch (err) {
    console.error(`gen-actions: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
