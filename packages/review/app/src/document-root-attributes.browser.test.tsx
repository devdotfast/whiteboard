import lensFixture from "@review/fixtures/blocks/database_lens.json";
import {
  type Block,
  documentSchema,
  elements,
} from "@review/review-api/document";
import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

import { mountReviewCanvas as mount } from "./desktop-entry";
import { fixtureReviewBridge, settled } from "./fixture-review-bridge";

const [lens] = documentSchema.parse(lensFixture);

const markdown = (id: string, source: string): Block => ({
  id,
  type: "markdown",
  markdown: source,
});

let canvas: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
  document.body.replaceChildren();
});

// The app root's layout attributes stand in for :has() over the document,
// so they must agree with what the document actually renders.
it.each([
  {
    name: "untitled review",
    document: [markdown("a", "Body.\n")],
    header: true,
    lens: false,
  },
  {
    name: "scratchpad",
    kind: "scratchpad" as const,
    document: [markdown("a", "Body.\n")],
    header: false,
    lens: false,
  },
  {
    name: "titled scratchpad",
    kind: "scratchpad" as const,
    document: [markdown("a", "# Notes\n\nBody.\n")],
    header: true,
    lens: false,
  },
  {
    name: "lens inside a section",
    document: [
      {
        id: "section",
        type: "section",
        title: "Storage",
        defaultCollapsed: false,
        children: [{ ...lens!, id: "lens" }],
      },
    ] satisfies Block[],
    header: true,
    lens: true,
  },
])("matches what the $name renders", async (fixture) => {
  const snapshot: Snapshot = {
    reviewId: "root-attributes",
    version: 0,
    title: "Fixture review",
    kind: fixture.kind,
    pins: { repositoryId: "repo", base: "base", head: "head" },
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
    document: fixture.document as Block[],
    createdAt: "2026-10-01T00:00:00.000Z",
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
    await settled(() =>
      elements(snapshot.document).every((element) =>
        container.querySelector(`[data-review-node-id="${element.id}"]`),
      ),
    ),
  ).toBe(true);

  const root = container.querySelector(".review-app")!;

  const rendered = {
    header: !!container.querySelector("[data-review-document-header]"),
    lens: !!container.querySelector(".database-lens"),
  };

  expect(rendered).toEqual({ header: fixture.header, lens: fixture.lens });
  expect({
    header: root.hasAttribute("data-document-header"),
    lens: root.hasAttribute("data-database-lens"),
  }).toEqual(rendered);
});
