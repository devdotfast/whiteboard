#!/usr/bin/env node
// Rewrites `../` import specifiers in packages/review and its canvas app to the
// `@review/*` and `@canvas/*` aliases from tsconfig.base.json. Run it after
// rebasing a branch that predates the aliases; it only touches specifiers that
// resolve into one of the aliased source roots.
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const reviewRoot = path.resolve(import.meta.dirname, "../packages/review");

const aliases = [
  ["@canvas", path.join(reviewRoot, "app/src")],
  ["@review", path.join(reviewRoot, "src")],
];

const specifier =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock|importActual)\(\s*)(["'])(\.\.\/[^"']*)\2/g;

function rewriteImports(source, filePath) {
  return source.replace(specifier, (match, prefix, quote, relative) => {
    const target = path.resolve(path.dirname(filePath), relative);

    for (const [alias, root] of aliases) {
      if (target.startsWith(root + path.sep)) {
        const rest = path.relative(root, target).split(path.sep).join("/");

        return `${prefix}${quote}${alias}/${rest}${quote}`;
      }
    }

    return match;
  });
}

async function* sourceFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(?:m?ts|tsx)$/.test(entry.name)) yield full;
  }
}

if (import.meta.main) {
  let changed = 0;

  for await (const file of sourceFiles(reviewRoot)) {
    const source = await readFile(file, "utf8");
    const next = rewriteImports(source, file);

    if (next !== source) {
      await writeFile(file, next);
      changed += 1;
    }
  }

  console.log(`Rewrote imports in ${changed} files.`);
}
