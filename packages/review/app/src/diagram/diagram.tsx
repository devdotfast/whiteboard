// One diagram block drawn on its own, for a page that lays out its own
// content around it: the same stage the board draws, without the board.

import { Stage, diagramRevision } from "@canvas/animation/animation-block";
import type {
  StageChrome,
  StageChromeInput,
  StageHost,
} from "@canvas/animation/stage-host";
import { withClass } from "@canvas/stylex-props";
import { themeClass, themeStyles } from "@canvas/theme-styles";
import type { DiagramBlock } from "@dev.fast/whiteboard-document";
import { useMemo, useRef } from "react";

/** What a diagram's stage found when its script ran. */
export interface DiagramFindings {
  /** What it drew wrong. */
  findings: string[];
  /** What the script asked of the diagram that it could not do. */
  notes: string[];
  /** What the script threw. */
  error?: string;
}

export interface DiagramProps {
  block: DiagramBlock;
  /** Defaults to light. */
  theme?: "light" | "dark";
  /** A drawn element's code link was clicked: one of `block.code`'s names. */
  onCode?(name: string): void;
  onFindings?(report: DiagramFindings): void;
}

// A diagram's stage names its code links itself: only an animation's reads
// these.
const noTitles: Record<string, string> = {};

const noBlocks: StageHost["blocks"] = new Map();

/**
 * A diagram block's header, stage and step player, at its container's
 * width. Render it in an element with the `review-canvas-root` class.
 */
export function Diagram({
  block,
  theme = "light",
  onCode,
  onFindings,
}: DiagramProps) {
  // A stage keys what it reports by the block's id; a page's block may have
  // none.
  const node = useMemo(() => ({ ...block, id: block.id ?? "" }), [block]);

  // The page asserts its code: every name holds.
  const codeStatus = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(block.code).map((name) => [name, "checked" as const]),
      ),
    [block.code],
  );

  const host: StageHost = {
    theme,
    codeTitles: noTitles,
    codeStatus,
    blocks: noBlocks,
    renderBlocks: () => null,
    motion: undefined,
    painted: () => {},
    report: ({ error, findings = [], notes = [] }) =>
      onFindings?.({ findings, notes, ...(error && { error }) }),
    useChrome: (stage) => usePageChrome(stage, onCode),
  };

  return (
    <div
      {...withClass(
        `review-app review-app--theme-${theme}`,
        themeStyles.vars,
        themeStyles.app,
        themeClass(theme),
      )}
    >
      <Stage key={diagramRevision(block)} node={node} host={host} />
    </div>
  );
}

/** A page's surroundings: the figure stays inline, and a code link goes to
 * the page. */
function usePageChrome(
  { node }: StageChromeInput,
  onCode: DiagramProps["onCode"],
): StageChrome {
  const figureRef = useRef<HTMLElement | null>(null);

  return {
    figureRef,
    fullscreen: false,
    inlineWidth: 0,
    action: null,
    reveal: (name) => {
      if (Object.hasOwn(node.code, name)) onCode?.(name);
    },
    escape: () => {},
    frame: (figure) => figure,
  };
}
