import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));

/** The canvas and Desktop's review sources. */
const roots = [
  here,
  join(here, "../../../../apps/review-desktop/code-oss/src/vs/review"),
];

const SYSTEM_FONT = /system-ui|-apple-system|sans-serif/;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(tsx?|css|html)$/.test(name) && !/\.test\.tsx?$/.test(name))
      yield path;
  }
}

/** Where a source line names a font it shouldn't, by path and line. */
function offending(test: (line: string) => boolean): string[] {
  return roots.flatMap((root) =>
    [...sources(root)]
      .filter((path) => !path.endsWith("fonts.css"))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .flatMap((line, index) =>
            test(line) ? [`${relative(root, path)}:${index + 1}`] : [],
          ),
      ),
  );
}

// The app sets three faces, each with one role and each through a token:
// Inter for its own interface, Newsreader for board prose, tables and thread
// quotes, and Geist Mono for code, ids, paths, line numbers and counts.
// fonts.css and the faces' definitions may name fallbacks.
it("names no system or sans-serif font outside fonts.css", () => {
  expect(
    offending((line) => SYSTEM_FONT.test(line) && !DEFINITION.test(line)),
  ).toEqual([]);
});

/** A face named in quotes, as a style would name it. */
const FACE = /["'](Geist Mono|Newsreader|Inter)["']/;

/** Where the three faces are defined: their variables, and Monaco's font
 * setting, which takes a family list rather than CSS. */
const DEFINITION =
  /--(font-sans|font-mono|font-serif|review-chrome-font|review-mono-font)\s*:|'editor\.fontFamily'/;

it("names Inter, Geist Mono and Newsreader only where their variables are defined", () => {
  expect(
    offending((line) => FACE.test(line) && !DEFINITION.test(line)),
  ).toEqual([]);
});

/** Another face by name, or the editor's own font settings: chrome follows
 * the app's faces, not the person's code font. */
const OTHER_FACE =
  /\b(Menlo|Monaco|Consolas|Georgia|SF Mono|SFMono|Courier|Helvetica|Arial)\b|--monaco-monospace-font|--vscode-editor-font-family/;

it("names no other face, nor the code editor's font, outside fonts.css", () => {
  expect(
    offending(
      (line) =>
        /font/i.test(line) &&
        OTHER_FACE.test(line) &&
        !DEFINITION.test(line) &&
        !/^\s*(\/\/|\*|\/\*)/.test(line),
    ),
  ).toEqual([]);
});

/** A generic family that isn't a fallback inside `var(…, family)`. */
const BARE_GENERIC =
  /font(-family)?\s*:[^;]*?(?<!var\([^)]*)\b(serif|monospace)\b/;

it("names a generic family only as a fallback", () => {
  expect(
    offending((line) => BARE_GENERIC.test(line) && !DEFINITION.test(line)),
  ).toEqual([]);
});

/** A face's base variable, used where its role's token belongs: the chrome
 * for words (`tokens.chromeFont`, `--review-chrome-font`), mono for what a
 * terminal would print, the serif for board prose. */
const BASE_FACE = /var\(--font-sans\)|tokens\.font(Sans|Display)\b/;

it("sets a face through its role's token, never a base variable", () => {
  expect(
    offending(
      (line) =>
        BASE_FACE.test(line) &&
        // The definitions themselves: the roles, and the token beside them.
        !/(--(chrome-font|font-display)"?|^\s*fontSans)\s*:/.test(line),
    ),
  ).toEqual([]);
});
