import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

import { mountReviewCanvas as mount } from "./desktop-entry";
import { fixtureReviewBridge, settled } from "./fixture-review-bridge";

let canvas: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
});

it("renders a document's task list with each checkbox beside its text", async () => {
  const markdown =
    "- [ ] Pick a repository; only its sessions remain.\n\n" +
    "- [x] Try Newest, Oldest and Title A-Z. ".repeat(8) +
    "\n\nTight:\n\n- [ ] One\n  - [ ] Nested\n";

  const snapshot: Snapshot = {
    reviewId: "tasks",
    version: 0,
    title: "Tasks",
    document: [{ id: "md-1", type: "markdown", markdown }],
    createdAt: "2026-09-28T00:00:00.000Z",
  };

  const container = document.createElement("div");
  container.style.width = "800px";
  document.body.append(container);
  await act(async () => {
    canvas = mount(container, {
      kind: "api",
      reviewId: snapshot.reviewId,
      version: 0,
      bridge: fixtureReviewBridge({ snapshot }),
    });
  });

  const items = await settled(() =>
    container.querySelectorAll<HTMLElement>("li.markdown-task").length === 4
      ? [...container.querySelectorAll<HTMLElement>("li.markdown-task")]
      : undefined,
  );

  expect(items).toBeDefined();

  for (const item of items!) {
    const box = item.querySelector("input")!.getBoundingClientRect();
    const text = item.querySelector(":scope > div")!.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(item).lineHeight);

    expect(getComputedStyle(item).listStyleType).toBe("none");
    expect(box.right).toBeLessThanOrEqual(text.left);
    // Centered within the text's first line, not above or below it.
    expect(
      Math.abs(box.top + box.height / 2 - (text.top + line / 2)),
    ).toBeLessThan(1);
  }

  // A pinned past version is read-only.
  expect(items!.every((item) => item.querySelector("input")!.disabled)).toBe(
    true,
  );
  expect(items!.map((item) => item.querySelector("input")!.checked)).toEqual([
    false,
    true,
    false,
    false,
  ]);
});
