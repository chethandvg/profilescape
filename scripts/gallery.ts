import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CARDS } from '../src/cards/registry.ts';
import { DEMO_NOW, demoProfile } from '../src/core/fixtures.ts';
import { esc, MONO, n, SANS, shade, textWidth, tint } from '../src/core/svg.ts';
import { contribRamp, DEFAULT_THEME, getTheme, themeList } from '../src/core/themes.ts';
import { CARD_IDS, type CardId, type CardOptions, type Mode, type OptionDoc } from '../src/core/types.ts';
import { renderCards } from '../src/render.ts';
import { ACTION_OUTPUTS, actionInputs, escapeProse, loadManifest, majorTag, tableCell, tableCode, umbrellaOf } from './gen-actions.ts';

/**
 * Gallery: the README, docs and Marketplace images, rendered deterministically
 * from the fictional demo profile ("Mira Chen", DEMO_NOW), plus the repository
 * social preview and the generated reference tables in the docs.
 *
 *   node scripts/gallery.ts            write docs/images, docs/social-preview.png, refresh doc tables
 *   node scripts/gallery.ts --check    exit 1 when an image or table is out of date (PNG not compared)
 *   node scripts/gallery.ts --no-png   skip the social preview PNG
 *
 * Image names are a contract: mirror READMEs (actions/manifest.json "preview")
 * and the docs reference them, and the tests check that they exist.
 */

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const IMAGES_DIR = 'docs/images';
export const SOCIAL_PREVIEW = 'docs/social-preview.png';
/** Markdown files whose `<!-- generated:* -->` blocks this script maintains. */
export const DOC_FILES = ['README.md', 'docs/cards.md', 'docs/configuration.md'] as const;
const MODES: Mode[] = ['dark', 'light'];

// ----------------------------------------------------------------- shots

export interface Shot {
  /** File stem: "<name>-dark.svg" and "<name>-light.svg". */
  name: string;
  card: CardId;
  options?: CardOptions;
  theme?: string;
  /** Combine several images of one card side by side (repo cards, social badges). */
  row?: { take?: number; gap: number };
  /** Accessible title of composed images. */
  title?: string;
}

const STACK_ICONS = ['typescript', 'react', 'nodedotjs', 'rust', 'go', 'docker', 'kubernetes', 'postgresql'];
const CHIP_ICONS = ['typescript', 'react', 'nextdotjs', 'tailwindcss', 'nodedotjs', 'postgresql', 'docker', 'githubactions'];
const SOCIAL_LINKS = { linkedin: 'mira-chen', mastodon: '@mira@hachyderm.io', email: 'hello@mira.dev' };

/** Every gallery image except the theme thumbnails. Defaults first, then option variants. */
export const SHOTS: Shot[] = [
  // Default options: names required by the mirror READMEs and the docs.
  { name: '3d', card: '3d' },
  { name: 'stats', card: 'stats' },
  { name: 'languages', card: 'languages' },
  { name: 'repos', card: 'repos', row: { take: 2, gap: 16 }, title: 'Two compact repository cards' },
  { name: 'hero', card: 'hero' },
  { name: 'grid', card: 'grid' },
  { name: 'stack', card: 'stack', options: { icons: STACK_ICONS } },
  { name: 'socials', card: 'socials', options: { links: SOCIAL_LINKS }, row: { gap: 10 }, title: 'Social link badges' },
  // Option variants that show the range of each card.
  { name: 'stats-compact', card: 'stats', options: { chart: 'none' } },
  { name: 'languages-donut', card: 'languages', options: { layout: 'donut' } },
  { name: 'languages-compact', card: 'languages', options: { layout: 'compact' } },
  { name: 'repos-detail', card: 'repos', options: { layout: 'detail', count: 1 } },
  { name: 'grid-rain', card: 'grid', options: { style: 'rain' } },
  { name: '3d-sunset', card: '3d', theme: 'sunset' },
  { name: 'stack-chips', card: 'stack', options: { style: 'chips', icons: CHIP_ICONS } },
  {
    name: 'socials-icons',
    card: 'socials',
    options: { style: 'icon', links: SOCIAL_LINKS },
    row: { gap: 10 },
    title: 'Round social link icons',
  },
];

