import { createHash } from 'node:crypto';

/**
 * Publishes rendered files to a dedicated branch through the GitHub REST Git
 * Data API (no git binary needed). Every publish is a single orphan commit, so
 * the branch never accumulates history, and nothing is committed when the
 * rendered tree is identical to what the branch already holds.
 *
 * Because a publish replaces the branch wholesale, an existing branch is only
 * replaced when it is not the repository's default branch and its latest commit
 * looks like an earlier publish: an orphan commit containing the marker file.
 */

export interface PublishFile {
  /** Path inside the branch, e.g. "stats-dark.svg". */
  path: string;
  content: string | Uint8Array;
}

export interface PublishOptions {
  token: string;
  /** "owner/repo" (GITHUB_REPOSITORY). */
  repository: string;
  branch: string;
  message: string;
  files: PublishFile[];
  /** REST root, e.g. GITHUB_API_URL on GitHub Enterprise Server. */
  apiUrl?: string;
  /** Web root (GITHUB_SERVER_URL), used to build raw URLs on GHES. */
  serverUrl?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** Parallel blob uploads (default 4). */
  concurrency?: number;
  /** Base delay between retries of transient failures (default 600 ms). */
  retryDelayMs?: number;
  /**
   * A file every publish contains (default "README-snippet.md"). An existing
   * branch is only replaced when its latest commit is an orphan holding it.
   */
  markerFile?: string;
}

export interface PublishResult {
  status: 'created' | 'updated' | 'unchanged';
  commitSha: string;
  treeSha: string;
  /** Prefix for raw file URLs, without trailing slash. */
  baseUrl: string;
  /** Web URL of the branch. */
  branchUrl: string;
}

export class PublishError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'PublishError';
    this.status = status;
  }
}

const DEFAULT_API = 'https://api.github.com';
const DEFAULT_SERVER = 'https://github.com';

const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

/** Raw file URL prefix: raw.githubusercontent.com on github.com, `<server>/<owner>/<repo>/raw/<branch>` on GHES. */
export function rawBaseUrl(repository: string, branch: string, serverUrl = DEFAULT_SERVER): string {
  const server = serverUrl.replace(/\/+$/, '');
  let host = '';
  try {
    host = new URL(server).hostname.toLowerCase();
  } catch {
    host = 'github.com';
  }
  if (host === 'github.com' || host === 'www.github.com') return `https://raw.githubusercontent.com/${repository}/${encodeRef(branch)}`;
  return `${server}/${repository}/raw/${encodeRef(branch)}`;
}

export function branchWebUrl(repository: string, branch: string, serverUrl = DEFAULT_SERVER): string {
  return `${serverUrl.replace(/\/+$/, '')}/${repository}/tree/${encodeRef(branch)}`;
}

const toBytes = (c: string | Uint8Array) => (typeof c === 'string' ? Buffer.from(c, 'utf8') : Buffer.from(c));

