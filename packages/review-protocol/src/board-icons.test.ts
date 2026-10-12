import { expect, it } from "vitest";

import { boardIconKind, boardTitle } from "./board-icons.js";

it("draws a board with code for any target but a project", () => {
  for (const kind of ["commits", "pullRequest", "worktree"])
    expect(boardIconKind({ kind })).toBe("code");

  expect(boardIconKind({ kind: "project" })).toBe("board");
  expect(boardIconKind(undefined)).toBe("board");
});

it("reads an empty title as Untitled, and a typed one as typed", () => {
  expect(boardTitle("")).toBe("Untitled");
  expect(boardTitle("   ")).toBe("Untitled");
  expect(boardTitle(undefined)).toBe("Untitled");
  expect(boardTitle("Untitled")).toBe("Untitled");
  expect(boardTitle("Plan")).toBe("Plan");
});
