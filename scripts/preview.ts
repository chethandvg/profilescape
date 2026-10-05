import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import { demoProfile, DEMO_NOW, emptyProfile } from '../src/core/fixtures.ts';
import { fetchProfile } from '../src/core/github.ts';
import { themeIds } from '../src/core/themes.ts';
import { CARD_IDS, type CardId, type Mode } from '../src/core/types.ts';
import { applyOverrides, getTheme } from '../src/core/themes.ts';
import type { CardDefinition } from '../src/core/types.ts';

/**
 * Render cards to SVG + PNG for visual review.
 *
 *   node scripts/preview.ts --card 3d --theme aurora
 *   node scripts/preview.ts --card all --theme all --mode dark
 *   node scripts/preview.ts --card stats --data empty
 *   GH_TOKEN=... node scripts/preview.ts --card all --user octocat
 *   node scripts/preview.ts --card repos --opts '{"layout":"detail"}'
 *
 * Output: preview/<card>/<theme>/<file>.svg|.png (PNG is a static frame; CSS animations are not rendered).
 */
const { values } = parseArgs({
  options: {
    card: { type: 'string', default: 'all' },
    theme: { type: 'string', default: 'aurora' },
    mode: { type: 'string', default: 'both' },
    data: { type: 'string', default: 'demo' },
    user: { type: 'string' },
    opts: { type: 'string' },
    out: { type: 'string', default: 'preview' },
    'no-png': { type: 'boolean', default: false },
  },
});

const cards = (values.card === 'all' ? [...CARD_IDS] : values.card.split(',')) as CardId[];
const themes = values.theme === 'all' ? themeIds() : values.theme.split(',');
const modes: Mode[] = values.mode === 'both' ? ['dark', 'light'] : [values.mode as Mode];

let data = values.data === 'empty' ? emptyProfile() : demoProfile();
let now = DEMO_NOW;
if (values.user) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Set GH_TOKEN to preview real data');
  now = new Date();
  data = await fetchProfile({ token, login: values.user, now, log: console.log });
}
const parsedOpts = values.opts ? JSON.parse(values.opts) : {};

// Card modules are imported one by one (not via the registry) so a card that is
// mid-edit or broken only affects its own preview.
const FILES: Record<CardId, string> = {
  stats: 'stats', languages: 'languages', '3d': 'landscape', grid: 'grid',
  repos: 'repos', hero: 'hero', stack: 'stack', socials: 'socials',
};
const files: { card: CardId; theme: string; path: string; svg: string }[] = [];
for (const id of cards) {
  let def: CardDefinition;
  try {
    def = (await import(`../src/cards/${FILES[id]}.ts`)).card;
  } catch (err) {
    console.error(`! ${id}: failed to load (${(err as Error).message})`);
    continue;
  }
  for (const themeId of themes) {
    const theme = getTheme(themeId);
    for (const mode of modes) {
      try {
        for (const img of def.render({ data, theme, palette: applyOverrides(theme[mode]), mode, options: parsedOpts, animate: true, now })) {
          files.push({ card: id, theme: themeId, path: `${img.name}-${mode}.svg`, svg: img.svg });
        }
      } catch (err) {
        console.error(`! ${id}/${themeId}/${mode}: render failed (${(err as Error).stack})`);
      }
    }
  }
}
{
  for (const f of files) {
    const theme = f.theme;
    const dir = join(values.out, f.card, theme);
    mkdirSync(dir, { recursive: true });
    const base = join(dir, f.path.replace(/\.svg$/, ''));
    writeFileSync(`${base}.svg`, f.svg);
    if (!values['no-png']) {
      const width = Number(/width="(\d+)"/.exec(f.svg)?.[1] ?? 800);
      const png = new Resvg(f.svg, {
        fitTo: { mode: 'zoom', value: width < 800 ? 2 : 1 },
        font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
      })
        .render()
        .asPng();
      writeFileSync(`${base}.png`, png);
    }
    console.log(`${base}.svg (${(f.svg.length / 1024).toFixed(1)} KB)`);
  }
}
