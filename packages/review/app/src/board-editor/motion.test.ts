import { DecorationSet } from "@tiptap/pm/view";
import { expect, test } from "vitest";

import { createBoardState } from "./editor-state";
import { motion, motionKey } from "./motion";

test("an agent's edit marks the block it draws, and rings the block it writes in", () => {
  let state = createBoardState(
    {
      title: "Plan",
      document: [
        { id: "block-1", type: "section", title: "Why", children: [] },
        { id: "block-2", type: "markdown", markdown: "Agents write." },
      ],
    },
    [motion()],
  );

  state = state.apply(
    state.tr.setMeta(motionKey, {
      phases: new Map([["block-1", "retitle"]]),
      region: { id: "block-2", writing: true },
    }),
  );

  const set = motionKey
    .get(state)!
    .props.decorations!.call(motionKey.get(state)!, state);

  if (!(set instanceof DecorationSet)) throw new Error("No decorations.");
  const marks = set.find().map(({ spec }) => spec);

  expect(marks).toMatchObject([
    { phase: "retitle", ring: "off" },
    { ring: "writing" },
  ]);
});
