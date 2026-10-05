import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CARD_IDS } from '../core/types.ts';
import {
  ACTION_INPUT_DEFAULTS,
  ConfigError,
  isValidBranchName,
  parseConfigJson,
  resolveConfig,
  stripJsonc,
  suggest,
  type RawInputs,
} from './config.ts';

/** What the runner passes when the workflow only sets `username`. */
const runnerDefaults = (overrides: RawInputs = {}): RawInputs => ({ ...ACTION_INPUT_DEFAULTS, token: 'tok', github_token: 'tok', ...overrides });

describe('resolveConfig defaults', () => {
  it('produces the documented defaults', () => {
    const { config, settings, warnings, sources } = resolveConfig({ username: 'mira-dev', token: 'tok' });
    assert.deepEqual(config, {
      username: 'mira-dev',
      cards: ['stats', '3d', 'languages', 'repos'],
      theme: 'aurora',
      colors: {},
      darkColors: {},
      lightColors: {},
      modes: ['dark', 'light'],
      animate: true,
      hideLanguages: [],
      excludeRepos: [],
      includePrivate: true,
      repos: [],
      options: {},
    });
    assert.deepEqual(settings, {
      token: 'tok',
      githubToken: '',
      history: 'full',
      outputDir: 'profilescape',
      publish: 'branch',
      branch: 'profilescape-output',
      commitMessage: 'chore: update profilescape cards',
      readme: '',
    });
    assert.deepEqual(warnings, []);
    assert.equal(sources.theme, 'default');
  });

  it('falls back to the repository owner for the username', () => {
    assert.equal(resolveConfig({}, undefined, { defaultUsername: 'octocat' }).config.username, 'octocat');
    assert.equal(resolveConfig({ username: '@mira-dev' }, undefined, { defaultUsername: 'octocat' }).config.username, 'mira-dev');
    assert.throws(() => resolveConfig({}), /No username/);
    assert.equal(resolveConfig({}, undefined, { requireUsername: false }).config.username, '');
    assert.throws(() => resolveConfig({ username: 'bad name!' }), /not a valid GitHub username/);
  });

  it('never writes with the read token', () => {
    assert.equal(resolveConfig({ username: 'u', token: 'read-pat', github_token: '' }).settings.githubToken, '');
  });

  it('uses github_token for publishing when given', () => {
    const { settings } = resolveConfig({ username: 'u', token: 'read-pat', github_token: 'write-token' });
    assert.equal(settings.token, 'read-pat');
    assert.equal(settings.githubToken, 'write-token');
  });
});

