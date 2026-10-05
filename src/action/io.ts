import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { INPUT_NAMES, type RawInputs } from './config.ts';

/**
 * Minimal, dependency-free replacements for the bits of @actions/core we need:
 * inputs, outputs, step summary and workflow commands.
 */

export type Env = Record<string, string | undefined>;
export type { RawInputs };

/** Reads `INPUT_<NAME>` the way the runner sets it (spaces become underscores, upper case). */
export function getInput(name: string, env: Env = process.env): string {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
}

export function readInputs(env: Env = process.env): RawInputs {
  const out: RawInputs = {};
  for (const name of INPUT_NAMES) out[name] = getInput(name, env);
  return out;
}

/** Escaping rules for workflow command data and properties (mirrors @actions/core). */
export function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function command(name: string, message: string, props: Record<string, string | number | undefined> = {}): string {
  const entries = Object.entries(props).filter(([, v]) => v !== undefined && v !== '');
  const propText = entries.length ? ` ${entries.map(([k, v]) => `${k}=${escapeProperty(String(v))}`).join(',')}` : '';
  return `::${name}${propText}::${escapeData(message)}`;
}

/**
 * Multiline-safe `name<<DELIM` syntax for GITHUB_OUTPUT / GITHUB_ENV. The
 * delimiter is random so a value can never terminate the block early.
 */
export function formatKeyValue(name: string, value: string, delimiter = `ghadelimiter_${randomUUID()}`): string {
  if (name.includes(delimiter) || value.includes(delimiter)) {
    throw new Error(`Output "${name}" contains its own delimiter; refusing to write it.`);
  }
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

export interface Logger {
  info(message: string): void;
  debug(message: string): void;
  warning(message: string, props?: { title?: string; file?: string }): void;
  error(message: string, props?: { title?: string; file?: string }): void;
  group(name: string): void;
  endGroup(): void;
  mask(secret: string): void;
}

/** Logger that speaks the GitHub Actions workflow-command protocol on stdout. */
export function actionsLogger(write: (line: string) => void = (l) => process.stdout.write(`${l}\n`), env: Env = process.env): Logger {
  return {
    info: (m) => write(m),
    debug: (m) => {
      if (env.RUNNER_DEBUG === '1' || env.ACTIONS_STEP_DEBUG === 'true') write(command('debug', m));
    },
    warning: (m, p = {}) => write(command('warning', m, p)),
    error: (m, p = {}) => write(command('error', m, p)),
    group: (name) => write(command('group', name)),
    endGroup: () => write('::endgroup::'),
    mask: (secret) => {
      // Mask each line separately: the runner matches masks line by line.
      for (const line of secret.split(/\r?\n/)) if (line.trim()) write(command('add-mask', line.trim()));
    },
  };
}

export interface Outputs {
  set(name: string, value: string): void;
  summary(markdown: string): void;
}

/** Writes outputs and the step summary to the files the runner provides (no-ops locally). */
export function actionsOutputs(env: Env = process.env, log?: Logger): Outputs {
  return {
    set(name, value) {
      const file = env.GITHUB_OUTPUT;
      if (file) appendFileSync(file, formatKeyValue(name, value), 'utf8');
      else log?.debug(`output ${name}=${value}`);
    },
    summary(markdown) {
      const file = env.GITHUB_STEP_SUMMARY;
      if (file) appendFileSync(file, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
    },
  };
}

/** `config` input: inline JSON (starts with "{") or a path to a JSON file in the workspace. */
export function loadConfigText(value: string, workspace: string): { text: string; source: string } | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith('{')) return { text: v, source: 'config input' };
  const path = isAbsolute(v) ? v : resolve(workspace, v);
  if (!existsSync(path)) {
    throw new Error(
      `Config file "${v}" was not found (looked in ${path}). Paths are relative to the repository root; ` +
        `make sure the workflow runs actions/checkout before Profilescape, or pass the JSON inline.`,
    );
  }
  return { text: readFileSync(path, 'utf8'), source: v };
}

/** Workspace-relative path with forward slashes, for logs and outputs. */
export function displayPath(path: string, workspace: string): string {
  const rel = relative(workspace, path);
  const out = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
  return out.split('\\').join('/');
}

/** "12.3 KB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Write rendered files into `outDir` (created if needed). Refuses paths that
 * would escape the directory. Returns absolute paths in write order.
 */
export function writeFiles(outDir: string, files: { path: string; content: string }[]): string[] {
  const root = resolve(outDir);
  mkdirSync(root, { recursive: true });
  const written: string[] = [];
  for (const f of files) {
    const target = resolve(join(root, f.path));
    if (target !== root && !target.startsWith(root.endsWith(sep) ? root : root + sep)) {
      throw new Error(`Refusing to write "${f.path}" outside ${root}.`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, 'utf8');
    written.push(target);
  }
  return written;
}
