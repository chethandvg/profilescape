/**
 * Icon lookup shared by the hero, stack and socials cards.
 *
 * Logos come from Simple Icons (CC0-1.0, see icons.generated.ts). Brand names
 * and logos are trademarks of their respective owners. Brands that Simple
 * Icons does not ship (e.g. C#, Java, AWS, Azure, LinkedIn) render as a
 * monogram tile in the brand's colour, and anything unknown gets a neutral
 * monogram, so a requested icon is never broken or missing.
 */
import { own } from '../core/options.ts';
import { contrast, ensureContrast, esc, n } from '../core/svg.ts';
import { ICONS, type IconCategory } from './icons.generated.ts';

export interface Icon {
  /** Canonical slug, or the slugified input for unknown names. */
  slug: string;
  title: string;
  /** "#RRGGBB" brand colour, or "" when unknown (renderers substitute an accent). */
  hex: string;
  category: IconCategory | 'generic';
  /** Filled 24×24 logo path. */
  path?: string;
  /** Stroked 24×24 outline path (generic glyphs such as email or website). */
  stroke?: string;
  /** Monogram text used when no logo path is available. */
  monogram?: string;
  /** False when the input matched nothing (generic monogram fallback). */
  known: boolean;
}

/** Brands absent from Simple Icons (usually trademark removals): rendered as monogram tiles. */
const MONOGRAMS: Record<string, { title: string; hex: string; text: string; category: IconCategory }> = {
  csharp: { title: 'C#', hex: '68217A', text: 'C#', category: 'language' },
  java: { title: 'Java', hex: 'E76F00', text: 'Java', category: 'language' },
  powershell: { title: 'PowerShell', hex: '5391FE', text: '>_', category: 'language' },
  visualbasic: { title: 'Visual Basic', hex: '945DB7', text: 'VB', category: 'language' },
  amazonwebservices: { title: 'AWS', hex: 'FF9900', text: 'aws', category: 'cloud' },
  awslambda: { title: 'AWS Lambda', hex: 'FF9900', text: 'λ', category: 'cloud' },
  amazondynamodb: { title: 'DynamoDB', hex: '4053D6', text: 'DDB', category: 'data' },
  microsoftazure: { title: 'Azure', hex: '0078D4', text: 'Az', category: 'cloud' },
  azuredevops: { title: 'Azure DevOps', hex: '0078D7', text: 'AD', category: 'devops' },
  microsoft: { title: 'Microsoft', hex: '5E5E5E', text: 'MS', category: 'tool' },
  microsoftsqlserver: { title: 'SQL Server', hex: 'CC2927', text: 'SQL', category: 'data' },
  windows: { title: 'Windows', hex: '0078D4', text: 'Win', category: 'tool' },
  visualstudiocode: { title: 'VS Code', hex: '007ACC', text: 'VSC', category: 'tool' },
  visualstudio: { title: 'Visual Studio', hex: '5C2D91', text: 'VS', category: 'tool' },
  slack: { title: 'Slack', hex: '4A154B', text: '#', category: 'tool' },
  playwright: { title: 'Playwright', hex: '2EAD33', text: 'PW', category: 'tool' },
  openai: { title: 'OpenAI', hex: '10A37F', text: 'AI', category: 'ai' },
  oracle: { title: 'Oracle', hex: 'F80000', text: 'O', category: 'data' },
  heroku: { title: 'Heroku', hex: '430098', text: 'H', category: 'cloud' },
  ibm: { title: 'IBM', hex: '0F62FE', text: 'IBM', category: 'cloud' },
  twilio: { title: 'Twilio', hex: 'F22F46', text: 'Tw', category: 'cloud' },
  linkedin: { title: 'LinkedIn', hex: '0A66C2', text: 'in', category: 'social' },
  hackernews: { title: 'Hacker News', hex: 'FF6600', text: 'Y', category: 'social' },
  codepen: { title: 'CodePen', hex: '1E1F26', text: 'CP', category: 'social' },
};

/** Friendlier display names than Simple Icons' official titles. */
const TITLES: Record<string, string> = {
  gnubash: 'Bash',
  html5: 'HTML',
  gnuemacs: 'Emacs',
  intellijidea: 'IntelliJ IDEA',
  googlecloud: 'Google Cloud',
};

/** Generic outline glyphs (drawn for Profilescape, not brands). */
const GLYPHS: Record<string, { title: string; stroke: string }> = {
  email: {
    title: 'Email',
    stroke: 'M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5ZM3 6.8l9 6.4 9-6.4',
  },
  website: {
    title: 'Website',
    stroke:
      'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18ZM3.2 12h17.6M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9M12 3c-2.4 2.5-3.6 5.5-3.6 9s1.2 6.5 3.6 9',
  },
  link: {
    title: 'Link',
    stroke: 'M10 14a4.2 4.2 0 0 0 6 0l3.2-3.2a4.2 4.2 0 0 0-6-6L12 6M14 10a4.2 4.2 0 0 0-6 0l-3.2 3.2a4.2 4.2 0 0 0 6 6L12 18',
  },
};

