import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { demoProfile, DEMO_NOW, emptyProfile } from '../core/fixtures.ts';
import { applyOverrides, getTheme } from '../core/themes.ts';
import type { CardOptions, Mode, ProfileData, RenderContext, RepoInfo } from '../core/types.ts';
import { card, categoryLabel, repoSlug, selectRepos } from './repos.ts';

const theme = getTheme('aurora');

function ctx(data: ProfileData, options: CardOptions = {}, mode: Mode = 'dark', animate = true): RenderContext {
  return { data, theme, palette: applyOverrides(theme[mode]), mode, options, animate, now: DEMO_NOW };
}

const render = (data: ProfileData, options: CardOptions = {}, mode: Mode = 'dark', animate = true) =>
  card.render(ctx(data, options, mode, animate));

function sane(svg: string): void {
  assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  for (const bad of ['NaN', 'undefined', 'Infinity', 'null']) assert.ok(!svg.includes(bad), `svg contains ${bad}`);
  for (const tag of ['text', 'g', 'tspan', 'svg', 'defs', 'style', 'clipPath']) {
    const open = svg.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0;
    const close = svg.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0;
    assert.equal(open, close, `unbalanced <${tag}>`);
  }
  assert.ok(svg.length < 150 * 1024, 'svg under 150 KB');
}

const size = (svg: string) => {
  const m = /width="(\d+)" height="(\d+)"/.exec(svg);
  return { w: Number(m?.[1]), h: Number(m?.[2]) };
};

function withRepos(patch: Partial<ProfileData>): ProfileData {
  return { ...demoProfile(), ...patch };
}

const base = (): RepoInfo => {
  const r = demoProfile().repos[0];
  assert.ok(r);
  return r;
};

describe('repos card: selection', () => {
  it('uses pinned repos by default and honours count', () => {
    const data = demoProfile();
    const imgs = render(data);
    assert.deepEqual(
      imgs.map((i) => i.name),
      data.pinned.map((r) => `repo-${repoSlug(r.nameWithOwner)}`),
    );
    assert.equal(render(data, { count: 2 }).length, 2);
    assert.equal(render(data, { count: '1' }).length, 1);
    assert.equal(render(data, { count: 0 }).length, 1, 'clamped to at least one');
    assert.equal(render(data, { count: 'lots' }).length, 4, 'falls back to the default');
  });

  it('prefers explicitly configured repos and keeps their order', () => {
    const data = demoProfile();
    const [a, b] = [data.repos[5], data.repos[2]];
    assert.ok(a && b);
    data.extraRepos = [a, b];
    assert.deepEqual(
      selectRepos(data, 4).map((r) => r.name),
      [a.name, b.name],
    );
  });

  it('falls back to most starred, non-archived repos', () => {
    const data = demoProfile();
    data.pinned = [];
    const archived = { ...base(), name: 'mega-star', nameWithOwner: 'mira-dev/mega-star', stars: 999_999, isArchived: true };
    const small = data.repos.slice(1).reverse();
    data.repos = [archived, ...small];
    const picked = selectRepos(data, 3);
    assert.ok(!picked.some((r) => r.isArchived));
    assert.deepEqual(
      picked.map((r) => r.stars),
      [...small].sort((x, y) => y.stars - x.stars).slice(0, 3).map((r) => r.stars),
    );
    assert.equal(selectRepos(data, 12).length, small.length);
  });

  it('fills pinned repos with the most starred ones', () => {
    const data = demoProfile();
    data.pinned = [data.repos[6] as (typeof data.repos)[number]];
    const picked = selectRepos(data, 3).map((r) => r.name);
    assert.deepEqual(picked, [data.repos[6]?.name, data.repos[0]?.name, data.repos[1]?.name]);
  });

  it('never auto-selects private repos or the profile repo', () => {
    const data = demoProfile();
    const secret = { ...base(), name: 'secret', nameWithOwner: 'mira-dev/secret', stars: 50_000, isPrivate: true };
    const profile = { ...base(), name: 'mira-dev', nameWithOwner: 'mira-dev/mira-dev', stars: 40_000 };
    data.pinned = [profile, secret];
    data.repos = [secret, profile, ...data.repos];
    const picked = selectRepos(data, 12).map((r) => r.name);
    assert.ok(!picked.includes('secret') && !picked.includes('mira-dev'));
    data.extraRepos = [secret];
    assert.deepEqual(selectRepos(data, 4).map((r) => r.name), ['secret'], 'explicit choice is honoured');
  });

  it('deduplicates repos that map to the same slug', () => {
    const r = base();
    const data = withRepos({ extraRepos: [r, { ...r }, { ...r, nameWithOwner: r.nameWithOwner.toUpperCase() }] });
    assert.equal(render(data).length, 1);
  });

  it('builds slugs from nameWithOwner', () => {
    assert.equal(repoSlug('Mira-Dev/nebula.UI'), 'mira-dev-nebula-ui');
    assert.equal(repoSlug('--a__b--/.c.'), 'a-b-c');
  });
});

