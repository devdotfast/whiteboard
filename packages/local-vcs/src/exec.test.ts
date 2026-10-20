import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  VcsOperandError,
  defaultVcsTimeout,
  renderVcsArgs,
  runVcs,
  setLocalVcsCommandObserver,
} from "./exec";

const started: string[][] = [];

setLocalVcsCommandObserver({
  start: ({ args }) => {
    started.push(args);

    return () => {};
  },
});

afterEach(() => {
  started.length = 0;
});

it("refuses a value that could be read as an option, before anything runs", async () => {
  for (const operand of [
    { rev: "--output=/tmp/pwned" },
    { commit: "HEAD" },
    { commit: "abc123" },
    { ref: "main:refs/heads/main" },
    { ref: "-x" },
    { refspec: { from: "--upload-pack=touch /tmp/x", to: "refs/x" } },
    { remote: "--upload-pack=sh" },
    { value: "-f" },
  ])
    await expect(
      runVcs("git", ["fetch", { remote: "origin" }, operand]),
    ).rejects.toThrow(VcsOperandError);

  expect(started).toEqual([]);
});

it("puts paths after `--`, once", () => {
  expect(
    renderVcsArgs([
      "log",
      { rev: "HEAD~1" },
      { path: "-rf" },
      { path: "a b.ts" },
    ]),
  ).toEqual(["log", "HEAD~1", "--", "-rf", "a b.ts"]);
  expect(
    renderVcsArgs([
      "show",
      { refspec: { from: "a".repeat(40), to: "refs/review/x", force: true } },
    ]),
  ).toEqual(["show", `+${"a".repeat(40)}:refs/review/x`]);
});

it("never prompts and never fetches a missing object on a read", async () => {
  const repository = mkdtempSync(path.join(tmpdir(), "vcs-exec-"));

  execFileSync("git", ["init", "-q", repository]);

  // A config value git expands from the environment it was given.
  const read = async (name: string) =>
    (
      await runVcs("git", [
        "-C",
        repository,
        "-c",
        `alias.env=!printf %s "$${name}"`,
        "env",
      ])
    ).stdout;

  expect(await read("GIT_NO_LAZY_FETCH")).toBe("1");
  expect(await read("GIT_TERMINAL_PROMPT")).toBe("0");
});

describe("default timeout", () => {
  it("fits the operation: quick queries, large reads, and the network", () => {
    const quick = defaultVcsTimeout("git", [
      "-C",
      "/repo",
      "rev-parse",
      "HEAD",
    ]);

    const read = defaultVcsTimeout("git", [
      "--git-dir",
      "/repo/.git",
      "show",
      "HEAD:big.ts",
    ]);

    const jj = defaultVcsTimeout("jj", ["-R", "/repo", "log"]);
    const fetch = defaultVcsTimeout("git", ["-C", "/repo", "fetch", "origin"]);

    expect(quick).toBe(30_000);
    expect(read).toBeGreaterThan(quick);
    expect(jj).toBe(read);
    expect(fetch).toBeGreaterThan(read);
  });
});

describe("the subcommand decides", () => {
  it("gives ls-remote the network's time, and a commit message is not a push", () => {
    const fetch = defaultVcsTimeout("git", ["-C", "/repo", "fetch", "origin"]);
    const quick = defaultVcsTimeout("git", [
      "-C",
      "/repo",
      "rev-parse",
      "HEAD",
    ]);

    expect(
      defaultVcsTimeout("git", ["-C", "/repo", "ls-remote", "origin"]),
    ).toBe(fetch);
    expect(
      defaultVcsTimeout("git", ["-C", "/repo", "commit", "-m", "push"]),
    ).toBe(quick);
  });

  it("keeps a read from fetching lazily when only an operand is spelt like a push", async () => {
    const repository = mkdtempSync(path.join(tmpdir(), "vcs-exec-"));

    execFileSync("git", ["init", "-q", repository]);

    // `#` drops the operand git appends to the alias.
    const { stdout } = await runVcs("git", [
      "-C",
      repository,
      "-c",
      'alias.env=!printf %s "$GIT_NO_LAZY_FETCH" #',
      "env",
      { value: "push" },
    ]);

    expect(stdout).toBe("1");
  });
});
