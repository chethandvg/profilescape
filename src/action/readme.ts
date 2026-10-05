import { PublishError, restClient, withSkipCi } from './publish.ts';

/**
 * Keeps a README in sync: everything between the Profilescape markers is
 * replaced with fresh markup, everything else is left byte-for-byte intact.
 */

export const START_MARKER = '<!-- profilescape:start -->';
export const END_MARKER = '<!-- profilescape:end -->';

const START_RE = /<!--\s*profilescape:start\s*-->/i;
const END_RE = /<!--\s*profilescape:end\s*-->/i;

export type ReplaceStatus = 'updated' | 'unchanged' | 'missing-markers' | 'misordered-markers';

/** The markers with markup between them, ready to paste into a README. */
export function wrapWithMarkers(markup: string, eol = '\n'): string {
  const body = markup.replace(/\r\n?/g, '\n').trim();
  const lines = body ? [START_MARKER, '', body, '', END_MARKER] : [START_MARKER, END_MARKER];
  return lines.join('\n').split('\n').join(eol);
}

/**
 * Replace the content between the first start marker and the following end
 * marker. Idempotent, keeps the file's line endings (LF or CRLF) and the exact
 * text of the user's markers.
 */
export function replaceBetweenMarkers(content: string, markup: string): { content: string; status: ReplaceStatus } {
  const start = START_RE.exec(content);
  if (!start) return { content, status: END_RE.test(content) ? 'misordered-markers' : 'missing-markers' };
  const afterStart = start.index + start[0].length;
  const endRel = END_RE.exec(content.slice(afterStart));
  if (!endRel) return { content, status: END_RE.test(content.slice(0, start.index)) ? 'misordered-markers' : 'missing-markers' };
  const endIndex = afterStart + endRel.index;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const body = markup.replace(/\r\n?/g, '\n').trim();
  const inner = body ? `${eol}${eol}${body.split('\n').join(eol)}${eol}${eol}` : eol;
  const next = `${content.slice(0, afterStart)}${inner}${content.slice(endIndex)}`;
  return { content: next, status: next === content ? 'unchanged' : 'updated' };
}

export function missingMarkersHelp(path: string): string {
  return (
    `${path} has no Profilescape markers, so it was not changed. Add these two lines where the cards should appear ` +
    `and the next run will fill them in:\n\n${START_MARKER}\n${END_MARKER}`
  );
}

export interface ReadmeUpdateOptions {
  token: string;
  /** "owner/repo". */
  repository: string;
  /** Path of the README inside the repository, e.g. "README.md". */
  path: string;
  markup: string;
  /** Commit message; " [skip ci]" is appended so the update never triggers workflows. */
  message: string;
  /** Branch to update; defaults to the repository's default branch. */
  branch?: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  log?: (message: string) => void;
}

export interface ReadmeUpdateResult {
  status: ReplaceStatus;
  path: string;
  commitSha?: string;
}

export function normalizeRepoPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');
}

interface ContentsFile {
  type: string;
  encoding?: string;
  content?: string;
  sha: string;
}

export async function updateReadme(o: ReadmeUpdateOptions): Promise<ReadmeUpdateResult> {
  const [owner, repo] = o.repository.split('/');
  if (!owner || !repo) throw new PublishError(`Invalid repository "${o.repository}"; expected "owner/repo".`);
  const path = normalizeRepoPath(o.path);
  if (!path || path.split('/').includes('..')) throw new PublishError(`Invalid readme path "${o.path}".`);
  const api = restClient({ ...o, branch: o.branch });
  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const query = o.branch ? `?ref=${encodeURIComponent(o.branch)}` : '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await api.call<ContentsFile | ContentsFile[]>('GET', `${url}${query}`, `read ${path}`, undefined, [404]);
    if (res.status === 404) {
      throw new PublishError(`README "${path}" was not found in ${o.repository}. Check the readme input (paths are relative to the repository root).`, 404);
    }
    const file = res.data;
    if (Array.isArray(file) || file.type !== 'file') throw new PublishError(`readme input "${path}" is not a file.`);
    if (file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new PublishError(`${path} is too large to update through the contents API (over 1 MB).`);
    }
    const current = Buffer.from(file.content, 'base64').toString('utf8');
    const result = replaceBetweenMarkers(current, o.markup);
    if (result.status !== 'updated') return { status: result.status, path };

    const put = await api.call<{ commit?: { sha: string } }>(
      'PUT',
      url,
      `update ${path}`,
      {
        message: withSkipCi(o.message),
        content: Buffer.from(result.content, 'utf8').toString('base64'),
        sha: file.sha,
        ...(o.branch ? { branch: o.branch } : {}),
      },
      [409],
    );
    if (put.status === 409) {
      // The file changed between our read and write; re-read and try once more.
      o.log?.(`${path} changed while updating; retrying.`);
      continue;
    }
    o.log?.(`Updated ${path}.`);
    return { status: 'updated', path, commitSha: put.data?.commit?.sha };
  }
  throw new PublishError(`${path} kept changing while Profilescape tried to update it; it will be retried on the next run.`, 409);
}