/** Theme thumbnails use the compact stats card: hero number, accent gradient, tiles and text tiers. */
export const THEME_SHOT: Omit<Shot, 'name'> = { card: 'stats', options: { chart: 'none' } };

export const themeShotName = (id: string) => `theme-${id}`;

/** Every file under docs/images, in generation order (both modes per stem). */
export function plannedFiles(): string[] {
  const stems = ['logo', ...SHOTS.map((s) => s.name), ...themeList().map((t) => themeShotName(t.id)), 'themes'];
  return stems.flatMap((stem) => MODES.map((m) => `${stem}-${m}.svg`));
}

// ----------------------------------------------------------------- SVG composition

interface Size {
  width: number;
  height: number;
}

export function svgSize(svg: string): Size {
  const open = /^<svg\b[^>]*>/.exec(svg.trim())?.[0] ?? '';
  const width = Number(/\swidth="([\d.]+)"/.exec(open)?.[1]);
  const height = Number(/\sheight="([\d.]+)"/.exec(open)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('SVG has no numeric width/height');
  return { width, height };
}

/**
 * Turn a standalone card SVG into a nested <svg> element at (x, y), scaled by
 * `scale`. Every id is prefixed so several cards can share one document (each
 * card defines ids such as "ps-clip"); card CSS uses card-prefixed class names
 * and no colours, so identical rules from repeated cards are harmless.
 */
export function nest(svg: string, prefix: string, x: number, y: number, scale = 1): string {
  const src = svg.trim();
  const open = /^<svg\b[^>]*>/.exec(src);
  if (!open || !src.endsWith('</svg>')) throw new Error('Not a standalone SVG');
  const { width, height } = svgSize(src);
  const viewBox = /\sviewBox="([^"]+)"/.exec(open[0])?.[1] ?? `0 0 ${width} ${height}`;
  let body = src.slice(open[0].length, -'</svg>'.length);
  const ids = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string));
  body = body
    .replace(/(\sid=")([^"]+)"/g, (_, a: string, id: string) => `${a}${prefix}${id}"`)
    .replace(/url\(#([^)\s'"]+)\)/g, (s, id: string) => (ids.has(id) ? `url(#${prefix}${id})` : s))
    .replace(/(href=")#([^"]+)"/g, (s, a: string, id: string) => (ids.has(id) ? `${a}#${prefix}${id}"` : s))
    .replace(/(aria-(?:labelledby|describedby)=")([^"]+)"/g, (_, a: string, list: string) =>
      `${a}${list.split(/\s+/).map((id) => (ids.has(id) ? prefix + id : id)).join(' ')}"`,
    );
  return `<svg x="${n(x)}" y="${n(y)}" width="${n(width * scale)}" height="${n(height * scale)}" viewBox="${viewBox}">${body}</svg>`;
}

function document(size: Size, title: string, body: string, defs = ''): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(size.width)}" height="${n(size.height)}" viewBox="0 0 ${n(size.width)} ${n(size.height)}" role="img" aria-labelledby="g-title">` +
    `<title id="g-title">${esc(title)}</title>${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`
  );
}

/** Images side by side, top-aligned, on a transparent background. */
export function composeRow(svgs: string[], gap: number, title: string): string {
  let x = 0;
  let height = 0;
  const parts = svgs.map((svg, i) => {
    const size = svgSize(svg);
    const part = nest(svg, `c${i}-`, x, 0);
    x += size.width + gap;
    height = Math.max(height, size.height);
    return part;
  });
  return document({ width: Math.max(0, x - gap), height }, title, parts.join(''));
}

/** Text colours for labels drawn straight onto GitHub's page background. */
const PAGE_TEXT: Record<Mode, { text: string; muted: string }> = {
  dark: { text: '#E6EDF3', muted: '#9198A1' },
  light: { text: '#1F2328', muted: '#59636E' },
};

