/**
 * Board icons, drawn the same in the canvas and in Desktop's tabs: a board,
 * a board with code attached, and one per pull request state. Each is a 14px
 * stroked icon.
 */

import type { PullRequestState } from "./contracts.js";

/** "code" for a board with code attached, "board" for one without. */
export type BoardIconKind = "board" | "code";

/** A board has code attached when its target is commits, a PR or a working
 * tree, even one with nothing to compare. A plan's target is its project. */
export const boardIconKind = (
  target: { kind: string } | undefined,
): BoardIconKind => (target && target.kind !== "project" ? "code" : "board");

export interface BoardIconStroke {
  tag: "path" | "rect" | "circle";
  attrs: Readonly<Record<string, string>>;
}

export interface BoardIconDefinition {
  strokeWidth: string;
  strokes: readonly BoardIconStroke[];
}

const BOARD = {
  tag: "rect",
  attrs: { x: "2", y: "2.5", width: "10", height: "9", rx: "1.5" },
} as const;

export const BOARD_ICONS: Readonly<Record<BoardIconKind, BoardIconDefinition>> =
  {
    board: {
      strokeWidth: "1.1",
      strokes: [
        BOARD,
        { tag: "path", attrs: { d: "M4.5 5.5 H9.5 M4.5 8 H8" } },
      ],
    },
    code: {
      strokeWidth: "1.1",
      strokes: [
        BOARD,
        {
          tag: "path",
          attrs: {
            d: "M5.75 5.25 L4 7 L5.75 8.75 M8.25 5.25 L10 7 L8.25 8.75",
          },
        },
      ],
    },
  };

const circle = (cx: string, cy: string): BoardIconStroke => ({
  tag: "circle",
  attrs: { cx, cy, r: "1.5" },
});

export const PULL_REQUEST_STATE_ICONS: Readonly<
  Record<PullRequestState, BoardIconDefinition>
> = {
  open: {
    strokeWidth: "1.2",
    strokes: [
      circle("4", "3.5"),
      circle("4", "10.5"),
      circle("10", "10.5"),
      { tag: "path", attrs: { d: "M4 5 V9 M10 9 V6.5 Q10 4.5 8 4.5 H6.5" } },
    ],
  },
  draft: {
    strokeWidth: "1.2",
    strokes: [
      circle("4", "3.5"),
      circle("4", "10.5"),
      circle("10", "10.5"),
      { tag: "path", attrs: { d: "M4 5 V9 M10 3.5 V4 M10 6 V7" } },
    ],
  },
  merged: {
    strokeWidth: "1.2",
    strokes: [
      circle("4", "3.5"),
      circle("4", "10.5"),
      circle("10", "7.5"),
      { tag: "path", attrs: { d: "M4 5 V9 M4.3 5 Q5 7.5 8.5 7.5" } },
    ],
  },
  closed: {
    strokeWidth: "1.2",
    strokes: [
      circle("4", "3.5"),
      circle("4", "10.5"),
      circle("10", "10.5"),
      {
        tag: "path",
        attrs: {
          d: "M4 5 V9 M10 7.5 V9 M8.75 2.75 L11.25 5.25 M11.25 2.75 L8.75 5.25",
        },
      },
    ],
  },
};

export const PULL_REQUEST_STATE_LABELS: Readonly<
  Record<PullRequestState, string>
> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

/** The icon as SVG markup, for a CSS mask or an image. */
export function boardIconMarkup(icon: BoardIconDefinition): string {
  const markup = icon.strokes
    .map(
      ({ tag, attrs }) =>
        `<${tag} ${Object.entries(attrs)
          .map(([name, value]) => `${name}='${value}'`)
          .join(" ")}/>`,
    )
    .join("");

  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14' fill='none' stroke='black' stroke-width='${icon.strokeWidth}' stroke-linecap='round' stroke-linejoin='round'>${markup}</svg>`;
}