describe('resolveConfig precedence', () => {
  const json = {
    theme: 'AURORA',
    cards: ['grid', 'hero'],
    modes: 'dark',
    animate: false,
    history: 'year',
    hideLanguages: ['HTML'],
    exclude_repos: 'dotfiles, old-site',
    includePrivate: false,
    repos: ['octocat/hello-world', 'tidy-notes'],
    colors: { accentA: '#ff7a59' },
    darkColors: { panel: '0B0D14', glowOpacity: 0.2 },
    lightColors: { syntax: { keyword: '#123' } },
    options: { repos: { layout: 'detail' }, Hero: { tagline: 'Hi' } },
  };

  it('config JSON overrides built-in defaults', () => {
    const { config, settings, sources, warnings } = resolveConfig({ username: 'u' }, json);
    assert.deepEqual(config.cards, ['grid', 'hero']);
    assert.equal(config.theme, 'aurora');
    assert.deepEqual(config.modes, ['dark']);
    assert.equal(config.animate, false);
    assert.equal(settings.history, 'year');
    assert.deepEqual(config.hideLanguages, ['HTML']);
    assert.deepEqual(config.excludeRepos, ['dotfiles', 'old-site'], 'snake_case keys and string lists are accepted');
    assert.equal(config.includePrivate, false);
    assert.deepEqual(config.repos, ['octocat/hello-world', 'tidy-notes']);
    assert.deepEqual(config.colors, { accentA: '#ff7a59' });
    assert.deepEqual(config.darkColors, { panel: '#0B0D14', glowOpacity: 0.2 }, 'hex colours gain a leading #');
    assert.deepEqual(config.lightColors, { syntax: { keyword: '#123' } });
    assert.deepEqual(config.options, { repos: { layout: 'detail' }, hero: { tagline: 'Hi' } });
    assert.equal(sources.cards, 'config');
    assert.ok(warnings.some((w) => /options\.repos is set but the "repos" card is not enabled/.test(w)));
  });

  it('explicit inputs override the config JSON', () => {
    const { config, settings, sources } = resolveConfig(
      { username: 'u', cards: 'stats, 3d', modes: 'light', animate: 'true', history: 'full', hide_languages: 'CSS', include_private: 'yes' },
      json,
    );
    assert.deepEqual(config.cards, ['stats', '3d']);
    assert.deepEqual(config.modes, ['light']);
    assert.equal(config.animate, true);
    assert.equal(settings.history, 'full');
    assert.deepEqual(config.hideLanguages, ['CSS']);
    assert.equal(config.includePrivate, true);
    assert.equal(sources.cards, 'input');
    assert.equal(sources.repos, 'config');
  });

  it('inputs left at their action.yml defaults defer to the config JSON', () => {
    const { config, settings } = resolveConfig(runnerDefaults({ username: 'u' }), json, { ignoreDefaultInputs: true });
    assert.deepEqual(config.cards, ['grid', 'hero']);
    assert.deepEqual(config.modes, ['dark']);
    assert.equal(config.animate, false);
    assert.equal(config.includePrivate, false);
    assert.equal(settings.history, 'year');
    // A non-default input still wins.
    const custom = resolveConfig(runnerDefaults({ username: 'u', cards: 'stats' }), json, { ignoreDefaultInputs: true });
    assert.deepEqual(custom.config.cards, ['stats']);
    // Without a config file, runner defaults resolve to the built-in defaults.
    const plain = resolveConfig(runnerDefaults({ username: 'u' }), undefined, { ignoreDefaultInputs: true });
    assert.deepEqual(plain.config.cards, ['stats', '3d', 'languages', 'repos']);
    assert.equal(plain.settings.publish, 'branch');
  });
});