/** Common spellings → canonical slug. Keys are already slugified. */
export const ALIASES: Readonly<Record<string, string>> = {
  // languages
  cs: 'csharp', csharpdotnet: 'csharp', js: 'javascript', ecmascript: 'javascript', ts: 'typescript',
  py: 'python', python3: 'python', golang: 'go', rs: 'rust', kt: 'kotlin', rb: 'ruby', cpp: 'cplusplus',
  cxx: 'cplusplus', fs: 'fsharp', ex: 'elixir', hs: 'haskell', vb: 'visualbasic', vbnet: 'visualbasic',
  jdk: 'java', bash: 'gnubash', shell: 'gnubash', sh: 'gnubash', zsh: 'gnubash', shellscript: 'gnubash',
  pwsh: 'powershell', html: 'html5', css3: 'css', scss: 'sass', md: 'markdown', tex: 'latex', wasm: 'webassembly',
  jupyternotebook: 'jupyter', ipynb: 'jupyter', vimscript: 'vim', viml: 'vim', emacslisp: 'gnuemacs',
  nix: 'nixos', hcl: 'terraform', dockerfile: 'docker', dockercompose: 'docker', vue: 'vuedotjs',
  // platforms & frameworks
  dotnetcore: 'dotnet', net: 'dotnet', netcore: 'dotnet', aspnet: 'dotnet', aspnetcore: 'dotnet',
  dotnetframework: 'dotnet', node: 'nodedotjs', nodejs: 'nodedotjs', next: 'nextdotjs', nextjs: 'nextdotjs',
  vuejs: 'vuedotjs', vue3: 'vuedotjs', nuxtjs: 'nuxt', nuxtdotjs: 'nuxt', solidjs: 'solid', threejs: 'threedotjs',
  three: 'threedotjs', d3js: 'd3', d3dotjs: 'd3', tailwind: 'tailwindcss', shadcn: 'shadcnui', rails: 'rubyonrails',
  ror: 'rubyonrails', reactjs: 'react', reactnative: 'react', angularjs: 'angular', sveltekit: 'svelte',
  nest: 'nestjs', springframework: 'spring', denojs: 'deno', bunjs: 'bun', expressjs: 'express',
  torch: 'pytorch', sklearn: 'scikitlearn', hf: 'huggingface', chatgpt: 'openai', gpt: 'openai',
  copilot: 'githubcopilot',
  // infrastructure & data
  k8s: 'kubernetes', kube: 'kubernetes', postgres: 'postgresql', pg: 'postgresql', psql: 'postgresql',
  mongo: 'mongodb', elastic: 'elasticsearch', kafka: 'apachekafka', aws: 'amazonwebservices',
  amazon: 'amazonwebservices', amazonaws: 'amazonwebservices', lambda: 'awslambda', dynamodb: 'amazondynamodb',
  azure: 'microsoftazure', msazure: 'microsoftazure', ado: 'azuredevops', spark: 'apachespark', airflow: 'apacheairflow', gcp: 'googlecloud', gcloud: 'googlecloud',
  googlecloudplatform: 'googlecloud', sqlserver: 'microsoftsqlserver', mssql: 'microsoftsqlserver',
  fly: 'flydotio', flyio: 'flydotio', gha: 'githubactions', actions: 'githubactions', gh: 'github',
  // tools & OS
  vscode: 'visualstudiocode', code: 'visualstudiocode', vs: 'visualstudio', win: 'windows',
  macos: 'apple', osx: 'apple', mac: 'apple', arch: 'archlinux', rpi: 'raspberrypi', raspberry: 'raspberrypi',
  nvim: 'neovim', emacs: 'gnuemacs', intellij: 'intellijidea', godot: 'godotengine', jetbrainsrider: 'rider',
  // social
  twitter: 'x', xdotcom: 'x', devto: 'devdotto', so: 'stackoverflow', yt: 'youtube', ig: 'instagram',
  insta: 'instagram', bsky: 'bluesky', bmc: 'buymeacoffee', sponsors: 'githubsponsors', hn: 'hackernews',
  li: 'linkedin', mail: 'email', site: 'website', web: 'website', blog: 'website', homepage: 'website',
  url: 'link',
};

/** Simple Icons' own slug rules: "Node.js" → "nodedotjs", "C#" → "csharp", "C++" → "cplusplus". */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/\./g, 'dot')
    .replace(/&/g, 'and')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]/g, '');
}

function canonical(input: string): string {
  const slug = slugify(input);
  return own(ALIASES, slug) ?? slug;
}