/** All themes at a glance: two columns of labelled thumbnails. */
export function themesOverview(thumbs: { id: string; label: string; svg: string }[], mode: Mode): string {
  const cols = 2;
  const scale = 0.5;
  const gapX = 32;
  const gapY = 28;
  const labelH = 34;
  const first = thumbs[0];
  if (!first) throw new Error('No themes');
  const tile = svgSize(first.svg);
  const tw = tile.width * scale;
  const th = tile.height * scale;
  const rows = Math.ceil(thumbs.length / cols);
  const colors = PAGE_TEXT[mode];
  const parts = thumbs.map((t, i) => {
    const x = (i % cols) * (tw + gapX);
    const y = Math.floor(i / cols) * (labelH + th + gapY);
    return (
      `<text x="${n(x + 4)}" y="${n(y + 22)}" font-family="${esc(SANS)}" font-size="20" font-weight="600" fill="${colors.text}">${esc(t.label)}</text>` +
      `<text x="${n(x + tw - 4)}" y="${n(y + 22)}" text-anchor="end" font-family="${esc(MONO)}" font-size="16" fill="${colors.muted}">theme: ${esc(t.id)}</text>` +
      nest(t.svg, `t${i}-`, x, y + labelH, scale)
    );
  });
  const size = { width: cols * tw + (cols - 1) * gapX, height: rows * (labelH + th) + (rows - 1) * gapY };
  return document(size, `All ${thumbs.length} Profilescape themes (${mode} mode)`, parts.join(''));
}

// ----------------------------------------------------------------- rendering

function renderShot(shot: Omit<Shot, 'name'>, mode: Mode): string {
  const files = renderCards({
    data: demoProfile(),
    cards: [shot.card],
    theme: shot.theme ?? DEFAULT_THEME,
    modes: [mode],
    options: shot.options ? { [shot.card]: shot.options } : {},
    animate: true,
    now: DEMO_NOW,
  });
  if (!files.length) throw new Error(`${shot.card} rendered no images`);
  if (!shot.row) return (files[0] as (typeof files)[number]).svg;
  const take = files.slice(0, shot.row.take ?? files.length).map((f) => f.svg);
  return composeRow(take, shot.row.gap, shot.title ?? CARDS[shot.card].title);
}

/** Every docs/images file: name -> SVG text. Pure and deterministic. */
export function galleryFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const mode of MODES) out.set(`logo-${mode}.svg`, logoSvg(mode));
  for (const shot of SHOTS) for (const mode of MODES) out.set(`${shot.name}-${mode}.svg`, renderShot(shot, mode));
  for (const mode of MODES) {
    const thumbs = themeList().map((t) => {
      const svg = renderShot({ ...THEME_SHOT, theme: t.id }, mode);
      out.set(`${themeShotName(t.id)}-${mode}.svg`, svg);
      return { ...t, svg };
    });
    out.set(`themes-${mode}.svg`, themesOverview(thumbs, mode));
  }
  // Keep plannedFiles() honest: same names, same order.
  const planned = plannedFiles();
  const names = [...out.keys()].sort();
  if (JSON.stringify(names) !== JSON.stringify([...planned].sort())) throw new Error('plannedFiles() is out of sync with galleryFiles()');
  return out;
}

// ----------------------------------------------------------------- logo

/** One isometric column: base centre (cx, cy), half-width s, height h. */
function isoColumn(cx: number, cy: number, s: number, h: number, color: string): string {
  const v = (x: number, y: number) => `${n(x)} ${n(y)}`;
  const top = `M${v(cx, cy - h - s / 2)}L${v(cx + s, cy - h)}L${v(cx, cy - h + s / 2)}L${v(cx - s, cy - h)}Z`;
  const left = `M${v(cx - s, cy - h)}L${v(cx, cy - h + s / 2)}L${v(cx, cy + s / 2)}L${v(cx - s, cy)}Z`;
  const right = `M${v(cx, cy - h + s / 2)}L${v(cx + s, cy - h)}L${v(cx + s, cy)}L${v(cx, cy + s / 2)}Z`;
  return `<path d="${top}" fill="${tint(color, 0.3)}"/><path d="${left}" fill="${color}"/><path d="${right}" fill="${shade(color, 0.28)}"/>`;
}

