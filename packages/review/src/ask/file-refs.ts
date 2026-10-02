/** A file an agent's answer names, as it wrote it: `src/app.ts`,
 * `src/app.ts:42:7`, `/checkout/src/app.ts#L42`, `file:///checkout/app.ts`. */
export interface AskFileRef {
  path: string;
  line?: number;
}

/** `:42`, `:42:7`, `:42-50`, `#L42`, `#L42C7`, `#L42-L50`. */
const lineSuffix = /(?::(\d+)(?::\d+)?(?:-\d+)?|#L(\d+)(?:C\d+)?(?:-L?\d+)?)$/;

/** A scheme, as in `https://`; a Windows drive letter is not one. */
const urlScheme = /^[a-z][a-z\d+.-]+:/i;

/** What a piece of inline code or a link target names, if it could be a
 * file: a path with a directory or an extension, and no spaces. Whether the
 * file exists is the checkout's to say. */
export function parseFileRef(text: string): AskFileRef | undefined {
  let value = text.trim();

  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(value.slice("file://".length));
    } catch {
      return undefined;
    }
  }

  if (
    !value ||
    value.length > 400 ||
    /[\s`'"<>|*?{}$]/.test(value) ||
    urlScheme.test(value) ||
    value.startsWith("-")
  )
    return undefined;

  const match = lineSuffix.exec(value);

  const path = (match ? value.slice(0, match.index) : value).replace(
    /^\.\//,
    "",
  );

  const name = path.split("/").at(-1) ?? "";

  if (!name || !(path.includes("/") || /\.[a-z][a-z\d]*$/i.test(name)))
    return undefined;

  const line = Number(match?.[1] ?? match?.[2]);

  return line > 0 ? { path, line } : { path };
}

/** Resolves the paths an answer names to files in the checkout, relative to
 * its root. Agents write paths from the checkout root, as absolute paths, or
 * relative to the package they are in; a path that could be several files
 * resolves to the one the agent's tools touched, else to none. */
export function resolveFileRefs(
  root: string,
  files: readonly string[],
  paths: readonly string[],
  /** Paths the agent's tool calls named. */
  touched: readonly string[] = [],
): Map<string, string> {
  const known = new Set(files);

  const inRoot = (path: string) =>
    path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;

  const named = (path: string) =>
    known.has(path)
      ? [path]
      : files.filter((file) => file.endsWith(`/${path}`));

  const touchedFiles = new Set(
    touched.flatMap((path) => {
      const relative = inRoot(path);

      return relative.startsWith("/") ? [] : named(relative);
    }),
  );

  const resolved = new Map<string, string>();

  for (const asked of paths) {
    const path = inRoot(asked);

    // Absolute, but not in this checkout.
    if (path.startsWith("/")) continue;

    // `a/` and `b/` are a diff's prefixes, not directories.
    for (const candidate of [path, path.replace(/^[ab]\//, "")]) {
      const matches = named(candidate);
      const touchedMatches = matches.filter((file) => touchedFiles.has(file));

      const match =
        matches.length === 1
          ? matches[0]
          : touchedMatches.length === 1
            ? touchedMatches[0]
            : undefined;

      if (match) {
        resolved.set(asked, match);
        break;
      }
    }
  }

  return resolved;
}
