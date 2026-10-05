import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoProfile, DEMO_NOW, emptyProfile } from '../core/fixtures.ts';
import { contrast } from '../core/svg.ts';
import { getTheme } from '../core/themes.ts';
import type { CardOptions, Mode, ProfileData } from '../core/types.ts';
import { ICONS } from './icons.generated.ts';
import { drawIcon, iconCatalog, isKnownIcon, legible, resolveIcon, slugify } from './icons.ts';
import { card, defaultStack } from './stack.ts';

const HOSTILE = `<script>&"'`;

function render(data: ProfileData, options: CardOptions = {}, mode: Mode = 'dark', animate = true): string {
  const theme = getTheme('aurora');
  const images = card.render({ data, theme, palette: theme[mode], mode, options, animate, now: DEMO_NOW });
  assert.equal(images.length, 1);
  const img = images[0];
  assert.ok(img);
  assert.equal(img.name, 'stack');
  return img.svg;
}

function assertValidSvg(svg: string): void {
  assert.doesNotMatch(svg, /NaN|undefined|Infinity|\[object/);
  assert.doesNotMatch(svg, /&(?!(amp|lt|gt|quot|#39|#\d+|#x[0-9a-f]+);)/i, 'unescaped &');
  const stack: string[] = [];
  const body = svg.replace(/<style>[\s\S]*?<\/style>/g, '<style/>');
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const [, close, tag, attrs = '', self] = m;
    const names = [...attrs.matchAll(/([\w:-]+)="/g)].map((a) => a[1]);
    assert.equal(new Set(names).size, names.length, `duplicate attribute on <${tag}${attrs}>`);
    if (close) assert.equal(stack.pop(), tag, `mismatched </${tag}>`);
    else if (!self) stack.push(tag as string);
  }
  assert.deepEqual(stack, [], 'unclosed tags');
  const stripped = body.replace(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g, '');
  assert.doesNotMatch(stripped, /[<>]/, 'stray angle bracket');
}

const height = (svg: string) => Number(/height="(\d+)"/.exec(svg)?.[1]);

test('demo profile shows top languages as tiles in both modes', () => {
  assert.deepEqual(defaultStack(demoProfile()), ['TypeScript', 'Rust', 'Go', 'C#', 'Python', 'CSS', 'Shell']);
  for (const mode of ['dark', 'light'] as const) {
    const svg = render(demoProfile(), {}, mode);
    assertValidSvg(svg);
    assert.match(svg, /width="1200"/);
    assert.match(svg, /TECH STACK/);
    assert.match(svg, /7 TECHNOLOGIES/);
    for (const name of ['TypeScript', 'Rust', 'Go', 'Python', 'CSS', 'Bash']) assert.match(svg, new RegExp(`>${name}<`));
    // C# has no Simple Icons logo: a monogram tile instead.
    assert.match(svg, />C#<\/text>/);
  }
});

test('empty profile shows a friendly empty state', () => {
  for (const mode of ['dark', 'light'] as const) {
    const svg = render(emptyProfile(), {}, mode);
    assertValidSvg(svg);
    assert.match(svg, /No tech stack to show yet/);
    assert.doesNotMatch(svg, /TECHNOLOGIES/);
  }
  assertValidSvg(render(emptyProfile(), { icons: [], hideTitle: true, style: 'chips' }));
});

test('chips style, aliases, custom labels and monogram fallbacks', () => {
  const svg = render(demoProfile(), { style: 'chips', icons: 'csharp, azure, aws, k8s, postgres, vscode, dotnet:ASP.NET Core, my-lib' });
  assertValidSvg(svg);
  assert.match(svg, /rx="22"/);
  for (const label of ['C#', 'Azure', 'AWS', 'Kubernetes', 'PostgreSQL', 'VS Code', 'ASP.NET Core', 'my-lib']) {
    assert.match(svg, new RegExp(`>${label.replace('.', '\\.')}<`), label);
  }
  assert.match(svg, />Az<\/text>/);
  assert.match(svg, />aws<\/text>/);
});

test('rows wrap and the card grows', () => {
  const icons = ['typescript', 'react', 'docker', 'go', 'rust', 'python', 'redis', 'git', 'linux', 'figma'];
  const one = height(render(demoProfile(), { icons: icons.slice(0, 4), perRow: 8 }));
  const two = height(render(demoProfile(), { icons, perRow: 8 }));
  const three = height(render(demoProfile(), { icons, perRow: 4 }));
  assert.ok(one < two && two < three, `${one} ${two} ${three}`);
  const chips = height(render(demoProfile(), { icons: [...icons, ...icons.map((i) => `${i}:${i} again`)], style: 'chips' }));
  assert.ok(chips > height(render(demoProfile(), { icons: icons.slice(0, 3), style: 'chips' })));
});

test('title options and hostile labels', () => {
  assert.doesNotMatch(render(demoProfile(), { hideTitle: true }), /TECH STACK/);
  assert.match(render(demoProfile(), { title: 'Tools I love' }), /TOOLS I LOVE/);
  const svg = render(demoProfile(), { title: HOSTILE, icons: [HOSTILE, `react:${HOSTILE}`] });
  assertValidSvg(svg);
  assert.doesNotMatch(svg, /<script/);
  assert.match(svg, /&lt;script&gt;&amp;&quot;&#39;/);
});

test('output is deterministic', () => {
  assert.equal(render(demoProfile()), render(demoProfile()));
  assert.equal(render(demoProfile(), { style: 'chips' }, 'light'), render(demoProfile(), { style: 'chips' }, 'light'));
});

test('icon lookup: slugs, aliases, GitHub language names and fallbacks', () => {
  assert.equal(slugify('Node.js'), 'nodedotjs');
  assert.equal(slugify('C#'), 'csharp');
  assert.equal(slugify('C++'), 'cplusplus');
  const cases: [string, string][] = [
    ['k8s', 'kubernetes'], ['postgres', 'postgresql'], ['ts', 'typescript'], ['JS', 'javascript'], ['py', 'python'],
    ['Node.js', 'nodedotjs'], ['next', 'nextdotjs'], ['.NET', 'dotnet'], ['dotnet', 'dotnet'], ['c#', 'csharp'],
    ['cs', 'csharp'], ['aws', 'amazonwebservices'], ['azure', 'microsoftazure'], ['vscode', 'visualstudiocode'],
    ['Jupyter Notebook', 'jupyter'], ['Shell', 'gnubash'], ['HTML', 'html5'], ['twitter', 'x'], ['golang', 'go'],
  ];
  for (const [input, slug] of cases) assert.equal(resolveIcon(input).slug, slug, input);
  assert.ok(resolveIcon('typescript').path);
  const cs = resolveIcon('C#');
  assert.equal(cs.path, undefined);
  assert.equal(cs.monogram, 'C#');
  assert.equal(cs.known, true);
  const unknown = resolveIcon('Objective C');
  assert.equal(unknown.known, false);
  assert.equal(unknown.monogram, 'OC');
  assert.equal(resolveIcon('').known, false);
  assert.equal(isKnownIcon('linkedin'), true);
  assert.equal(isKnownIcon('definitely-not-a-brand'), false);
  assert.ok(resolveIcon('email').stroke);
});

test('generated icon data is well formed', () => {
  const entries = Object.entries(ICONS);
  assert.ok(entries.length >= 150, `${entries.length} icons`);
  for (const [slug, icon] of entries) {
    assert.match(slug, /^[a-z0-9]+$/);
    assert.match(icon.hex, /^[0-9A-F]{6}$/);
    assert.match(icon.path, /^[Mm][\d\s.,MmLlHhVvCcSsQqTtAaZz-]+$/);
  }
  assert.ok(iconCatalog().some((i) => i.slug === 'csharp' && i.monogram));
});

test('brand colours are adjusted for contrast', () => {
  const dark = getTheme('aurora').dark;
  const light = getTheme('aurora').light;
  // Black logos switch to the text colour on dark panels.
  assert.equal(legible('#000000', dark.panelAlt, dark.text), dark.text);
  assert.equal(legible('#181717', light.panelAlt, light.text), '#181717');
  // Coloured brands keep their hue but gain contrast.
  const react = legible('#61DAFB', light.panelAlt, light.text);
  assert.notEqual(react, '#61DAFB');
  assert.ok(contrast(react, light.panelAlt) > contrast('#61DAFB', light.panelAlt));
  assert.equal(legible('#3178C6', dark.panelAlt, dark.text), '#3178C6');
  // Monogram ink picks the more legible candidate.
  const tile = drawIcon(resolveIcon('aws'), 0, 0, 40, { color: '#FF9900', inks: [dark.panel, dark.text] });
  assert.match(tile, new RegExp(`fill="${dark.panel}">aws<`));
});

test('knows data-platform icons and Azure DevOps', async () => {
  const { resolveIcon } = await import('./icons.ts');
  for (const name of ['databricks', 'apachespark', 'spark', 'azuredevops', 'ado', 'snowflake', 'airflow']) {
    assert.equal(resolveIcon(name).known, true, name);
  }
  assert.equal(resolveIcon('azuredevops').title, 'Azure DevOps');
});
