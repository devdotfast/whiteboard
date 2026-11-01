import { expect, it } from "vitest";

import {
  type ShareBundle,
  gitHubRepositoryUrlSchema,
  normalizeGitHubRemote,
  parseShareLink,
  shareBundleSchema,
  shareCreatedSchema,
  shareLink,
  sharePathSchema,
  shareRevisionsSchema,
  sharedMetaSchema,
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

it("carries a revision as ?rev= and rejects any other query", () => {
  const token = "a".repeat(43),
    rev = "5b0e9a52-4a43-4f7e-9d8e-3c1f0e7b2a11";

  expect(shareLink("https://app.dev.fast", token, rev)).toBe(
    `https://app.dev.fast/s/${token}?rev=${rev}`,
  );
  expect(parseShareLink(`https://app.dev.fast/s/${token}?rev=${rev}`)).toEqual({
    origin: "https://app.dev.fast",
    capability: token,
    revision: rev,
  });
  expect(
    parseShareLink(`https://app.dev.fast/s/${token}?app=preview&rev=${rev}`)
      .revision,
  ).toBe(rev);
  expect(() =>
    parseShareLink(`https://app.dev.fast/s/${token}?rev=nope`),
  ).toThrow("Invalid UUID");
  expect(() => parseShareLink(`https://app.dev.fast/s/${token}?x=1`)).toThrow(
    "HTTPS",
  );
  expect(parseShareLink(`https://app.dev.fast/s/${token}`)).not.toHaveProperty(
    "revision",
  );
});

it("reads a link's revisions and the revision a capability serves", () => {
  const id = "5b0e9a52-4a43-4f7e-9d8e-3c1f0e7b2a11",
    url = `https://app.dev.fast/s/${"a".repeat(43)}?rev=${id}`;

  expect(
    shareRevisionsSchema.parse({
      latest: id,
      items: [{ id, version: 3, size: 10, createdAt: 1, url, extra: true }],
    }).items[0],
  ).toEqual({ id, version: 3, size: 10, createdAt: 1, url });
  expect(
    sharedMetaSchema.safeParse({
      sender: { login: "ada" },
      sharedAt: 1,
      size: 10,
    }).success,
  ).toBe(false);
  expect(
    sharedMetaSchema.parse({
      title: "T",
      sender: { login: "ada" },
      sharedAt: 1,
      size: 10,
      revision: { id, version: 3, createdAt: 1 },
      latest: id,
    }).revision.id,
  ).toBe(id);
  expect(
    shareCreatedSchema.safeParse({ shareId: id, url, revision: id }).success,
  ).toBe(false);
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

it("drops fields a newer sharer adds instead of rejecting the bundle", () => {
  const parsed = shareBundleSchema.parse({
    ...bundle,
    later: true,
    sources: [{ ...bundle.sources[0], later: true }],
    alignments: [{ ...bundle.alignments![0], later: true }],
  });

  expect(parsed).toEqual(bundle);
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