describe('resolveConfig validation', () => {
  it('rejects unknown cards with the list of valid ids and a suggestion', () => {
    assert.throws(
      () => resolveConfig({ username: 'u', cards: 'stats,langauges,foo' }),
      (e: unknown) => {
        assert.ok(e instanceof ConfigError);
        assert.match(e.message, /"langauges" \(did you mean "languages"\?\)/);
        assert.match(e.message, /"foo"/);
        for (const id of CARD_IDS) assert.ok(e.message.includes(id));
        return true;
      },
    );
    assert.throws(() => resolveConfig({ username: 'u' }, { cards: [] }), /at least one card/);
    assert.throws(() => resolveConfig({ username: 'u' }, { cards: [{}] }), /list of strings/);
  });

  it('accepts aliases, "all" and space separated lists, without duplicates', () => {
    assert.deepEqual(resolveConfig({ username: 'u', cards: 'landscape stats 3d' }).config.cards, ['3d', 'stats']);
    assert.deepEqual(resolveConfig({ username: 'u', cards: 'all' }).config.cards, [...CARD_IDS]);
    assert.deepEqual(resolveConfig({ username: 'u', cards: 'Banner,\ntech-stack' }).config.cards, ['hero', 'stack']);
  });

  it('warns and falls back to aurora for unknown themes', () => {
    const { config, warnings } = resolveConfig({ username: 'u', theme: 'auroa' });
    assert.equal(config.theme, 'aurora');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /Unknown theme "auroa".*did you mean "aurora".*using "aurora"/);
  });

  it('validates modes, booleans, history, publish and branch', () => {
    assert.deepEqual(resolveConfig({ username: 'u', modes: 'both' }).config.modes, ['dark', 'light']);
    assert.throws(() => resolveConfig({ username: 'u', modes: 'dim' }), /Unknown mode "dim"/);
    assert.throws(() => resolveConfig({ username: 'u', animate: 'maybe' }), /animate input must be true or false/);
    assert.throws(() => resolveConfig({ username: 'u', history: 'week' }), /"full" or "year"/);
    assert.equal(resolveConfig({ username: 'u', publish: 'false' }).settings.publish, 'none');
    assert.throws(() => resolveConfig({ username: 'u', publish: 'gh-pages' }), /publish must be "branch" or "none"/);
    assert.throws(() => resolveConfig({ username: 'u', branch: 'bad branch' }), /not a valid branch name/);
    assert.throws(() => resolveConfig({ username: 'u', repos: 'a/b/c' }), /Invalid repository "a\/b\/c"/);
  });

  it('labels inputs the way the caller asks', () => {
    assert.throws(() => resolveConfig({ username: 'u', cards: 'nope' }, undefined, { inputLabel: (n) => `--${n}` }), /in --cards/);
  });

  it('validates colours and warns about unknown keys', () => {
    assert.throws(() => resolveConfig({ username: 'u' }, { colors: { accentA: 'red' } }), /colors\.accentA must be a hex colour/);
    assert.throws(() => resolveConfig({ username: 'u' }, { colors: { accentA: '#fff" onload="x' } }), /hex colour/);
    assert.throws(() => resolveConfig({ username: 'u' }, { darkColors: { glowOpacity: 3 } }), /between 0 and 1/);
    assert.throws(() => resolveConfig({ username: 'u' }, { colors: 'blue' }), /must be an object/);
    const { warnings, config } = resolveConfig({ username: 'u' }, { colors: { accent: '#fff', acentA: '#000' }, flavour: 1, username: 'x' });
    assert.deepEqual(config.colors, {});
    assert.ok(warnings.some((w) => /unknown colour "colors\.acentA" \(did you mean "accentA"\?\)/.test(w)));
    assert.ok(warnings.some((w) => /unknown config key "flavour"/.test(w)));
    assert.ok(warnings.some((w) => /"username" in the config JSON is ignored/.test(w)));
  });

  it('warns about options for unknown cards and rejects non-object options', () => {
    const { warnings } = resolveConfig({ username: 'u' }, { options: { stast: {} } });
    assert.match(warnings[0] as string, /unknown card "stast" \(did you mean "stats"\?\)/);
    assert.throws(() => resolveConfig({ username: 'u' }, { options: { stats: 3 } }), /options\.stats must be an object/);
    assert.throws(() => resolveConfig({ username: 'u' }, [1, 2]), /must be a JSON object/);
  });
});

describe('config JSON parsing', () => {
  it('accepts comments and trailing commas without touching strings', () => {
    const text = `{
      // the theme
      "theme": "aurora", /* inline */
      "url": "https://example.com/a//b,}",
      "cards": ["stats", "3d",],
    }`;
    assert.deepEqual(parseConfigJson(text), { theme: 'aurora', url: 'https://example.com/a//b,}', cards: ['stats', '3d'] });
    assert.equal(stripJsonc('"a\\"//b"').trim(), '"a\\"//b"');
    assert.deepEqual(parseConfigJson('\uFEFF{"a":1}'), { a: 1 });
    assert.deepEqual(parseConfigJson('   '), {});
  });

  it('reports invalid JSON with line, column and a code frame', () => {
    const text = '{\n  "theme": "aurora"\n  "cards": []\n}';
    assert.throws(
      () => parseConfigJson(text, '.github/profilescape.json'),
      (e: unknown) => {
        assert.ok(e instanceof ConfigError);
        assert.match(e.message, /^Invalid JSON in \.github\/profilescape\.json at line 2, column 20: .*comma missing/);
        assert.match(e.message, /2 \|   "theme": "aurora"\n\s+\| {20}\^/);
        return true;
      },
    );
    assert.throws(() => parseConfigJson('{"a": ', 'config input'), /Invalid JSON in config input/);
  });
});

