import { randomUUID } from "node:crypto";

import type {
  ReviewApiSummary,
  ReviewGatewayHostState,
} from "@dev.fast/review-protocol";
import { expect, it } from "vitest";

import {
  type ListSource,
  listedBy,
  mergeLists,
} from "./review-gateway-list.js";

const entry = (
  title: string,
  extra: Partial<ReviewApiSummary> = {},
): ReviewApiSummary => ({
  reviewId: randomUUID(),
  version: 1,
  title,
  createdAt: "2026-09-30T00:00:00.000Z",
  repositoryName: "project",
  viewedAt: null,
  trashedAt: null,
  ...extra,
});

function source(
  states: ReviewGatewayHostState[],
  lists: Record<string, ReviewApiSummary[]>,
  serving: string[] = [],
  remembered: Record<string, string> = {},
): ListSource {
  return {
    states,
    serving: (serverId) => serving.includes(serverId),
    serverIdOf: (alias) => remembered[alias],
    list: (serverId) => lists[serverId],
  };
}

const summary = (list: ReviewApiSummary[]) =>
  list.map((review) => [review.title, review.host, review.hostState]);

it("lists this machine first, then each machine in the setting's order", () => {
  const merged = mergeLists(
    [entry("local")],
    source(
      [
        { alias: "b", serverId: "B", state: "online" },
        { alias: "a", serverId: "A", state: "online" },
      ],
      { A: [entry("on a")], B: [entry("on b")] },
      ["A", "B"],
    ),
  );

  expect(summary(merged)).toEqual([
    ["local", undefined, undefined],
    ["on b", "b", "online"],
    ["on a", "a", "online"],
  ]);
  expect(merged[1]?.available).toEqual({
    sourceWindows: false,
  });
});

it("offers language features and Source windows only for an online host whose Desktop reported language features", () => {
  const merged = mergeLists(
    [],
    source(
      [
        { alias: "a", serverId: "A", state: "online", languageFeatures: true },
        { alias: "b", serverId: "B", state: "online", languageFeatures: false },
        { alias: "c", serverId: "C", state: "offline", languageFeatures: true },
      ],
      { A: [entry("on a")], B: [entry("on b")], C: [entry("on c")] },
      ["A", "B"],
    ),
  );

  expect(merged.map((review) => [review.host, review.available])).toEqual([
    ["a", { sourceWindows: true }],
    ["b", { sourceWindows: false }],
    ["c", { sourceWindows: false, reason: "c offline." }],
  ]);
});

it("lists a server two aliases share once, under the first, offline", () => {
  const merged = mergeLists(
    [],
    source(
      [
        { alias: "first", serverId: "A", state: "duplicate" },
        { alias: "second", serverId: "A", state: "duplicate" },
      ],
      { A: [entry("on a")] },
    ),
  );

  expect(summary(merged)).toEqual([["on a", "first", "offline"]]);
});

it("puts the alias in front of the group key and keeps the label", () => {
  const [merged] = mergeLists(
    [],
    source(
      [{ alias: "a", serverId: "A", state: "online" }],
      {
        A: [
          entry("grouped", {
            repositoryGroup: { key: "git:/srv/r/.git", label: "r" },
          }),
        ],
      },
      ["A"],
    ),
  );

  expect(merged?.repositoryGroup).toEqual({
    key: "a:git:/srv/r/.git",
    label: "r",
  });
});

it("keeps the last list of a host that is connecting, offline, incompatible or unreachable, with its state", () => {
  const merged = mergeLists(
    [],
    source(
      [
        { alias: "starting", state: "connecting" },
        { alias: "gone", serverId: "G", state: "offline" },
        { alias: "old", serverId: "O", state: "incompatible" },
        { alias: "unreached", state: "unreachable" },
        { alias: "never", state: "offline" },
      ],
      {
        S: [entry("starting")],
        G: [entry("gone")],
        O: [entry("old")],
        U: [entry("unreached")],
      },
      [],
      { starting: "S", unreached: "U" },
    ),
  );

  expect(summary(merged)).toEqual([
    ["starting", "starting", "connecting"],
    ["gone", "gone", "offline"],
    ["old", "old", "incompatible"],
    ["unreached", "unreached", "unreachable"],
  ]);
});

it("gives an id to this machine, then to the first host in the setting's order that lists it", () => {
  const shared = entry("mine");
  const onBoth = entry("on both");

  const lists = source(
    [
      { alias: "b", serverId: "B", state: "offline" },
      { alias: "a", serverId: "A", state: "online" },
    ],
    {
      A: [
        { ...shared, title: "a's" },
        { ...onBoth, title: "a's" },
      ],
      B: [{ ...onBoth, title: "b's" }],
    },
    ["A"],
  );

  expect(summary(mergeLists([shared], lists))).toEqual([
    ["mine", undefined, undefined],
    ["b's", "b", "offline"],
  ]);
  expect(listedBy(onBoth.reviewId, lists)?.state.alias).toBe("b");
});

it("says why Source windows are off: the host's sentence while it is down, else the language features detail", () => {
  const merged = mergeLists(
    [],
    source(
      [
        { alias: "a", serverId: "A", state: "online", languageFeatures: true },
        {
          alias: "b",
          serverId: "B",
          state: "online",
          languageFeatures: false,
          languageFeaturesDetail: "The Whiteboard on b has no VS Code server.",
        },
        { alias: "c", serverId: "C", state: "offline", languageFeatures: true },
        {
          alias: "d",
          serverId: "D",
          state: "auth-failed",
          detail: "Permission denied.",
        },
        { alias: "e", serverId: "E", state: "online", detail: "stale" },
        {
          alias: "f",
          serverId: "F",
          state: "online",
          languageFeatures: false,
          languageFeaturesDetail: "Installing the language extensions.",
          languageFeaturesPending: true,
        },
      ],
      {
        A: [entry("on a")],
        B: [entry("on b")],
        C: [entry("on c")],
        D: [entry("on d")],
        E: [entry("on e")],
        F: [entry("on f")],
      },
      ["A", "B", "F"],
    ),
  );

  expect(
    merged.map((review) => [
      review.host,
      review.available?.reason,
      review.available?.pending,
    ]),
  ).toEqual([
    ["a", undefined, undefined],
    ["b", "The Whiteboard on b has no VS Code server.", undefined],
    ["c", "c offline.", undefined],
    ["d", "Permission denied.", undefined],
    ["e", "e offline.", undefined],
    ["f", "Installing the language extensions.", true],
  ]);
});
