import { CARDS } from '../../src/cards/registry.ts';
import { DEMO_NOW } from '../../src/core/fixtures.ts';
import { getTheme, themeList } from '../../src/core/themes.ts';
import { CARD_IDS, type CardId, type Mode, type ProfileData } from '../../src/core/types.ts';
import { renderCards } from '../../src/render.ts';
import { announce, byId, copyText, h, scrollToSection } from './dom.ts';
import { displayValue, type Field, fieldsFor, parseFieldInput } from './fields.ts';
import { svgImage } from './images.ts';
import { siteMode } from './site-theme.ts';
import { configFile, readmeSnippet, workflowYaml } from './output.ts';
import {
  activeOptions,
  COLOR_KEYS,
  COLOR_LABELS,
  type ColorKey,
  decodeState,
  defaultState,
  isStateHash,
  type PlaygroundState,
  type PreviewMode,
  setCardOptions,
  stateToHash,
} from './state.ts';

/** Short names for the card picker; the registry titles are used everywhere else. */
export const SHORT_TITLES: Record<CardId, string> = {
  stats: 'Stats',
  languages: 'Languages',
  '3d': '3D landscape',
  grid: 'Grid',
  repos: 'Repos',
  hero: 'Hero',
  stack: 'Stack',
  socials: 'Socials',
};

export interface Playground {
  getState(): PlaygroundState;
  /** Replace the whole state (gallery clicks, shared links) and rebuild the controls. */
  load(next: PlaygroundState, opts?: { scroll?: boolean }): void;
}

const clone = (s: PlaygroundState): PlaygroundState => JSON.parse(JSON.stringify(s)) as PlaygroundState;

/** The same SVG without motion: shown while a colour or text field is being edited. */
const still = (svg: string) => svg.replace('</style>', '*{animation:none!important}</style>');

const MODE_LABELS: Record<PreviewMode, string> = { dark: 'Dark', light: 'Light', both: 'Both' };

