import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Packs the package and checks the tarball holds the canvas and only the
// opaque types, never the canvas's own declarations.
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

  if (!files.some((file) => file.endsWith(".wasm")))
    throw new Error(`${tarball} lacks the routing wasm`);

  execFileSync("tar", ["-xzf", path.join(out, tarball), "-C", out]);

  const types = readFileSync(
    path.join(out, "package/dist/index.d.ts"),
    "utf8",
  );

  const imports = [...types.matchAll(/from\s+"([^"]+)"/g)].map(
    ([, source]) => source,
  );

  if (imports.some((source) => source !== "react"))
    throw new Error(`index.d.ts imports ${imports.join(", ")}`);

  for (const name of ["WhiteboardProvider", "Whiteboard", "ReviewTopBar"])
    if (!types.includes(`function ${name}`))
      throw new Error(`index.d.ts lacks ${name}`);

  console.log(`${tarball}: ${files.length} files, opaque types`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
