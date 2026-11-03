import {
  type FlowNodeKind,
  flowNodeKinds,
} from "@dev.fast/whiteboard-document";
import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

import {
  fixtureHost,
  loadFixture,
  mountWhiteboard,
  settled,
} from "./whiteboard-fixture";

import "./styles.css";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** A flow of one node per kind, chained in order; `undefined` leaves a node
 * without a kind, as older documents do. */
async function mountFlow(kinds: (FlowNodeKind | undefined)[]) {
  const snapshot: Snapshot = {
    reviewId: "flow-kinds",
    version: 0,
    title: "Kinds",
    pins: { repositoryId: "repo", base: "base", head: "head" },
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
    document: [
      {
        id: "flow",
        type: "flow_diagram",
        title: "Kinds",
        nodes: kinds.map((kind, index) => ({
          id: `node-${index}`,
          type: "flow_node",
          key: String(index),
          label: kind ?? "plain",
          kind,
          attachments: [],
        })),
        edges: kinds.slice(1).map((_, index) => ({
          id: `edge-${index}`,
          type: "flow_edge",
          from: String(index),
          to: String(index + 1),
        })),
      },
    ],
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const container = document.createElement("div");
  container.style.width = "900px";
  document.body.append(container);
  await act(async () => {
    const canvas = mountWhiteboard(
      container,
      loadFixture({
        snapshot,
        progress: { files: [], lenses: [], resolvedSelections: {} },
        commits: [],
        images: {},
        traces: {},
        maps: {},
      }),
      { host: fixtureHost() },
    );

    disposers.push(() => {
      canvas.dispose();
      container.remove();
    });
  });

  expect(
    await settled(
      () =>
        container.querySelectorAll(".lens-flow-node").length === kinds.length,
    ),
  ).toBe(true);

  return container;
}

const legend = (container: HTMLElement) =>
  [...container.querySelectorAll("ul[aria-label='Node kinds'] li")].map(
    (item) => item.textContent,
  );

it("draws each kind its own way and lists them in the legend", async () => {
  const container = await mountFlow([...flowNodeKinds]);

  const nodes = [...container.querySelectorAll<HTMLElement>(".lens-flow-node")];

  const outlines = new Map(
    nodes.map((node) => [
      node.dataset.flowKind,
      node.querySelector("path[pathLength]")!.getAttribute("d"),
    ]),
  );

  expect([...outlines.keys()]).toEqual([...flowNodeKinds]);

  // Four kinds have an outline of their own; the rest share the box and
  // differ by their marks or stroke.
  const box = outlines.get("process");
  const own = ["decision", "terminal", "database", "cache"];

  expect(own.map((kind) => outlines.get(kind))).not.toContain(box);
  expect(new Set(outlines.values()).size).toBe(own.length + 1);

  // The marks that make a kind: a lid, a title bar, side rules, a stack.
  const marks = Object.fromEntries(
    nodes.map((node) => [
      node.dataset.flowKind,
      node.querySelectorAll("path").length - 1,
    ]),
  );

  expect(marks).toEqual({
    process: 0,
    decision: 0,
    terminal: 0,
    client: 1,
    service: 2,
    external: 0,
    database: 1,
    queue: 2,
    cache: 1,
  });

  expect(legend(container)).toEqual([
    "Process",
    "Decision",
    "Start / end",
    "Client",
    "Service",
    "External",
    "Database",
    "Queue",
    "Cache",
  ]);
});

it("lists only the kinds the diagram uses, counting an unset kind as a process", async () => {
  const container = await mountFlow([undefined, "database", "database"]);

  expect(container.querySelector("[data-flow-kind='process']")).not.toBeNull();
  expect(legend(container)).toEqual(["Process", "Database"]);
});

it("draws no legend for a diagram of one kind", async () => {
  const container = await mountFlow([undefined, "process"]);

  expect(container.querySelector("ul[aria-label='Node kinds']")).toBeNull();
});
