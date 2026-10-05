import type { CardOptions } from './types.ts';

/** Typed, forgiving accessors for per-card options coming from user JSON. */
export function readOptions(options: CardOptions | undefined) {
  const src = options ?? {};
  const get = (key: string): unknown => src[key];
  return {
    has: (key: string) => key in src && src[key] !== undefined && src[key] !== null,
    raw: get,
    string(key: string, fallback: string): string {
      const v = get(key);
      return typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : fallback;
    },
    optionalString(key: string): string | undefined {
      const v = get(key);
      return typeof v === 'string' && v.trim() !== '' ? v : undefined;
    },
    number(key: string, fallback: number, range: { min?: number; max?: number } = {}): number {
      const v = get(key);
      const num = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
      if (!Number.isFinite(num)) return fallback;
      return Math.min(range.max ?? Number.POSITIVE_INFINITY, Math.max(range.min ?? Number.NEGATIVE_INFINITY, num));
    },
    boolean(key: string, fallback: boolean): boolean {
      const v = get(key);
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return ['true', 'yes', '1', 'on'].includes(v.trim().toLowerCase());
      return fallback;
    },
    /** Accepts an array or a comma/newline separated string. */
    list(key: string, fallback: string[]): string[] {
      const v = get(key);
      if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
      if (typeof v === 'string') return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      return fallback;
    },
    oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
      const v = get(key);
      return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
    },
  };
}
