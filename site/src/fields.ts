import type { CardDefinition, CardOptions, OptionDoc } from '../../src/core/types.ts';

/**
 * Turns a card's documented options (CardDefinition.options) into form field
 * descriptions for the playground. Pure and DOM-free so it can be tested in
 * Node; nothing here is hand-written per card, so new options appear in the
 * playground automatically.
 */

export type FieldKind = 'text' | 'number' | 'toggle' | 'tristate' | 'list' | 'lines' | 'choice' | 'json';

export interface Field {
  key: string;
  kind: FieldKind;
  label: string;
  description: string;
  /** Allowed values for `choice` fields, default first is not guaranteed. */
  choices?: string[];
  /** The real default value when the docs give one of the right type. */
  defaultValue?: unknown;
  placeholder: string;
  min?: number;
  max?: number;
}

/** "hideTitle" -> "Hide title", "cellSize" -> "Cell size". */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const QUOTED = /"([a-z][a-z0-9-]*)"/g;

/** Quoted lowercase words in a description, e.g. '"bar", "donut" or "compact"'. */
export function quotedChoices(description: string): string[] {
  const out: string[] = [];
  for (const m of description.matchAll(QUOTED)) {
    const word = m[1] as string;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/** "26 to 53", "(1-12)", "(3–12)" -> { min, max }. */
export function rangeOf(description: string): { min?: number; max?: number } {
  const m = /(\d+)\s*(?:to|-|–)\s*(\d+)/.exec(description);
  if (!m) return {};
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a < b ? { min: a, max: b } : {};
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function fieldFor(doc: OptionDoc): Field {
  const base = { key: doc.key, label: humanize(doc.key), description: doc.description };
  const describedDefault = doc.default === undefined ? '' : isStringArray(doc.default) ? doc.default.join(', ') : String(doc.default);
  switch (doc.type) {
    case 'boolean':
      return typeof doc.default === 'boolean'
        ? { ...base, kind: 'toggle', defaultValue: doc.default, placeholder: '' }
        : { ...base, kind: 'tristate', placeholder: '' };
    case 'number': {
      const range = rangeOf(doc.description);
      return {
        ...base,
        kind: 'number',
        ...range,
        ...(typeof doc.default === 'number' ? { defaultValue: doc.default } : {}),
        placeholder: describedDefault,
      };
    }
    case 'list': {
      // Free-text lines (e.g. a tagline) must keep their commas.
      const kind: FieldKind = /\blines?\b/i.test(doc.description) && !isStringArray(doc.default) ? 'lines' : 'list';
      return {
        ...base,
        kind,
        ...(isStringArray(doc.default) ? { defaultValue: doc.default } : {}),
        placeholder: describedDefault,
      };
    }
    case 'object':
      return { ...base, kind: 'json', placeholder: describedDefault };
    default: {
      const choices = quotedChoices(doc.description);
      const isChoice = typeof doc.default === 'string' && choices.length >= 2 && choices.includes(doc.default) && !/any other/i.test(doc.description);
      if (isChoice) return { ...base, kind: 'choice', choices, defaultValue: doc.default, placeholder: '' };
      return { ...base, kind: 'text', placeholder: describedDefault.replace(/^"(.*)"$/, '$1') };
    }
  }
}

export function fieldsFor(card: CardDefinition): Field[] {
  return card.options.map(fieldFor);
}

/** Split a list field's text into items: commas or new lines for lists, new lines only for free text. */
export function splitItems(text: string, kind: FieldKind): string[] {
  const parts = kind === 'lines' ? text.split('\n') : text.split(/[,\n]/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

const sameList = (a: unknown, b: string[]) => isStringArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Convert raw form input into the option value written to the config, or
 * `undefined` when the field is empty or equal to its default (so the output
 * only contains what the user actually changed).
 */
export function parseFieldInput(field: Field, raw: string | boolean): ParseResult {
  if (field.kind === 'toggle') {
    const v = raw === true || raw === 'true';
    return { ok: true, value: v === field.defaultValue ? undefined : v };
  }
  const text = typeof raw === 'string' ? raw : String(raw);
  const trimmed = text.trim();
  switch (field.kind) {
    case 'tristate':
      return { ok: true, value: trimmed === 'true' ? true : trimmed === 'false' ? false : undefined };
    case 'choice':
      return { ok: true, value: !trimmed || trimmed === field.defaultValue ? undefined : trimmed };
    case 'number': {
      if (!trimmed) return { ok: true, value: undefined };
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number.' };
      if (field.min !== undefined && n < field.min) return { ok: false, error: `Minimum is ${field.min}.` };
      if (field.max !== undefined && n > field.max) return { ok: false, error: `Maximum is ${field.max}.` };
      return { ok: true, value: n === field.defaultValue ? undefined : n };
    }
    case 'list':
    case 'lines': {
      const items = splitItems(text, field.kind);
      if (isStringArray(field.defaultValue)) {
        // Clearing a pre-filled list restores the default rather than writing [].
        if (!items.length || sameList(items, field.defaultValue)) return { ok: true, value: undefined };
        return { ok: true, value: items };
      }
      // One free-text line stays a string, which cards may wrap on their own.
      if (field.kind === 'lines' && items.length === 1) return { ok: true, value: items[0] };
      return { ok: true, value: items.length ? items : undefined };
    }
    case 'json': {
      if (!trimmed) return { ok: true, value: undefined };
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return { ok: true, value: JSON.parse(trimmed) as unknown };
        } catch (err) {
          return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
        }
      }
      return { ok: true, value: splitItems(text, 'list') };
    }
    default:
      return { ok: true, value: trimmed ? text : undefined };
  }
}

/** The text a form control shows for a stored option value. */
export function displayValue(field: Field, value: unknown): string {
  if (field.kind === 'toggle') return String(value ?? field.defaultValue ?? false);
  if (value === undefined || value === null) {
    if (isStringArray(field.defaultValue)) return field.defaultValue.join(', ');
    if (field.kind === 'choice') return String(field.defaultValue ?? '');
    return '';
  }
  switch (field.kind) {
    case 'list':
      return isStringArray(value) ? value.join(', ') : String(value);
    case 'lines':
      return isStringArray(value) ? value.join('\n') : String(value);
    case 'json':
      return typeof value === 'string' ? value : isStringArray(value) && value.every((s) => !s.includes(',')) ? value.join(', ') : JSON.stringify(value);
    default:
      return String(value);
  }
}

/** Drop options a card does not document and values equal to their defaults. */
export function cleanOptions(card: CardDefinition, options: CardOptions | undefined): CardOptions {
  const out: CardOptions = {};
  if (!options) return out;
  for (const field of fieldsFor(card)) {
    const v = options[field.key];
    if (v === undefined || v === null) continue;
    if (field.defaultValue !== undefined && (v === field.defaultValue || (isStringArray(field.defaultValue) && sameList(v, field.defaultValue)))) continue;
    out[field.key] = v;
  }
  return out;
}
