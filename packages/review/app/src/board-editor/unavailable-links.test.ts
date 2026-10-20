import type { ApiDocumentData } from "@canvas/api-document";
import { expect, test } from "vitest";

import { createBoardState } from "./editor-state";
import { TestEditor } from "./testing";
import { unavailableLinkKey, unavailableLinks } from "./unavailable-links";

const gone = "22222222-2222-4222-8222-222222222222";
const here = "33333333-3333-4333-8333-333333333333";

const board = () => ({
  title: "Plan",
  document: [
    {
      id: "p1",
      type: "markdown" as const,
      markdown: `See [the old plan](whiteboard:board/${gone}), [a gone block](whiteboard:board/${here}#b9) and [the other](whiteboard:board/${here}).`,
    },
  ],
});

const struckText = (e: TestEditor) =>
  unavailableLinkKey
    .getState(e.state)!
    .find()
    .map(({ from, to }) => e.state.doc.textBetween(from, to));

test("strikes links whose board or block is gone, follows them through typing, and lets them go", () => {
  let boards: ApiDocumentData["boards"] = new Map([
    [`${gone}#`, { missing: true }],
    [`${here}#b9`, { title: "The other", missing: true }],
    [`${here}#`, { title: "The other", missing: false }],
  ]);

  // SAFETY: the plugin reads only `boards` of the data.
  const data = () => ({ boards }) as unknown as ApiDocumentData;

  const e = new TestEditor(
    board(),
    createBoardState(board(), [unavailableLinks(data)]),
  );

  expect(struckText(e)).toEqual(["the old plan", "a gone block"]);

  e.caret("See ").type("now ");
  expect(struckText(e)).toEqual(["the old plan", "a gone block"]);

  boards = new Map([[`${here}#b9`, { title: "The other", missing: true }]]);
  e.dispatch(e.state.tr.setMeta(unavailableLinkKey, true));
  expect(struckText(e)).toEqual(["a gone block"]);

  boards = new Map();
  e.dispatch(e.state.tr.setMeta(unavailableLinkKey, true));
  expect(struckText(e)).toEqual([]);
});
