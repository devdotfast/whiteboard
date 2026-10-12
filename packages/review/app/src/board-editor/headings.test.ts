import { expect, test } from "vitest";

import { createBoardState } from "./editor-state";
import { headings, headingsKey } from "./headings";

test("Contents puts each heading at its section's depth", () => {
  const state = createBoardState(
    {
      title: "Depths",
      document: [
        {
          id: "block-1",
          type: "section",
          title: "One",
          children: [
            {
              id: "block-2",
              type: "section",
              title: "Two",
              children: [
                {
                  id: "block-3",
                  type: "markdown",
                  markdown: "## In the text\n\n### Under it\n\n#### Deeper",
                },
                {
                  id: "block-4",
                  type: "section",
                  title: "Three",
                  children: [],
                },
              ],
            },
          ],
        },
        { id: "block-5", type: "section", title: "Next", children: [] },
      ],
    },
    [headings({ initiallyCollapsed: () => false, remember: () => {} })],
  );

  // #### reads as text, as the server has it: only ## and ### are headings.
  expect(
    headingsKey
      .getState(state)!
      .entries.map(({ text, depth }) => [text, depth]),
  ).toEqual([
    ["One", 1],
    ["Two", 2],
    ["In the text", 3],
    ["Under it", 4],
    ["Three", 3],
    ["Next", 1],
  ]);
});
