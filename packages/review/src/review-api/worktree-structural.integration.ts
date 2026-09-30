import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatAnchor, selectionKey } from "@review/lens-selection";
import { expect, it } from "vitest";

import { createReviewApi } from "./http";
import { openLocalReviewStore } from "./local-data";

it.each([
  { linked: false, explicitBase: false },
  { linked: true, explicitBase: false },
  { linked: true, explicitBase: true },
])(
  "resolves saved edits and refreshes cached peeks: %j",
  async ({ linked, explicitBase }) => {
    const root = mkdtempSync(path.join(tmpdir(), "worktree-structural-"));
    let repository = path.join(root, "repository");
    mkdirSync(repository);

    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repository, ...args], {
        encoding: "utf8",
      }).trim();

    git("init", "-q", "-b", "main");
    writeFileSync(
      path.join(repository, "value.ts"),
      "export const value = 1;\n",
    );
    git("add", "value.ts");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "Base",
    );
    const base = git("rev-parse", "HEAD");

    if (explicitBase) {
      writeFileSync(
        path.join(repository, "value.ts"),
        "export const value = 10;\n",
      );
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-am",
        "Head",
      );
    }

    if (linked) {
      const checkout = path.join(root, "linked checkout");
      git("worktree", "add", "-qb", "live", checkout);
      repository = checkout;
    }

    const local = openLocalReviewStore(path.join(root, "reviews.db"));

    const selection = {
      file: "value.ts",
      start: { side: "head" as const, line: 1 },
      end: { side: "head" as const, line: 1 },
    };

    const source = formatAnchor(selection);

    try {
      const { id } = await local.data.register(repository);
      writeFileSync(
        path.join(repository, "value.ts"),
        "export const value = 2;\n",
      );
      git("add", "value.ts");

      const { reviewId } = await local.store.execute({
        commandId: randomUUID(),
        operation: {
          type: "create",
          title: "Live",
          target: {
            kind: "worktree",
            repositoryId: id,
            base: explicitBase ? base : undefined,
          },
        },
      });

      await local.store.execute({
        commandId: randomUUID(),
        operation: {
          type: "edit",
          reviewId,
          edit: { type: "insert", content: { type: "code_peek", source } },
        },
      });
      const app = createReviewApi(local.store, local.data);
      const index = git("diff", "--cached");
      const worktrees = git("worktree", "list", "--porcelain");
      let revision: string | undefined;

      for (const value of [2, 333]) {
        writeFileSync(
          path.join(repository, "value.ts"),
          `export const value = ${value};\n`,
        );
        await local.store.refreshWorktrees();
        const snapshot = local.store.read(reviewId);
        expect(snapshot.pins!.base).toBe(base);
        expect(snapshot.pins!.head).toBe(
          explicitBase ? git("rev-parse", "HEAD") : base,
        );
        expect(snapshot.pins!.worktreeRevision).not.toBe(revision);
        revision = snapshot.pins!.worktreeRevision;

        const response = await app.request(
          `/${reviewId}/structural-diff?file=value.ts`,
        );

        expect(response.status).toBe(200);

        const events = (await response.text())
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));

        expect(events.find((event) => event.type === "file")).toMatchObject({
          diff: {
            lhs: { text: "export const value = 1;\n" },
            rhs: { text: `export const value = ${value};\n` },
          },
        });

        const progress = await (
          await app.request(`/${reviewId}/progress?mode=structural`)
        ).json();

        expect(progress.unavailableSelections).toEqual({});
        expect(
          progress.resolvedSelections[selectionKey(selection)],
        ).toContainEqual(
          expect.objectContaining({
            file: "value.ts",
            side: "head",
            fromLine: 1,
            toLine: 1,
          }),
        );
        expect(progress.files).toHaveLength(1);
      }

      expect(git("diff", "--cached")).toBe(index);
      expect(git("worktree", "list", "--porcelain")).toBe(worktrees);
    } finally {
      await local.data.close();
      await local.store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);

