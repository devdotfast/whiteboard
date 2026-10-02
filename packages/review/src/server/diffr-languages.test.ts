import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { installFullDiffr } from "./diffr-languages.js";
import { diffrExecutable } from "./structural-diff.js";

let temporary: string;

afterEach(async () => {
  vi.unstubAllEnvs();

  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test("delegates full installation once and selects its cache outside the runtime", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "whiteboard-diffr-"));
  vi.stubEnv("XDG_CACHE_HOME", path.join(temporary, "cache"));
  vi.stubEnv("REVIEW_DIFFR_BINARY", "");
  const root = path.join(temporary, "runtime");
  const installer = path.join(root, "bin/diffr-package");
  await mkdir(path.join(installer, "bin"), { recursive: true });
  await writeFile(
    path.join(installer, "package.json"),
    JSON.stringify({ version: "0.1.10" }),
  );
  const calls = path.join(temporary, "calls");
  await writeFile(
    path.join(installer, "bin/fetch.mjs"),
    `
    import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
    import path from "node:path";
    if (!process.argv.includes("--full") || !process.argv.includes("--required")) throw new Error("full verified installation required");
    appendFileSync(${JSON.stringify(calls)}, "install\\n");
    const directory = process.argv[process.argv.indexOf("--into") + 1];
    mkdirSync(directory, { recursive: true });
    const binary = path.join(directory, process.platform === "win32" ? "diffr.exe" : "diffr");
    writeFileSync(binary, "installed");
    chmodSync(binary, 0o755);
    writeFileSync(path.join(directory, "diffr.stamp.json"), JSON.stringify({ version: "0.1.10", full: true }));
  `,
  );
  expect(diffrExecutable(root)).toBe("diffr");
  await Promise.all([installFullDiffr(root), installFullDiffr(root)]);
  expect(await readFile(calls, "utf8")).toBe("install\n");
  const binary = diffrExecutable(root);
  expect(binary.startsWith(root)).toBe(false);
  expect(await readFile(binary, "utf8")).toBe("installed");
  vi.stubEnv("REVIEW_DIFFR_BINARY", "/explicit/diffr");
  expect(diffrExecutable(root)).toBe("/explicit/diffr");
  await expect(installFullDiffr(root)).rejects.toThrow("explicitly selected");
});
