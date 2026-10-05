import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CARDS } from '../src/cards/registry.ts';
import { DEMO_NOW, demoProfile } from '../src/core/fixtures.ts';
import { themeIds } from '../src/core/themes.ts';
import { renderCards } from '../src/render.ts';

/**
 * Builds the website and playground into site/dist (deployed to GitHub Pages
 * by .github/workflows/pages.yml). The page is served from /profilescape/, so
 * every URL in it is relative.
 *
 *   node scripts/site.ts [--out <dir>]
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_DIR = join(ROOT, 'site');
export const DEFAULT_OUT = join(SITE_DIR, 'dist');
export const SITE_URL = 'https://chethandvg.github.io/profilescape/';
const SOCIAL_PREVIEW = join(ROOT, 'docs', 'social-preview.png');

interface ManifestAction {
  repo: string;
  name: string;
  short: string;
  description: string;
  cards: string[];
}

interface Manifest {
  owner: string;
  actions: ManifestAction[];
}

export interface BuiltFile {
  path: string;
  bytes: number;
  gzip: number;
}

export interface SiteBuild {
  outDir: string;
  files: BuiltFile[];
  bundle: BuiltFile;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 10);

function actionsList(manifest: Manifest): string {
  return manifest.actions
    .map((a) => {
      const url = `https://github.com/${manifest.owner}/${a.repo}`;
      const cards = a.cards.map((c) => CARDS[c as keyof typeof CARDS]?.title ?? c).join(', ');
      return [
        '<li class="action-item glass">',
        `  <h4><a href="${url}">${escapeHtml(a.short)}</a></h4>`,
        `  <p>${escapeHtml(a.description)}</p>`,
        `  <span class="action-cards">Default cards: ${escapeHtml(cards)}</span>`,
        `  <code>uses: ${manifest.owner}/${a.repo}@v1</code>`,
        '</li>',
      ].join('\n            ');
    })
    .join('\n            ');
}

function ogImageTags(path: string, width?: number, height?: number): string {
  const url = `${SITE_URL}${path}`;
  const size = width && height ? `\n    <meta property="og:image:width" content="${width}" />\n    <meta property="og:image:height" content="${height}" />` : '';
  return [
    `<meta property="og:image" content="${url}" />`,
    `<meta property="og:image:alt" content="Profilescape cards: a 3D contribution landscape, stats and languages" />${size}`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${url}" />`,
  ].join('\n    ');
}

/** PNG width and height from the IHDR chunk. */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Social preview: the committed image when present, else a render of the 3D card (best effort). */
async function socialPreview(outDir: string, svg: string): Promise<string> {
  if (existsSync(SOCIAL_PREVIEW)) {
    copyFileSync(SOCIAL_PREVIEW, join(outDir, 'social-preview.png'));
    const size = pngSize(readFileSync(SOCIAL_PREVIEW));
    return ogImageTags('social-preview.png', size?.width, size?.height);
  }
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng();
    writeFileSync(join(outDir, 'social-preview.png'), png);
    const size = pngSize(png);
    return ogImageTags('social-preview.png', size?.width, size?.height);
  } catch {
    return '<meta name="twitter:card" content="summary" />';
  }
}

export async function buildSite(opts: { outDir?: string; quiet?: boolean } = {}): Promise<SiteBuild> {
  const outDir = resolve(opts.outDir ?? DEFAULT_OUT);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'assets'), { recursive: true });

  const result = await build({
    entryPoints: [join(SITE_DIR, 'src', 'main.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022', 'chrome111', 'firefox113', 'safari16.4'],
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
  });
  const js = result.outputFiles[0]?.text ?? '';
  const nodeImport = /\bfrom\s*["']node:|import\(\s*["']node:|require\(\s*["']node:/.exec(js);
  if (nodeImport) throw new Error(`The site bundle imports a Node module (${nodeImport[0]}); src/cards and src/core must stay browser-safe.`);
  writeFileSync(join(outDir, 'app.js'), js);

  const css = readFileSync(join(SITE_DIR, 'styles.css'), 'utf8');
  writeFileSync(join(outDir, 'styles.css'), css);
  copyFileSync(join(SITE_DIR, 'favicon.svg'), join(outDir, 'favicon.svg'));

  // Static fallbacks of the hero card (no-JS visitors) and the social preview.
  const data = demoProfile(DEMO_NOW);
  const hero = renderCards({ data, cards: ['3d'], theme: 'aurora', modes: ['dark', 'light'], now: DEMO_NOW });
  for (const f of hero) writeFileSync(join(outDir, 'assets', `hero-${f.path}`), f.svg);
  const darkHero = hero.find((f) => f.mode === 'dark')?.svg ?? '';
  const ogTags = await socialPreview(outDir, darkHero.replace('</style>', '*{animation:none!important}</style>'));

  const manifest = JSON.parse(readFileSync(join(ROOT, 'actions', 'manifest.json'), 'utf8')) as Manifest;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  let html = readFileSync(join(SITE_DIR, 'index.html'), 'utf8');
  const replacements: Record<string, string> = {
    '{{APP}}': `app.js?v=${hash(js)}`,
    '{{CSS}}': `styles.css?v=${hash(css)}`,
    '{{VERSION}}': escapeHtml(pkg.version),
    '{{CARD_COUNT}}': String(Object.keys(CARDS).length),
    '{{THEME_COUNT}}': String(themeIds().length),
    '<!-- @og-image -->': ogTags,
    '<!-- @actions -->': actionsList(manifest),
  };
  for (const [token, value] of Object.entries(replacements)) html = html.split(token).join(value);
  const leftover = /\{\{[A-Z_]+\}\}|<!-- @[a-z-]+ -->/.exec(html);
  if (leftover) throw new Error(`Unreplaced placeholder ${leftover[0]} in site/index.html`);
  writeFileSync(join(outDir, 'index.html'), html);

  writeFileSync(join(outDir, '.nojekyll'), '');
  writeFileSync(join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
  writeFileSync(
    join(outDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}</loc></url>\n</urlset>\n`,
  );

  const measure = (rel: string): BuiltFile => {
    const buf = readFileSync(join(outDir, rel));
    return { path: rel, bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
  };
  const files = ['index.html', 'app.js', 'styles.css', 'favicon.svg', ...hero.map((f) => `assets/hero-${f.path}`)]
    .concat(existsSync(join(outDir, 'social-preview.png')) ? ['social-preview.png'] : [])
    .map(measure);
  const bundle = files.find((f) => f.path === 'app.js') as BuiltFile;

  if (!opts.quiet) {
    const kb = (n: number) => `${(n / 1024).toFixed(1).padStart(7)} KB`;
    console.log(`Built site into ${relative(ROOT, outDir) || '.'}`);
    for (const f of files) console.log(`  ${f.path.padEnd(28)} ${kb(f.bytes)}  ${kb(f.gzip)} gzip`);
    const total = files.filter((f) => !f.path.endsWith('.png')).reduce((s, f) => s + f.gzip, 0);
    console.log(`  ${'page weight (gzip, no PNG)'.padEnd(28)} ${' '.repeat(10)}  ${kb(total)} gzip`);
  }
  return { outDir, files, bundle };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const out = i > 0 ? process.argv[i + 1] : undefined;
  await buildSite({ outDir: out });
}
