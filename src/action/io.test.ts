import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  actionsLogger,
  actionsOutputs,
  command,
  displayPath,
  escapeData,
  formatBytes,
  formatKeyValue,
  getInput,
  loadConfigText,
  readInputs,
  writeFiles,
} from './io.ts';

const tmp = mkdtempSync(join(tmpdir(), 'profilescape-io-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Parse a GITHUB_OUTPUT file written with the heredoc syntax. */
function parseOutputFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^<]+)<<(.+)$/.exec(lines[i] ?? '');
    if (!m) continue;
    const [, name, delim] = m as unknown as [string, string, string];
    const value: string[] = [];
    while (lines[++i] !== delim) value.push(lines[i] as string);
    out[name] = value.join('\n');
  }
  return out;
}

describe('inputs', () => {
  it('reads INPUT_<NAME> variables, upper-cased and trimmed', () => {
    const env = { INPUT_HIDE_LANGUAGES: '  HTML, CSS \n', INPUT_THEME: 'nord' };
    assert.equal(getInput('hide_languages', env), 'HTML, CSS');
    assert.equal(getInput('missing', env), '');
    const inputs = readInputs(env);
    assert.equal(inputs.theme, 'nord');
    assert.equal(inputs.cards, '');
    assert.equal(inputs.hide_languages, 'HTML, CSS');
  });
});

describe('outputs', () => {
  it('formats multiline values with a delimiter', () => {
    assert.equal(formatKeyValue('markup', 'a\nb', 'EOF_X'), 'markup<<EOF_X\na\nb\nEOF_X\n');
    assert.throws(() => formatKeyValue('x', 'oops EOF_X', 'EOF_X'), /delimiter/);
    assert.match(formatKeyValue('x', 'y'), /^x<<ghadelimiter_[0-9a-f-]{36}\ny\nghadelimiter_[0-9a-f-]{36}\n$/);
  });

  it('round-trips multiline values through the GITHUB_OUTPUT file', () => {
    const file = join(tmp, 'output.txt');
    writeFileSync(file, '');
    const outputs = actionsOutputs({ GITHUB_OUTPUT: file });
    const markup = '<picture>\n  <img src="x" />\n</picture>\n\nname<<EOF\ntrailing';
    outputs.set('markup', markup);
    outputs.set('files', JSON.stringify(['profilescape/stats-dark.svg']));
    outputs.set('base_url', 'https://raw.githubusercontent.com/o/r/b');
    const parsed = parseOutputFile(readFileSync(file, 'utf8'));
    assert.equal(parsed.markup, markup);
    assert.deepEqual(JSON.parse(parsed.files as string), ['profilescape/stats-dark.svg']);
    assert.equal(parsed.base_url, 'https://raw.githubusercontent.com/o/r/b');
  });

  it('appends to the step summary and is a no-op without runner files', () => {
    const file = join(tmp, 'summary.md');
    writeFileSync(file, '# Earlier step\n');
    actionsOutputs({ GITHUB_STEP_SUMMARY: file }).summary('## Profilescape');
    assert.equal(readFileSync(file, 'utf8'), '# Earlier step\n## Profilescape\n');
    assert.doesNotThrow(() => actionsOutputs({}).set('x', 'y'));
    assert.doesNotThrow(() => actionsOutputs({}).summary('x'));
  });
});

describe('workflow commands', () => {
  it('escapes data and properties', () => {
    assert.equal(escapeData('50% done\r\nnext'), '50%25 done%0D%0Anext');
    assert.equal(command('warning', 'a\nb', { title: 'T: x, y' }), '::warning title=T%3A x%2C y::a%0Ab');
    assert.equal(command('error', 'boom'), '::error::boom');
  });

  it('logger emits groups, warnings, masks and gated debug lines', () => {
    const lines: string[] = [];
    const log = actionsLogger((l) => lines.push(l), {});
    log.group('Fetching');
    log.info('plain');
    log.debug('hidden');
    log.warning('careful', { title: 'Config' });
    log.mask('secret-token');
    log.mask('line1\nline2');
    log.endGroup();
    assert.deepEqual(lines, [
      '::group::Fetching',
      'plain',
      '::warning title=Config::careful',
      '::add-mask::secret-token',
      '::add-mask::line1',
      '::add-mask::line2',
      '::endgroup::',
    ]);
    const debugLines: string[] = [];
    actionsLogger((l) => debugLines.push(l), { RUNNER_DEBUG: '1' }).debug('shown');
    assert.deepEqual(debugLines, ['::debug::shown']);
  });
});

describe('files', () => {
  it('writes files and refuses to escape the output directory', () => {
    const dir = join(tmp, 'out');
    const written = writeFiles(dir, [
      { path: 'stats-dark.svg', content: '<svg/>' },
      { path: 'README-snippet.md', content: 'x' },
    ]);
    assert.equal(written.length, 2);
    assert.equal(readFileSync(join(dir, 'stats-dark.svg'), 'utf8'), '<svg/>');
    assert.throws(() => writeFiles(dir, [{ path: '../evil.svg', content: 'x' }]), /outside/);
    assert.equal(displayPath(join(dir, 'stats-dark.svg'), tmp), 'out/stats-dark.svg');
  });

  it('loads config from inline JSON or a workspace file', () => {
    assert.equal(loadConfigText('', tmp), null);
    assert.deepEqual(loadConfigText(' {"theme":"aurora"} ', tmp), { text: '{"theme":"aurora"}', source: 'config input' });
    mkdirSync(join(tmp, '.github'), { recursive: true });
    writeFileSync(join(tmp, '.github', 'profilescape.json'), '{"cards":["stats"]}');
    assert.deepEqual(loadConfigText('.github/profilescape.json', tmp), { text: '{"cards":["stats"]}', source: '.github/profilescape.json' });
    assert.throws(() => loadConfigText('missing.json', tmp), /not found.*actions\/checkout/s);
  });

  it('formats sizes', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(12_600), '12.3 KB');
    assert.equal(formatBytes(3 * 1024 * 1024), '3.00 MB');
  });
});
