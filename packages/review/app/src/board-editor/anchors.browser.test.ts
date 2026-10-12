import { documentHeadings } from "@review/review-api/document-headings";
import { expect, it } from "vitest";

import type { Board } from "./board-doc";
import { createBoardState } from "./editor-state";
import { headings, headingsKey } from "./headings";

it("anchors the same headings as the server, so a link lands in either", () => {
  const board: Board = {
    title: "Plan",
    document: [
      {
        id: "block-1",
        type: "section",
        title: "Design",
        children: [
          {
            id: "block-2",
            type: "markdown",
            markdown:
              "## Storage\n\nRows.\n\n#### Storage\n\nA detail.\n\n### Storage\n\nMore.",
          },
        ],
      },
    ],
  };

  const state = createBoardState(board, [
    headings({ initiallyCollapsed: () => false, remember: () => {} }),
  ]);

  const editor = headingsKey
    .getState(state)!
    .entries.map(({ id, text }) => [id, text]);

  // SAFETY: the board's blocks are the document blocks the server stores.
  const server = documentHeadings(board.document as never).map(
    ({ id, text }) => [id, text],
  );

  expect(editor).toEqual(server);
  expect(editor.map(([id]) => id)).toEqual(["design", "storage", "storage-2"]);
});
