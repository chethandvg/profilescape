import { CARDS } from './cards/registry.ts';
import { applyOverrides, getTheme } from './core/themes.ts';
import { esc } from './core/svg.ts';
import type { CardId, CardOptions, Mode, PaletteOverrides, ProfileData, Theme } from './core/types.ts';

/** Browser-safe entry point shared by the Action, CLI, gallery and playground. */

export interface RenderRequest {
  data: ProfileData;
  cards: CardId[];
  theme?: string | Theme;
  colors?: PaletteOverrides;
  darkColors?: PaletteOverrides;
  lightColors?: PaletteOverrides;
  modes?: Mode[];
  options?: Partial<Record<CardId, CardOptions>>;
  animate?: boolean;
  now?: Date;
}

export interface RenderedFile {
  card: CardId;
  /** File stem without mode, e.g. "stats". */
  name: string;
  mode: Mode;
  /** e.g. "stats-dark.svg" */
  path: string;
  alt: string;
  svg: string;
  link?: string;
  layout: 'full' | 'half';
}

export function renderCards(req: RenderRequest): RenderedFile[] {
  const theme = typeof req.theme === 'object' ? req.theme : getTheme(req.theme);
  const modes = req.modes?.length ? req.modes : (['dark', 'light'] as Mode[]);
  const now = req.now ?? new Date();
  const animate = req.animate ?? true;
  const files: RenderedFile[] = [];
  for (const id of req.cards) {
    const card = CARDS[id];
    if (!card) throw new Error(`Unknown card "${id}"`);
    for (const mode of modes) {
      const palette = applyOverrides(theme[mode], req.colors, mode === 'dark' ? req.darkColors : req.lightColors);
      const images = card.render({ data: req.data, theme, palette, mode, options: req.options?.[id] ?? {}, animate, now });
      for (const img of images) {
        files.push({
          card: id,
          name: img.name,
          mode,
          path: `${img.name}-${mode}.svg`,
          alt: img.alt,
          svg: img.svg,
          link: img.link,
          layout: img.layout ?? 'full',
        });
      }
    }
  }
  return files;
}

function picture(baseUrl: string, group: RenderedFile[], width: string): string {
  const first = group[0] as RenderedFile;
  const dark = group.find((f) => f.mode === 'dark');
  const light = group.find((f) => f.mode === 'light');
  const url = (f: RenderedFile) => `${baseUrl.replace(/\/$/, '')}/${f.path}`;
  const fallback = light ?? dark ?? first;
  const img = `<img src="${esc(url(fallback))}" alt="${esc(first.alt)}" width="${width}" />`;
  const inner =
    dark && light
      ? `<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${esc(url(dark))}" />\n  ${img}\n</picture>`
      : img;
  return first.link ? `<a href="${esc(first.link)}">\n${inner}\n</a>` : inner;
}

/**
 * Ready-to-paste README markup. Dark/light variants become <picture> elements
 * that follow the viewer's GitHub theme; half-width images are paired in a table.
 */
export function readmeMarkup(files: RenderedFile[], baseUrl: string): string {
  const groups = new Map<string, RenderedFile[]>();
  for (const f of files) groups.set(f.name, [...(groups.get(f.name) ?? []), f]);
  const blocks: string[] = [];
  const pending: RenderedFile[][] = [];
  const flushHalves = () => {
    for (let i = 0; i < pending.length; i += 2) {
      const cells = pending.slice(i, i + 2).map((g) => `    <td width="50%">\n${picture(baseUrl, g, '100%')}\n    </td>`);
      blocks.push(`<table>\n  <tr>\n${cells.join('\n')}\n  </tr>\n</table>`);
    }
    pending.length = 0;
  };
  for (const group of groups.values()) {
    if ((group[0] as RenderedFile).layout === 'half') pending.push(group);
    else {
      flushHalves();
      blocks.push(picture(baseUrl, group, '100%'));
    }
  }
  flushHalves();
  return blocks.join('\n\n');
}
