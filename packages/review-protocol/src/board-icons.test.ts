import { expect, it } from "vitest";

import { boardIconKind } from "./board-icons.js";

it("draws a board with code for any target but a project", () => {
  for (const kind of ["commits", "pullRequest", "worktree"])
    expect(boardIconKind({ kind })).toBe("code");

  expect(boardIconKind({ kind: "project" })).toBe("board");
  expect(boardIconKind(undefined)).toBe("board");
});