/** Wordmark for the README header: three rising columns from the 3D card plus the name. */
export function logoSvg(mode: Mode): string {
  const p = getTheme(DEFAULT_THEME)[mode];
  const ramp = contribRamp(p, mode);
  const s = 15;
  const step = s + 4;
  const columns = [
    { h: 22, color: ramp[2] },
    { h: 40, color: ramp[3] },
    { h: 60, color: ramp[4] },
  ];
  // Back to front so nearer columns overlap the ones behind them.
  const mark = columns
    .map((c, i) => ({ ...c, cx: 22 + i * step, cy: 100 - (i * step) / 2 }))
    .reverse()
    .map((c) => isoColumn(c.cx, c.cy, s, c.h, c.color))
    .join('');
  const defs = `<linearGradient id="logo-text" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${p.accentA}"/><stop offset="1" stop-color="${p.accentB}"/></linearGradient>`;
  const word = `<text x="100" y="88" font-family="${esc(SANS)}" font-size="64" font-weight="800" letter-spacing="-1.5" fill="url(#logo-text)">Profilescape</text>`;
  return document({ width: 500, height: 120 }, 'Profilescape', mark + word, defs);
}

// ----------------------------------------------------------------- social preview

/** 1280 x 640 repository social preview, composed from real cards. */
export function socialPreviewSvg(): string {
  const W = 1280;
  const H = 640;
  const p = getTheme(DEFAULT_THEME).dark;
  const card = (shot: Omit<Shot, 'name'>) => renderShot(shot, 'dark');
  const shadow = 'filter="url(#sp-shadow)"';
  const chips = ['Your token', 'No servers', '14 themes', '8 cards'];
  let cx = 72;
  const chipSvg = chips
    .map((label) => {
      const w = textWidth(label, 19, { weight: 600 }) + 32;
      const s =
        `<rect x="${n(cx)}" y="330" width="${n(w)}" height="40" rx="20" fill="${p.chipBg}" stroke="${p.border}"/>` +
        `<text x="${n(cx + w / 2)}" y="356" text-anchor="middle" font-family="${esc(SANS)}" font-size="19" font-weight="600" fill="${p.text}">${esc(label)}</text>`;
      cx += w + 10;
      return s;
    })
    .join('');
  const defs =
    `<linearGradient id="sp-title" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${p.accentA}"/><stop offset="1" stop-color="${p.accentB}"/></linearGradient>` +
    `<radialGradient id="sp-glow-a" cx=".12" cy="0" r=".7"><stop offset="0" stop-color="${p.accentA}" stop-opacity=".42"/><stop offset="1" stop-color="${p.accentA}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="sp-glow-b" cx=".92" cy="1" r=".6"><stop offset="0" stop-color="${p.accentB}" stop-opacity=".3"/><stop offset="1" stop-color="${p.accentB}" stop-opacity="0"/></radialGradient>` +
    `<pattern id="sp-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${p.grid}" stroke-opacity="${p.gridOpacity}"/></pattern>` +
    `<filter id="sp-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000000" flood-opacity=".55"/></filter>`;
  const body =
    `<rect width="${W}" height="${H}" fill="${p.bg}"/><rect width="${W}" height="${H}" fill="url(#sp-grid)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#sp-glow-a)"/><rect width="${W}" height="${H}" fill="url(#sp-glow-b)"/>` +
    // Cards on a grid: the 3D landscape top right, a repo card and the stats tiles below, ~70px from the edges.
    `<g ${shadow}>${nest(card({ card: '3d', options: { insights: false } }), 'a-', 600, 48, 0.51)}</g>` +
    `<g ${shadow}>${nest(card({ card: 'repos', options: { count: 1 } }), 'b-', 72, 428, 0.8)}</g>` +
    `<g ${shadow}>${nest(card({ card: 'stats', options: { chart: 'none', hideTitle: true } }), 'c-', 412, 428, 2 / 3)}</g>` +
    // Text
    `<text x="71" y="112" font-family="${esc(MONO)}" font-size="19" letter-spacing="3" fill="${p.accentB}">GITHUB PROFILE CARDS</text>` +
    `<text x="66" y="200" font-family="${esc(SANS)}" font-size="88" font-weight="800" letter-spacing="-2" fill="url(#sp-title)">Profilescape</text>` +
    `<text x="72" y="256" font-family="${esc(SANS)}" font-size="32" font-weight="600" fill="${p.text}">Beautiful, self-hosted cards</text>` +
    `<text x="72" y="298" font-family="${esc(SANS)}" font-size="32" font-weight="600" fill="${p.text}">for your profile README.</text>` +
    chipSvg;
  return document({ width: W, height: H }, 'Profilescape: beautiful, self-hosted GitHub profile cards', body, defs);
}

