import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  findReviewPackageRoot,
  readBuildCommit,
  readReviewPackageVersion,
} from "./package-paths";

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

describe("readReviewPackageVersion", () => {
  it("reports a dev Desktop's version for its own checkout only", async () => {
    const packageRoot = path.dirname(
      path.dirname(fileURLToPath(import.meta.url)),
    );

    const other = await mkdtemp(path.join(tmpdir(), "review-package-"));

    try {
      await writeFile(
        path.join(other, "package.json"),
        JSON.stringify({ name: "@dev.fast/whiteboard", version: "9.9.9" }),
      );
      vi.stubEnv("DEV_FAST_REVIEW_DEV_VERSION", "0.2.0+dev.0123456789ab");
      vi.stubEnv(
        "DEV_FAST_REVIEW_CHECKOUT",
        path.dirname(path.dirname(packageRoot)),
      );

      expect(readReviewPackageVersion(import.meta.url)).toBe(
        "0.2.0+dev.0123456789ab",
      );
      expect(
        readReviewPackageVersion(
          pathToFileURL(path.join(other, "cli.js")).href,
        ),
      ).toBe("9.9.9");
    } finally {
      vi.unstubAllEnvs();
      await rm(other, { recursive: true, force: true });
    }
  });
});
