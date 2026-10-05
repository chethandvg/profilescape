import { compact as count, displayName, percent, relativeTime, shortDate } from '../core/format.ts';
import { readOptions } from '../core/options.ts';
import {
  delay,
  ensureContrast,
  esc,
  fit,
  fitLabel,
  label,
  labelWidth,
  linearGradient,
  mix,
  n,
  safeColor,
  shell,
  textWidth,
  wrapPx,
} from '../core/svg.ts';
import { otherColor } from '../core/themes.ts';
import type { CardDefinition, CardImage, Palette, ProfileData, RenderContext, RepoInfo } from '../core/types.ts';

/**
 * Repository cards. One image per repository, in two layouts:
 *  - compact: 400px half-width card for profile READMEs (paired two per row)
 *  - detail:  1200px full card for a project's own README
 */

type Layout = 'compact' | 'detail';

interface Settings {
  layout: Layout;
  count: number;
  /** null = automatic (shown only for repositories owned by someone else). */
  showOwner: boolean | null;
  descriptionLines: number;
  title: string | undefined;
}

const NO_DESCRIPTION = 'No description provided.';
/**
 * textWidth() is calibrated on Segoe UI; SF Pro (macOS/iOS viewers) runs a few
 * percent wider, so proportional text is laid out against a slightly smaller box.
 */
const SAFE = 0.95;

// ── Options & selection ─────────────────────────────────────────────────────

function readSettings(ctx: RenderContext): Settings {
  const o = readOptions(ctx.options);
  const layout: Layout = o.string('layout', 'compact').trim().toLowerCase() === 'detail' ? 'detail' : 'compact';
  return {
    layout,
    count: Math.floor(o.number('count', 4, { min: 1, max: 12 })),
    showOwner: o.has('showOwner') ? o.boolean('showOwner', false) : layout === 'detail' ? true : null,
    descriptionLines: Math.floor(o.number('descriptionLines', layout === 'detail' ? 2 : 3, { min: 1, max: 4 })),
    title: o.optionalString('title')?.replace(/\s+/g, ' ').trim(),
  };
}

