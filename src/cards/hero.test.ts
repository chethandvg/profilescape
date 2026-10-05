import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoProfile, DEMO_NOW, emptyProfile } from '../core/fixtures.ts';
import { getTheme } from '../core/themes.ts';
import type { CardOptions, Mode, ProfileData } from '../core/types.ts';
import {
  autoCode,
  bioClauses,
  card,
  CODE_LANGUAGES,
  customCode,
  detectLanguage,
  factsFrom,
  MAX_CODE_CHARS,
  roleFrom,
  tokenize,
  topTopics,
} from './hero.ts';

const HOSTILE = `<script>&"'`;

function render(data: ProfileData, options: CardOptions = {}, mode: Mode = 'dark', animate = true): string {
  const theme = getTheme('aurora');
  const images = card.render({ data, theme, palette: theme[mode], mode, options, animate, now: DEMO_NOW });
  assert.equal(images.length, 1);
  const img = images[0];
  assert.ok(img);
  assert.equal(img.name, 'hero');
  assert.equal(img.layout, 'full');
  return img.svg;
}

/** Minimal well-formedness check: balanced tags, unique attributes, escaped ampersands, no bad numbers. */
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

test('demo profile renders in both modes with key content', () => {
  for (const mode of ['dark', 'light'] as const) {
    const svg = render(demoProfile(), {}, mode);
    assertValidSvg(svg);
    assert.match(svg, /width="1200" height="400"/);
    assert.match(svg, /Mira Chen/);
    assert.match(svg, /Building delightful developer tools/);
    assert.match(svg, /open to collaboration · Amsterdam, NL/);
    assert.match(svg, /profile\.ts/);
    assert.match(svg, />TypeScript</);
    assert.match(svg, /h-cur/);
    assert.ok(svg.length < 150_000);
  }
});

test('empty profile degrades gracefully', () => {
  for (const mode of ['dark', 'light'] as const) {
    const svg = render(emptyProfile(), {}, mode);
    assertValidSvg(svg);
    assert.match(svg, /new-user/);
    assert.match(svg, />Developer</);
    assert.match(svg, /profile\.json/);
    assert.match(svg, /since 2026/);
    const none = render(emptyProfile(), { code: 'none' }, mode);
    assertValidSvg(none);
    assert.match(none, /Your first contribution lights this up/);
  }
});

test('hostile text is escaped everywhere', () => {
  const data: ProfileData = { ...demoProfile(), name: HOSTILE, bio: `${HOSTILE}. ${HOSTILE}`, location: HOSTILE, company: HOSTILE };
  const variants: CardOptions[] = [
    {},
    { role: HOSTILE, tagline: [HOSTILE, HOSTILE], chips: [HOSTILE], status: HOSTILE, codeFile: HOSTILE },
    { code: `${HOSTILE}\nconst x = "${HOSTILE}";`, codeLanguage: 'typescript' },
    { statusColor: `red" onload="alert(1)` },
    { code: 'none' },
  ];
  for (const options of variants) {
    for (const lang of ['csharp', 'php', 'json', 'python']) {
      const svg = render(data, { codeLanguage: lang, ...options });
      assertValidSvg(svg);
      assert.doesNotMatch(svg, /<script/);
      assert.doesNotMatch(svg, /onload/);
    }
  }
  assert.match(render(data), /&lt;script&gt;&amp;/);
});

test('output is deterministic', () => {
  assert.equal(render(demoProfile()), render(demoProfile()));
  assert.equal(render(demoProfile(), { code: 'none' }, 'light'), render(demoProfile(), { code: 'none' }, 'light'));
});

