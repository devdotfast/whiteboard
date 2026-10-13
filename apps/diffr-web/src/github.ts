/**
 * Read a pull request or a comparison straight from GitHub. Requests go only to api.github.com and
 * raw.githubusercontent.com, both of which allow cross-origin reads; the token, when there is one,
 * stays in this browser's localStorage and goes only to api.github.com.
 */

export type Target =
  | { kind: "pull"; owner: string; repo: string; number: number }
  | {
      kind: "compare";
      owner: string;
      repo: string;
      base: string;
      head: string;
    };

export type Status = "added" | "deleted" | "modified" | "renamed" | "copied";

export interface ChangedFile {
  path: string;
  /** The path at the base, for a rename or copy. */
  previousPath?: string;
  status: Status;
  /** GitHub's patch for the file; absent for binary files and ones too large for the listing. */
  patch?: string;
  additions: number;
  deletions: number;
  /** The file's blob at the head; absent for a deletion. */
  sha?: string;
}

export interface Change {
  target: Target;
  title: string;
  url: string;
  /** The merge base, as GitHub's own PR diff uses: what the head is compared with. */
  base: string;
  head: string;
  files: ChangedFile[];
  /** GitHub's totals for a pull request. Its file listing reports 0 for files too large to patch. */
  additions?: number;
  deletions?: number;
}

const TOKEN_KEY = "diffr.githubToken";

export function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(value: string | null) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage is off: the token lasts until the page closes, which is never, since nothing keeps it.
  }
}

