import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { resolveReviewDiffFiles } from "./review-diff-files";

describe("resolveReviewDiffFiles", () => {
  test("falls back to jj for unexported jj commits", async () => {
    if (!commandExists("jj")) {
      return;
    }

    const rootPath = await mkdtemp(path.join(os.tmpdir(), "review-diff-jj-"));

    try {
      execJj(rootPath, ["git", "init"]);
      await mkdir(path.join(rootPath, "src"), { recursive: true });
      await writeFile(
        path.join(rootPath, "src/example.ts"),
        "export const value = 1;\n",
      );

      const baseRef = execJjOutput(rootPath, [
        "log",
        "--no-graph",
        "-r",
        "@",
        "-T",
        "change_id.short()",
      ]);

      execJj(rootPath, ["new"]);
      await writeFile(
        path.join(rootPath, "src/example.ts"),
        "export const value = 2;\n",
      );

      const headRef = execJjOutput(rootPath, [
        "log",
        "--no-graph",
        "-r",
        "@",
        "-T",
        "change_id.short()",
      ]);

      expect(() =>
        execFileSync("git", ["diff", `${baseRef}...${headRef}`], {
          cwd: rootPath,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      ).toThrow(/./);

      const result = await resolveReviewDiffFiles({
        rootPath,
        baseRef,
        headRef,
      });

      expect(result.files).toMatchObject([
        {
          path: "src/example.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
        },
      ]);
      expect(result.files[0]?.patch).toContain("-export const value = 1;");
      expect(result.files[0]?.patch).toContain("+export const value = 2;");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  test("limits parsed diff files to requested paths", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "review-diff-git-"));

    try {
      execGit(rootPath, ["init"]);
      execGit(rootPath, ["config", "user.email", "test@example.com"]);
      execGit(rootPath, ["config", "user.name", "Test User"]);
      await mkdir(path.join(rootPath, "src"), { recursive: true });
      await writeFile(
        path.join(rootPath, "src/visible.ts"),
        "export const visible = 1;\n",
      );
      await writeFile(
        path.join(rootPath, "src/hidden.ts"),
        "export const hidden = 1;\n",
      );
      execGit(rootPath, ["add", "src/visible.ts", "src/hidden.ts"]);
      execGit(rootPath, ["commit", "-m", "initial"]);
      const baseRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);
      await writeFile(
        path.join(rootPath, "src/visible.ts"),
        "export const visible = 2;\n",
      );
      await writeFile(
        path.join(rootPath, "src/hidden.ts"),
        "export const hidden = 2;\n",
      );
      execGit(rootPath, ["add", "src/visible.ts", "src/hidden.ts"]);
      execGit(rootPath, ["commit", "-m", "change"]);
      const headRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);

      const result = await resolveReviewDiffFiles({
        rootPath,
        baseRef,
        headRef,
        paths: ["src/visible.ts"],
      });

      expect(result.files.map((file) => file.path)).toEqual(["src/visible.ts"]);
      expect(result.files[0]?.patch).toContain("+export const visible = 2;");
      expect(result.files[0]?.patch).not.toContain("hidden");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  test("can return file summaries without patch bodies", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "review-diff-git-"));

    try {
      execGit(rootPath, ["init"]);
      execGit(rootPath, ["config", "user.email", "test@example.com"]);
      execGit(rootPath, ["config", "user.name", "Test User"]);
      await mkdir(path.join(rootPath, "src"), { recursive: true });
      await writeFile(
        path.join(rootPath, "src/example.ts"),
        "export const value = 1;\n",
      );
      execGit(rootPath, ["add", "src/example.ts"]);
      execGit(rootPath, ["commit", "-m", "initial"]);
      const baseRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);
      await writeFile(
        path.join(rootPath, "src/example.ts"),
        "export const value = 2;\n",
      );
      execGit(rootPath, ["add", "src/example.ts"]);
      execGit(rootPath, ["commit", "-m", "change"]);
      const headRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);

      const result = await resolveReviewDiffFiles({
        rootPath,
        baseRef,
        headRef,
        includePatch: false,
      });

      expect(result.files).toEqual([
        {
          path: "src/example.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
        },
      ]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  test("can request enough context for declaration-shaped CodePeek patches", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "review-diff-git-"));

    try {
      execGit(rootPath, ["init"]);
      execGit(rootPath, ["config", "user.email", "test@example.com"]);
      execGit(rootPath, ["config", "user.name", "Test User"]);
      await mkdir(path.join(rootPath, "src"), { recursive: true });
      await writeFile(
        path.join(rootPath, "src/example.ts"),
        [
          "export function target() {",
          "  const one = 1;",
          "  const two = 2;",
          "  const three = 3;",
          "  const four = 4;",
          "  return one + two + three + four;",
          "}",
          "",
        ].join("\n"),
      );
      execGit(rootPath, ["add", "src/example.ts"]);
      execGit(rootPath, ["commit", "-m", "initial"]);
      const baseRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);

      await writeFile(
        path.join(rootPath, "src/example.ts"),
        [
          "export function target() {",
          "  const one = 1;",
          "  const two = 2;",
          "  const three = 30;",
          "  const four = 4;",
          "  return one + two + three + four;",
          "}",
          "",
        ].join("\n"),
      );
      execGit(rootPath, ["add", "src/example.ts"]);
      execGit(rootPath, ["commit", "-m", "change"]);
      const headRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);

      const narrow = await resolveReviewDiffFiles({
        rootPath,
        baseRef,
        headRef,
        paths: ["src/example.ts"],
        contextLines: 1,
      });

      const wide = await resolveReviewDiffFiles({
        rootPath,
        baseRef,
        headRef,
        paths: ["src/example.ts"],
        contextLines: 100,
      });

      expect(narrow.files[0]?.patch).not.toContain(
        "\n export function target()",
      );
      expect(wide.files[0]?.patch).toContain("\n export function target()");
      expect(wide.files[0]?.patch).toContain("+  const three = 30;");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  test("parses a deleted file whose removed content begins with `-- `", async () => {
    const fixture = await createDeletedHijackFixture();

    try {
      const result = await resolveReviewDiffFiles({
        rootPath: fixture.rootPath,
        baseRef: fixture.baseRef,
        headRef: fixture.headRef,
      });

      expect(result.files).toEqual([
        expect.objectContaining({
          path: "src/schema.sql",
          status: "deleted",
          additions: 0,
          deletions: 2,
        }),
      ]);
      expect(result.files[0]?.patch).toContain(
        "diff --git a/src/schema.sql b/src/schema.sql",
      );
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
    }
  });

  test("counts added lines whose content begins with `++ `", async () => {
    const rootPath = await mkdtemp(
      path.join(os.tmpdir(), "review-diff-hijack-add-"),
    );

    try {
      execGit(rootPath, ["init"]);
      execGit(rootPath, ["config", "user.email", "test@example.com"]);
      execGit(rootPath, ["config", "user.name", "Test User"]);
      await mkdir(path.join(rootPath, "src"), { recursive: true });
      await writeFile(path.join(rootPath, "src/example.txt"), "line one\n");
      execGit(rootPath, ["add", "src/example.txt"]);
      execGit(rootPath, ["commit", "-m", "initial"]);
      const baseRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);
      await writeFile(
        path.join(rootPath, "src/example.txt"),
        "++ sparkles line\nline two\n",
      );
      execGit(rootPath, ["add", "src/example.txt"]);
      execGit(rootPath, ["commit", "-m", "change"]);
      const headRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);

      const result = await resolveReviewDiffFiles({
        rootPath,
        baseRef,
        headRef,
      });

      expect(result.files).toEqual([
        expect.objectContaining({
          path: "src/example.txt",
          status: "modified",
          additions: 2,
          deletions: 1,
        }),
      ]);
      expect(result.files[0]?.patch).toContain("+++ sparkles line");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  test("parses a mode-only change with no hunk header", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "review-diff-mode-"));

    try {
      execGit(rootPath, ["init"]);
      execGit(rootPath, ["config", "user.email", "test@example.com"]);
      execGit(rootPath, ["config", "user.name", "Test User"]);
      await writeFile(path.join(rootPath, "mode.txt"), "same content\n");
      execGit(rootPath, ["add", "mode.txt"]);
      execGit(rootPath, ["commit", "-m", "initial"]);
      const baseRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);
      execGit(rootPath, ["update-index", "--chmod=+x", "mode.txt"]);
      execGit(rootPath, ["commit", "-m", "make executable"]);
      const headRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);

      const result = await resolveReviewDiffFiles({
        rootPath,
        baseRef,
        headRef,
      });

      expect(result.files).toEqual([
        expect.objectContaining({
          path: "mode.txt",
          status: "modified",
          additions: 0,
          deletions: 0,
        }),
      ]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  test("parses a binary file change with no hunk header", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "review-diff-bin-"));

    try {
      execGit(rootPath, ["init"]);
      execGit(rootPath, ["config", "user.email", "test@example.com"]);
      execGit(rootPath, ["config", "user.name", "Test User"]);
      await writeFile(path.join(rootPath, "bin.dat"), Buffer.from([0, 1, 2]));
      execGit(rootPath, ["add", "bin.dat"]);
      execGit(rootPath, ["commit", "-m", "initial"]);
      const baseRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);
      await writeFile(path.join(rootPath, "bin.dat"), Buffer.from([3, 4, 5]));
      execGit(rootPath, ["add", "bin.dat"]);
      execGit(rootPath, ["commit", "-m", "change"]);
      const headRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);

      const result = await resolveReviewDiffFiles({
        rootPath,
        baseRef,
        headRef,
      });

      expect(result.files).toEqual([
        expect.objectContaining({
          path: "bin.dat",
          status: "modified",
          additions: 0,
          deletions: 0,
        }),
      ]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

async function createDeletedHijackFixture(): Promise<{
  rootPath: string;
  baseRef: string;
  headRef: string;
}> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "review-diff-hijack-"));
  execGit(rootPath, ["init"]);
  execGit(rootPath, ["config", "user.email", "test@example.com"]);
  execGit(rootPath, ["config", "user.name", "Test User"]);
  await mkdir(path.join(rootPath, "src"), { recursive: true });
  await writeFile(
    path.join(rootPath, "src/schema.sql"),
    "-- a sql comment line\nSELECT 1;\n",
  );
  execGit(rootPath, ["add", "src/schema.sql"]);
  execGit(rootPath, ["commit", "-m", "initial"]);
  const baseRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);
  await unlink(path.join(rootPath, "src/schema.sql"));
  execGit(rootPath, ["add", "src"]);
  execGit(rootPath, ["commit", "-m", "remove schema"]);
  const headRef = execGitOutput(rootPath, ["rev-parse", "HEAD"]);

  return { rootPath, baseRef, headRef };
}

function execJj(cwd: string, args: string[]) {
  execFileSync("jj", args, {
    cwd,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function execGit(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function execGitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function execJjOutput(cwd: string, args: string[]): string {
  return execFileSync("jj", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function commandExists(command: string): boolean {
  try {
    execFileSync(command, ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    return true;
  } catch {
    return false;
  }
}