export async function socialPreviewPng(): Promise<Uint8Array> {
  const { Resvg } = await import('@resvg/resvg-js');
  return new Resvg(socialPreviewSvg(), {
    fitTo: { mode: 'width', value: 1280 },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  })
    .render()
    .asPng();
}

// ----------------------------------------------------------------- reference tables

/** Defaults that describe behaviour rather than a literal value you could type. */
const DESCRIPTIVE_DEFAULTS = new Set(['hero.name', 'hero.role', 'hero.status', 'hero.statusColor', 'hero.codeLanguage', 'hero.codeFile']);
export const descriptiveDefaultKeys = () => [...DESCRIPTIVE_DEFAULTS];

/** Escape prose for a Markdown table cell: pipes everywhere; backslashes and angle brackets outside code spans. */
export const cell = (text: string) =>
  tableCell(text.replace(/\n/g, ' '), (part) => escapeProse(part).replace(/</g, '&lt;').replace(/>/g, '&gt;'));
const code = tableCode;

export function formatDefault(card: CardId, o: OptionDoc): string {
  if (o.default === undefined) return '_see description_';
  if (typeof o.default === 'string' && (o.type !== 'string' || DESCRIPTIVE_DEFAULTS.has(`${card}.${o.key}`))) return `_${cell(o.default)}_`;
  return code(JSON.stringify(o.default).replace(/","/g, '", "'));
}

export function optionsTable(id: CardId): string {
  const rows = CARDS[id].options.map((o) => `| ${code(o.key)} | ${o.type} | ${formatDefault(id, o)} | ${cell(o.description)} |`);
  return ['| Option | Type | Default | Description |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

export function inputsTable(): string {
  const umbrella = umbrellaOf(loadManifest(ROOT));
  const rows = actionInputs(umbrella.cards).map(
    (i) => `| ${code(i.name)} | ${i.default === '' ? '_empty_' : code(i.default)} | ${cell(i.description)} |`,
  );
  return ['| Input | Default | Description |', '| --- | --- | --- |', ...rows].join('\n');
}

export function outputsTable(): string {
  return ['| Output | Description |', '| --- | --- |', ...ACTION_OUTPUTS.map((o) => `| ${code(o.name)} | ${cell(o.description)} |`)].join('\n');
}

/** The umbrella and single-purpose actions, from actions/manifest.json. */
export function actionsTable(): string {
  const m = loadManifest(ROOT);
  const tag = majorTag(ROOT);
  const rows = m.actions.map((a) => {
    const url = `https://github.com/${m.owner}/${a.repo}`;
    const renders = a.repo === m.umbrella ? `any card (default: ${a.cards.map(code).join(', ')})` : a.cards.map(code).join(', ');
    return `| [${a.name}](${url}) | ${renders} | ${code(`uses: ${m.owner}/${a.repo}@${tag}`)} |`;
  });
  return ['| Action | Renders | Step |', '| --- | --- | --- |', ...rows].join('\n');
}

/** Generated blocks by name: `<!-- generated:NAME -->` ... `<!-- /generated:NAME -->`. */
export function referenceBlocks(): Map<string, string> {
  const blocks = new Map<string, string>([
    ['inputs', inputsTable()],
    ['outputs', outputsTable()],
    ['actions', actionsTable()],
  ]);
  for (const id of CARD_IDS) blocks.set(`options:${id}`, optionsTable(id));
  return blocks;
}

const BLOCK_RE = /(<!-- generated:([\w:-]+) -->)\r?\n[\s\S]*?\r?\n?(<!-- \/generated:\2 -->)/g;

/** Replace every known generated block; unknown block names are reported. */
export function applyBlocks(text: string, blocks: Map<string, string>): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(BLOCK_RE, (whole, open: string, name: string, close: string) => {
    const content = blocks.get(name);
    if (content === undefined) {
      unknown.push(name);
      return whole;
    }
    return `${open}\n${content}\n${close}`;
  });
  return { text: out, unknown };
}

// ----------------------------------------------------------------- main

/** Run a read, mapping "file not found" to `undefined` (no separate existence check that could go stale before the use). */
function unlessMissing<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined;
    throw error;
  }
}

