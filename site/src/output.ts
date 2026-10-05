import { DEFAULT_THEME } from '../../src/core/themes.ts';
import type { PaletteOverrides } from '../../src/core/types.ts';
import { activeOptions, COLOR_KEYS, DEFAULT_CARDS, encodeState, HASH_PREFIX, type PlaygroundState } from './state.ts';

/**
 * Generates what the user copies out of the playground: a workflow that only
 * sets non-default inputs, the README markers and a standalone config file.
 * DOM-free and testable in Node.
 */

export const SITE_URL = 'https://chethandvg.github.io/profilescape/';
export const ACTION_REF = 'chethandvg/profilescape@v1';
export const START_MARKER = '<!-- profilescape:start -->';
export const END_MARKER = '<!-- profilescape:end -->';

export interface ColorConfig {
  colors?: PaletteOverrides;
  darkColors?: PaletteOverrides;
  lightColors?: PaletteOverrides;
}

/** Colours set to the same value in both modes collapse into `colors`. */
export function colorConfig(state: PlaygroundState): ColorConfig {
  const colors: Record<string, string> = {};
  const darkColors: Record<string, string> = {};
  const lightColors: Record<string, string> = {};
  for (const key of COLOR_KEYS) {
    const d = state.dark[key];
    const l = state.light[key];
    if (d && l && d === l) colors[key] = d;
    else {
      if (d) darkColors[key] = d;
      if (l) lightColors[key] = l;
    }
  }
  const out: ColorConfig = {};
  if (Object.keys(colors).length) out.colors = colors;
  if (Object.keys(darkColors).length) out.darkColors = darkColors;
  if (Object.keys(lightColors).length) out.lightColors = lightColors;
  return out;
}

/** Options and colours: the parts of a configuration that have no Action input. */
export function inlineConfig(state: PlaygroundState): Record<string, unknown> | null {
  const options = activeOptions(state);
  const out: Record<string, unknown> = { ...colorConfig(state) };
  if (Object.keys(options).length) out.options = options;
  return Object.keys(out).length ? out : null;
}

/** A complete config file for the CLI (`--config`) or the Action's `config` input. */
export function configFile(state: PlaygroundState): string {
  const out: Record<string, unknown> = { theme: state.theme, cards: state.cards };
  if (!state.animate) out.animate = false;
  Object.assign(out, inlineConfig(state) ?? {});
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function shareUrl(state: PlaygroundState): string {
  const q = encodeState(state);
  return q ? `${SITE_URL}${HASH_PREFIX}${q}` : SITE_URL;
}

/** A GitHub Actions expression, e.g. ${{ github.token }}. */
const GH = (expr: string) => '${{ ' + expr + ' }}';

export function workflowYaml(state: PlaygroundState): string {
  const inputs: string[] = [];
  if (state.cards.join(',') !== DEFAULT_CARDS.join(',')) inputs.push(`cards: ${state.cards.join(',')}`);
  if (state.theme !== DEFAULT_THEME) inputs.push(`theme: ${state.theme}`);
  if (!state.animate) inputs.push('animate: false');
  inputs.push('readme: README.md');
  inputs.push('# Optional: add a PROFILESCAPE_TOKEN secret to include private contributions.');
  inputs.push(`token: ${GH('secrets.PROFILESCAPE_TOKEN || github.token')}`);
  const config = inlineConfig(state);
  if (config) {
    inputs.push('config: |');
    for (const line of JSON.stringify(config, null, 2).split('\n')) inputs.push(`  ${line}`);
  }
  const edit = encodeState(state) ? [`# Edit this setup in the playground: ${shareUrl(state)}`] : [`# Try every card and theme: ${SITE_URL}`];
  return [
    'name: Profilescape',
    '',
    `# Renders your cards every day and keeps README.md up to date between the`,
    `# ${START_MARKER} and ${END_MARKER} markers.`,
    ...edit,
    '',
    'on:',
    '  schedule:',
    '    - cron: "23 4 * * *" # every day at 04:23 UTC',
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: write',
    '',
    'concurrency:',
    '  group: profilescape',
    '  cancel-in-progress: true',
    '',
    'jobs:',
    '  cards:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 10',
    '    steps:',
    `      - uses: ${ACTION_REF}`,
    '        with:',
    ...inputs.map((l) => `          ${l}`),
    '',
  ].join('\n');
}

export function readmeSnippet(): string {
  return `${START_MARKER}\n${END_MARKER}\n`;
}