/** "Mira-Dev/nebula.ui" → "mira-dev-nebula-ui" */
export function repoSlug(nameWithOwner: string): string {
  return nameWithOwner
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Explicitly configured repos (in order) → pinned → most starred non-archived. Deduplicated by slug. */
export function selectRepos(data: ProfileData, limit: number): RepoInfo[] {
  const extra = data.extraRepos ?? [];
  // Automatic picks never include private repos (cards are public images) or the
  // profile README repo itself; explicitly configured repos are always honoured.
  const profileRepo = `${data.login}/${data.login}`.toLowerCase();
  const eligible = (r: RepoInfo) => !r.isPrivate && r.nameWithOwner.toLowerCase() !== profileRepo;
  const ranked = (data.repos ?? [])
    .filter((r) => eligible(r) && !r.isArchived)
    .sort((a, b) => b.stars - a.stars || (b.pushedAt > a.pushedAt ? 1 : b.pushedAt < a.pushedAt ? -1 : 0));
  const source = extra.length ? extra : [...(data.pinned ?? []).filter(eligible), ...ranked];
  const seen = new Set<string>();
  const out: RepoInfo[] = [];
  for (const repo of source) {
    const slug = repoSlug(repo.nameWithOwner);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(repo);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Small helpers ───────────────────────────────────────────────────────────

const validDate = (iso: string | null | undefined): iso is string => !!iso && Number.isFinite(Date.parse(iso));

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Language colours are data: sanitised, then nudged until they stand out from the card surface. */
const dataColor = (c: string | null | undefined, p: Palette): string => ensureContrast(safeColor(c, p.faint), p.panel, 1.8, p.text);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/#/g, 'sharp')
    .replace(/\+/g, 'p')
    .replace(/[^a-z0-9]/g, '');

function primaryLanguage(repo: RepoInfo): { name: string; color: string } | null {
  if (repo.primaryLanguage?.name) return repo.primaryLanguage;
  const first = repo.languages?.[0];
  return first?.name ? { name: first.name, color: first.color } : null;
}

/** "TYPESCRIPT · REACT": primary language plus topics that add information, fitted to `maxWidth`. */
export function categoryLabel(repo: RepoInfo, maxWidth: number, maxParts = 2): string {
  const lang = primaryLanguage(repo)?.name;
  const candidates: string[] = [];
  if (lang) candidates.push(displayName(lang));
  const langKey = lang ? norm(lang) : '';
  const shortKey = lang ? norm(displayName(lang)) : '';
  for (const topic of repo.topics ?? []) {
    const key = norm(topic);
    if (!key || key === langKey || key === shortKey || key === `${langKey}lang` || candidates.some((c) => norm(c) === key)) continue;
    candidates.push(topic);
  }
  if (!candidates.length) return 'REPOSITORY';
  const parts: string[] = [];
  for (const c of candidates) {
    if (parts.length >= maxParts) break;
    const next = [...parts, c].join(' · ').toUpperCase();
    if (parts.length && labelWidth(next) > maxWidth) break;
    parts.push(c);
  }
  return fitLabel(parts.join(' · ').toUpperCase(), maxWidth);
}

function ownerShown(repo: RepoInfo, data: ProfileData, s: Settings): boolean {
  const foreign = repo.owner.toLowerCase() !== (data.login ?? '').toLowerCase();
  return s.showOwner === null ? foreign : s.showOwner || foreign;
}

/** Title as tspans: dimmed owner prefix (optional) + bold name, together fitted to `maxWidth`. */
function titleText(
  repo: RepoInfo,
  showOwner: boolean,
  maxWidth: number,
  size: number,
  weight: number,
  p: Palette,
  sep: string,
): string {
  const nameOpts = { weight };
  if (!showOwner) return `<tspan fill="${p.text}">${esc(fit(repo.name, maxWidth, size, nameOpts))}</tspan>`;
  const ownerOpts = { weight: 500 };
  let owner = repo.owner;
  const sepW = textWidth(sep, size, ownerOpts);
  if (textWidth(owner, size, ownerOpts) + sepW > maxWidth * 0.45) owner = fit(owner, maxWidth * 0.45 - sepW, size, ownerOpts);
  const ownerW = textWidth(owner, size, ownerOpts) + sepW;
  const name = fit(repo.name, maxWidth - ownerW, size, nameOpts);
  return (
    `<tspan fill="${p.muted}" font-weight="500">${esc(owner)}</tspan>` +
    `<tspan fill="${p.faint}" font-weight="400">${esc(sep)}</tspan>` +
    `<tspan fill="${p.text}">${esc(name)}</tspan>`
  );
}

// ── Icons (drawn on a 16-unit grid centred at 0,0) ──────────────────────────

type IconName = 'star' | 'fork' | 'issue' | 'pr' | 'eye' | 'tag' | 'clock' | 'law' | 'globe' | 'book';

function starPoints(outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${n(Math.cos(a) * r, 2)} ${n(Math.sin(a) * r + 0.6, 2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const STAR = starPoints(7.2, 3.1);

function iconBody(name: IconName, color: string): string {
  switch (name) {
    case 'star':
      return `<path d="${STAR}"/>`;
    case 'fork':
      return (
        '<circle cx="-4" cy="-4.6" r="1.9"/><circle cx="4" cy="-4.6" r="1.9"/><circle cx="0" cy="4.8" r="1.9"/>' +
        '<path d="M-4-2.7V-1.4Q-4 .6-2 .6H2Q4 .6 4-1.4V-2.7M0 .6V2.9"/>'
      );
    case 'issue':
      return `<circle r="6.6"/><circle r="1.7" fill="${color}" stroke="none"/>`;
    case 'pr':
      return (
        '<circle cx="-4" cy="-4.8" r="1.9"/><circle cx="-4" cy="4.8" r="1.9"/><circle cx="4" cy="4.8" r="1.9"/>' +
        '<path d="M-4-2.9V2.9M4 2.9V-1.6Q4-4.6 1-4.6H-.6M1.4-6.6-.6-4.6 1.4-2.6"/>'
      );
    case 'eye':
      return `<path d="M-7.2 0Q0-8.4 7.2 0Q0 8.4-7.2 0Z"/><circle r="2.3" fill="${color}" stroke="none"/>`;
    case 'tag':
      return (
        '<path d="M-6.6-6.6H-.9L6.2.5Q7 1.3 6.2 2.1L2.1 6.2Q1.3 7 .5 6.2L-6.6-.9Z"/>' +
        `<circle cx="-3.4" cy="-3.4" r="1.2" fill="${color}" stroke="none"/>`
      );
    case 'clock':
      return '<circle r="6.6"/><path d="M0-3.6V0L2.6 1.8"/>';
    case 'law':
      return '<path d="M0-6.6V6.4M-3.8 6.4H3.8M-6.2-4.4H6.2M-6.2-4.4-8 .6Q-6.2 2.4-4.4 .6ZM6.2-4.4 4.4.6Q6.2 2.4 8 .6Z"/>';
    case 'globe':
      return '<circle r="6.6"/><ellipse rx="2.8" ry="6.6"/><path d="M-6.6 0H6.6"/>';
    case 'book':
      return '<path d="M-5.6 5V-5.2Q-5.6-6.8-4-6.8H5.6V3.4H-4Q-5.6 3.4-5.6 5Q-5.6 6.6-4 6.6H5.6M-2.6-3.6H2.6"/>';
  }
}

function icon(name: IconName, x: number, y: number, color: string, scale = 1, strokeWidth = 1.5): string {
  const t = scale === 1 ? `translate(${n(x)} ${n(y)})` : `translate(${n(x)} ${n(y)}) scale(${n(scale, 3)})`;
  return `<g transform="${t}" fill="none" stroke="${color}" stroke-width="${n(strokeWidth, 2)}" stroke-linecap="round" stroke-linejoin="round">${iconBody(name, color)}</g>`;
}

// ── Shared pieces ───────────────────────────────────────────────────────────

const STYLE =
  '.rp-bar{transform-box:fill-box;transform-origin:left;animation:rp-grow 1.1s cubic-bezier(.2,.7,.2,1) backwards}' +
  '@keyframes rp-grow{from{transform:scaleX(0)}}';

function accentBar(W: number): string {
  return `<g clip-path="url(#ps-clip)"><rect class="rp-bar" width="${W}" height="3" fill="url(#rp-accent)"/></g>`;
}

function chip(x: number, y: number, w: number, h: number, p: Palette, inner: string): string {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${h}" rx="${n(h / 2)}" fill="${p.chipBg}" stroke="${p.border}"/>${inner}`;
}

function badgeOf(repo: RepoInfo): { text: string; release: boolean } | null {
  const tag = clean(repo.latestRelease?.tag);
  if (tag) return { text: tag, release: true };
  if (repo.isArchived) return { text: 'Archived', release: false };
  if (repo.isTemplate) return { text: 'Template', release: false };
  if (repo.isFork) return { text: 'Fork', release: false };
  return null;
}

function describe(repo: RepoInfo): string {
  const bits = [`${count(repo.stars)} stars`, `${count(repo.forks)} forks`];
  const lang = primaryLanguage(repo);
  if (lang) bits.unshift(`written in ${lang.name}`);
  const desc = clean(repo.description);
  return `${desc ? `${desc} ` : ''}(${bits.join(', ')})`;
}

// ── Compact layout (400 × ~200) ─────────────────────────────────────────────

function compactCard(ctx: RenderContext, repo: RepoInfo, s: Settings): string {
  const p = ctx.palette;
  const W = 400;
  const P = 24;
  const lines = s.descriptionLines;
  const descTop = 104;
  const lh = 21;
  const divY = descTop + (lines - 1) * lh + 18;
  const H = divY + 36;
  const out: string[] = [];

  // Header: category label + status badge.
  const badge = badgeOf(repo);
  let badgeW = 0;
  let badgeSvg = '';
  if (badge) {
    const iconW = badge.release ? 15 : 0;
    const text = fit(badge.text, 120, 11, { mono: true });
    badgeW = textWidth(text, 11, { mono: true }) + 20 + iconW;
    const bx = W - P - badgeW;
    const tagColor = badge.release ? p.accentB : p.muted;
    badgeSvg = chip(
      bx,
      25,
      badgeW,
      22,
      p,
      (badge.release ? icon('tag', bx + 15, 36, tagColor, 0.62, 2) : '') +
        `<text x="${n(bx + 10 + iconW)}" y="40" class="mono" font-size="11" fill="${badge.release ? p.text : p.muted}">${esc(text)}</text>`,
    );
  }
  const labelMax = W - 2 * P - (badgeW ? badgeW + 14 : 0);
  const category = s.title ? fitLabel(s.title.toUpperCase(), labelMax) : categoryLabel(repo, labelMax);
  out.push(`<g class="fade">${label(P, 40, category, p)}${badgeSvg}</g>`);

  // Title.
  const title = titleText(repo, ownerShown(repo, ctx.data, s), (W - 2 * P) * SAFE, 20, 700, p, '/');
  out.push(
    `<text class="sans up" ${delay(0.05)} x="${P}" y="72" font-size="20" font-weight="700" letter-spacing="-.3">${title}</text>`,
  );

  // Description.
  const desc = clean(repo.description);
  if (desc) {
    const rows = wrapPx(desc, (W - 2 * P) * SAFE, 13.5, {}, lines);
    out.push(
      `<g class="up" ${delay(0.12)}>` +
        rows
          .map(
            (row, i) =>
              `<text x="${P}" y="${descTop + i * lh}" class="sans" font-size="13.5" fill="${p.muted}">${esc(row)}</text>`,
          )
          .join('') +
        '</g>',
    );
  } else {
    out.push(
      `<text class="sans up" ${delay(0.12)} x="${P}" y="${descTop}" font-size="13.5" font-style="italic" fill="${p.faint}">${NO_DESCRIPTION}</text>`,
    );
  }

  // Footer: language · stars · forks, last push on the right when there is room.
  const cy = divY + 18;
  const base = divY + 22.5;
  const mono = { mono: true };
  const foot: string[] = [`<line x1="${P}" y1="${divY}" x2="${W - P}" y2="${divY}" stroke="${p.border}"/>`];
  let x = P;
  const lang = primaryLanguage(repo);
  if (lang) {
    const name = fit(displayName(lang.name), 118, 12.5, mono);
    foot.push(
      `<circle cx="${x + 6}" cy="${cy}" r="5.5" fill="${dataColor(lang.color, p)}"/>` +
        `<text x="${x + 18}" y="${n(base)}" class="mono" font-size="12.5" fill="${p.text}">${esc(name)}</text>`,
    );
    x += 18 + textWidth(name, 12.5, mono) + 18;
  }
  for (const [kind, value] of [
    ['star', repo.stars],
    ['fork', repo.forks],
  ] as const) {
    const v = count(Math.max(0, value || 0));
    foot.push(
      icon(kind, x + 6, cy, p.muted, 0.82, 1.6) +
        `<text x="${n(x + 17)}" y="${n(base)}" class="mono" font-size="12.5" fill="${p.muted}">${esc(v)}</text>`,
    );
    x += 17 + textWidth(v, 12.5, mono) + 16;
  }
  if (validDate(repo.pushedAt)) {
    const ago = relativeTime(repo.pushedAt, ctx.now);
    const agoW = textWidth(ago, 12, mono);
    if (x + agoW + 18 <= W - P) {
      foot.push(
        icon('clock', W - P - agoW - 10, cy, p.muted, 0.72, 1.7) +
          `<text x="${W - P}" y="${n(base)}" text-anchor="end" class="mono" font-size="12" fill="${p.muted}">${esc(ago)}</text>`,
      );
    }
  }
  out.push(`<g class="fade" ${delay(0.2)}>${foot.join('')}</g>`);

  return shell({
    width: W,
    height: H,
    palette: p,
    title: `${repo.nameWithOwner} repository`,
    desc: describe(repo),
    radius: 16,
    defs: linearGradient('rp-accent', p.accentA, p.accentB),
    style: STYLE,
    glow: { cx: 0, cy: 0, r: 1, color: p.accentA, opacity: p.glowOpacity * 0.45 },
    body: accentBar(W) + out.join(''),
    animate: ctx.animate,
  });
}

// ── Detail layout (1200 × auto) ─────────────────────────────────────────────

interface Slice {
  name: string;
  color: string;
  value: number;
}

function languageSlices(repo: RepoInfo, p: Palette): Slice[] {
  let langs = (repo.languages ?? []).filter((l) => l.name && Number.isFinite(l.value) && l.value > 0);
  if (!langs.length) {
    const primary = primaryLanguage(repo);
    if (!primary) return [];
    langs = [{ name: primary.name, color: primary.color, value: 1 }];
  }
  const sorted = [...langs].sort((a, b) => b.value - a.value);
  const top: Slice[] = sorted.slice(0, 5).map((l) => ({ name: l.name, color: dataColor(l.color, p), value: l.value }));
  const rest = sorted.slice(5).reduce((sum, l) => sum + l.value, 0);
  if (rest > 0) top.push({ name: 'Other', color: otherColor(p, top.map((l) => l.color)), value: rest });
  return top;
}

function detailCard(ctx: RenderContext, repo: RepoInfo, s: Settings): string {
  const p = ctx.palette;
  const W = 1200;
  const P = 40;
  const CW = W - 2 * P;
  const mono = { mono: true };
  const out: string[] = [];

  // Header row: category label left, status chips right.
  const flags = [
    repo.isArchived && 'Archived',
    repo.isTemplate && 'Template',
    repo.isFork && 'Fork',
    repo.isPrivate && 'Private',
  ].filter((f): f is string => !!f);
  let right = W - P;
  const chips: string[] = [];
  for (const f of [...flags].reverse()) {
    const w = textWidth(f, 12, mono) + 26;
    right -= w;
    chips.push(
      chip(right, 39, w, 26, p, `<text x="${n(right + w / 2)}" y="56.5" text-anchor="middle" class="mono" font-size="12" fill="${p.muted}">${f}</text>`),
    );
    right -= 8;
  }
  const labelMax = right - P - 24;
  const category = s.title ? fitLabel(s.title.toUpperCase(), labelMax) : categoryLabel(repo, labelMax, 3);
  out.push(`<g class="fade">${label(P, 58, category, p)}${chips.join('')}</g>`);

  // Title.
  const title = titleText(repo, ownerShown(repo, ctx.data, s), CW * SAFE, 40, 800, p, ' / ');
  out.push(
    `<text class="sans up" ${delay(0.05)} x="${P}" y="114" font-size="40" font-weight="800" letter-spacing="-1">${title}</text>`,
  );

  // Description.
  const descY = 156;
  const descLh = 28;
  const desc = clean(repo.description);
  const rows = desc ? wrapPx(desc, CW * SAFE, 18, {}, s.descriptionLines) : [];
  if (rows.length) {
    out.push(
      `<g class="up" ${delay(0.12)}>` +
        rows
          .map((row, i) => `<text x="${P}" y="${descY + i * descLh}" class="sans" font-size="18" fill="${p.muted}">${esc(row)}</text>`)
          .join('') +
        '</g>',
    );
  } else {
    out.push(
      `<text class="sans up" ${delay(0.12)} x="${P}" y="${descY}" font-size="18" font-style="italic" fill="${p.faint}">${NO_DESCRIPTION}</text>`,
    );
  }
  let y = descY + (Math.max(1, rows.length) - 1) * descLh;

  // Meta row: release · last push · license · homepage.
  y += 44;
  const meta: { icon: IconName; color: string; spans: string; width: number }[] = [];
  const tag = clean(repo.latestRelease?.tag);
  if (tag) {
    const t = fit(tag, 220, 13, mono);
    const when = validDate(repo.latestRelease?.publishedAt) ? ` · ${shortDate(repo.latestRelease.publishedAt)}` : '';
    meta.push({
      icon: 'tag',
      color: p.accentB,
      spans: `<tspan fill="${p.text}" font-weight="600">${esc(t)}</tspan><tspan fill="${p.muted}">${esc(when)}</tspan>`,
      width: textWidth(t + when, 13, mono),
    });
  }
  if (validDate(repo.pushedAt)) {
    const t = `updated ${relativeTime(repo.pushedAt, ctx.now)}`;
    meta.push({ icon: 'clock', color: p.muted, spans: `<tspan fill="${p.muted}">${esc(t)}</tspan>`, width: textWidth(t, 13, mono) });
  }
  const license = clean(repo.license);
  if (license) {
    const t = fit(`${license} license`, 220, 13, mono);
    meta.push({ icon: 'law', color: p.muted, spans: `<tspan fill="${p.muted}">${esc(t)}</tspan>`, width: textWidth(t, 13, mono) });
  }
  const homepage = clean(repo.homepageUrl);
  const home = /^https?:\/\/[^\s/]/i.test(homepage)
    ? homepage
        .replace(/^https?:\/\/(www\.)?/i, '')
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
    : '';
  if (home) {
    const t = fit(home, 260, 13, mono);
    const color = ensureContrast(p.accentB, p.panel, 3.5, p.text);
    meta.push({ icon: 'globe', color, spans: `<tspan fill="${color}">${esc(t)}</tspan>`, width: textWidth(t, 13, mono) });
  }
  let mx = P;
  const metaSvg: string[] = [];
  for (const m of meta) {
    if (mx + 22 + m.width > W - P) break;
    metaSvg.push(icon(m.icon, mx + 8, y - 4.5, m.color, 0.95) + `<text x="${n(mx + 22)}" y="${y}" class="mono" font-size="13">${m.spans}</text>`);
    mx += 22 + m.width + 30;
  }
  if (metaSvg.length) out.push(`<g class="fade" ${delay(0.18)}>${metaSvg.join('')}</g>`);
  else y -= 30;

  // Stat tiles.
  y += 30;
  const stats: [IconName, string, number][] = [
    ['star', 'Stars', repo.stars],
    ['fork', 'Forks', repo.forks],
    ['issue', 'Open issues', repo.openIssues],
    ['pr', 'Open PRs', repo.openPullRequests],
    ['eye', 'Watchers', repo.watchers],
  ];
  const gap = 16;
  const tileW = (CW - gap * (stats.length - 1)) / stats.length;
  const tileH = 92;
  stats.forEach(([kind, name, value], i) => {
    const tx = P + i * (tileW + gap);
    const v = count(Math.max(0, value || 0));
    out.push(
      `<g class="up" ${delay(0.22 + i * 0.06)}>` +
        `<rect x="${n(tx)}" y="${y}" width="${n(tileW)}" height="${tileH}" rx="14" fill="${p.panelAlt}" stroke="${p.border}"/>` +
        icon(kind, tx + 28, y + 30, p.accentB, 1, 1.5) +
        `<text x="${n(tx + 46)}" y="${y + 34.5}" class="mono" font-size="12" letter-spacing="1" fill="${p.muted}">${esc(name.toUpperCase())}</text>` +
        `<text x="${n(tx + 20)}" y="${y + 74}" class="sans" font-size="30" font-weight="800" letter-spacing="-.8" fill="${p.text}">${esc(v)}</text>` +
        '</g>',
    );
  });
  y += tileH;

  // Language breakdown.
  const slices = languageSlices(repo, p);
  let defs = linearGradient('rp-accent', p.accentA, p.accentB);
  if (slices.length) {
    y += 48;
    const total = slices.reduce((sum, l) => sum + l.value, 0) || 1;
    const barY = y + 16;
    const barH = 10;
    out.push(
      `<text x="${P}" y="${y}" class="mono" font-size="12" letter-spacing="1.2" fill="${p.muted}">LANGUAGES</text>` +
        `<rect x="${P}" y="${barY}" width="${CW}" height="${barH}" rx="${barH / 2}" fill="${p.empty}"/>`,
    );
    defs += `<clipPath id="rp-lang"><rect x="${P}" y="${barY}" width="${CW}" height="${barH}" rx="${barH / 2}"/></clipPath>`;
    let bx = P;
    const segs = slices.map((l, i) => {
      const w = (l.value / total) * CW;
      const seg = `<rect class="rp-bar" ${delay(0.3 + i * 0.08)} x="${n(bx)}" y="${barY}" width="${n(Math.max(1.5, w - (i < slices.length - 1 ? 3 : 0)))}" height="${barH}" fill="${l.color}"/>`;
      bx += w;
      return seg;
    });
    out.push(`<g clip-path="url(#rp-lang)">${segs.join('')}</g>`);

    // Legend flows left to right, wrapping when needed.
    let lx = P;
    let ly = barY + barH + 32;
    const legend: string[] = [];
    for (const l of slices) {
      const name = fit(l.name, 220, 14, { weight: 600 });
      const pct = percent(l.value / total);
      const w = 18 + textWidth(name, 14, { weight: 600 }) + 8 + textWidth(pct, 13, mono);
      if (lx > P && lx + w > W - P) {
        lx = P;
        ly += 28;
      }
      legend.push(
        `<circle cx="${n(lx + 5)}" cy="${ly - 5}" r="5" fill="${l.color}"/>` +
          `<text x="${n(lx + 18)}" y="${ly}"><tspan class="sans" font-size="14" font-weight="600" fill="${p.text}">${esc(name)}</tspan>` +
          `<tspan dx="8" class="mono" font-size="13" fill="${p.muted}">${pct}</tspan></text>`,
      );
      lx += w + 32;
    }
    out.push(`<g class="fade" ${delay(0.4)}>${legend.join('')}</g>`);
    y = ly;
  }

  // Topics: as many chips as fit on one line, then "+N".
  const topics = (repo.topics ?? []).map(clean).filter(Boolean);
  if (topics.length) {
    y += 46;
    out.push(`<text x="${P}" y="${y}" class="mono" font-size="12" letter-spacing="1.2" fill="${p.muted}">TOPICS</text>`);
    const chipY = y + 14;
    const chipH = 28;
    const chipGap = 8;
    const chipFill = mix(p.panel, p.accentB, 0.1);
    const chipStroke = mix(p.panel, p.accentB, 0.28);
    const chipText = ensureContrast(p.accentB, chipFill, 4.5, p.text);
    const widths = topics.map((t) => {
      const text = fit(t, 300, 12.5, mono);
      return { text, w: textWidth(text, 12.5, mono) + 26 };
    });
    const moreW = (k: number) => textWidth(`+${k}`, 12.5, mono) + 26;
    let cx = P;
    let shown = 0;
    for (let i = 0; i < widths.length; i++) {
      const item = widths[i];
      if (!item) break;
      const remaining = widths.length - i - 1;
      const reserve = remaining > 0 ? chipGap + moreW(remaining) : 0;
      if (cx + item.w + reserve > W - P) break;
      out.push(
        `<g class="fade" ${delay(0.45 + i * 0.04)}><rect x="${n(cx)}" y="${chipY}" width="${n(item.w)}" height="${chipH}" rx="${chipH / 2}" fill="${chipFill}" stroke="${chipStroke}"/>` +
          `<text x="${n(cx + item.w / 2)}" y="${chipY + 18.5}" text-anchor="middle" class="mono" font-size="12.5" fill="${chipText}">${esc(item.text)}</text></g>`,
      );
      cx += item.w + chipGap;
      shown++;
    }
    const hidden = widths.length - shown;
    if (hidden > 0) {
      const w = moreW(hidden);
      out.push(
        `<g class="fade" ${delay(0.45 + shown * 0.04)}>` +
          chip(cx, chipY, w, chipH, p, `<text x="${n(cx + w / 2)}" y="${chipY + 18.5}" text-anchor="middle" class="mono" font-size="12.5" fill="${p.muted}">+${hidden}</text>`) +
          '</g>',
      );
    }
    y = chipY + chipH;
  }

  const H = Math.ceil(y + 40);
  return shell({
    width: W,
    height: H,
    palette: p,
    title: `${repo.nameWithOwner} repository`,
    desc: describe(repo),
    radius: 20,
    defs,
    style: STYLE,
    glow: { cx: 1, cy: 0, r: 0.8, color: p.accentB, opacity: p.glowOpacity * 0.3 },
    body: accentBar(W) + out.join(''),
    animate: ctx.animate,
  });
}

// ── Empty state ─────────────────────────────────────────────────────────────

function placeholder(ctx: RenderContext, s: Settings): CardImage {
  const p = ctx.palette;
  const detail = s.layout === 'detail';
  const W = detail ? 1200 : 400;
  const P = detail ? 40 : 24;
  const skeleton = mix(p.panel, p.faint, 0.18);
  const heading = 'No repositories yet';
  const message = 'Pin a repository on your profile or list some in the repos setting and they will appear here.';
  const out: string[] = [];
  let H: number;
  if (!detail) {
    H = 200;
    out.push(`<g class="fade">${label(P, 40, s.title ? fitLabel(s.title.toUpperCase(), W - 2 * P) : 'Repositories', p)}</g>`);
    out.push(
      `<g class="up" ${delay(0.05)}><circle cx="${P + 24}" cy="96" r="24" fill="${p.chipBg}" stroke="${p.border}"/>${icon('book', P + 24, 96, p.accentB, 1.3, 1.5)}</g>`,
    );
    const tx = P + 64;
    const rows = wrapPx(message, (W - P - tx) * SAFE, 13, {}, 3);
    out.push(
      `<g class="up" ${delay(0.12)}><text x="${tx}" y="82" class="sans" font-size="17" font-weight="700" letter-spacing="-.2" fill="${p.text}">${heading}</text>` +
        rows.map((r, i) => `<text x="${tx}" y="${104 + i * 19}" class="sans" font-size="13" fill="${p.muted}">${esc(r)}</text>`).join('') +
        '</g>',
    );
    out.push(
      `<g class="fade" ${delay(0.2)}><line x1="${P}" y1="164" x2="${W - P}" y2="164" stroke="${p.border}"/>` +
        `<circle cx="${P + 6}" cy="182" r="5.5" fill="${skeleton}"/>` +
        `<rect x="${P + 18}" y="177" width="64" height="10" rx="5" fill="${skeleton}"/>` +
        `<rect x="${P + 100}" y="177" width="36" height="10" rx="5" fill="${skeleton}"/>` +
        `<rect x="${P + 152}" y="177" width="28" height="10" rx="5" fill="${skeleton}"/></g>`,
    );
  } else {
    out.push(`<g class="fade">${label(P, 58, s.title ? fitLabel(s.title.toUpperCase(), W - 2 * P) : 'Repository', p)}</g>`);
    out.push(
      `<g class="up" ${delay(0.05)}><circle cx="${P + 32}" cy="122" r="32" fill="${p.chipBg}" stroke="${p.border}"/>${icon('book', P + 32, 122, p.accentB, 1.8, 1.4)}</g>`,
    );
    out.push(
      `<g class="up" ${delay(0.12)}><text x="${P + 88}" y="116" class="sans" font-size="28" font-weight="800" letter-spacing="-.6" fill="${p.text}">${heading}</text>` +
        `<text x="${P + 88}" y="146" class="sans" font-size="16" fill="${p.muted}">${esc(message)}</text></g>`,
    );
    const gap = 16;
    const tileW = (W - 2 * P - gap * 4) / 5;
    const tiles: string[] = [];
    for (let i = 0; i < 5; i++) {
      const tx = P + i * (tileW + gap);
      tiles.push(
        `<rect x="${n(tx)}" y="190" width="${n(tileW)}" height="64" rx="14" fill="${p.panelAlt}" stroke="${p.border}"/>` +
          `<rect x="${n(tx + 20)}" y="210" width="${n(tileW * 0.32)}" height="8" rx="4" fill="${skeleton}"/>` +
          `<rect x="${n(tx + 20)}" y="228" width="${n(tileW * 0.5)}" height="12" rx="6" fill="${skeleton}"/>`,
      );
    }
    out.push(`<g class="fade" ${delay(0.2)}>${tiles.join('')}</g>`);
    H = 294;
  }
  const svg = shell({
    width: W,
    height: H,
    palette: p,
    title: 'Repositories',
    desc: heading,
    radius: detail ? 20 : 16,
    defs: linearGradient('rp-accent', p.accentA, p.accentB),
    style: STYLE,
    glow: detail
      ? { cx: 1, cy: 0, r: 0.8, color: p.accentB, opacity: p.glowOpacity * 0.3 }
      : { cx: 0, cy: 0, r: 1, color: p.accentA, opacity: p.glowOpacity * 0.45 },
    body: accentBar(W) + out.join(''),
    animate: ctx.animate,
  });
  return { name: 'repos', alt: `Repositories: ${heading.toLowerCase()}`, svg, layout: detail ? 'full' : 'half' };
}

// ── Card definition ─────────────────────────────────────────────────────────

export const card: CardDefinition = {
  id: 'repos',
  title: 'Repo cards',
  description:
    'One card per repository: pinned or configured repos (else your most starred), as compact half-width tiles for your profile or a detailed full-width card for a project README.',
  options: [
    { key: 'layout', type: 'string', default: 'compact', description: '"compact" (400px half-width tiles) or "detail" (1200px card for a project README).' },
    { key: 'count', type: 'number', default: 4, description: 'How many repositories to render (1-12).' },
    {
      key: 'showOwner',
      type: 'boolean',
      description: 'Prefix the name with "owner/". Defaults to true for detail; compact shows it only for repos you do not own.',
    },
    { key: 'descriptionLines', type: 'number', description: 'Maximum description lines (1-4). Defaults to 3 for compact, 2 for detail.' },
    { key: 'title', type: 'string', description: 'Replaces the category label (default: primary language and topics, e.g. "TYPESCRIPT · REACT").' },
  ],
  render(ctx: RenderContext): CardImage[] {
    const s = readSettings(ctx);
    const repos = selectRepos(ctx.data, s.count);
    if (!repos.length) return [placeholder(ctx, s)];
    return repos.map((repo) => {
      const desc = clean(repo.description);
      return {
        name: `repo-${repoSlug(repo.nameWithOwner) || 'unnamed'}`,
        alt: desc ? `${repo.name}: ${desc}` : repo.name,
        svg: s.layout === 'detail' ? detailCard(ctx, repo, s) : compactCard(ctx, repo, s),
        link: repo.url,
        layout: s.layout === 'detail' ? 'full' : 'half',
      };
    });
  },
};