describe('repos card: compact layout', () => {
  it('renders half-width images with link and alt text', () => {
    const data = demoProfile();
    for (const mode of ['dark', 'light'] as const) {
      const imgs = render(data, {}, mode);
      assert.equal(imgs.length, 4);
      imgs.forEach((img, i) => {
        const repo = data.pinned[i];
        assert.ok(repo);
        sane(img.svg);
        assert.equal(img.layout, 'half');
        assert.equal(img.link, repo.url);
        assert.equal(img.alt, `${repo.name}: ${repo.description}`);
        assert.deepEqual(size(img.svg), { w: 400, h: 200 });
        assert.ok(img.svg.includes(theme[mode].panel), 'uses the palette of the requested mode');
      });
    }
  });

  it('shows key values', () => {
    const [nebula] = render(demoProfile());
    assert.ok(nebula);
    const svg = nebula.svg;
    for (const s of ['nebula-ui', '4,821', '312', 'TypeScript', 'v3.4.0', '7 days ago', 'TYPESCRIPT · REACT', '#3178c6']) {
      assert.ok(svg.includes(s), `missing ${s}`);
    }
    assert.ok(!svg.includes('>mira-dev</tspan>'), 'own repos have no owner prefix by default');
  });

  it('dark and light outputs differ', () => {
    const [d] = render(demoProfile(), {}, 'dark');
    const [l] = render(demoProfile(), {}, 'light');
    assert.notEqual(d?.svg, l?.svg);
  });

  it('shows the owner for foreign repos or when asked', () => {
    const foreign = { ...base(), owner: 'acme', nameWithOwner: 'acme/nebula-ui' };
    const [f] = render(withRepos({ extraRepos: [foreign] }));
    assert.ok(f?.svg.includes('>acme</tspan>'));
    assert.equal(f?.name, 'repo-acme-nebula-ui');
    const [own] = render(demoProfile(), { showOwner: true });
    assert.ok(own?.svg.includes('>mira-dev</tspan>'));
  });

  it('descriptionLines changes height and is clamped', () => {
    const h = (lines: unknown) => size(render(demoProfile(), { descriptionLines: lines })[0]?.svg ?? '').h;
    assert.equal(h(3), 200);
    assert.ok(h(1) < h(2) && h(2) < h(3) && h(3) < h(4));
    assert.equal(h(0), h(1));
    assert.equal(h(9), h(4));
  });

  it('title overrides the category label', () => {
    const [img] = render(demoProfile(), { title: 'Featured work' });
    assert.ok(img?.svg.includes('FEATURED WORK'));
    assert.ok(!img?.svg.includes('TYPESCRIPT · REACT'));
  });

  it('badge priority: release, then archived/template/fork', () => {
    const r = { ...base(), latestRelease: null };
    const badge = (patch: Partial<RepoInfo>) => render(withRepos({ extraRepos: [{ ...r, ...patch }] }))[0]?.svg ?? '';
    assert.ok(badge({ isArchived: true, isFork: true }).includes('>Archived<'));
    assert.ok(badge({ isTemplate: true, isFork: true }).includes('>Template<'));
    assert.ok(badge({ isFork: true }).includes('>Fork<'));
    assert.ok(badge({ isArchived: true, latestRelease: { tag: 'v9', publishedAt: '2026-01-01T00:00:00Z' } }).includes('>v9<'));
    const none = badge({});
    for (const s of ['>Archived<', '>Template<', '>Fork<']) assert.ok(!none.includes(s));
  });

  it('handles a repo with no description, language or activity', () => {
    const bare: RepoInfo = {
      ...base(),
      description: null,
      languages: [],
      primaryLanguage: null,
      topics: [],
      latestRelease: null,
      license: null,
      homepageUrl: null,
      stars: 0,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      openPullRequests: 0,
      pushedAt: '',
    };
    for (const layout of ['compact', 'detail']) {
      const [img] = render(withRepos({ extraRepos: [bare] }), { layout });
      assert.ok(img);
      sane(img.svg);
      assert.ok(img.svg.includes('No description provided.'));
      assert.ok(img.svg.includes('font-style="italic"'));
      assert.ok(img.svg.includes('REPOSITORY'));
      assert.equal(img.alt, bare.name);
    }
  });

  it('truncates very long names and descriptions', () => {
    const long: RepoInfo = {
      ...base(),
      name: 'x'.repeat(200),
      nameWithOwner: `mira-dev/${'x'.repeat(200)}`,
      description: 'word '.repeat(400),
      topics: Array.from({ length: 40 }, (_, i) => `topic-${i}`),
      latestRelease: { tag: 'r'.repeat(80), publishedAt: '2026-01-01T00:00:00Z' },
    };
    for (const layout of ['compact', 'detail']) {
      const [img] = render(withRepos({ extraRepos: [long] }), { layout });
      assert.ok(img);
      sane(img.svg);
      const visible = img.svg.replace(/<title[^>]*>.*?<\/title>|<desc>.*?<\/desc>/g, '');
      assert.ok(!visible.includes('x'.repeat(200)), 'visible name is truncated');
      assert.ok(img.svg.includes('…'));
    }
  });
});

