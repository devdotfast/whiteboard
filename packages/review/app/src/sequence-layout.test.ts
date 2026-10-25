import { describe, expect, it } from "vitest";

import { sequenceLabelLines, sequenceRows } from "./sequence-layout";

const LANE = 184;

describe("sequence rows", () => {
  // Consecutive self-calls with long labels, then long labels across lanes:
  // the shape of PR 3's "An agent command through /commands".
  const messages = [
    {
      from: 0,
      to: 1,
      label: "session_create / session_edit with paths and {head, base?} pins",
    },
    { from: 1, to: 2, label: "POST /commands" },
    {
      from: 2,
      to: 2,
      label:
        "reject a repositoryId on the operation, its target or a pins object",
    },
    {
      from: 2,
      to: 3,
      label:
        "pullRequest target: check it (and the board, for set_target), register path, PR number to URL; set_target resolves the PR now",
    },
    {
      from: 2,
      to: 2,
      label:
        "edit / lens_edit: stamp the board's repositoryId on every pins-shaped object",
    },
    {
      from: 2,
      to: 2,
      label:
        "a second self-call straight after the first, also long enough to wrap over several lines",
    },
    {
      from: 4,
      to: 3,
      label: "create from pullRequestUrl: fetch into the named checkout only",
    },
    { from: 1, to: 0, label: "result with every repositoryId key removed" },
  ];

  it("starts each row below everything the row above it drew", () => {
    const { rows, height } = sequenceRows(messages, LANE);

    for (const row of rows) {
      expect(row.labelTop).toBeLessThan(row.labelBottom);
      expect(row.labelBottom).toBeLessThan(row.arrow);
    }

    for (const [above, row] of rows
      .slice(1)
      .map((row, index) => [rows[index]!, row] as const))
      expect(row.labelTop).toBeGreaterThan(above.bottom);

    expect(height).toBeGreaterThan(rows.at(-1)!.bottom);
  });

  it("never lets two labels' boxes meet", () => {
    const { rows } = sequenceRows(messages, LANE);

    const boxes = rows.map((row, index) => {
      const { from, to } = messages[index]!;

      // Centered between its ends; a self-call's sits beside its lifeline.
      const center =
        from === to ? (from + 0.5) * LANE + 27 : ((from + to + 1) / 2) * LANE;

      return {
        left: center - row.labelWidth / 2,
        right: center + row.labelWidth / 2,
        top: row.labelTop,
        bottom: row.labelBottom,
      };
    });

    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1))
        expect(
          a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom,
        ).toBe(false);
  });

  it("wraps a label at spaces, and a long word anywhere", () => {
    // 11 characters to a line at this width.
    expect(sequenceLabelLines("hello world", 80)).toBe(1);
    expect(sequenceLabelLines("hello world again", 80)).toBe(2);
    expect(sequenceLabelLines("a".repeat(30), 80)).toBe(3);
  });
});
