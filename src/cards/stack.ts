import { displayName, plural } from '../core/format.ts';
import { readOptions } from '../core/options.ts';
import { delay, esc, fit, fitLabel, label, labelWidth, n, shell, textWidth } from '../core/svg.ts';
import type { CardDefinition, Palette, ProfileData, RenderContext } from '../core/types.ts';
import { drawIcon, type Icon, legible, resolveIcon } from './icons.ts';

const W = 1200;
const PAD = 40;
/** Header label baseline, shared by every full-width card. */
const HEADER_Y = 56;
const MAX_ICONS = 48;

interface Item {
  icon: Icon;
  label: string;
}

/** "csharp" or "csharp:C# 13" → icon + display label. */
function parseItem(entry: string): Item | null {
  const i = entry.indexOf(':');
  const key = (i > 0 ? entry.slice(0, i) : entry).trim();
  const custom = i > 0 ? entry.slice(i + 1).trim() : '';
  if (!key) return null;
  const icon = resolveIcon(key);
  return { icon, label: custom || displayName(icon.title) };
}

/** Top languages that have a known icon, de-duplicated by slug. */
export function defaultStack(data: ProfileData, limit = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const lang of data.languages) {
    const icon = resolveIcon(lang.name);
    if (!icon.known || seen.has(icon.slug)) continue;
    seen.add(icon.slug);
    out.push(lang.name);
    if (out.length >= limit) break;
  }
  return out;
}

function items(ctx: RenderContext): Item[] {
  const o = readOptions(ctx.options);
  const requested = o.has('icons') ? o.list('icons', []) : defaultStack(ctx.data);
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const entry of requested) {
    const item = parseItem(entry);
    if (!item) continue;
    const key = `${item.icon.slug}|${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_ICONS) break;
  }
  return out;
}

function iconColor(icon: Icon, bg: string, p: Palette): string {
  return legible(icon.hex || p.accentA, bg, p.text);
}

interface Layout {
  body: string;
  defs: string;
  height: number;
}

function tiles(list: Item[], top: number, perRow: number, ctx: RenderContext): Layout {
  const p = ctx.palette;
  const gap = 16;
  const tileW = (W - PAD * 2 - gap * (perRow - 1)) / perRow;
  const iconSize = Math.round(Math.min(46, Math.max(26, tileW * 0.36)));
  const labelSize = tileW < 96 ? 12 : 14;
  const tileH = Math.round(iconSize + 78);
  const glowOpacity = ctx.mode === 'dark' ? 0.2 : 0.13;
  const gradients = new Map<string, string>();
  const parts: string[] = [];
  const rows = Math.ceil(list.length / perRow);
  list.forEach((item, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, list.length - row * perRow);
    const rowWidth = inRow * tileW + (inRow - 1) * gap;
    const x = (W - rowWidth) / 2 + col * (tileW + gap);
    const y = top + row * (tileH + gap);
    const color = iconColor(item.icon, p.panelAlt, p);
    let gid = gradients.get(color);
    if (!gid) {
      gid = `sg${gradients.size}`;
      gradients.set(color, gid);
    }
    const cx = x + tileW / 2;
    const iy = y + 24;
    const text = fit(item.label, tileW - 16, labelSize, { weight: 600 });
    parts.push(
      `<g class="up" ${delay(0.08 + Math.min(i, 24) * 0.035)}>` +
        `<rect x="${n(x, 2)}" y="${n(y, 2)}" width="${n(tileW, 2)}" height="${tileH}" rx="14" fill="${p.panelAlt}" stroke="${p.border}"/>` +
        `<circle cx="${n(cx, 2)}" cy="${n(iy + iconSize / 2, 2)}" r="${n(iconSize * 1.05, 2)}" fill="url(#${gid})"/>` +
        drawIcon(item.icon, cx - iconSize / 2, iy, iconSize, { color, inks: [p.panel, p.text] }) +
        `<text x="${n(cx, 2)}" y="${n(y + tileH - 22, 2)}" text-anchor="middle" class="sans" font-size="${labelSize}" font-weight="600" fill="${p.text}">${esc(text)}</text>` +
        '</g>',
    );
  });
  const defs = [...gradients]
    .map(
      ([color, id]) =>
        `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${glowOpacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    )
    .join('');
  return { body: parts.join(''), defs, height: rows * tileH + (rows - 1) * gap };
}