/** SHA-1 of a git blob object, exactly as git computes it. */
export function gitBlobSha(content: string | Uint8Array): string {
  const bytes = toBytes(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/**
 * SHA-1 of a flat git tree of regular files (mode 100644). Lets us detect an
 * unchanged branch without uploading a single blob. Returns null for nested
 * paths, which we leave to the API.
 */
export function gitTreeSha(files: { path: string; sha: string }[]): string | null {
  if (files.some((f) => f.path.includes('/') || !f.path)) return null;
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const parts: Buffer[] = [];
  for (const f of sorted) parts.push(Buffer.from(`100644 ${f.path}\0`, 'utf8'), Buffer.from(f.sha, 'hex'));
  const body = Buffer.concat(parts);
  return createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
}

export function withSkipCi(message: string): string {
  return /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/i.test(message) ? message : `${message.trim()} [skip ci]`;
}

export interface ApiResult<T> {
  status: number;
  data: T;
}

export interface RestClient {
  /** Calls the REST API, retrying transient failures; non-2xx statuses not listed in okStatuses throw PublishError. */
  call<T>(method: string, path: string, action: string, body?: unknown, okStatuses?: number[]): Promise<ApiResult<T>>;
}

export interface RestOptions {
  token: string;
  repository: string;
  branch?: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Turn a failed REST call into an actionable message. */
export function describeFailure(status: number, body: string, action: string, ctx: { repository: string; branch?: string }): string {
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) message = parsed.message;
  } catch {
    // not JSON
  }
  const permissions =
    'Grant the workflow write access by adding this to the workflow (or the job):\n\n' +
    '  permissions:\n    contents: write\n\n' +
    'or pass a github_token (e.g. a fine-grained PAT with "Contents: Read and write") that can push to the repository.';
  if (status === 401) {
    return `GitHub rejected github_token (401) while trying to ${action}. The token is invalid or has expired.`;
  }
  if (status === 403 && /rate limit/i.test(message)) {
    return `GitHub API rate limit reached while trying to ${action}: ${message}. Try again later.`;
  }
  if (status === 403) {
    return `GitHub refused to ${action} in ${ctx.repository} (403: ${message}).\n${permissions}`;
  }
  if (status === 404) {
    return `GitHub could not ${action}: ${ctx.repository} was not found or github_token cannot access it (404).\n${permissions}`;
  }
  if (status === 409 && /empty/i.test(message)) {
    return `Cannot ${action}: ${ctx.repository} has no commits yet. Push an initial commit first.`;
  }
  if (status === 422 && /protect/i.test(message)) {
    return `Cannot ${action}: branch "${ctx.branch}" is protected (${message}). Use a dedicated branch input such as "profilescape-output".`;
  }
  return `GitHub API responded ${status} while trying to ${action}: ${message}`;
}

export function restClient(o: RestOptions): RestClient {
  const doFetch = o.fetchImpl ?? fetch;
  const root = (o.apiUrl || DEFAULT_API).replace(/\/+$/, '');
  const baseDelay = o.retryDelayMs ?? 600;
  return {
    async call<T>(method: string, path: string, action: string, body?: unknown, okStatuses: number[] = []): Promise<ApiResult<T>> {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await sleep(baseDelay * 2 ** (attempt - 1));
        let res: Response;
        try {
          res = await doFetch(`${root}${path}`, {
            method,
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${o.token}`,
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'profilescape',
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        } catch (err) {
          lastError = new PublishError(`Network error while trying to ${action}: ${(err as Error).message}`);
          continue;
        }
        const text = await res.text();
        if (res.status >= 500) {
          lastError = new PublishError(describeFailure(res.status, text, action, { repository: o.repository, branch: o.branch }), res.status);
          continue;
        }
        if (!res.ok && !okStatuses.includes(res.status)) {
          throw new PublishError(describeFailure(res.status, text, action, { repository: o.repository, branch: o.branch }), res.status);
        }
        let data: unknown = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }
        return { status: res.status, data: data as T };
      }
      throw lastError instanceof Error ? lastError : new PublishError(String(lastError));
    },
  };
}

interface CommitInfo {
  sha: string;
  tree: { sha: string };
  parents?: { sha: string }[];
}

/**
 * Refuse to replace a branch Profilescape did not create: the default branch,
 * or any branch whose latest commit has history or lacks the marker file.
 */
async function assertReplaceable(
  api: RestClient,
  repoPath: string,
  o: PublishOptions,
  marker: string,
  commit: CommitInfo,
): Promise<void> {
  const advice =
    `Publishing replaces the whole branch with a single commit of SVG files, so Profilescape only writes to a dedicated branch. ` +
    `Set the "branch" input to a new name such as "profilescape-output" (the default)`;
  const repo = await api.call<{ default_branch?: string } | null>('GET', repoPath, 'read the repository settings');
  if (repo.data && repo.data.default_branch === o.branch) {
    throw new PublishError(
      `Refusing to publish to "${o.branch}": it is the default branch of ${o.repository}. ${advice}, and use the "readme" input to keep your README up to date.`,
    );
  }
  let reason = (commit.parents ?? []).length ? 'its latest commit has history' : '';
  if (!reason) {
    const tree = await api.call<{ tree?: { path: string; type: string }[] } | null>(
      'GET',
      `${repoPath}/git/trees/${commit.tree.sha}`,
      `read the files on "${o.branch}"`,
    );
    if (!(tree.data?.tree ?? []).some((e) => e.path === marker && e.type === 'blob')) reason = `it has no ${marker}`;
  }
  if (reason) {
    throw new PublishError(
      `Branch "${o.branch}" already exists and was not created by Profilescape (${reason}). ${advice}, or delete "${o.branch}" first if its contents are disposable.`,
    );
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function publishToBranch(o: PublishOptions): Promise<PublishResult> {
  const log = o.log ?? (() => {});
  const [owner, repo, extra] = o.repository.split('/');
  if (!owner || !repo || extra !== undefined) {
    throw new PublishError(`Invalid repository "${o.repository}"; expected "owner/repo".`);
  }
  if (!o.files.length) throw new PublishError('Nothing to publish: no files were rendered.');
  const seen = new Set<string>();
  for (const f of o.files) {
    if (seen.has(f.path)) throw new PublishError(`Duplicate file path "${f.path}" in publish set.`);
    seen.add(f.path);
  }

  const api = restClient(o);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const ref = encodeRef(o.branch);
  const baseUrl = rawBaseUrl(o.repository, o.branch, o.serverUrl);
  const branchUrl = branchWebUrl(o.repository, o.branch, o.serverUrl);

  const marker = o.markerFile ?? 'README-snippet.md';

  // 1. Current state of the branch, if it exists.
  const readHead = async (): Promise<CommitInfo | undefined> => {
    const current = await api.call<{ object?: { sha: string; type: string } } | unknown[]>(
      'GET',
      `${repoPath}/git/ref/heads/${ref}`,
      `read branch "${o.branch}"`,
      undefined,
      [404],
    );
    const sha = current.status === 200 && !Array.isArray(current.data) ? current.data?.object?.sha : undefined;
    if (!sha) return undefined;
    const commit = await api.call<Omit<CommitInfo, 'sha'>>('GET', `${repoPath}/git/commits/${sha}`, `read the latest commit of "${o.branch}"`);
    return { ...commit.data, sha };
  };
  const head = await readHead();
  const headSha = head?.sha;
  const existingTree = head?.tree.sha;

  // 2. Cheap local check: identical tree means nothing to upload.
  const local = o.files.map((f) => ({ path: f.path, sha: gitBlobSha(f.content), content: f.content }));
  const localTree = gitTreeSha(local);
  if (headSha && existingTree && localTree === existingTree) {
    log(`Branch "${o.branch}" is already up to date (tree ${existingTree.slice(0, 7)}); nothing to publish.`);
    return { status: 'unchanged', commitSha: headSha, treeSha: existingTree, baseUrl, branchUrl };
  }

  // Never wipe a branch that holds something else (e.g. "main" or "gh-pages").
  if (head) await assertReplaceable(api, repoPath, o, marker, head);

  // 3. Upload blobs (each distinct content once).
  const unique = [...new Map(local.map((f) => [f.sha, f])).values()];
  const uploaded = new Map<string, string>();
  await mapLimit(unique, o.concurrency ?? 4, async (f) => {
    const res = await api.call<{ sha: string }>('POST', `${repoPath}/git/blobs`, `upload ${f.path}`, {
      content: toBytes(f.content).toString('base64'),
      encoding: 'base64',
    });
    uploaded.set(f.sha, res.data.sha);
  });

  // 4. Tree without base_tree: the branch holds exactly these files.
  const tree = await api.call<{ sha: string }>('POST', `${repoPath}/git/trees`, 'create the file tree', {
    tree: local
      .map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: uploaded.get(f.sha) ?? f.sha }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
  const treeSha = tree.data.sha;
  if (headSha && existingTree === treeSha) {
    log(`Branch "${o.branch}" is already up to date (tree ${treeSha.slice(0, 7)}); nothing to publish.`);
    return { status: 'unchanged', commitSha: headSha, treeSha, baseUrl, branchUrl };
  }

  // 5. Orphan commit: no parents, so the branch never grows.
  const commit = await api.call<{ sha: string }>('POST', `${repoPath}/git/commits`, 'create the commit', {
    message: withSkipCi(o.message),
    tree: treeSha,
    parents: [],
  });
  const commitSha = commit.data.sha;

  // 6. Point the branch at it (force, since the new commit is unrelated).
  const update = () =>
    api.call('PATCH', `${repoPath}/git/refs/heads/${ref}`, `update branch "${o.branch}"`, { sha: commitSha, force: true });
  if (headSha) {
    await update();
    log(`Updated branch "${o.branch}" -> ${commitSha.slice(0, 7)}.`);
    return { status: 'updated', commitSha, treeSha, baseUrl, branchUrl };
  }
  const created = await api.call<{ message?: string }>(
    'POST',
    `${repoPath}/git/refs`,
    `create branch "${o.branch}"`,
    { ref: `refs/heads/${o.branch}`, sha: commitSha },
    [422],
  );
  if (created.status === 422) {
    const message = (created.data as { message?: string } | null)?.message ?? '';
    if (!/already exists/i.test(message)) {
      throw new PublishError(describeFailure(422, JSON.stringify({ message }), `create branch "${o.branch}"`, o), 422);
    }
    // Someone created the branch in the meantime (e.g. a concurrent run): take it
    // over, but only if that branch is an earlier publish too.
    const raced = await readHead();
    if (raced) await assertReplaceable(api, repoPath, o, marker, raced);
    await update();
    log(`Updated branch "${o.branch}" -> ${commitSha.slice(0, 7)}.`);
    return { status: 'updated', commitSha, treeSha, baseUrl, branchUrl };
  }
  log(`Created branch "${o.branch}" at ${commitSha.slice(0, 7)}.`);
  return { status: 'created', commitSha, treeSha, baseUrl, branchUrl };
}
