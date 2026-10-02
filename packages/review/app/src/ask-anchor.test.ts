import { expect, it } from "vitest";

import { mapSpan } from "./ask-anchor";

it("follows words edits leave alone, and gives up on words an edit touched", () => {
  const before = "It points one workspace at the head checkout.";
  const start = before.indexOf("one workspace");
  const end = start + "one workspace".length;

  // Text added and removed before them moves them.
  const moved = "Now it points one workspace at the head checkout.";

  expect(mapSpan(before, moved, start, end)).toEqual({
    start: moved.indexOf("one workspace"),
    end: moved.indexOf("one workspace") + "one workspace".length,
  });

  // Edits after them, and insertions right at their edges, leave them.
  expect(
    mapSpan(before, "It points one workspace at each checkout.", start, end),
  ).toEqual({ start, end });
  expect(
    mapSpan(
      before,
      "It points (one workspace) at the head checkout.",
      start,
      end,
    ),
  ).toEqual({ start: start + 1, end: end + 1 });

  // An edit inside them, or removing them, is a change to what was asked.
  expect(
    mapSpan(before, "It points one shared workspace at the head.", start, end),
  ).toBeNull();
  expect(
    mapSpan(before, "It points at the head checkout.", start, end),
  ).toBeNull();
});
