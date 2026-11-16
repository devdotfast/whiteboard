// The page a hidden Desktop window loads to render one stage block for the
// agent that wrote it: the block alone on a board, as wide as a reader's
// column and as tall as it needs, so the capture never touches the window
// the user is working in.

import type {
  ReviewRenderedFrame,
  ReviewTheme,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { createRoot } from "react-dom/client";

import { renderStage } from "./animation/stage-renderer";
import { ReviewContainerProvider } from "./review-root-context";
import { type BoardSnapshot, boardView } from "./share/board-data";
import { staticPeeks } from "./share/peeks";
import { shareHost } from "./share/share-host";
import { shellStyles } from "./shell-styles";
import { themeStyles } from "./theme-styles";
import { Whiteboard, WhiteboardProvider } from "./whiteboard";

export interface ReviewRenderPageInput {
  /** The board's snapshot, holding only the block to render. */
  snapshot: BoardSnapshot;
  theme: ReviewTheme;
}

/** A frame shown on the page, with what its stage found drawn wrong and how
 * tall the page is, so the window can grow to hold all of it. */
export interface ReviewRenderPageFrame extends ReviewRenderedFrame {
  findings: string[];
  /** What the stage decided for the author, such as a graph it turned. */
  notes: string[];
  height: number;
}

export interface ReviewRenderPage {
  mount(input: ReviewRenderPageInput): Promise<{ height: number }>;
  show(targetId: string, frame: string): Promise<ReviewRenderPageFrame>;
}

/** How long the block may take to mount and run before a render gives up. */
const READY_WAIT = 15_000;

const figure = () => document.querySelector<HTMLElement>(".animation-block");

const pageHeight = () => Math.ceil(document.documentElement.scrollHeight);

async function until(done: () => boolean, what: string) {
  const deadline = Date.now() + READY_WAIT;

  while (!done()) {
    if (Date.now() > deadline) throw new Error(`The block did not ${what}.`);

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function reviewRenderPage(container: HTMLElement): ReviewRenderPage {
  let reviewId = "";

  return {
    async mount({ snapshot, theme }) {
      reviewId = snapshot.reviewId;
      container.classList.add("review-canvas-root");

      createRoot(container).render(
        <ReviewContainerProvider container={container}>
          <div {...stylex.props(themeStyles.vars, shellStyles.apiCanvas)}>
            <WhiteboardProvider
              data={boardView(snapshot)}
              host={shareHost({ theme, wasmUrl: "", peeks: staticPeeks })}
              settings={{}}
            >
              <Whiteboard />
            </WhiteboardProvider>
          </div>
        </ReviewContainerProvider>,
      );

      await until(() => figure() !== null, "appear on the page");

      return { height: pageHeight() };
    },
    async show(targetId, frame) {
      const shown = await renderStage(reviewId, targetId, frame);

      return {
        ...shown,
        findings: figure()?.dataset.findings?.split("\n") ?? [],
        notes: figure()?.dataset.notes?.split("\n") ?? [],
        height: pageHeight(),
      };
    },
  };
}