export function initPlayground(data: ProfileData): Playground {
  const section = byId('playground');
  const controls = byId('pg-controls');
  const preview = byId('pg-preview');
  const replayBtn = byId<HTMLButtonElement>('pg-replay');
  const shareBtn = byId<HTMLButtonElement>('pg-share');
  const resetBtn = byId<HTMLButtonElement>('pg-reset');
  const outWorkflow = byId('out-workflow');
  const outReadme = byId('out-readme');
  const outConfig = byId('out-config');

  let state: PlaygroundState = isStateHash(location.hash) ? decodeState(location.hash) : { ...defaultState(), mode: siteMode() };
  const openPanels = new Set<CardId>(state.cards.slice(0, 1));

  // ------------------------------------------------------------ rendering

  /** Last rendered SVG per image, so unchanged cards keep their element (and their animation). */
  let cache = new Map<string, { svg: string; img: HTMLImageElement }>();
  let frame = 0;
  let pendingQuiet = true;
  let pendingHash = false;

  function schedule(opts: { quiet?: boolean; hash?: boolean } = {}): void {
    pendingQuiet = pendingQuiet && (opts.quiet ?? false);
    pendingHash = pendingHash || (opts.hash ?? true);
    if (frame) return;
    frame = 1;
    // Next frame, or shortly after when frames are throttled (background tab).
    const run = () => {
      if (!frame) return;
      frame = 0;
      const quiet = pendingQuiet;
      const hash = pendingHash;
      pendingQuiet = true;
      pendingHash = false;
      renderPreview(quiet);
      renderOutput();
      if (hash) writeHash();
    };
    requestAnimationFrame(run);
    window.setTimeout(run, 60);
  }

  function renderPreview(quiet: boolean): void {
    const modes: Mode[] = state.mode === 'both' ? ['dark', 'light'] : [state.mode];
    let files;
    try {
      files = renderCards({
        data,
        cards: state.cards,
        theme: state.theme,
        darkColors: state.dark,
        lightColors: state.light,
        modes,
        options: activeOptions(state),
        animate: state.animate,
        now: DEMO_NOW,
      });
    } catch (err) {
      preview.replaceChildren(h('p', { class: 'pv-error', role: 'alert' }, `This combination could not be rendered: ${(err as Error).message}`));
      cache = new Map();
      return;
    }
    const next = new Map<string, { svg: string; img: HTMLImageElement }>();
    const blocks = state.cards.map((id) => {
      const card = CARDS[id];
      const cols = modes.map((mode) => {
        const imgs = files
          .filter((f) => f.card === id && f.mode === mode)
          .map((f) => {
            const key = `${f.mode}/${f.name}`;
            const prev = cache.get(key);
            const img = prev && prev.svg === f.svg ? prev.img : svgImage(quiet ? still(f.svg) : f.svg, f.alt, `pv-img pv-${f.layout}`);
            next.set(key, { svg: f.svg, img });
            return img;
          });
        return h(
          'div',
          { class: `pv-col pv-on-${mode}` },
          state.mode === 'both' ? h('span', { class: 'pv-badge' }, mode === 'dark' ? 'Dark' : 'Light') : null,
          h('div', { class: 'pv-imgs' }, ...imgs),
        );
      });
      return h(
        'figure',
        { class: 'pv-card' },
        h('figcaption', { class: 'pv-cap' }, h('span', { class: 'pv-title' }, card.title), h('code', { class: 'pv-id' }, id)),
        h('div', { class: `pv-cols${state.mode === 'both' ? ' pv-both' : ''}` }, ...cols),
      );
    });
    preview.replaceChildren(...blocks);
    cache = next;
  }

  function renderOutput(): void {
    outWorkflow.innerHTML = highlightYaml(workflowYaml(state));
    outReadme.innerHTML = highlightMarkup(readmeSnippet());
    outConfig.innerHTML = highlightJson(configFile(state));
  }

  function writeHash(): void {
    const target = stateToHash(state);
    const current = isStateHash(location.hash) ? location.hash : '';
    if (target === current) return;
    history.replaceState(null, '', target || `${location.pathname}${location.search}`);
  }

  // ------------------------------------------------------------ controls

  let colorInputs: { key: ColorKey; mode: Mode; input: HTMLInputElement; cell: HTMLElement }[] = [];
  let optionsBox: HTMLElement = h('div');
  let chipOrder = new Map<CardId, HTMLElement>();

  function buildControls(): void {
    controls.replaceChildren(cardsControl(), themeControl(), previewControl(), optionsControl(), colorsControl());
  }

  function cardsControl(): HTMLElement {
    chipOrder = new Map();
    const chips = CARD_IDS.map((id) => {
      const order = h('span', { class: 'chip-order', 'aria-hidden': 'true' });
      chipOrder.set(id, order);
      const input = h('input', {
        type: 'checkbox',
        class: 'chip-input',
        name: 'pg-cards',
        value: id,
        checked: state.cards.includes(id),
        onchange: (e: Event) => {
          const el = e.currentTarget as HTMLInputElement;
          if (el.checked) {
            if (!state.cards.includes(id)) state.cards.push(id);
            openPanels.add(id);
          } else if (state.cards.length === 1) {
            el.checked = true;
            announce('Keep at least one card selected.');
            return;
          } else state.cards = state.cards.filter((c) => c !== id);
          syncOrder();
          buildOptions();
          schedule();
        },
      });
      return h('label', { class: 'chip', title: CARDS[id].title }, input, h('span', { class: 'chip-label' }, SHORT_TITLES[id]), order);
    });
    const box = h('fieldset', { class: 'ctl' }, h('legend', { class: 'ctl-title' }, 'Cards'), h('p', { class: 'hint' }, 'Numbers show the README order; reorder under Card options.'), h('div', { class: 'chips' }, ...chips));
    syncOrder();
    return box;
  }

  function syncOrder(): void {
    for (const [id, el] of chipOrder) {
      const i = state.cards.indexOf(id);
      el.textContent = i >= 0 ? String(i + 1) : '';
    }
  }

  function themeControl(): HTMLElement {
    const items = themeList().map(({ id, label }) => {
      const t = getTheme(id);
      return h(
        'label',
        { class: 'swatch', title: label },
        h('input', {
          type: 'radio',
          class: 'swatch-input',
          name: 'pg-theme',
          value: id,
          checked: state.theme === id,
          onchange: () => {
            state.theme = id;
            syncColorInputs();
            schedule();
          },
        }),
        h('span', {
          class: 'swatch-art',
          'aria-hidden': 'true',
          style: `--dp:${t.dark.panel};--da:${t.dark.accentA};--db:${t.dark.accentB};--lp:${t.light.panel};--la:${t.light.accentA};--lb:${t.light.accentB}`,
        }),
        h('span', { class: 'swatch-label' }, label),
      );
    });
    return h('fieldset', { class: 'ctl' }, h('legend', { class: 'ctl-title' }, 'Theme'), h('div', { class: 'swatches' }, ...items));
  }

  function previewControl(): HTMLElement {
    const modes = (['dark', 'light', 'both'] as PreviewMode[]).map((m) =>
      h(
        'label',
        { class: 'seg' },
        h('input', {
          type: 'radio',
          class: 'seg-input',
          name: 'pg-mode',
          value: m,
          checked: state.mode === m,
          onchange: () => {
            state.mode = m;
            schedule();
          },
        }),
        h('span', {}, MODE_LABELS[m]),
      ),
    );
    const animate = h(
      'label',
      { class: 'switch' },
      h('input', {
        type: 'checkbox',
        role: 'switch',
        checked: state.animate,
        onchange: (e: Event) => {
          state.animate = (e.currentTarget as HTMLInputElement).checked;
          schedule();
        },
      }),
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
      h('span', {}, 'Animate'),
    );
    return h(
      'fieldset',
      { class: 'ctl' },
      h('legend', { class: 'ctl-title' }, 'Preview'),
      h('div', { class: 'row-wrap' }, h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Colour mode' }, ...modes), animate),
      h('p', { class: 'hint' }, 'Your workflow renders both modes and switches with each viewer’s GitHub theme. Animations always respect reduced-motion settings.'),
    );
  }

  function colorsControl(): HTMLElement {
    colorInputs = [];
    const rows = COLOR_KEYS.map((key) => {
      const cells = (['dark', 'light'] as Mode[]).map((mode) => {
        const input = h('input', {
          type: 'color',
          class: 'color-input',
          'aria-label': `${COLOR_LABELS[key]}, ${mode} mode`,
          oninput: (e: Event) => {
            const value = (e.currentTarget as HTMLInputElement).value.toUpperCase();
            // Picking the theme's own colour clears the override, keeping the config minimal.
            if (value === getTheme(state.theme)[mode][key].toUpperCase()) delete state[mode][key];
            else state[mode][key] = value;
            syncColorInputs();
            schedule({ quiet: true });
          },
        });
        const cell = h('span', { class: 'color-cell' }, input);
        colorInputs.push({ key, mode, input, cell });
        return cell;
      });
      const reset = h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Reset ${COLOR_LABELS[key]}`,
          title: `Reset ${COLOR_LABELS[key]}`,
          onclick: () => {
            delete state.dark[key];
            delete state.light[key];
            syncColorInputs();
            schedule();
          },
        },
        '↺',
      );
      return h('div', { class: 'color-row' }, h('span', { class: 'color-name' }, COLOR_LABELS[key]), ...cells, reset);
    });
    const resetAll = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        onclick: () => {
          state.dark = {};
          state.light = {};
          syncColorInputs();
          schedule();
          announce('Colours reset to the theme.');
        },
      },
      'Reset colours',
    );
    const box = h(
      'fieldset',
      { class: 'ctl' },
      h('legend', { class: 'ctl-title' }, 'Colours'),
      h('p', { class: 'hint' }, 'Override theme colours per mode. A dot marks a changed colour.'),
      h('div', { class: 'color-grid' }, h('div', { class: 'color-row color-head', 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, 'Dark'), h('span', {}, 'Light'), h('span', {}, '')), ...rows),
      resetAll,
    );
    syncColorInputs();
    return box;
  }

  function syncColorInputs(): void {
    const theme = getTheme(state.theme);
    for (const { key, mode, input, cell } of colorInputs) {
      const override = state[mode][key];
      const value = (override ?? theme[mode][key]).toLowerCase();
      if (input.value !== value) input.value = value;
      cell.classList.toggle('is-set', Boolean(override));
    }
  }

  function optionsControl(): HTMLElement {
    optionsBox = h('div', { class: 'opt-list' });
    buildOptions();
    return h('div', { class: 'ctl' }, h('h3', { class: 'ctl-title' }, 'Card options'), optionsBox);
  }

  function buildOptions(focusKey?: string): void {
    optionsBox.replaceChildren(...state.cards.map((id, i) => optionPanel(id, i)));
    if (focusKey) optionsBox.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  function move(id: CardId, delta: number, focusKey: string): void {
    const i = state.cards.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.cards.length) return;
    const cards = [...state.cards];
    [cards[i], cards[j]] = [cards[j] as CardId, cards[i] as CardId];
    state.cards = cards;
    syncOrder();
    buildOptions(focusKey);
    announce(`${CARDS[id].title} moved to position ${j + 1}.`);
    schedule();
  }

  function optionPanel(id: CardId, index: number): HTMLElement {
    const card = CARDS[id];
    const bodyId = `opt-${id === '3d' ? 'landscape' : id}`;
    const open = openPanels.has(id);
    const body = h('div', { id: bodyId, class: 'opt-body', hidden: !open }, h('p', { class: 'hint' }, card.description));
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'opt-toggle',
        'aria-expanded': String(open),
        'aria-controls': bodyId,
        onclick: () => {
          const nowOpen = body.hidden;
          body.hidden = !nowOpen;
          toggle.setAttribute('aria-expanded', String(nowOpen));
          if (nowOpen) openPanels.add(id);
          else openPanels.delete(id);
        },
      },
      h('span', { class: 'opt-num', 'aria-hidden': 'true' }, String(index + 1)),
      h('span', { class: 'opt-name', title: card.title }, SHORT_TITLES[id]),
      h('span', { class: 'opt-chev', 'aria-hidden': 'true' }),
    );
    const up = h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': `Move ${card.title} up`,
        title: 'Move up',
        disabled: index === 0,
        'data-focus-key': `${id}-up`,
        onclick: () => move(id, -1, index - 1 === 0 ? `${id}-down` : `${id}-up`),
      },
      '↑',
    );
    const down = h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': `Move ${card.title} down`,
        title: 'Move down',
        disabled: index === state.cards.length - 1,
        'data-focus-key': `${id}-down`,
        onclick: () => move(id, 1, index + 1 === state.cards.length - 1 ? `${id}-up` : `${id}-down`),
      },
      '↓',
    );
    const fields = fieldsFor(card);
    for (const field of fields) body.append(fieldControl(id, field));
    if (!fields.length) body.append(h('p', { class: 'hint' }, 'This card has no options.'));
    body.append(
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          onclick: () => {
            setCardOptions(state, id, undefined);
            buildOptions(`${id}-reset`);
            schedule();
            announce(`${card.title} options reset.`);
          },
          'data-focus-key': `${id}-reset`,
        },
        'Reset options',
      ),
    );
    return h('div', { class: 'opt-card' }, h('div', { class: 'opt-head' }, toggle, up, down), body);
  }

  function setOption(id: CardId, key: string, value: unknown): void {
    const opts = { ...(state.options[id] ?? {}) };
    if (value === undefined) delete opts[key];
    else opts[key] = value;
    setCardOptions(state, id, opts);
  }

  function fieldControl(id: CardId, field: Field): HTMLElement {
    const fid = `f-${id === '3d' ? 'landscape' : id}-${field.key}`;
    const descId = `${fid}-d`;
    const errId = `${fid}-e`;
    const current = state.options[id]?.[field.key];
    const shown = displayValue(field, current);
    const error = h('p', { id: errId, class: 'field-error', hidden: true });
    const desc = h('p', { id: descId, class: 'field-desc' }, field.description);
    const described = `${descId} ${errId}`;

    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const commit = (quiet: boolean) => {
      const raw = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value;
      const result = parseFieldInput(field, raw);
      if (!result.ok) {
        error.textContent = result.error;
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      error.hidden = true;
      input.removeAttribute('aria-invalid');
      setOption(id, field.key, result.value);
      schedule({ quiet });
    };

    if (field.kind === 'toggle') {
      input = h('input', { type: 'checkbox', role: 'switch', id: fid, checked: shown === 'true', 'aria-describedby': described, onchange: () => commit(false) });
      return h(
        'div',
        { class: 'field field-toggle' },
        h('label', { class: 'switch', for: fid }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', { class: 'field-label' }, field.label)),
        desc,
        error,
      );
    }

    if (field.kind === 'tristate' || field.kind === 'choice') {
      const choices: [string, string][] =
        field.kind === 'tristate'
          ? [
              ['', 'Default'],
              ['true', 'On'],
              ['false', 'Off'],
            ]
          : (field.choices ?? []).map((c) => [c, c === field.defaultValue ? `${c} (default)` : c]);
      const select = h('select', { id: fid, class: 'input', 'aria-describedby': described, onchange: () => commit(false) });
      for (const [value, label] of choices) select.append(h('option', { value }, label));
      select.value = field.kind === 'tristate' ? (current === true ? 'true' : current === false ? 'false' : '') : shown;
      input = select;
    } else if (field.kind === 'lines' || field.kind === 'json') {
      input = h('textarea', {
        id: fid,
        class: `input${field.kind === 'json' ? ' mono' : ''}`,
        rows: field.kind === 'json' ? 3 : 2,
        placeholder: field.kind === 'json' ? '{"linkedin": "handle", "email": "me@example.com"}' : field.placeholder,
        spellcheck: 'false',
        'aria-describedby': described,
        oninput: () => commit(true),
        onchange: () => commit(false),
      });
      input.value = shown;
    } else {
      input = h('input', {
        id: fid,
        class: 'input',
        type: field.kind === 'number' ? 'number' : 'text',
        inputmode: field.kind === 'number' ? 'numeric' : undefined,
        min: field.min,
        max: field.max,
        step: field.kind === 'number' ? 1 : undefined,
        placeholder: field.placeholder,
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-describedby': described,
        oninput: () => commit(true),
        onchange: () => commit(false),
      });
      input.value = shown;
    }
    const range = field.kind === 'number' && field.min !== undefined ? h('span', { class: 'field-range' }, `${field.min}–${field.max}`) : null;
    return h('div', { class: 'field' }, h('label', { class: 'field-label', for: fid }, field.label, range), input, desc, error);
  }

  // ------------------------------------------------------------ output + actions

  initTabs(byId('out-tabs'));
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.copy ?? '';
      const text = target === 'workflow' ? workflowYaml(state) : target === 'readme' ? readmeSnippet() : configFile(state);
      const ok = await copyText(text);
      if (!ok) selectContents(btn.closest('.code-block')?.querySelector('code'));
      flash(btn, ok ? 'Copied' : 'Press Ctrl+C');
      announce(ok ? `${btn.dataset.label ?? 'Text'} copied to the clipboard.` : 'Copy failed; select the text and copy it manually.');
    });
  }

  shareBtn.addEventListener('click', async () => {
    writeHash();
    const ok = await copyText(new URL(stateToHash(state) || '#playground', location.href).href);
    flash(shareBtn, ok ? 'Link copied' : 'Copy failed');
    announce(ok ? 'Shareable link copied to the clipboard.' : 'Copy failed.');
  });

  replayBtn.addEventListener('click', () => {
    cache = new Map();
    renderPreview(false);
  });

  resetBtn.addEventListener('click', () => {
    load({ ...defaultState(), mode: siteMode() });
    announce('Playground reset.');
  });

  window.addEventListener('hashchange', () => {
    if (!isStateHash(location.hash) || location.hash === stateToHash(state)) return;
    load(decodeState(location.hash), { scroll: true });
  });

  function load(next: PlaygroundState, opts: { scroll?: boolean } = {}): void {
    state = clone(next);
    openPanels.clear();
    if (state.cards[0]) openPanels.add(state.cards[0]);
    buildControls();
    cache = new Map();
    schedule();
    if (opts.scroll) scrollToSection(section);
  }

  buildControls();
  renderPreview(false);
  renderOutput();
  if (isStateHash(location.hash)) requestAnimationFrame(() => section.scrollIntoView({ block: 'start' }));

  return { getState: () => clone(state), load };
}

/** Select an element's text so the visitor can copy it by hand when the clipboard API is blocked. */
function selectContents(el: Element | null | undefined): void {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function flash(btn: HTMLButtonElement, text: string): void {
  const label = btn.querySelector('.btn-text') ?? btn;
  const original = btn.dataset.original ?? label.textContent ?? '';
  btn.dataset.original = original;
  label.textContent = text;
  btn.classList.add('is-done');
  window.clearTimeout(Number(btn.dataset.timer ?? 0));
  btn.dataset.timer = String(
    window.setTimeout(() => {
      label.textContent = original;
      btn.classList.remove('is-done');
    }, 1600),
  );
}

/** WAI-ARIA tabs with arrow-key navigation. */
function initTabs(root: HTMLElement): void {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (tab: HTMLButtonElement, focus: boolean) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (to === null) return;
      e.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length] as HTMLButtonElement, true);
    });
  }
}

// ------------------------------------------------------------ highlighting

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightYaml(yaml: string): string {
  return yaml
    .split('\n')
    .map((line) => {
      const esc = escapeHtml(line);
      if (/^\s*#/.test(line)) return `<span class="tk-c">${esc}</span>`;
      // Lines of the inline JSON config block.
      if (/^\s*[{}[\]"]/.test(line)) return highlightJson(line);
      const m = /^(\s*-?\s*)([A-Za-z_][\w-]*)(:)(.*)$/.exec(esc);
      if (!m) return esc;
      const [, indent, key, colon, rest = ''] = m;
      const value = rest.replace(/(\s#.*)$/, '<span class="tk-c">$1</span>').replace(/(\$\{\{.*?\}\})/g, '<span class="tk-e">$1</span>');
      return `${indent}<span class="tk-k">${key}</span>${colon}<span class="tk-v">${value}</span>`;
    })
    .join('\n');
}

export function highlightJson(json: string): string {
  return escapeHtml(json).replace(/("(?:[^"\\]|\\.)*")(\s*:)?/g, (_, str: string, colon?: string) => (colon ? `<span class="tk-k">${str}</span>${colon}` : `<span class="tk-s">${str}</span>`));
}

export function highlightMarkup(text: string): string {
  return `<span class="tk-c">${escapeHtml(text)}</span>`;
}
