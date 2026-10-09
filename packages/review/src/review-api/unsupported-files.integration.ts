import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { coverageProgress } from "@review/viewed-coverage";
import { expect, it } from "vitest";

import { createReviewApi } from "./http";
import { openLocalReviewStore } from "./local-data";

it.each([false, true])(
  "omits unsupported files from progress, with text changes=%s",
  async (textChanged) => {
    const root = mkdtempSync(path.join(tmpdir(), "unsupported-files-"));

    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

    const commit = () => {
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "Fixture",
      );

      return git("rev-parse", "HEAD");
    };

    const local = openLocalReviewStore(path.join(root, "reviews.db"));

    try {
      git("init", "-q", "-b", "main");
      writeFileSync(path.join(root, "value.ts"), "export const value = 1;\n");
      git("add", "value.ts");
      const first = commit();
      git("update-index", "--add", "--cacheinfo", `160000,${first},module`);
      symlinkSync("value.ts", path.join(root, "link"));
      git("add", "link");
      const base = commit();

      git("update-index", "--cacheinfo", `160000,${base},module`);
      unlinkSync(path.join(root, "link"));
      symlinkSync("other.ts", path.join(root, "link"));

      if (textChanged)
        writeFileSync(path.join(root, "value.ts"), "export const value = 2;\n");
      git("add", "value.ts", "link");
      const head = commit();
      const { id } = await local.data.register(root);

      const { reviewId } = await local.store.execute({
        operation: {
          type: "create",
          title: "Unsupported files",
          target: { kind: "commits", repositoryId: id, base, head },
        },
      });

      const app = createReviewApi(local.store, local.data);

      const response = await app.request(
        `/${reviewId}/progress?mode=structural`,
      );

      expect(response.status).toBe(200);
      const progress = await response.json();
      expect(progress.files.map((file: { path: string }) => file.path)).toEqual(
        textChanged ? ["value.ts"] : [],
      );
      expect(coverageProgress(progress.files).total).toEqual({
        additions: textChanged ? 1 : 0,
        deletions: textChanged ? 1 : 0,
      });
    } finally {
      await local.data.close();
      await local.store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
