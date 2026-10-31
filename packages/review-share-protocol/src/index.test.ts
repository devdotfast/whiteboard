import { expect, it } from "vitest";

import {
  type ShareBundle,
  gitHubRepositoryUrlSchema,
  normalizeGitHubRemote,
  parseShareLink,
  shareBundleSchema,
  shareLink,
  sharePathSchema,
} from "./index.js";

it("puts the capability in the path and rejects credentials, fragments or other paths", () => {
  const token = "a".repeat(43),
    url = shareLink("https://app.dev.fast", token);

  expect(url).toBe(`https://app.dev.fast/s/${token}`);
  expect(parseShareLink(url)).toEqual({
    origin: "https://app.dev.fast",
    capability: token,
  });
  expect(parseShareLink(`${url}?app=preview`).capability).toBe(token);
  expect(() =>
    parseShareLink(url.replace("https://", "https://user:password@")),
  ).toThrow("HTTPS");
  expect(() => parseShareLink(`${url}#x`)).toThrow("HTTPS");
  expect(() => parseShareLink(url.replace("/s/", "/other/"))).toThrow(
    "expected string",
  );
});

it("rejects traversal paths and platform-specific separators", () => {
  for (const file of [
    "../secret",
    "a/../../secret",
    "/etc/passwd",
    "a\\b",
    "a//b",
    "./a",
    "a\0b",
  ])
    expect(sharePathSchema.safeParse(file).success).toBe(false);
  expect(sharePathSchema.parse("src/[route]/index.ts")).toBe(
    "src/[route]/index.ts",
  );
});

const bundle: ShareBundle = {
  format: "review-share/2",
  reviewId: "review",
  version: 1,
  title: "Title",
  snapshot: {},
  images: {},
  traces: {},
  maps: {},
  commits: [],
  selections: {},
  sources: [
    {
      kind: "excerpt",
      file: "src/a.ts",
      commit: "a".repeat(40),
      fromLine: 3,
      lines: ["const a = 1;"],
    },
  ],
  alignments: [{ file: "src/a.ts", head: "a".repeat(40), rows: [[null, 3]] }],
};

it("rejects an older format and an unknown source kind", () => {
  expect(
    shareBundleSchema.safeParse({ ...bundle, format: "review-share/1" })
      .success,
  ).toBe(false);
  expect(
    shareBundleSchema.safeParse({
      ...bundle,
      sources: [{ kind: "file", file: "a", commit: "a".repeat(40) }],
    }).success,
  ).toBe(false);
});

it("normalizes GitHub transports without publishing credentials", () => {
  for (const remote of [
    "git@github.com:owner/repo.git",
    "ssh://git@github.com/owner/repo",
    "https://user:secret@github.com/owner/repo.git",
    "https://github.com/owner/repo\n",
  ])
    expect(normalizeGitHubRemote(remote)).toBe(
      "https://github.com/owner/repo.git",
    );

  for (const remote of [
    "https://gitlab.com/owner/repo",
    "/tmp/repo",
    "https://github.com/owner/repo?token=secret",
    "https://github.com/owner/repo#main",
    "https://github.com:1234/owner/repo",
    "https://github.com/owner",
    "https://github.com/owner/repo/extra",
  ])
    expect(() => normalizeGitHubRemote(remote)).toThrow(/GitHub|Invalid URL/);

  for (const remote of [
    "git@github.com:owner/repo.git",
    "https://user:secret@github.com/owner/repo.git",
    "https://github.com/owner/repo",
  ])
    expect(gitHubRepositoryUrlSchema.safeParse(remote).success).toBe(false);
});