function main(): void {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false }, 'no-png': { type: 'boolean', default: false } } });
  const dir = join(ROOT, IMAGES_DIR);
  const files = galleryFiles();
  const problems: string[] = [];
  let changed = 0;

  // Images
  const existing = unlessMissing(() => readdirSync(dir)) ?? [];
  for (const [name, svg] of files) {
    const path = join(dir, name);
    const current = unlessMissing(() => readFileSync(path, 'utf8'));
    if (current === svg) continue;
    if (values.check) problems.push(`${IMAGES_DIR}/${name} is ${current === undefined ? 'missing' : 'out of date'}`);
    else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, svg, 'utf8');
      changed++;
    }
  }
  for (const name of existing) {
    if (files.has(name)) continue;
    if (values.check) problems.push(`${IMAGES_DIR}/${name} is not produced by the gallery`);
    else {
      rmSync(join(dir, name));
      console.log(`removed  ${IMAGES_DIR}/${name}`);
    }
  }

  // Generated tables in the docs
  const blocks = referenceBlocks();
  for (const rel of DOC_FILES) {
    const path = join(ROOT, rel);
    const current = unlessMissing(() => readFileSync(path, 'utf8'));
    if (current === undefined) continue;
    const { text, unknown } = applyBlocks(current, blocks);
    for (const u of unknown) problems.push(`${rel}: unknown generated block "${u}"`);
    if (text === current) continue;
    if (values.check) problems.push(`${rel}: generated tables are out of date`);
    else {
      writeFileSync(path, text, 'utf8');
      console.log(`updated  ${rel}`);
    }
  }

  if (values.check) {
    for (const p of problems) console.error(`gallery: ${p}`);
    if (problems.length) {
      console.error('Run `npm run gallery` and commit the result.');
      process.exitCode = 1;
    } else console.log(`gallery: ${files.size} images and the doc tables are up to date.`);
    return;
  }
  for (const p of problems) console.warn(`gallery: ${p}`);
  console.log(`gallery: ${changed} of ${files.size} images written to ${IMAGES_DIR}.`);
}

async function writeSocialPreview(): Promise<void> {
  const png = await socialPreviewPng();
  const path = join(ROOT, SOCIAL_PREVIEW);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  console.log(`gallery: wrote ${SOCIAL_PREVIEW} (${(png.length / 1024).toFixed(0)} KB)`);
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
    if (!process.argv.includes('--check') && !process.argv.includes('--no-png')) await writeSocialPreview();
  } catch (err) {
    console.error(`gallery: ${(err as Error).stack ?? String(err)}`);
    process.exitCode = 1;
  }
}