test('code language follows the top language and options', () => {
  const cs: ProfileData = { ...demoProfile(), languages: [{ name: 'C#', color: '#178600', value: 10 }] };
  assert.equal(detectLanguage(cs), 'csharp');
  assert.equal(detectLanguage(emptyProfile()), 'json');
  assert.equal(detectLanguage({ ...demoProfile(), languages: [{ name: 'Shell', color: '#000', value: 1 }, { name: 'Go', color: '#000', value: 1 }] }), 'go');
  const svg = render(cs);
  assert.match(svg, /Program\.cs/);
  assert.match(svg, /ShipAsync/);
  assert.match(render(demoProfile(), { codeLanguage: 'py' }), /me\.py/);
  assert.match(render(demoProfile(), { codeLanguage: 'rust', codeFile: 'lib.rs' }), /lib\.rs/);
});

test('auto snippets fit the panel in every language', () => {
  const long = factsFrom(
    {
      ...demoProfile(),
      name: 'Maximilian Alexander von Hohenzollern-Sigmaringen',
      location: 'Llanfairpwllgwyngyll, Isle of Anglesey, Wales',
      bio: 'Building an extraordinarily long list of distributed developer platform things that never ends.',
      languages: [
        { name: 'Jupyter Notebook', color: '#000', value: 3 },
        { name: 'TypeScript', color: '#000', value: 2 },
        { name: 'Rust', color: '#000', value: 1 },
      ],
    },
    'Maximilian Alexander von Hohenzollern-Sigmaringen',
    DEMO_NOW,
  );
  const demo = factsFrom(demoProfile(), 'Mira Chen', DEMO_NOW);
  const empty = factsFrom(emptyProfile(), 'new-user', DEMO_NOW);
  for (const facts of [demo, long, empty]) {
    for (const lang of CODE_LANGUAGES) {
      const lines = autoCode(facts, lang, MAX_CODE_CHARS);
      assert.ok(lines.length >= 3 && lines.length <= 9, `${lang}: ${lines.length} lines`);
      for (const line of lines) assert.ok([...line].length <= MAX_CODE_CHARS, `${lang}: "${line}" too long`);
    }
  }
  const ts = autoCode(demo, 'typescript', MAX_CODE_CHARS).join('\n');
  assert.match(ts, /name: "Mira Chen"/);
  assert.match(ts, /base: "Amsterdam, NL"/);
  assert.match(ts, /"TypeScript", "Rust", "Go"/);
  // The role line already says "Building delightful developer tools", so focus uses the rest of the bio.
  assert.match(ts, /focus: "Open source at heart"/);
  assert.match(ts, /since: 2021/);
});

/** Drawn text only (the accessible title and description repeat it). */
const visible = (svg: string) => svg.replace(/<title[\s\S]*?<\/desc>/, '');

const REAL_BIO = 'Software Engineer · .NET · Azure · Applied AI | Berlin';

test('bio clauses split on bars, dashes, newlines and sentences', () => {
  assert.deepEqual(bioClauses(REAL_BIO), ['Software Engineer · .NET · Azure · Applied AI', 'Berlin']);
  assert.deepEqual(bioClauses('Staff engineer - Rust — Wasm\nOpen source. Coffee!'), ['Staff engineer', 'Rust', 'Wasm', 'Open source.', 'Coffee!']);
  // Hyphens inside words, ".NET" and version numbers never split.
  assert.deepEqual(bioClauses('Full-stack .NET dev, v2.1 fan'), ['Full-stack .NET dev, v2.1 fan']);
  assert.deepEqual(bioClauses(null), []);
  assert.deepEqual(bioClauses(' | · | '), []);
});

test('role trims whole list items instead of cutting a word', () => {
  const fits = (max: number) => (s: string) => s.length <= max;
  assert.equal(roleFrom('A · B · C', fits(20)), 'A · B · C');
  assert.equal(roleFrom('Engineer · Kubernetes · Observability', fits(24)), 'Engineer · Kubernetes');
  assert.equal(roleFrom('Designer / Developer / Writer', fits(22)), 'Designer / Developer');
  assert.equal(roleFrom('Building tools.', fits(20)), 'Building tools');
  assert.equal(roleFrom('A sentence that is far too long to fit', fits(10)), '');
});

