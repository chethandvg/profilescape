import { DEMO_NOW } from '../../src/core/fixtures.ts';
import { getTheme, themeIds } from '../../src/core/themes.ts';
import type { ProfileData } from '../../src/core/types.ts';
import { renderCards } from '../../src/render.ts';
import { byId, h } from './dom.ts';
import { setSvgSource } from './images.ts';
import { onSiteModeChange, siteMode } from './site-theme.ts';

/** Landing hero: the flagship 3D card, rendered live in the browser, with a few themes to flip through. */

const HERO_THEMES = ['aurora', 'tokyonight', 'dracula', 'catppuccin', 'gruvbox', 'sunset'].filter((id) => themeIds().includes(id));

export function initHero(data: ProfileData, openInPlayground: (theme: string) => void): void {
  const img = byId<HTMLImageElement>('hero-card');
  const swatches = byId('hero-swatches');
  const open = byId<HTMLAnchorElement>('hero-open');
  let theme = 'aurora';

  const draw = () => {
    const [file] = renderCards({ data, cards: ['3d'], theme, modes: [siteMode()], animate: true, now: DEMO_NOW });
    if (!file) return;
    setSvgSource(img, file.svg);
    img.alt = file.alt;
  };

  const buttons = HERO_THEMES.map((id) => {
    const t = getTheme(id);
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'hero-swatch',
        'aria-pressed': String(id === theme),
        title: t.label,
        style: `--a:${t.dark.accentA};--b:${t.dark.accentB};--p:${t.dark.panel}`,
        onclick: () => {
          theme = id;
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === btn));
          draw();
        },
      },
      h('span', { class: 'sr-only' }, `Render the 3D card in the ${t.label} theme`),
    );
    return btn;
  });
  swatches.replaceChildren(...buttons);

  open.addEventListener('click', (e) => {
    e.preventDefault();
    openInPlayground(theme);
  });

  draw();
  onSiteModeChange(draw);
}