/** "Objective C" → "OC", "Assembly" → "As", "F#" → "F#". */
function monogramText(input: string): string {
  const clean = input.trim();
  if (!clean) return '?';
  if ([...clean].length <= 3) return clean.charAt(0).toUpperCase() + clean.slice(1);
  const words = clean.split(/[\s\-_/.]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length >= 2) return words.slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? '').join('');
  const chars = [...clean.replace(/[^\p{L}\p{N}]/gu, '')];
  if (!chars.length) return [...clean].slice(0, 2).join('');
  return (chars[0] ?? '').toUpperCase() + (chars[1] ?? '').toLowerCase();
}

/** Resolve any user-supplied name, alias or GitHub language name. Never throws. */
export function resolveIcon(input: string): Icon {
  const raw = String(input ?? '').trim();
  const slug = canonical(raw);
  const icon = own(ICONS, slug);
  if (icon) return { slug, title: own(TITLES, slug) ?? icon.title, hex: `#${icon.hex}`, category: icon.category, path: icon.path, known: true };
  const mono = own(MONOGRAMS, slug);
  if (mono) return { slug, title: mono.title, hex: `#${mono.hex}`, category: mono.category, monogram: mono.text, known: true };
  const glyph = own(GLYPHS, slug);
  if (glyph) return { slug, title: glyph.title, hex: '', category: 'generic', stroke: glyph.stroke, known: true };
  return { slug: slug || 'unknown', title: raw || 'Unknown', hex: '', category: 'generic', monogram: monogramText(raw), known: false };
}

export function isKnownIcon(input: string): boolean {
  return resolveIcon(input).known;
}

/** All embedded slugs plus the monogram brands, for docs and the playground picker. */
export function iconCatalog(): { slug: string; title: string; category: IconCategory; monogram: boolean }[] {
  return [
    ...Object.entries(ICONS).map(([slug, i]) => ({ slug, title: i.title, category: i.category, monogram: false })),
    ...Object.entries(MONOGRAMS).map(([slug, m]) => ({ slug, title: m.title, category: m.category, monogram: true })),
  ].sort((a, b) => a.slug.localeCompare(b.slug));
}

function saturation(c: string): number {
  const h = c.replace('#', '');
  const v = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) || 0);
  return (Math.max(...v) - Math.min(...v)) / 255;
}

/**
 * Brand colour adjusted until it reads against `bg`. Near-neutral brands
 * (black or white logos) switch to `ink` outright; coloured brands go through
 * the shared ensureContrast(), which keeps their hue.
 */
export function legible(color: string, bg: string, ink: string, base = 2.3): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return ink;
  const sat = saturation(color);
  // Saturated colours stay recognisable at lower luminance contrast (a yellow
  // JavaScript square still reads on white), so they are adjusted less.
  const min = Math.max(1.35, base - 1.1 * sat);
  if (contrast(color, bg) >= min) return color;
  if (sat < 0.14) return ink;
  return ensureContrast(color, bg, min, ink);
}

/** Text colour for a filled brand tile: whichever of the two candidates contrasts more. */
export function inkOn(fill: string, a: string, b: string): string {
  return contrast(fill, a) >= contrast(fill, b) ? a : b;
}

export interface DrawOptions {
  /** Logo/tile colour (already contrast-adjusted). */
  color: string;
  /** Candidate text colours for monogram tiles; the more legible one is used. */
  inks: [string, string];
  /** Extra attributes for the outermost element (e.g. a class). */
  attrs?: string;
}

/** Draw an icon into the square (x, y, size). */
export function drawIcon(icon: Icon, x: number, y: number, size: number, o: DrawOptions): string {
  const attrs = o.attrs ? ` ${o.attrs}` : '';
  const k = size / 24;
  const t = `translate(${n(x, 2)} ${n(y, 2)}) scale(${n(k, 4)})`;
  if (icon.path) return `<path${attrs} transform="${t}" fill="${o.color}" d="${icon.path}"/>`;
  if (icon.stroke) {
    return `<path${attrs} transform="${t}" fill="none" stroke="${o.color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="${icon.stroke}"/>`;
  }
  const text = icon.monogram ?? '?';
  const len = [...text].length;
  const fs = size * (len <= 1 ? 0.56 : len === 2 ? 0.44 : len === 3 ? 0.34 : 0.28);
  const ink = inkOn(o.color, o.inks[0], o.inks[1]);
  return (
    `<g${attrs}><rect x="${n(x, 2)}" y="${n(y, 2)}" width="${n(size, 2)}" height="${n(size, 2)}" rx="${n(size * 0.24, 2)}" fill="${o.color}"/>` +
    `<text x="${n(x + size / 2, 2)}" y="${n(y + size / 2 + fs * 0.36, 2)}" text-anchor="middle" class="sans" font-size="${n(fs, 2)}" font-weight="800" letter-spacing="${n(-fs * 0.02, 2)}" fill="${ink}">${esc(text)}</text></g>`
  );
}