test('real-world bio: role, tagline, location and focus never repeat each other', () => {
  const data: ProfileData = {
    ...demoProfile(),
    name: 'Chethan',
    bio: REAL_BIO,
    location: 'Berlin, Germany',
    company: null,
    languages: [
      { name: 'C#', color: '#178600', value: 90 },
      { name: 'Jupyter Notebook', color: '#DA5B0B', value: 6 },
      { name: 'PowerShell', color: '#012456', value: 4 },
    ],
  };
  const svg = render(data);
  assertValidSvg(svg);
  assert.match(svg, />Software Engineer · \.NET · Azure · Applied AI</);
  assert.doesNotMatch(svg, /\||Applied AI …|Applied AI…/);
  // Berlin is in the status line, so the tagline does not say it again.
  assert.match(svg, /open to collaboration · Berlin, Germany/);
  assert.equal(visible(svg).match(/Berlin/g)?.length, 2, 'status line and the snippet base only');
  // Display names on chips and in the snippet.
  assert.match(svg, />Jupyter</);
  assert.doesNotMatch(svg, /Jupyter Notebook/);
  // Focus comes from the most common topics, not the role.
  const code = autoCode(factsFrom(data, 'Chethan', DEMO_NOW), 'csharp', MAX_CODE_CHARS).join('\n');
  assert.doesNotMatch(code, /Software Engineer/);
  assert.match(code, /Focus = \["react", "design-system"/);
  assert.match(code, /Stack = \["C#", "Jupyter", "PowerShell"\]/);
});

test('focus: leftover bio first, then repo topics, else omitted', () => {
  const base = { ...demoProfile(), location: 'Lisbon' };
  const facts = (bio: string, extra: Partial<ProfileData> = {}) => factsFrom({ ...base, bio, ...extra }, 'X', DEMO_NOW);
  assert.equal(facts('Platform engineer | Building internal developer platforms').focus, 'Internal developer platforms');
  assert.equal(facts('Platform engineer | Lisbon').focus?.[0], 'react', 'location is never the focus');
  assert.deepEqual(topTopics(base, 2), ['react', 'design-system']);
  // Private, archived and forked repos never leak their topics; language topics are skipped.
  const repos = base.repos.map((r, i) => ({ ...r, isPrivate: i === 0, isArchived: i === 1, isFork: i === 2 }));
  const topics = topTopics({ ...base, repos }, 10);
  assert.ok(!topics.includes('react') && !topics.includes('cache') && !topics.includes('rest-api'), topics.join());
  assert.ok(!topics.includes('python') && !topics.includes('dotnet'), topics.join());
  assert.equal(facts('Platform engineer', { repos: [] }).focus, undefined);
  const none = autoCode(facts('Platform engineer', { repos: [] }), 'typescript', MAX_CODE_CHARS).join('\n');
  assert.doesNotMatch(none, /focus/);
});

test('a place clause never becomes the role', () => {
  const svg = render({ ...demoProfile(), bio: '📍 Tokyo | ML engineer', location: 'Tokyo, Japan' });
  assert.match(svg, /font-size="25"[^>]*>ML engineer</);
  assert.doesNotMatch(visible(svg), /📍/);
});

test('location is said once: status line, else tagline', () => {
  const data: ProfileData = { ...demoProfile(), bio: 'Engineer | Lisbon', location: 'Lisbon, Portugal', company: null };
  const shown = render(data);
  assert.equal(visible(shown).match(/Lisbon/g)?.length, 2, 'status line and snippet base');
  const hidden = render(data, { status: 'none' });
  // The leftover "Lisbon" clause is kept, and "Based in …" is not added on top of it.
  assert.match(hidden, />Lisbon</);
  assert.doesNotMatch(hidden, /Based in/);
  const noBio = render({ ...data, bio: 'Engineer' }, { status: 'none' });
  assert.match(noBio, /Based in Lisbon, Portugal\./);
});

test('snippet strings escape quotes for the target language', () => {
  const facts = { ...factsFrom(demoProfile(), `O'Neil "Dev"`, DEMO_NOW) };
  assert.match(autoCode(facts, 'csharp', MAX_CODE_CHARS).join('\n'), /"O'Neil \\"Dev\\""/);
  assert.match(autoCode(facts, 'php', MAX_CODE_CHARS).join('\n'), /'O\\'Neil "Dev"'/);
});

test('tokenizer covers every character and classifies the basics', () => {
  const samples: [string, (typeof CODE_LANGUAGES)[number]][] = [
    ['var me = new Developer', 'csharp'],
    ['    Name  = "Mira", // hi', 'csharp'],
    ['const s = `x ${y}`; /* c */ let n = 0x1F;', 'typescript'],
    ['print(f"hi {x}")  # comment', 'python'],
    ['me := Developer{Name: "x"}', 'go'],
    ['let v = vec!["a\\"b"];', 'rust'],
    ['<?php $me->ship(); // done', 'php'],
    ['  "since": 2021,', 'json'],
    ['unterminated "string', 'swift'],
  ];
  for (const [line, lang] of samples) {
    const tokens = tokenize(line, lang);
    assert.equal(tokens.map((t) => t.text).join(''), line);
  }
  const kinds = (line: string, lang: (typeof CODE_LANGUAGES)[number]) =>
    Object.fromEntries(tokenize(line, lang).filter((t) => t.text.trim()).map((t) => [t.text.trim(), t.kind]));
  const cs = kinds('var me = new Developer', 'csharp');
  assert.equal(cs.var, 'keyword');
  assert.equal(cs.Developer, 'type');
  const prop = kinds('    Name = "Mira",', 'csharp');
  assert.equal(prop.Name, 'property');
  assert.equal(prop['"Mira"'], 'string');
  assert.equal(kinds('  "since": 2021', 'json')['"since"'], 'property');
  assert.equal(kinds('x = True  # yes', 'python')['# yes'], 'comment');
  assert.equal(kinds('me.ship()', 'python').ship, 'type');
});

test('custom code is normalised and clamped', () => {
  const lines = customCode(`\n\tif x:\n${'a'.repeat(80)}\n1\n2\n3\n4\n5\n6\n7\n8\n`, 44);
  assert.equal(lines.length, 9);
  assert.equal(lines[0], '    if x:');
  assert.equal([...(lines[1] ?? '')].length, 44);
  assert.ok(lines[1]?.endsWith('…'));
  assert.deepEqual(customCode('a\n\n\n\n\n\n\n\n\nb', 44), ['a']);
});

test('long names shrink, then truncate at a word boundary', () => {
  const svg = render({ ...demoProfile(), name: 'Alexandria Montgomery-Fitzgerald' });
  const size = Number(/font-size="(\d+)" font-weight="800"/.exec(svg)?.[1]);
  assert.ok(size < 76 && size >= 48, `size ${size}`);
  const huge = render({ ...demoProfile(), name: 'Maximilian Alexander von Hohenzollern-Sigmaringen der Dritte' });
  assert.match(huge, /font-size="48" font-weight="800"/);
  assert.match(huge, /…<\/text>/);
});

test('status, chips and animation options', () => {
  const hidden = render(demoProfile(), { status: 'none' });
  assert.doesNotMatch(hidden, /class="h-pulse"/);
  const custom = render(demoProfile(), { status: 'Shipping v2', statusColor: '#ff00aa', chips: ['Azure', 'Kubernetes'] });
  assert.match(custom, /Shipping v2/);
  assert.match(custom, /fill="#ff00aa"/);
  assert.match(custom, />Azure</);
  assert.match(render(demoProfile(), { statusColor: 'accentA' }), new RegExp(`class="h-pulse"[^>]*fill="${getTheme('aurora').dark.accentA}"`));
  assert.match(render(demoProfile(), {}, 'dark', false), /\*\{animation:none!important\}/);
  const tagline = render(demoProfile(), { tagline: 'A single custom tagline' });
  assert.match(tagline, /A single custom tagline/);
});