function chips(list: Item[], top: number, ctx: RenderContext): Layout {
  const p = ctx.palette;
  const h = 44;
  const gap = 12;
  const iconSize = 20;
  const fontSize = 15;
  const maxW = W - PAD * 2;
  const placed: { item: Item; w: number; text: string }[][] = [[]];
  let rowW = 0;
  for (const item of list) {
    const text = fit(item.label, 360, fontSize, { weight: 600 });
    // Small slack on the estimate so real font widths never touch the pill edge.
    const w = Math.ceil(16 + iconSize + 10 + textWidth(text, fontSize, { weight: 600 }) + 20);
    let row = placed[placed.length - 1] as { item: Item; w: number; text: string }[];
    if (row.length && rowW + gap + w > maxW) {
      row = [];
      placed.push(row);
      rowW = 0;
    }
    rowW += (row.length ? gap : 0) + w;
    row.push({ item, w, text });
  }
  const parts: string[] = [];
  let i = 0;
  placed.forEach((row, r) => {
    let x = PAD;
    const y = top + r * (h + gap);
    for (const { item, w, text } of row) {
      const color = iconColor(item.icon, p.chipBg, p);
      parts.push(
        `<g class="up" ${delay(0.08 + Math.min(i, 24) * 0.03)}>` +
          `<rect x="${n(x, 2)}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${p.chipBg}" stroke="${p.border}"/>` +
          drawIcon(item.icon, x + 16, y + (h - iconSize) / 2, iconSize, { color, inks: [p.panel, p.text] }) +
          `<text x="${n(x + 16 + iconSize + 10, 2)}" y="${y + h / 2 + 5.3}" class="sans" font-size="${fontSize}" font-weight="600" fill="${p.text}">${esc(text)}</text>` +
          '</g>',
      );
      x += w + gap;
      i++;
    }
  });
  return { body: parts.join(''), defs: '', height: placed.length * h + (placed.length - 1) * gap };
}

function emptyState(top: number, p: Palette): Layout {
  const h = 112;
  return {
    body:
      '<g class="fade">' +
      `<rect x="${PAD + 0.5}" y="${top + 0.5}" width="${W - PAD * 2 - 1}" height="${h - 1}" rx="14" fill="${p.panelAlt}" fill-opacity=".6" stroke="${p.faint}" stroke-opacity=".45" stroke-dasharray="5 5"/>` +
      `<text x="${W / 2}" y="${top + 50}" text-anchor="middle" class="sans" font-size="16" font-weight="600" fill="${p.muted}">No tech stack to show yet</text>` +
      `<text x="${W / 2}" y="${top + 76}" text-anchor="middle" class="mono" font-size="12.5" fill="${p.muted}">Pick icons with the "icons" option, e.g. typescript, docker, postgres</text>` +
      '</g>',
    defs: '',
    height: h,
  };
}

export const card: CardDefinition = {
  id: 'stack',
  title: 'Tech stack',
  description: 'Brand icons for the technologies you use, as tiles or pills. Missing logos fall back to tasteful monograms.',
  options: [
    {
      key: 'icons',
      type: 'list',
      default: 'top languages with an icon (max 8)',
      description: 'Technologies to show: slugs or aliases (typescript, csharp, k8s, aws…). Append ":Label" to rename one.',
    },
    { key: 'style', type: 'string', default: 'tiles', description: '"tiles" (icon above label) or "chips" (pill per technology).' },
    { key: 'title', type: 'string', default: 'Tech stack', description: 'Header label.' },
    { key: 'hideTitle', type: 'boolean', default: false, description: 'Hide the header row.' },
    { key: 'perRow', type: 'number', default: 8, description: 'Tiles per row (3–12); rows wrap and the card grows.' },
  ],
  render(ctx) {
    const p = ctx.palette;
    const o = readOptions(ctx.options);
    const list = items(ctx);
    const style = o.oneOf('style', ['tiles', 'chips'] as const, 'tiles');
    const perRow = Math.round(o.number('perRow', 8, { min: 3, max: 12 }));
    const title = o.string('title', 'Tech stack');
    const hideTitle = o.boolean('hideTitle', false);
    const top = hideTitle ? PAD : 80;
    const layout = !list.length ? emptyState(top, p) : style === 'chips' ? chips(list, top, ctx) : tiles(list, top, perRow, ctx);
    const height = Math.round(top + layout.height + PAD);
    const countText = list.length ? `${list.length} ${plural(list.length, 'technology', 'technologies')}` : '';
    const titleRoom = W - PAD * 2 - (countText ? labelWidth(countText) + 32 : 0);
    const header = hideTitle
      ? ''
      : `<g class="fade">${label(PAD, HEADER_Y, fitLabel(title, titleRoom), p)}` +
        (countText ? label(W - PAD, HEADER_Y, countText, p, { anchor: 'end', color: p.muted }) : '') +
        '</g>';
    const names = list.map((i) => i.label);
    const alt = names.length ? `${title}: ${names.join(', ')}` : `${title}: nothing to show yet`;
    return [
      {
        name: 'stack',
        alt,
        layout: 'full',
        svg: shell({
          width: W,
          height,
          palette: p,
          title,
          desc: alt,
          defs: layout.defs,
          body: header + layout.body,
          radius: 20,
          glow: { cx: 0.08, cy: 0, r: 0.9, color: p.accentA, opacity: p.glowOpacity * 0.22 },
          animate: ctx.animate,
        }),
      },
    ];
  },
};
