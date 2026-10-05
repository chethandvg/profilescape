import type { Mode } from '../../src/core/types.ts';
import { storageGet, storageSet } from './dom.ts';

/**
 * The page's own colour scheme. Dark first: we follow the system preference
 * until the visitor picks one with the toggle, then remember it. An inline
 * script in index.html applies the stored choice before first paint.
 */

export const THEME_KEY = 'profilescape:theme';

const listeners = new Set<(mode: Mode) => void>();
const lightQuery = () => window.matchMedia('(prefers-color-scheme: light)');

export function siteMode(): Mode {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark' || t === 'light') return t;
  return lightQuery().matches ? 'light' : 'dark';
}

export function onSiteModeChange(fn: (mode: Mode) => void): void {
  listeners.add(fn);
}

function apply(mode: Mode): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0B0D14' : '#F7F7FC');
  if (document.documentElement.dataset.theme === mode) return;
  document.documentElement.dataset.theme = mode;
  for (const fn of listeners) fn(mode);
}

export function initSiteTheme(button: HTMLButtonElement): void {
  const sync = () => {
    const mode = siteMode();
    const next = mode === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
    button.dataset.mode = mode;
  };
  const stored = storageGet(THEME_KEY);
  apply(stored === 'dark' || stored === 'light' ? stored : lightQuery().matches ? 'light' : 'dark');
  sync();
  button.addEventListener('click', () => {
    const next: Mode = siteMode() === 'dark' ? 'light' : 'dark';
    storageSet(THEME_KEY, next);
    apply(next);
    sync();
  });
  lightQuery().addEventListener('change', (e) => {
    const pinned = storageGet(THEME_KEY);
    if (pinned === 'dark' || pinned === 'light') return;
    apply(e.matches ? 'light' : 'dark');
    sync();
  });
}
