// How an agent sees a frame it wrote: Desktop asks the block showing it to
// jump there and come to rest, then captures the figure's place in the
// window. Each stage block on a board registers here while it is mounted.

import type { ReviewRenderedFrame } from "@dev.fast/review-protocol";

export interface StageRenderer {
  /** Shows the stop `key` (a frame, or a clip's marker) at rest, scrolled
   * into view, and reports where the figure is. */
  show(key: string): Promise<ReviewRenderedFrame>;
}

const renderers = new Map<string, StageRenderer>();

const rendererKey = (reviewId: string, blockId: string) =>
  `${reviewId}\n${blockId}`;

export function registerStageRenderer(
  reviewId: string,
  blockId: string,
  renderer: StageRenderer,
): () => void {
  const key = rendererKey(reviewId, blockId);
  renderers.set(key, renderer);

  return () => {
    if (renderers.get(key) === renderer) renderers.delete(key);
  };
}

/** Shows `frame` of the block and reports where to capture it. Rejects when
 * the board showing has no animation, clip or diagram with that id. */
export function renderStage(
  reviewId: string,
  blockId: string,
  frame: string,
): Promise<ReviewRenderedFrame> {
  const renderer = renderers.get(rendererKey(reviewId, blockId));

  if (!renderer)
    return Promise.reject(
      new Error(
        `${blockId} is not an animation, clip or diagram on the board showing.`,
      ),
    );

  return renderer.show(frame);
}
