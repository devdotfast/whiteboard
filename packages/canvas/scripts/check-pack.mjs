import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = mkdtempSync(path.join(tmpdir(), "canvas-pack-"));

try {
  execFileSync("pnpm", ["pack", "--pack-destination", out], {
    stdio: "inherit",
  });
  const [tarball] = execFileSync("ls", [out]).toString().trim().split("\n");

  const files = execFileSync("tar", ["-tzf", path.join(out, tarball)])
    .toString()
    .trim()
    .split("\n");

  for (const file of [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/assets/canvas.css",
  ])
    if (!files.includes(file)) throw new Error(`${tarball} lacks ${file}`);

  if (files.filter((file) => file.endsWith(".css")).length !== 1)
    throw new Error(`${tarball} splits its stylesheet`);

  if (!files.some((file) => file.endsWith(".wasm")))
    throw new Error(`${tarball} lacks the routing wasm`);

  execFileSync("tar", ["-xzf", path.join(out, tarball), "-C", out]);

  const types = readFileSync(path.join(out, "package/dist/index.d.ts"), "utf8");

  const imports = [...types.matchAll(/from\s+"([^"]+)"/g)].map(
    ([, source]) => source,
  );

  if (imports.some((source) => source !== "react"))
    throw new Error(`index.d.ts imports ${imports.join(", ")}`);

  for (const name of [
    "WhiteboardProvider",
    "Whiteboard",
    "ReviewTopBar",
    "openShare",
    "boardView",
    "readOnlyHost",
  ])
    if (!types.includes(`function ${name}`))
      throw new Error(`index.d.ts lacks ${name}`);

  // A read-only share never edits or typesets; both load on demand.
  const entry = readFileSync(path.join(out, "package/dist/index.js"), "utf8");

  for (const marker of ["ProseMirror-", "KaTeX parse error"])
    if (entry.includes(marker))
      throw new Error(`index.js bundles ${marker.replace(/-$/, "")}`);

  for (const file of files.filter((name) => name.endsWith(".js"))) {
    const code = readFileSync(path.join(out, file), "utf8");

    // React is external: a CommonJS require of it throws in a browser.
    if (/[\w$]\(\s*[`"']react(?:-dom)?(?:\/[^`"']*)?[`"']\s*\)/.test(code))
      throw new Error(`${file} requires React`);

    // TanStack Start babel-parses modules with `.handler(`, and Emscripten's
    // glue does not parse there.
    if (code.includes(".handler(") && code.includes("emscripten"))
      throw new Error(`${file} mixes .handler( with Emscripten glue`);
  }

  console.log(`${tarball}: ${files.length} files, opaque types`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
