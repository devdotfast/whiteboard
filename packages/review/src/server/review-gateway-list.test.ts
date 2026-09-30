import { randomUUID } from "node:crypto";

import type {
  ReviewApiSummary,
  ReviewGatewayHostState,
} from "@dev.fast/review-protocol";
import { expect, it } from "vitest";

import { type ListSource, mergeLists } from "./review-gateway-list.js";

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
  dismissedAt: null,
  ...extra,
});

/** Hosts in setting order; `lists` by server id; `serving` server ids. */
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

it("lists the laptop first, then each machine in the setting's order", () => {
  const merged = mergeLists(
    "structural",
    [entry("laptop")],
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
    ["laptop", undefined, undefined],
    ["on b", "b", "online"],
    ["on a", "a", "online"],
  ]);
  expect(merged[1]?.available).toEqual({
    sourceWindows: false,
    languageFeatures: false,
  });
});

it("offers language features only for an online host whose Desktop reported them", () => {
  const merged = mergeLists(
    "structural",
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

  expect(
    merged.map((review) => [review.host, review.available?.languageFeatures]),
  ).toEqual([
    ["a", true],
    ["b", false],
    ["c", false],
  ]);
});

it("lists one machine under two aliases once, under the first", () => {
  const merged = mergeLists(
    "structural",
    [],
    source(
      [
        { alias: "first", serverId: "A", state: "online" },
        { alias: "second", serverId: "A", state: "online" },
      ],
      { A: [entry("on a")] },
      ["A"],
    ),
  );

  expect(summary(merged)).toEqual([["on a", "first", "online"]]);
});

it("leaves a duplicate out", () => {
  const merged = mergeLists(
    "structural",
    [],
    source([{ alias: "copy", serverId: "C", state: "duplicate" }], {
      C: [entry("copied")],
    }),
  );

  expect(merged).toEqual([]);
});

it("drops entries whose id is not a UUID", () => {
  const merged = mergeLists(
    "structural",
    [],
    source(
      [{ alias: "a", serverId: "A", state: "online" }],
      {
        A: [
          entry("pad", { reviewId: "scratchpad" }),
          entry("shared", { reviewId: `shared-${"a".repeat(64)}` }),
          entry("kept"),
        ],
      },
      ["A"],
    ),
  );

  expect(summary(merged)).toEqual([["kept", "a", "online"]]);
});

it("puts the alias in front of the group key and keeps the label", () => {
  const [merged] = mergeLists(
    "structural",
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
    "structural",
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

it("keeps an id with the machine that lists it first", () => {
  const shared = entry("mine");
  const conflicts: string[] = [];

  const merged = mergeLists(
    "structural",
    [shared],
    source(
      [{ alias: "a", serverId: "A", state: "online" }],
      { A: [{ ...shared, title: "theirs" }] },
      ["A"],
    ),
    (conflict) => conflicts.push(`${conflict.host}:${conflict.reviewId}`),
  );

  expect(summary(merged)).toEqual([["mine", undefined, undefined]]);
  expect(conflicts).toEqual([`a:${shared.reviewId}`]);
});
