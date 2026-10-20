import { type EditorState, TextSelection } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { expect, test, vi } from "vitest";

import { createBoardState } from "./editor-state";
import { motion, motionKey } from "./motion";

const decorations = (state: EditorState) =>
  motionKey.get(state)!.props.decorations!.call(motionKey.get(state)!, state);

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

test("a ghost that waited too long goes on the next transaction", () => {
  vi.useFakeTimers();

  let state = createBoardState(
    {
      title: "Plan",
      document: [{ id: "block-2", type: "markdown", markdown: "Kept." }],
    },
    [motion()],
  );

  // SAFETY: never rendered here; the node project has no DOM.
  const dom = { dataset: {}, className: "" } as HTMLElement;

  const ghost = {
    id: "gone",
    pos: state.doc.firstChild!.nodeSize,
    dom,
    classes: "",
    since: Date.now(),
  };

  state = state.apply(state.tr.setMeta(motionKey, { ghosts: [ghost] }));
  expect((decorations(state) as DecorationSet).find()).toHaveLength(1);

  vi.advanceTimersByTime(2_000);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1)),
  );
  expect(decorations(state)).toBeNull();
  vi.useRealTimers();
});