describe('repos card: detail layout', () => {
  it('renders a full-width card with stats, release, languages and topics', () => {
    for (const mode of ['dark', 'light'] as const) {
      const imgs = render(demoProfile(), { layout: 'detail' }, mode);
      assert.equal(imgs.length, 4);
      const img = imgs[0];
      assert.ok(img);
      sane(img.svg);
      assert.equal(img.layout, 'full');
      assert.equal(size(img.svg).w, 1200);
      for (const s of [
        '>mira-dev</tspan>',
        'nebula-ui',
        '4,821',
        '312',
        '>41<',
        '>9<',
        '>96<',
        'v3.4.0',
        'Sep 21, 2026',
        'updated 7 days ago',
        'MIT license',
        'nebula-ui.dev',
        '87.4%',
        'design-system',
        'accessibility',
        'OPEN ISSUES',
        'WATCHERS',
      ]) {
        assert.ok(img.svg.includes(s), `missing ${s}`);
      }
    }
  });

  it('showOwner: false hides the owner on own repos', () => {
    const [img] = render(demoProfile(), { layout: 'detail', showOwner: false });
    assert.ok(!img?.svg.includes('>mira-dev</tspan>'));
  });

  it('groups languages beyond the top five into Other', () => {
    const langs = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, i) => ({ name, color: '#123456', value: 70 - i * 10 }));
    const [img] = render(withRepos({ extraRepos: [{ ...base(), languages: langs }] }), { layout: 'detail' });
    assert.ok(img?.svg.includes('>Other<'));
    assert.ok(!img?.svg.includes('>F<'));
  });

  it('fits topics on one line and summarises the rest as +N', () => {
    const topics = Array.from({ length: 30 }, (_, i) => `topic-number-${i}`);
    const [img] = render(withRepos({ extraRepos: [{ ...base(), topics }] }), { layout: 'detail' });
    const svg = img?.svg ?? '';
    const shown = topics.filter((t) => svg.includes(`>${t}<`)).length;
    assert.ok(shown > 0 && shown < topics.length);
    assert.ok(svg.includes(`>+${topics.length - shown}<`));
  });

  it('only links http(s) homepages', () => {
    const [img] = render(withRepos({ extraRepos: [{ ...base(), homepageUrl: 'javascript:alert(1)' }] }), { layout: 'detail' });
    assert.ok(!img?.svg.includes('javascript:'));
  });
});

