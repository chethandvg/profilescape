import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { displayName } from './format.ts';
import { contrast, ensureContrast, esc, fit, fitLabel, labelWidth, safeColor, textWidth, wrapPx } from './svg.ts';
import { getTheme, themeIds } from './themes.ts';

describe('safeColor', () => {
  test('accepts strict #RGB and #RRGGBB only', () => {
    assert.equal(safeColor('#3178c6', '#000'), '#3178c6');
    assert.equal(safeColor(' #ABC ', '#000'), '#ABC');
    for (const bad of ['red', '#12345', '#1234567', '3178c6', 'url(#x)', '#3178c6" onload="x', '', null, undefined, 42]) {
      assert.equal(safeColor(bad, '#000'), '#000', String(bad));
    }
  });
});

describe('ensureContrast', () => {
  test('returns colours that already pass unchanged', () => {
    assert.equal(ensureContrast('#3178c6', '#11141D'), '#3178c6');
    assert.equal(ensureContrast('#ABC', '#11141D'), '#ABC');
  });

  test('PowerShell navy becomes a visible blue on every dark panel', () => {
    for (const id of themeIds()) {
      for (const mode of ['dark', 'light'] as const) {
        const p = getTheme(id)[mode];
        const out = ensureContrast('#012456', p.panel, 1.8, p.text);
        assert.ok(contrast(out, p.panel) >= 1.8, `${id}/${mode}: ${out}`);
        // Hue is kept: blue stays the dominant channel.
        const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(out.slice(i, i + 2), 16)) as [number, number, number];
        assert.ok(b > r && b > g, `${id}/${mode}: ${out} is no longer blue`);
      }
    }
  });

  test('moves toward the ink, or toward white/black without one', () => {
    assert.ok(contrast(ensureContrast('#f1e05a', '#FFFFFF', 1.8), '#FFFFFF') >= 1.8);
    assert.ok(contrast(ensureContrast('#000000', '#0D1117', 1.8), '#0D1117') >= 1.8);
    assert.ok(contrast(ensureContrast('#7355dd', '#7355dd', 3, '#FFFFFF'), '#7355dd') >= 3);
    assert.equal(ensureContrast('not a colour', '#FFFFFF', 1.8, '#111111'), '#111111');
  });
});

describe('labels', () => {
  test('fitLabel measures like label(): 12px mono with 1.4px tracking', () => {
    assert.equal(labelWidth('ABCDE'), 5 * (12 * 0.6 + 1.4));
    assert.equal(fitLabel('Activity', 100), 'Activity');
    const cut = fitLabel('Languages · weighted by commits', 120);
    assert.ok(cut.endsWith('…'));
    assert.ok(labelWidth(cut) <= 120);
    assert.equal(fitLabel('Best day', 40, { size: 11, spacing: 0.8 }), 'Best…');
    // Never splits a surrogate pair.
    assert.doesNotMatch(fitLabel('🚀🚀🚀🚀🚀🚀', 30), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  test('fit never splits a surrogate pair', () => {
    assert.doesNotMatch(fit('🚀🚀🚀🚀🚀🚀🚀🚀', 40, 14), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('wrapPx', () => {
  test('wraps by pixel width and splits overlong words', () => {
    const lines = wrapPx('Modern, async, AOT-friendly .NET client for the Ollama REST API.', 200, 13.5);
    assert.ok(lines.length > 1);
    for (const l of lines) assert.ok(textWidth(l, 13.5) <= 200, l);
    const long = wrapPx('a'.repeat(80), 100, 13);
    assert.ok(long.length > 1);
    for (const l of long) assert.ok(textWidth(l, 13) <= 100);
  });

  test('ends the last kept line at a word boundary with an ellipsis', () => {
    const lines = wrapPx('one two three four five six seven eight nine ten eleven twelve', 90, 14, {}, 2);
    assert.equal(lines.length, 2);
    assert.match(lines[1] ?? '', /\w…$/);
    assert.ok(textWidth(lines[1] ?? '', 14) <= 90);
    assert.deepEqual(wrapPx('', 100, 14, {}, 2), []);
  });
});

test('displayName shortens awkward language names only', () => {
  assert.equal(displayName('Jupyter Notebook'), 'Jupyter');
  assert.equal(displayName(' jupyter notebook '), 'Jupyter');
  assert.equal(displayName('TypeScript'), 'TypeScript');
  assert.equal(displayName('C#'), 'C#');
});

describe('esc', () => {
  test('escapes markup characters', () => {
    assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  test('drops characters XML 1.0 cannot hold, so one stray control character never breaks the SVG', () => {
    const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
    assert.equal(esc(`Mira${controls}Dev`), 'Mira\t\n\rDev');
    assert.equal(esc('a￾b￿c'), 'abc');
    // Lone surrogates go, valid pairs (emoji) stay.
    assert.equal(esc('x\uD800y\uDC00z'), 'xyz');
    assert.equal(esc('🚀 ok'), '🚀 ok');
    const invalid = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    assert.doesNotMatch(esc(`${controls}\uD83D￿\uDE80`), invalid);
  });
});

describe('fit', () => {
  test('never leaves a separator dangling before the ellipsis', () => {
    const status = 'Currently heads-down shipping a big release, replies may be slow · San Francisco Bay Area, California';
    for (let w = 200; w <= 600; w += 7) {
      const out = fit(status, w, 14, { mono: true });
      assert.doesNotMatch(out, /[\s.,;:!?·|/-]…$/, out);
      assert.ok(textWidth(out, 14, { mono: true }) <= w, out);
    }
    assert.equal(fit('short', 200, 14), 'short');
  });
});