it("streams added, deleted, renamed and binary working files and respects path filtering", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "worktree-files-"));
  const repository = path.join(root, "repository");
  mkdirSync(repository);

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
    }).trim();

  git("init", "-q", "-b", "main");
  writeFileSync(
    path.join(repository, "gone.ts"),
    "export const gone = true;\n",
  );
  writeFileSync(
    path.join(repository, "old name.ts"),
    "export const renamed = true;\n",
  );
  writeFileSync(path.join(repository, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "Base",
  );
  git("mv", "old name.ts", "new name.ts");
  git("rm", "gone.ts");
  writeFileSync(
    path.join(repository, "added file.ts"),
    "export const added = 1;\n",
  );
  git("add", "added file.ts");
  writeFileSync(path.join(repository, "binary.bin"), Buffer.from([0, 4, 5, 6]));
  const index = git("diff", "--cached");
  const local = openLocalReviewStore(path.join(root, "reviews.db"));

  try {
    const { id } = await local.data.register(repository);

    const { reviewId } = await local.store.execute({
      commandId: randomUUID(),
      operation: {
        type: "create",
        title: "Changed files",
        target: { kind: "worktree", repositoryId: id },
      },
    });

    const app = createReviewApi(local.store, local.data);

    const read = async (query = "") => {
      const response = await app.request(
        `/${reviewId}/structural-diff${query}`,
      );

      expect(response.status).toBe(200);

      return (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    };

    const events = await read();
    expect(events.at(-1)).toMatchObject({ type: "complete", failed: 0 });
    expect(events[0].files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "added",
          file: expect.objectContaining({
            rhs: expect.objectContaining({ path: "added file.ts" }),
          }),
        }),
        expect.objectContaining({
          status: "deleted",
          file: expect.objectContaining({
            lhs: expect.objectContaining({ path: "gone.ts" }),
          }),
        }),
        expect.objectContaining({
          status: "renamed",
          file: expect.objectContaining({
            lhs: expect.objectContaining({ path: "old name.ts" }),
            rhs: expect.objectContaining({ path: "new name.ts" }),
          }),
        }),
      ]),
    );
    expect(
      events.find(
        (event) =>
          event.type === "file" && event.file.rhs?.path === "binary.bin",
      ).diff.type,
    ).toBe("binary");
    const filtered = await read("?file=added%20file.ts");
    expect(filtered.filter((event) => event.type === "file")).toHaveLength(1);
    expect(filtered.find((event) => event.type === "file")).toMatchObject({
      diff: { rhs: { text: "export const added = 1;\n" } },
    });
    expect(git("diff", "--cached")).toBe(index);
  } finally {
    await local.data.close();
    await local.store.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("compares a staged file in an unborn repository with empty source", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "worktree-unborn-"));
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  execFileSync("git", ["-C", repository, "init", "-q", "-b", "main"]);
  writeFileSync(path.join(repository, "first.ts"), "export const first = 1;\n");
  execFileSync("git", ["-C", repository, "add", "first.ts"]);
  const local = openLocalReviewStore(path.join(root, "reviews.db"));

  try {
    const { id } = await local.data.register(repository);

    const { reviewId } = await local.store.execute({
      commandId: randomUUID(),
      operation: {
        type: "create",
        title: "Unborn",
        target: { kind: "worktree", repositoryId: id },
      },
    });

    const response = await createReviewApi(local.store, local.data).request(
      `/${reviewId}/structural-diff`,
    );

    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events.at(-1)).toMatchObject({ type: "complete", failed: 0 });
    expect(events.find((event) => event.type === "file")).toMatchObject({
      file: { rhs: { path: "first.ts" } },
      diff: { rhs: { text: "export const first = 1;\n" } },
    });
  } finally {
    await local.data.close();
    await local.store.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