describe('repos card: safety and determinism', () => {
  const hostile: RepoInfo = {
    ...base(),
    owner: '<x>"&\'',
    name: `<script>&"'`,
    nameWithOwner: `<x>"&'/<script>&"'`,
    description: '</text><script>alert("x")</script> & more',
    topics: ['<img src=x onerror=alert(1)>', '&amp;'],
    primaryLanguage: { name: '<Lang>', color: '"/><script>alert(1)</script>' },
    languages: [{ name: '<Lang>', color: 'red" onload="x', value: 10 }],
    latestRelease: { tag: '<v1>', publishedAt: 'not a date' },
    license: '<MIT>',
    pushedAt: 'garbage',
  };

  it('escapes hostile text in both layouts and modes', () => {
    for (const layout of ['compact', 'detail']) {
      for (const mode of ['dark', 'light'] as const) {
        const imgs = render(withRepos({ extraRepos: [hostile] }), { layout, title: '<b>"pwn"</b>' }, mode);
        const svg = imgs[0]?.svg ?? '';
        sane(svg);
        assert.ok(!svg.includes('<script'), 'no raw script tag');
        assert.ok(!svg.includes('<img'), 'no raw img tag');
        assert.ok(!svg.includes('<b>'), 'no raw title markup');
        assert.ok(!svg.includes('onload='), 'colour injection blocked');
        assert.ok(svg.includes('&lt;script&gt;'), 'name is escaped, not dropped');
        assert.equal(imgs[0]?.name, 'repo-x-script');
      }
    }
  });

  it('is deterministic', () => {
    for (const layout of ['compact', 'detail']) {
      const a = render(demoProfile(), { layout });
      const b = render(demoProfile(), { layout });
      assert.deepEqual(a, b);
    }
  });

  it('respects animate: false', () => {
    const [img] = render(demoProfile(), {}, 'dark', false);
    assert.ok(img?.svg.includes('*{animation:none!important}'));
  });

  it('category label skips topics that repeat the language', () => {
    const r = { ...base(), primaryLanguage: { name: 'C#', color: '#178600' }, languages: [], topics: ['csharp', 'dotnet', 'gpu'] };
    assert.equal(categoryLabel(r, 400), 'C# · DOTNET');
    assert.equal(categoryLabel({ ...r, primaryLanguage: null, topics: [] }, 400), 'REPOSITORY');
    assert.equal(categoryLabel({ ...r, topics: ['an-extraordinarily-long-topic-name-indeed'] }, 120), 'C#', 'drops topics that do not fit');
  });
});

describe('repos card: empty profile', () => {
  it('renders a single friendly placeholder for each layout and mode', () => {
    for (const layout of ['compact', 'detail']) {
      for (const mode of ['dark', 'light'] as const) {
        const imgs = render(emptyProfile(), { layout }, mode);
        assert.equal(imgs.length, 1);
        const [img] = imgs;
        assert.ok(img);
        sane(img.svg);
        assert.equal(img.name, 'repos');
        assert.equal(img.link, undefined);
        assert.equal(img.layout, layout === 'detail' ? 'full' : 'half');
        assert.equal(size(img.svg).w, layout === 'detail' ? 1200 : 400);
        assert.ok(img.svg.includes('No repositories yet'));
      }
    }
  });

  it('tolerates archived-only accounts', () => {
    const data = emptyProfile();
    data.repos = [{ ...base(), isArchived: true }];
    const imgs = render(data);
    assert.equal(imgs.length, 1);
    assert.equal(imgs[0]?.name, 'repos');
  });
});