describe('helpers', () => {
  it('suggests close matches only', () => {
    assert.equal(suggest('lnaguages', ['languages', 'stats']), 'languages');
    assert.equal(suggest('zzz', ['languages', 'stats']), undefined);
  });

  it('validates branch names like git does', () => {
    for (const ok of ['profilescape-output', 'cards/output', 'v1.0']) assert.ok(isValidBranchName(ok), ok);
    for (const bad of ['', 'a b', 'a..b', '-x', 'x.lock', 'x/', '/x', 'a~b', 'a:b', '.hidden', 'x.']) assert.ok(!isValidBranchName(bad), bad);
  });
});

describe('per-card options', () => {
  it('normalises key spelling and warns about unknown keys and unusable values', () => {
    const { config, warnings } = resolveConfig(
      { username: 'u', cards: 'repos,languages,stats' },
      { options: { repos: { layuot: 'detail', description_lines: 2 }, languages: { Layout: 'donut', top: 'eight' }, stats: { 'hide-title': 'nah' } } },
    );
    assert.deepEqual(config.options, { repos: { descriptionLines: 2 }, languages: { layout: 'donut', top: 'eight' }, stats: { hideTitle: 'nah' } });
    assert.ok(warnings.some((w) => /unknown option "options\.repos\.layuot" \(did you mean "layout"\?\)/.test(w)), warnings.join('\n'));
    assert.ok(warnings.some((w) => /options\.languages\.top must be a number, got "eight"/.test(w)), warnings.join('\n'));
    assert.ok(warnings.some((w) => /options\.stats\.hideTitle must be true or false/.test(w)), warnings.join('\n'));
    assert.equal(warnings.length, 3, warnings.join('\n'));
  });

  it('accepts numeric strings, boolean words and string lists', () => {
    const { warnings } = resolveConfig(
      { username: 'u', cards: 'languages,stack' },
      { options: { languages: { top: '6', hideTitle: 'yes', hide: 'HTML,CSS' }, stack: { icons: ['ts', 'go'] } } },
    );
    assert.deepEqual(warnings, []);
  });
});

describe('config lists', () => {
  it('splits list items on line breaks so no value spans log lines', () => {
    const { config } = resolveConfig({ username: 'u' }, { excludeRepos: ['old-repo\n::warning::injected'], hideLanguages: ['HTML\r\n::error::x'] });
    assert.deepEqual(config.excludeRepos, ['old-repo', '::warning::injected']);
    assert.deepEqual(config.hideLanguages, ['HTML', '::error::x']);
  });
});

describe('mirror defaults', () => {
  it("treats the running action's own cards default as not set", () => {
    const inputs = runnerDefaults({ username: 'u', cards: 'hero,stack,socials' });
    const json = { cards: ['hero', 'socials'], theme: 'nord' };
    const mirror = resolveConfig(inputs, json, { ignoreDefaultInputs: true, inputDefaults: { cards: 'hero,stack,socials' } });
    assert.deepEqual(mirror.config.cards, ['hero', 'socials']);
    assert.equal(mirror.sources.cards, 'config');
    assert.deepEqual(mirror.overridden, []);
    // Without knowing the mirror's default, the input looks explicit and wins (and says so).
    const unknown = resolveConfig(inputs, json, { ignoreDefaultInputs: true });
    assert.deepEqual(unknown.config.cards, ['hero', 'stack', 'socials']);
    assert.deepEqual(unknown.overridden, ['cards']);
  });
});
