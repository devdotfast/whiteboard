import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { findReviewPackageRoot, readBuildCommit } from "./package-paths";

describe("findReviewPackageRoot", () => {
  it("resolves modules nested below source and distribution directories", () => {
    const packageRoot = path.dirname(
      path.dirname(fileURLToPath(import.meta.url)),
    );

    expect(
      findReviewPackageRoot(
        pathToFileURL(
          path.join(packageRoot, "src", "server", "desktop-host.ts"),
        ).href,
      ),
    ).toBe(packageRoot);
    expect(
      findReviewPackageRoot(
        pathToFileURL(
          path.join(packageRoot, "dist", "server", "desktop-host.js"),
        ).href,
      ),
    ).toBe(packageRoot);
  });
});

describe("readBuildCommit", () => {
  it("reports the build's commit only for a module that runs from dist", async () => {
    const packageRoot = await mkdtemp(path.join(tmpdir(), "review-build-"));

    try {
      await mkdir(path.join(packageRoot, "dist"));
      await writeFile(
        path.join(packageRoot, "dist", "build-info.json"),
        JSON.stringify({ version: "1.2.3", commit: "abc123", dirty: false }),
      );

      const module = (...segments: string[]) =>
        pathToFileURL(path.join(packageRoot, ...segments)).href;

      expect(readBuildCommit(module("dist", "server", "host.js"))).toBe(
        "abc123",
      );
      expect(readBuildCommit(module("src", "server", "host.ts"))).toBeNull();
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });
});