/** `owner/repo/pull/N` or `owner/repo/compare/base...head`, with or without github.com in front. */
export function parseTarget(input: string): Target | null {
  const path = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/^\/+/, "")
    .replace(/[?#].*$/, "");

  const pull = path.match(/^([\w.-]+)\/([\w.-]+)\/pulls?\/(\d+)/);

  if (pull)
    return {
      kind: "pull",
      owner: pull[1]!,
      repo: pull[2]!,
      number: Number(pull[3]),
    };

  const compare = path.match(
    /^([\w.-]+)\/([\w.-]+)\/compare\/(.+?)\.\.\.?(.+)$/,
  );

  if (compare)
    return {
      kind: "compare",
      owner: compare[1]!,
      repo: compare[2]!,
      base: decodeURIComponent(compare[3]!),
      head: decodeURIComponent(compare[4]!),
    };

  return null;
}

export function targetPath(target: Target): string {
  const repo = `/${target.owner}/${target.repo}`;

  return target.kind === "pull"
    ? `${repo}/pull/${target.number}`
    : `${repo}/compare/${encodeURIComponent(target.base)}...${encodeURIComponent(target.head)}`;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string): Promise<T> {
  const auth = token();

  const headers = new Headers({ Accept: "application/vnd.github+json" });

  if (auth) headers.set("Authorization", `Bearer ${auth}`);

  const response = await fetch(`https://api.github.com${path}`, { headers });

  if (!response.ok) {
    // SAFETY: GitHub's error bodies carry a message; without one the status text is shown.
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    const limited = response.headers.get("x-ratelimit-remaining") === "0";
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;

    const until = reset
      ? ` until ${new Date(reset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "";

    const message = limited
      ? `GitHub's rate limit is spent${auth ? "" : " (60 requests an hour without a token)"}${until}. Add a token or try again then.`
      : response.status === 404 && !auth
        ? "Not found. A private repository needs a token"
        : (body.message ?? response.statusText);

    throw new GitHubError(
      `GitHub ${response.status}: ${message}`,
      response.status,
    );
  }

  // SAFETY: each caller names the shape GitHub documents for its endpoint.
  return response.json() as Promise<T>;
}

interface ApiFile {
  filename: string;
  previous_filename?: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  patch?: string;
  additions: number;
  deletions: number;
  sha?: string;
}

const statuses: Record<ApiFile["status"], Status> = {
  added: "added",
  removed: "deleted",
  modified: "modified",
  renamed: "renamed",
  copied: "copied",
  changed: "modified",
  unchanged: "modified",
};

const changedFile = (file: ApiFile): ChangedFile => ({
  path: file.filename,
  previousPath: file.previous_filename,
  status: statuses[file.status],
  patch: file.patch,
  additions: file.additions,
  deletions: file.deletions,
  sha: file.status === "removed" ? undefined : file.sha,
});

/** Every page of a listing GitHub caps at 100 a page; it stops listing a PR's files at 3000. */
async function pages<R, T>(
  path: (page: number) => string,
  items: (response: R) => T[],
): Promise<T[]> {
  const all: T[] = [];

  for (let page = 1; page <= 30; page++) {
    const batch = items(await api<R>(path(page)));
    all.push(...batch);

    if (batch.length < 100) break;
  }

  return all;
}

/** What can be shown before the whole listing is in: the title and the first page of files. */
export type Preview = Omit<Change, "base"> & { base?: string };

/**
 * Load a change. A pull request calls `onPreview` as soon as its first hundred files are known,
 * so they can be shown while the rest of the listing and the merge base load.
 */
export async function loadChange(
  target: Target,
  onPreview?: (preview: Preview) => void,
): Promise<Change> {
  if (
    import.meta.env.DEV &&
    new URLSearchParams(location.search).has("ui-fixture")
  ) {
    const data = await (await fetch("/__ui-fixture.json")).json();
    onPreview?.(data.change);

    return data.change;
  }

  const repo = `/repos/${target.owner}/${target.repo}`;

  if (target.kind === "pull") {
    const page = (n: number) =>
      api<ApiFile[]>(
        `${repo}/pulls/${target.number}/files?per_page=100&page=${n}`,
      );

    // The first page of files needs nothing from the PR, so it is asked for alongside it.
    const [pr, first] = await Promise.all([
      api<{
        title: string;
        html_url: string;
        base: { sha: string };
        head: { sha: string };
        changed_files: number;
        additions: number;
        deletions: number;
      }>(`${repo}/pulls/${target.number}`),
      page(1),
    ]);

    const preview: Preview = {
      target,
      title: pr.title,
      url: pr.html_url,
      head: pr.head.sha,
      files: first.map(changedFile),
      additions: pr.additions,
      deletions: pr.deletions,
    };

    onPreview?.(preview);

    // The merge base is all diffr needs to start on the files already shown.
    const base = api<{ merge_base_commit: { sha: string } }>(
      `${repo}/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`,
    );

    void base.then(
      (compare) =>
        onPreview?.({ ...preview, base: compare.merge_base_commit.sha }),
      () => {},
    );
    // The PR says how many files it changed, so every other page can be asked for at once.
    const count = Math.min(30, Math.max(1, Math.ceil(pr.changed_files / 100)));

    const [compare, ...rest] = await Promise.all([
      base,
      ...Array.from({ length: count - 1 }, (_, i) => page(i + 2)),
    ]);

    const files = [first, ...rest].flat();

    return {
      target,
      title: pr.title,
      url: pr.html_url,
      base: compare.merge_base_commit.sha,
      head: pr.head.sha,
      files: files.map(changedFile),
      additions: pr.additions,
      deletions: pr.deletions,
    };
  }

  const range = `${encodeURIComponent(target.base)}...${encodeURIComponent(target.head)}`;

  type Compare = {
    merge_base_commit: { sha: string };
    html_url: string;
    files?: ApiFile[];
  };

  let compare: Compare | undefined;

  const [head, files] = await Promise.all([
    api<{ sha: string }>(`${repo}/commits/${encodeURIComponent(target.head)}`),
    pages(
      (page) => `${repo}/compare/${range}?per_page=100&page=${page}`,
      (r: Compare) => {
        compare ??= r;

        return r.files ?? [];
      },
    ),
  ]);

  return {
    target,
    title: `${target.base}...${target.head}`,
    url: compare!.html_url,
    base: compare!.merge_base_commit.sha,
    head: head.sha,
    files: files.map(changedFile),
  };
}

const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

/** A file's text at a commit. Without a token, raw.githubusercontent.com serves public files outside the API's rate limit. */
export async function fileText(
  target: Target,
  sha: string,
  path: string,
): Promise<string> {
  if (
    import.meta.env.DEV &&
    new URLSearchParams(location.search).has("ui-fixture")
  ) {
    const data = await (await fetch("/__ui-fixture.json")).json();

    return data.texts[sha][path];
  }

  const auth = token();

  const response = auth
    ? await fetch(
        `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodePath(path)}?ref=${sha}`,
        {
          headers: {
            Accept: "application/vnd.github.raw+json",
            Authorization: `Bearer ${auth}`,
          },
        },
      )
    : await fetch(
        `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${sha}/${encodePath(path)}`,
      );

  if (!response.ok)
    throw new GitHubError(
      `GitHub ${response.status} fetching ${path}`,
      response.status,
    );

  // diffr decides what is binary from the bytes, so keep NULs; invalid UTF-8 becomes U+FFFD.
  return new TextDecoder().decode(await response.arrayBuffer());
}
