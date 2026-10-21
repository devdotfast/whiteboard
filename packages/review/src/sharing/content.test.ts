import { expect, it } from "vitest";

import { parseSharedSnapshot, sharePresentationSchema } from "./content.js";

const element = (path: string, parentPath?: string) => ({
  type: "container" as const,
  id: path,
  path,
  ...(parentPath && { parentPath }),
  label: path,
  children: [],
});

const presentation = (elements: ReturnType<typeof element>[]) => ({
  maps: {
    map: {
      commit: "a".repeat(40),
      side: "head" as const,
      elements,
      relationships: [],
      countsByElementPath: {},
      unmappedByElementPath: {},
    },
  },
});

it("reads a map whose elements nest", () => {
  expect(
    sharePresentationSchema.safeParse(
      presentation([element("app"), element("app.api", "app")]),
    ).success,
  ).toBe(true);
});

// The map renderers walk parents until there are none.
it.each([
  ["itself", [element("app", "app")]],
  ["a loop", [element("a", "b"), element("b", "c"), element("c", "a")]],
])("refuses map elements nested in %s", (_name, elements) => {
  expect(sharePresentationSchema.safeParse(presentation(elements)).error)
    .toMatchInlineSnapshot(`
    [ZodError: [
      {
        "code": "custom",
        "path": [
          "maps",
          "map",
          "elements"
        ],
        "message": "Software map elements nest in a cycle."
      }
    ]]
  `);
});

const snapshot = (pullRequestUrl: string) => ({
  reviewId: "shared",
  version: 1,
  title: "Board",
  document: [],
  createdAt: "2026-10-20T00:00:00.000Z",
  origin: { pullRequestNumber: 7, pullRequestUrl },
});

it("links a pull request only over https", () => {
  expect(
    parseSharedSnapshot(snapshot("https://github.com/o/r/pull/7")).origin,
  ).toEqual({
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/o/r/pull/7",
  });

  for (const url of [
    "javascript:alert(1)",
    "http://example.com/pull/7",
    "/pull/7",
  ])
    expect(() => parseSharedSnapshot(snapshot(url))).toThrow(/pullRequestUrl/);
});
