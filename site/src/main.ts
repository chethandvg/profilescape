import { DEMO_NOW, demoProfile } from '../../src/core/fixtures.ts';
import { byId, scrollToSection } from './dom.ts';
import { initGallery } from './gallery.ts';
import { initHero } from './hero.ts';
import { initPlayground } from './playground.ts';
import { initSiteTheme } from './site-theme.ts';

/**
 * Website entry point. Everything renders client-side from the same engine
 * the Action uses (src/render.ts), with the deterministic demo profile.
 */

const data = demoProfile(DEMO_NOW);

initSiteTheme(byId<HTMLButtonElement>('theme-toggle'));

const playground = initPlayground(data);

initHero(data, (theme) => {
  playground.load({ ...playground.getState(), cards: ['3d'], theme }, { scroll: true });
});

initGallery(data, (card, theme) => {
  const current = playground.getState();
  playground.load({ ...current, cards: [card], theme }, { scroll: true });
});

// In-page links scroll without touching the hash, which holds the shareable playground state.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!link) return;
  const id = link.getAttribute('href')?.slice(1) ?? '';
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  e.preventDefault();
  scrollToSection(target);
});
