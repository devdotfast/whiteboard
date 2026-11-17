import type { BlockProps } from "@canvas/blocks";
import type { ReviewTheme } from "@canvas/debug-settings";
import type { MotionPhase } from "@canvas/draw-queue";
import { type Block, animationCode } from "@dev.fast/whiteboard-document";
import type { ReactElement, ReactNode, RefObject } from "react";

import type { StageRunReport } from "./report-run";
import type { StagePlayer } from "./stage-player";

export type StageNode = BlockProps<"animation" | "clip" | "diagram">["node"];

/**
 * What a stage reads from whatever draws it: the board, or a page that shows
 * one diagram on its own. The stage itself (its boot, messages, player and
 * sizing) is the same for both.
 */
export interface StageHost {
  theme: ReviewTheme;
  /** What hovering a drawn element that opens code says, by code name. */
  codeTitles: Record<string, string>;
  /** Whether each code name still holds, for the claims a diagram reports. */
  codeStatus: Record<string, "checked" | "changed">;
  /** Blocks the stage may show with whiteboard.block(), by id. */
  blocks: ReadonlyMap<string, Block>;
  renderBlocks(blocks: Block[]): ReactNode;
  /** The draw queue's phase for this block, and how the stage says it is
   * painted. */
  motion: MotionPhase | undefined;
  painted(blockId: string): void;
  /** What the stage's script did and, for a diagram, what it drew wrong. */
  report(report: StageRunReport): void;
  /** The board an agent's render finds this stage on. */
  reviewId?: string;
  /** The stage's surroundings. Called as a hook, so a stage keeps one host
   * kind for its life. */
  useChrome(stage: StageChromeInput): StageChrome;
}

/** What a stage's surroundings read from it. */
export interface StageChromeInput {
  node: StageNode;
  player: StagePlayer;
  noun: "animation" | "clip" | "diagram";
  /** The width the stage is laid out at inline. */
  inlineWidth(): number;
}

/** Around the stage: the header's action, where a drawn element's code
 * opens, and the stage moved fullscreen. */
export interface StageChrome {
  figureRef: RefObject<HTMLElement | null>;
  fullscreen: boolean;
  /** Fullscreen, the inline width the stage keeps and scales from. */
  inlineWidth: number;
  action: ReactNode;
  reveal(name: string): void;
  escape(): void;
  /** Places the figure: inline, or in an overlay. */
  frame(figure: ReactElement): ReactNode;
}

/** A named range's source and label, however the block writes it. */
export function codeEntry(
  node: StageNode,
  name: string,
): { source: string; label?: string } | undefined {
  if (node.type === "diagram") return node.code[name];
  const entry = node.code[name];

  return entry === undefined ? undefined : animationCode(entry);
}
