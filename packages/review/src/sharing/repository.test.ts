import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  fetchPinnedRepository,
  fetchSharedCommits,
  forgetSharedCommits,
  repositoryReady,
  sharedGit,
} from "./repository.js";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();

  for (const root of directories.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function remoteFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "sharing-git-"));
  directories.push(root);

  const sender = path.join(root, "sender"),
    remote = path.join(root, "remote.git");

  await mkdir(sender);

  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: sender,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(sender, "answer.ts"), "export const answer = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  await writeFile(path.join(sender, "answer.ts"), "export const answer = 2;\n");
  git("add", ".");
  git("commit", "-qm", "head");
  const head = git("rev-parse", "HEAD");
  git("clone", "--bare", sender, remote);

  return { root, sender, remote, git, pins: { base, head } };
}

it("fetches both pinned histories independently and reads them after the sender and remote disappear", async () => {
  const { root, sender, remote, pins } = await remoteFixture();
  const checkout = path.join(root, "recipient");
  vi.stubEnv("GIT_DIR", path.join(root, "nonexistent.git"));
  vi.stubEnv(
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    path.join(sender, ".git", "objects"),
  );
  await fetchPinnedRepository(checkout, remote, pins);
  await sharedGit(checkout, ["checkout", "--detach", pins.head]);
  await rename(sender, sender + "-hidden");
  await rename(remote, remote + "-hidden");
  expect(await repositoryReady(checkout, pins)).toBe(true);
  expect(
    (await sharedGit(checkout, ["show", `${pins.base}:answer.ts`])).stdout,
  ).toContain("answer = 1");
  expect(
    (await sharedGit(checkout, ["show", `${pins.head}:answer.ts`])).stdout,
  ).toContain("answer = 2");
  expect(
    (await sharedGit(checkout, ["diff", pins.base, pins.head])).stdout,
  ).toContain("+export const answer = 2");
  await rm(checkout, { recursive: true });
  expect(await repositoryReady(checkout, pins)).toBe(false);
});

it("refuses a shared board's commit that isn't a full commit id, before running git", async () => {
  const { root, remote, git, pins } = await remoteFixture();
  const checkout = path.join(root, "recipient");

  git("clone", "--quiet", remote, checkout);
  const marker = path.join(root, "pwned");

  // With no git to run, any git call would fail differently.
  vi.stubEnv("PATH", path.join(root, "no-git"));

  for (const commit of [
    `--upload-pack=touch ${marker}`,
    "+refs/heads/main:refs/heads/main",
    "HEAD",
    pins.head.slice(0, 12),
  ])
    await expect(
      fetchSharedCommits(checkout, [pins.head, commit], "share-1"),
    ).rejects.toThrow(/full commit id/);

  expect(existsSync(marker)).toBe(false);
});

it("keeps a shared board's commits under refs, so gc can't prune them from the person's checkout", async () => {
  const { root, remote, git, pins } = await remoteFixture();
  const checkout = path.join(root, "recipient");

  // The person's checkout has only the base; the board quotes the head too.
  git("clone", "--quiet", "--no-checkout", remote, checkout);
  execFileSync("git", [
    "-C",
    checkout,
    "update-ref",
    "-d",
    "refs/remotes/origin/main",
  ]);
  execFileSync("git", [
    "-C",
    checkout,
    "update-ref",
    "refs/heads/main",
    pins.base,
  ]);
  execFileSync("git", [
    "-C",
    checkout,
    "reflog",
    "expire",
    "--expire=now",
    "--all",
  ]);
  execFileSync("git", ["-C", checkout, "gc", "--quiet", "--prune=now"]);

  await fetchSharedCommits(checkout, [pins.base, pins.head], "share-1");

  // Only the head is fetched; the base was already here.
  expect(
    execFileSync(
      "git",
      [
        "-C",
        checkout,
        "for-each-ref",
        "--format=%(refname)",
        "refs/review/shared/share-1",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n"),
  ).toEqual(
    [
      `refs/review/shared/share-1/${pins.base}`,
      `refs/review/shared/share-1/${pins.head}`,
    ].sort(),
  );

  // Nothing else names them; gc keeps them anyway.
  execFileSync("git", ["-C", checkout, "update-ref", "-d", "refs/heads/main"]);
  execFileSync("git", [
    "-C",
    checkout,
    "reflog",
    "expire",
    "--expire=now",
    "--all",
  ]);
  execFileSync("git", ["-C", checkout, "gc", "--quiet", "--prune=now"]);

  for (const commit of [pins.base, pins.head])
    expect(() =>
      execFileSync("git", [
        "-C",
        checkout,
        "cat-file",
        "-e",
        `${commit}^{commit}`,
      ]),
    ).not.toThrow();

  // Removing the share lets them go.
  await forgetSharedCommits(checkout, "share-1");
  expect(
    execFileSync(
      "git",
      ["-C", checkout, "for-each-ref", "refs/review/shared/share-1"],
      { encoding: "utf8" },
    ),
  ).toBe("");
});

it("rejects an unpushed commit even when the sender has its objects", async () => {
  const { root, remote, git, pins } = await remoteFixture();
  git("commit", "--allow-empty", "-qm", "not pushed");
  const head = git("rev-parse", "HEAD");
  await expect(
    fetchPinnedRepository(
      path.join(root, "recipient"),
      remote,
      { ...pins, head },
      true,
    ),
  ).rejects.toThrow("Push the reviewed commits to GitHub before sharing.");
});

it("checks published pins without downloading trees, blobs, or intervening history", async () => {
  const { root, remote, git, pins } = await remoteFixture();
  git("commit", "--allow-empty", "-qm", "third commit");
  const head = git("rev-parse", "HEAD");
  git("push", remote, "HEAD:refs/heads/published");
  execFileSync("git", [
    "-C",
    remote,
    "config",
    "uploadpack.allowFilter",
    "true",
  ]);
  const checkout = path.join(root, "preflight");

  await fetchPinnedRepository(
    checkout,
    `file://${remote}`,
    { ...pins, head },
    true,
  );

  const objects = await sharedGit(checkout, [
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectname) %(objecttype)",
  ]);

  expect(objects.stdout.trim().split("\n").sort()).toEqual(
    [`${pins.base} commit`, `${head} commit`].sort(),
  );
});

it("reports access and connection failures without leaking Git output", async () => {
  const { root, pins } = await remoteFixture();
  await expect(
    fetchPinnedRepository(
      path.join(root, "recipient"),
      path.join(root, "missing-private.git"),
      pins,
    ),
  ).rejects.toThrow("Check your connection and Git credentials");
});

it("rejects non-commit pins during publication", async () => {
  const { root, remote, git, pins } = await remoteFixture();

  for (const [kind, spec] of [
    ["tree", "HEAD^{tree}"],
    ["blob", "HEAD:answer.ts"],
  ]) {
    const head = git("rev-parse", spec!);
    await expect(
      fetchPinnedRepository(
        path.join(root, kind!),
        remote,
        { ...pins, head },
        true,
      ),
    ).rejects.toThrow("Could not fetch the GitHub repository.");
  }
});
