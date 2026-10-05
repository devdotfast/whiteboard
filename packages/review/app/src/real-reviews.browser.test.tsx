import type { JsonValue } from "@dev.fast/review-protocol";
import {
  assignFreshIds,
  documentSchema,
  elements,
} from "@review/review-api/document";
import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

import { mountReviewCanvas as mount } from "./desktop-entry";
import { fixtureReviewBridge, settled } from "./fixture-review-bridge";
import { testReviewBridge } from "./review-session-test-utils";

// Saved canonical documents exercise rendering without the retired importer.
const goldens = import.meta.glob<{ default: JsonValue }>(
  "./fixtures/saved-reviews/*.json",
  { eager: true },
);

/** The title heading of each archived review's golden document. */
const phrases = {
  "bug-report-dialog": "Bug reports: screenshots and simpler consent",
  "opencode-agentserver": "OpenCode on AgentServer",
  "three-minute-tour": "Review Desktop: three-minute tour",
};

let canvas: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
});

it("shows migration guidance in the existing error surface for an unavailable old review", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    canvas = mount(container, {
      kind: "api",
      reviewId: "11111111-1111-4111-8111-111111111111",
      bridge: testReviewBridge(
        {},
        {
          request: async () =>
            Response.json(
              {
                error:
                  "Review not found. If this is an old Whiteboard review, ask your agent to migrate your old Whiteboard reviews.",
              },
              { status: 404 },
            ),
        },
      ),
    });
  });
  expect(
    await settled(() =>
      container.textContent?.includes(
        "ask your agent to migrate your old Whiteboard reviews",
      ),
    ),
  ).toBe(true);
});

it.each(Object.keys(phrases) as (keyof typeof phrases)[])(
  "renders the real review %s through the JSON canvas",
  async (name) => {
    const file = Object.keys(goldens).find((key) =>
      key.endsWith(`/${name}.json`),
    )!;

    // Assign ids as current authoring does before rendering.
    const blocks = documentSchema.parse(goldens[file]!.default);
    let nextId = 0;

    for (const block of blocks)
      assignFreshIds(block, (prefix) => `${prefix}-${++nextId}`);

    const snapshot: Snapshot = {
      reviewId: `real-${name}`,
      version: 0,
      title: name,
      pins: { repositoryId: "repo", base: "base", head: "head" },
      target: {
        kind: "commits",
        repositoryId: "repo",
        base: "base",
        head: "head",
      },
      document: blocks,
      createdAt: "2026-09-16T00:00:00.000Z",
    };

    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      canvas = mount(container, {
        kind: "api",
        reviewId: snapshot.reviewId,
        version: 0,
        bridge: fixtureReviewBridge({ snapshot }),
      });
    });

    expect(
      await settled(() => container.textContent?.includes(phrases[name])),
    ).toBe(true);
    expect(container.textContent).not.toContain("Layout failed");

    expect(container.querySelector("[data-block-error]")).toBeNull();

    // No golden collapses a section, so every block must be in the DOM with content.
    const missing = elements(blocks)
      .filter((element) => {
        if (element.type === "step") return false;

        const node = container.querySelector(
          `[data-review-node-id="${element.id}"]`,
        );

        return !node || node.innerHTML.trim() === "";
      })
      .map((element) => element.id);

    expect(missing).toEqual([]);
  },
);
