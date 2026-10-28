import { mountWhiteboard, settled } from "@canvas/whiteboard-fixture";
import type { ActivitySnapshot } from "@dev.fast/whiteboard-document";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

import { type BoardSnapshot, boardView } from "./board-data";
import { readOnlyHost } from "./share-host";

const working: ActivitySnapshot = {
  workingCount: 1,
  expiresAt: null,
  activities: [{ activityId: "agent", slot: 0 }],
};

const version = (
  n: number,
  ids: string[],
  activity?: BoardSnapshot["activity"],
): BoardSnapshot => ({
  reviewId: "live-board",
  version: n,
  title: "Live",
  createdAt: "2026-10-27T00:00:00.000Z",
  document: ids.map((id) => ({
    id,
    type: "markdown",
    markdown: `Block ${id}`,
  })),
  lastEdit: {
    type: "insert",
    targetId: ids.at(-1)!,
    blockId: ids.at(-1)!,
    kind: "markdown",
  },
  ...(activity && { activity }),
});

let canvas: ReturnType<typeof mountWhiteboard> | undefined;

const host = readOnlyHost();

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
  document.body.replaceChildren();
});

const mount = async (snapshot: BoardSnapshot) => {
  const container = document.body.appendChild(document.createElement("div"));

  await act(async () => {
    canvas = mountWhiteboard(container, boardView(snapshot), { host });
  });

  return container;
};

const motion = (container: HTMLElement, id: string) =>
  container
    .querySelector(`[data-review-node-id="${id}"]`)
    ?.getAttribute("data-motion") ?? undefined;

it("draws each new version's edit on a board that carries activity", async () => {
  const container = await mount(version(1, ["a"], working));

  await settled(() => container.textContent?.includes("Agent working…"));
  expect(container.textContent).toContain("Agent working…");
  // The board as found is already drawn.
  expect(motion(container, "a")).toBeUndefined();

  await act(async () =>
    canvas!.update(boardView(version(2, ["a", "b"], working))),
  );
  await settled(() => container.textContent?.includes("Block b"));
  expect(motion(container, "b")).toBeDefined();

  await act(async () =>
    canvas!.update(boardView(version(2, ["a", "b"], "unknown"))),
  );
  expect(container.textContent).not.toContain("Agent working…");
});

it("draws nothing on a static board", async () => {
  const container = await mount(version(1, ["a"]));

  await settled(() => container.textContent?.includes("Block a"));
  await act(async () => canvas!.update(boardView(version(2, ["a", "b"]))));
  await settled(() => container.textContent?.includes("Block b"));
  expect(motion(container, "b")).toBeUndefined();
  expect(container.textContent).not.toContain("Agent working…");
});

it("rejects a document that is not a Whiteboard document", () => {
  expect(() =>
    boardView({ ...version(1, ["a"]), document: [{ type: "nonsense" }] }),
  ).toThrow(/"document"/);
});
