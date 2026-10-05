import { CARDS } from '../../src/cards/registry.ts';
import { DEMO_NOW } from '../../src/core/fixtures.ts';
import { themeList } from '../../src/core/themes.ts';
import { CARD_IDS, type CardId, type CardOptions, type Mode, type ProfileData } from '../../src/core/types.ts';
import { renderCards } from '../../src/render.ts';
import { byId, h } from './dom.ts';
import { svgImage } from './images.ts';
import { SHORT_TITLES } from './playground.ts';
import { onSiteModeChange, siteMode } from './site-theme.ts';

/**
 * Every card in every theme. Thumbnails are static (no animation) and are
 * rendered lazily, a few per frame, as their group scrolls near the viewport.
 */

/** How many images a multi-image card shows in one thumbnail. */
const MAX_IMAGES: Partial<Record<CardId, number>> = { repos: 2, socials: 3 };
const THUMB_OPTIONS: Partial<Record<CardId, CardOptions>> = {};

interface Thumb {
  card: CardId;
  theme: string;
  art: HTMLElement;
  mode: Mode | null;
}

export function initGallery(data: ProfileData, pick: (card: CardId, theme: string) => void): void {
  const root = byId('gallery-groups');
  const filters = byId('gallery-filters');
  const themes = themeList();
  const groups = new Map<CardId, { el: HTMLElement; thumbs: Thumb[]; visible: boolean }>();

  for (const id of CARD_IDS) {
    const card = CARDS[id];
    const thumbs: Thumb[] = [];
    const items = themes.map(({ id: theme, label }) => {
      const art = h('span', { class: `g-art g-art-${id === '3d' ? 'landscape' : id}`, 'aria-hidden': 'true' });
      thumbs.push({ card: id, theme, art, mode: null });
      return h(
        'li',
        {},
        h(
          'button',
          { type: 'button', class: 'g-thumb', onclick: () => pick(id, theme), 'aria-label': `Open ${card.title} in the ${label} theme in the playground` },
          art,
          h('span', { class: 'g-name' }, label),
        ),
      );
    });
    const el = h(
      'section',
      { class: 'g-group', 'data-card': id, 'aria-labelledby': `g-h-${id === '3d' ? 'landscape' : id}` },
      h('div', { class: 'g-head' }, h('h3', { id: `g-h-${id === '3d' ? 'landscape' : id}` }, card.title), h('p', { class: 'muted' }, card.description)),
      h('ul', { class: 'g-grid', role: 'list' }, ...items),
    );
    groups.set(id, { el, thumbs, visible: false });
    root.append(el);
  }

  // Filter: all cards or one card.
  const options: [string, string][] = [['all', 'All cards'], ...CARD_IDS.map((id): [string, string] => [id, SHORT_TITLES[id]])];
  filters.replaceChildren(
    ...options.map(([value, label]) =>
      h(
        'label',
        { class: 'seg' },
        h('input', {
          type: 'radio',
          class: 'seg-input',
          name: 'gallery-filter',
          value,
          checked: value === 'all',
          onchange: () => {
            for (const [id, g] of groups) g.el.hidden = value !== 'all' && value !== id;
          },
        }),
        h('span', {}, label),
      ),
    ),
  );

  // Lazy rendering queue, processed within a small time budget per frame.
  const queue: Thumb[] = [];
  let scheduled = false;
  const pump = () => {
    scheduled = false;
    const start = performance.now();
    while (queue.length && performance.now() - start < 12) {
      const t = queue.shift() as Thumb;
      const mode = siteMode();
      if (t.mode === mode) continue;
      const files = renderCards({ data, cards: [t.card], theme: t.theme, modes: [mode], animate: false, options: THUMB_OPTIONS, now: DEMO_NOW });
      const imgs = files.slice(0, MAX_IMAGES[t.card] ?? 1).map((f) => svgImage(f.svg, '', 'g-img'));
      t.art.replaceChildren(...imgs);
      t.mode = mode;
    }
    if (queue.length) tick();
  };
  const tick = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(pump);
  };
  const enqueue = (id: CardId) => {
    const g = groups.get(id);
    if (!g) return;
    for (const t of g.thumbs) if (t.mode !== siteMode() && !queue.includes(t)) queue.push(t);
    tick();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.card as CardId;
        const g = groups.get(id);
        if (!g) continue;
        g.visible = e.isIntersecting;
        if (e.isIntersecting) enqueue(id);
      }
    },
    { rootMargin: '600px 0px' },
  );
  for (const g of groups.values()) observer.observe(g.el);

  onSiteModeChange(() => {
    for (const [id, g] of groups) if (g.visible) enqueue(id);
  });
}
