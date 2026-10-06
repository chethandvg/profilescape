import { CARDS } from '../../src/cards/registry.ts';
import { DEFAULT_THEME, themeIds } from '../../src/core/themes.ts';
import { CARD_IDS, type CardId, type CardOptions } from '../../src/core/types.ts';
import { cleanOptions } from './fields.ts';

/**
 * Playground state and its URL-hash encoding. Shared links look like
 * `#playground?cards=hero,3d&theme=nord&opts={...}` so they stay readable and
 * scroll straight to the playground. DOM-free and testable in Node.
 */

export type PreviewMode = 'dark' | 'light' | 'both';
export type ColorKey = 'accentA' | 'accentB' | 'panel' | 'text';
export const COLOR_KEYS: readonly ColorKey[] = ['accentA', 'accentB', 'panel', 'text'];
export const COLOR_LABELS: Record<ColorKey, string> = {
  accentA: 'Accent A',
  accentB: 'Accent B',
  panel: 'Panel',
  text: 'Text',
};

export type ColorOverrides = Partial<Record<ColorKey, string>>;

export interface PlaygroundState {
  /** Selected cards in README order. */
  cards: CardId[];
  theme: string;
  /** Which variants the preview shows; the workflow always renders both. */
  mode: PreviewMode;
  animate: boolean;
  options: Partial<Record<CardId, CardOptions>>;
  dark: ColorOverrides;
  light: ColorOverrides;
}

/** Mirrors the Action's defaults, so an untouched playground yields a minimal workflow. */
export const DEFAULT_CARDS: CardId[] = ['stats', '3d', 'languages', 'repos'];

export function defaultState(): PlaygroundState {
  return { cards: [...DEFAULT_CARDS], theme: DEFAULT_THEME, mode: 'dark', animate: true, options: {}, dark: {}, light: {} };
}

export const HASH_PREFIX = '#playground?';

const HEX = /^#?([0-9a-f]{6})$/i;

export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = HEX.exec(value.trim());
  return m ? `#${(m[1] as string).toUpperCase()}` : undefined;
}

/**
 * The registry's own id equal to `value`, or undefined. State can come from a
 * shared link, so every computed key written into an options record is the
 * constant from CARD_IDS rather than the incoming string.
 */
export function toCardId(value: unknown): CardId | undefined {
  return CARD_IDS.find((id) => id === value);
}

/** Store one card's options, or drop the entry when they are empty or missing. */
export function setCardOptions(state: PlaygroundState, id: CardId, options: CardOptions | undefined): void {
  const key = toCardId(id);
  if (!key) return;
  if (options && Object.keys(options).length) state.options[key] = options;
  else delete state.options[key];
}

/** Options for the selected cards only, without unknown keys or default values. */
export function activeOptions(state: PlaygroundState): Partial<Record<CardId, CardOptions>> {
  const out: Partial<Record<CardId, CardOptions>> = {};
  for (const card of state.cards) {
    const id = toCardId(card);
    if (!id) continue;
    const clean = cleanOptions(CARDS[id], state.options[id]);
    if (Object.keys(clean).length) out[id] = clean;
  }
  return out;
}

/** "a:1,b:2" style colour lists keep links short: accentA:8B7CFF,panel:101010 */
function encodeColors(c: ColorOverrides): string {
  return COLOR_KEYS.filter((k) => c[k]).map((k) => `${k}:${(c[k] as string).slice(1)}`).join(',');
}

function decodeColors(text: string | null): ColorOverrides {
  const out: ColorOverrides = {};
  if (!text) return out;
  // A Map keeps link-supplied names away from object keys; only known colour keys are read back.
  const pairs = new Map<string, string>();
  for (const part of text.split(',')) {
    const [k, v] = part.split(':');
    if (k && v) pairs.set(k.trim(), v.trim());
  }
  for (const key of COLOR_KEYS) {
    const hex = normalizeHex(pairs.get(key));
    if (hex) out[key] = hex;
  }
  return out;
}

/** Query string for the state (without the prefix); empty for the default state. */
export function encodeState(state: PlaygroundState): string {
  const d = defaultState();
  const p = new URLSearchParams();
  if (state.cards.join(',') !== d.cards.join(',')) p.set('cards', state.cards.join(','));
  if (state.theme !== d.theme) p.set('theme', state.theme);
  if (state.mode !== d.mode) p.set('mode', state.mode);
  if (!state.animate) p.set('animate', '0');
  const opts = activeOptions(state);
  if (Object.keys(opts).length) p.set('opts', JSON.stringify(opts));
  const dark = encodeColors(state.dark);
  const light = encodeColors(state.light);
  if (dark) p.set('dark', dark);
  if (light) p.set('light', light);
  return p.toString();
}

export function stateToHash(state: PlaygroundState): string {
  const q = encodeState(state);
  return q ? HASH_PREFIX + q : '';
}

/** True when a location hash carries playground state. */
export function isStateHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX);
}

/** Parse a hash produced by stateToHash. Anything invalid falls back to defaults. */
export function decodeState(hash: string): PlaygroundState {
  const state = defaultState();
  if (!isStateHash(hash)) return state;
  const p = new URLSearchParams(hash.slice(HASH_PREFIX.length));
  const cards: CardId[] = [];
  for (const part of (p.get('cards') ?? '').split(',')) {
    const id = toCardId(part.trim().toLowerCase());
    if (id && !cards.includes(id)) cards.push(id);
  }
  if (p.has('cards') && cards.length) state.cards = cards;
  const theme = (p.get('theme') ?? '').trim().toLowerCase();
  if (themeIds().includes(theme)) state.theme = theme;
  const mode = p.get('mode');
  if (mode === 'dark' || mode === 'light' || mode === 'both') state.mode = mode;
  state.animate = p.get('animate') !== '0';
  const rawOpts = p.get('opts');
  if (rawOpts) {
    try {
      const parsed = JSON.parse(rawOpts) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        for (const id of CARD_IDS) {
          const v = (parsed as Record<string, unknown>)[id];
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) state.options[id] = cleanOptions(CARDS[id], v as CardOptions);
        }
      }
    } catch {
      // A truncated or hand-edited link should still open the playground.
    }
  }
  state.dark = decodeColors(p.get('dark'));
  state.light = decodeColors(p.get('light'));
  return state;
}
