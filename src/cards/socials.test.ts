import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoProfile, DEMO_NOW, emptyProfile } from '../core/fixtures.ts';
import { getTheme } from '../core/themes.ts';
import type { CardImage, CardOptions, Mode, ProfileData } from '../core/types.ts';
import { card } from './socials.ts';

const HOSTILE = `<script>&"'`;

function render(data: ProfileData, options: CardOptions = {}, mode: Mode = 'dark', animate = true): CardImage[] {
  const theme = getTheme('aurora');
  const images = card.render({ data, theme, palette: theme[mode], mode, options, animate, now: DEMO_NOW });
  for (const img of images) {
    assertValidSvg(img.svg);
    assert.equal(img.layout, 'inline');
  }
  return images;
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

const links = (images: CardImage[]) => Object.fromEntries(images.map((i) => [i.name, i.link]));

test('demo profile: GitHub, X and website badges in both modes', () => {
  for (const mode of ['dark', 'light'] as const) {
    const images = render(demoProfile(), {}, mode);
    assert.deepEqual(
      images.map((i) => [i.name, i.link]),
      [
        ['social-github', 'https://github.com/mira-dev'],
        ['social-x', 'https://x.com/miradev'],
        ['social-website', 'https://mira.dev'],
      ],
    );
    assert.match(images[0]?.svg ?? '', />GitHub</);
    assert.match(images[2]?.svg ?? '', />mira\.dev</);
    for (const img of images) assert.match(img.svg, /height="36"/);
  }
});

test('empty profile still links to GitHub', () => {
  const images = render(emptyProfile());
  assert.deepEqual(links(images), { 'social-github': 'https://github.com/new-user' });
  const none = render({ ...emptyProfile(), login: '' }, { auto: false });
  assert.equal(none.length, 1);
  assert.match(none[0]?.svg ?? '', /No links yet/);
  assert.equal(none[0]?.link, undefined);
});

test('object form builds every platform URL', () => {
  const images = render(demoProfile(), {
    links: {
      linkedin: 'mira-chen',
      twitter: '@miradev2',
      email: 'mira@example.dev',
      mastodon: '@mira@hachyderm.io',
      bluesky: '@mira.bsky.social',
      youtube: '@miracodes',
      devto: 'mira',
      medium: '@mira',
      stackoverflow: 12345,
      discord: 'abc123',
      instagram: 'mira.codes',
      website: 'mira.dev/blog',
      custom: [{ label: 'Talks', url: 'https://speakerdeck.com/mira' }],
    },
  });
  assert.deepEqual(links(images), {
    'social-github': 'https://github.com/mira-dev',
    'social-linkedin': 'https://www.linkedin.com/in/mira-chen',
    'social-x': 'https://x.com/miradev2',
    'social-email': 'mailto:mira@example.dev',
    'social-mastodon': 'https://hachyderm.io/@mira',
    'social-bluesky': 'https://bsky.app/profile/mira.bsky.social',
    'social-youtube': 'https://www.youtube.com/@miracodes',
    'social-devto': 'https://dev.to/mira',
    'social-medium': 'https://medium.com/@mira',
    'social-stackoverflow': 'https://stackoverflow.com/users/12345',
    'social-discord': 'https://discord.gg/abc123',
    'social-instagram': 'https://www.instagram.com/mira.codes',
    'social-website': 'https://mira.dev/blog',
    'social-talks': 'https://speakerdeck.com/mira',
  });
  // LinkedIn has no Simple Icons logo: monogram tile.
  assert.match(images.find((i) => i.name === 'social-linkedin')?.svg ?? '', />in<\/text>/);
});

test('list form, URL detection and hiding automatic links', () => {
  const images = render(demoProfile(), {
    links: ['linkedin:in/mira', 'https://gitlab.com/mira', 'me@mira.dev', 'website:false', { label: 'Blog', url: 'https://mira.dev/blog' }],
  });
  assert.deepEqual(links(images), {
    'social-github': 'https://github.com/mira-dev',
    'social-linkedin': 'https://www.linkedin.com/in/mira',
    'social-gitlab': 'https://gitlab.com/mira',
    'social-email': 'mailto:me@mira.dev',
    'social-blog': 'https://mira.dev/blog',
    'social-x': 'https://x.com/miradev',
  });
  const hidden = render(demoProfile(), { links: { github: false, x: 'none' } });
  assert.deepEqual(links(hidden), { 'social-website': 'https://mira.dev' });
  assert.deepEqual(links(render(demoProfile(), { auto: false, links: 'x:mira' })), { 'social-x': 'https://x.com/mira' });
});

test('unsafe URLs are dropped and labels are escaped', () => {
  const images = render(demoProfile(), {
    auto: false,
    links: {
      custom: [
        { label: 'Evil', url: 'javascript:alert(1)' },
        { label: 'Data', url: 'data:text/html,hi' },
        { label: HOSTILE, url: 'https://example.com' },
      ],
      email: 'not-an-email',
      github: 'a b',
      linkedin: HOSTILE,
    },
  });
  assert.equal(images.length, 1);
  const [img] = images;
  assert.equal(img?.link, 'https://example.com');
  assert.doesNotMatch(img?.svg ?? '', /<script/i);
  assert.match(img?.svg ?? '', /&lt;script&gt;&amp;&quot;&#39;/);
  assert.ok(img?.alt.includes(HOSTILE), 'alt is raw text; render.ts escapes it in markup');
});

test('icon style, handles and duplicate names', () => {
  for (const img of render(demoProfile(), { style: 'icon' })) assert.match(img.svg, /width="36" height="36"/);
  const handles = render(demoProfile(), { handles: true, links: { email: 'mira@example.dev' } });
  assert.match(handles.find((i) => i.name === 'social-github')?.svg ?? '', /mira-dev<\/tspan>/);
  assert.match(handles.find((i) => i.name === 'social-email')?.svg ?? '', /mira@example\.dev/);
  assert.match(handles.find((i) => i.name === 'social-x')?.alt ?? '', /X: @miradev/);
  const dupes = render(demoProfile(), {
    auto: false,
    links: { custom: [{ label: 'Blog', url: 'https://a.dev' }, { label: 'Blog', url: 'https://b.dev' }, { label: 'Blog', url: 'https://a.dev' }] },
  });
  assert.deepEqual(dupes.map((i) => i.name), ['social-blog', 'social-blog-2']);
});

test('badge width follows the label', () => {
  const [short, long] = render(demoProfile(), { auto: false, links: { x: 'a', stackoverflow: '1' } });
  const width = (img: CardImage | undefined) => Number(/width="(\d+)"/.exec(img?.svg ?? '')?.[1]);
  assert.ok(width(short) < width(long), `${width(short)} < ${width(long)}`);
});

test('output is deterministic', () => {
  const opts = { links: { linkedin: 'mira', email: 'a@b.dev' }, handles: true };
  assert.deepEqual(render(demoProfile(), opts), render(demoProfile(), opts));
  assert.deepEqual(render(demoProfile(), {}, 'light', false), render(demoProfile(), {}, 'light', false));
});
