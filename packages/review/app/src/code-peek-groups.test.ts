import { describe, expect, it } from "vitest";

import type { DiffSelection } from "../../src/lens-selection";
import { codePeekFileGroups } from "./CodePeek";

const chunk = (
  file: string,
  line: number,
  extra: Partial<DiffSelection> = {},
): DiffSelection => ({
  file,
  start: { side: "head", line },
  end: { side: "head", line },
  ...extra,
});

describe("code peek file groups", () => {
  it("puts chunks from one file in one card and other files in their own", () => {
    const first = chunk("src/a.ts", 10);
    const other = chunk("src/b.ts", 3);
    const second = chunk("src/a.ts", 40);

    expect(codePeekFileGroups([first, other, second])).toEqual([
      [first, second],
      [other],
    ]);
  });

  it("keeps chunks apart when their side or pins differ", () => {
    const head = chunk("src/a.ts", 10);

    const base = chunk("src/a.ts", 10, {
      start: { side: "base", line: 10 },
      end: { side: "base", line: 10 },
      pins: { repositoryId: "repo", base: "b1", head: "h1" },
    });

    const pinned = chunk("src/a.ts", 20, {
      pins: { repositoryId: "repo", head: "h2" },
    });

    expect(codePeekFileGroups([head, base, pinned])).toEqual([
      [head],
      [base],
      [pinned],
    ]);
  });
});
