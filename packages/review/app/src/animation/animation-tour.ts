import type {
  GuidedTour,
  GuidedTourStop,
  ReviewPeekContent,
  SourcePeekAnchor,
} from "@canvas/review-panel-model";
import { type Block, animationCodeId } from "@dev.fast/whiteboard-document";

export type AnimationFrame = Extract<
  Block,
  { type: "animation" }
>["frames"][number];

type Anchors = ReadonlyMap<string, SourcePeekAnchor>;

/** The tour stop, and panel anchor, a frame stands for. */
export const frameAnchorId = (blockId: string, frameKey: string) =>
  `${blockId}:frame:${frameKey}`;

/** The code a frame lists that resolves, `lead` first when it resolves. */
function frameSources(
  blockId: string,
  anchors: Anchors,
  frame: AnimationFrame,
  lead?: string,
) {
  const names = lead
    ? [lead, ...(frame.code ?? []).filter((name) => name !== lead)]
    : (frame.code ?? []);

  return names.flatMap((name) => {
    const anchor = anchors.get(animationCodeId(blockId, name));

    return anchor ? [anchor.peek] : [];
  });
}

/** What a frame's stop shows: its code, `lead` first, or its words. */
export function frameContent(
  blockId: string,
  anchors: Anchors,
  frame: AnimationFrame,
  lead?: string,
): ReviewPeekContent {
  const [source, ...more] = frameSources(blockId, anchors, frame, lead);

  return source
    ? { kind: "source", source, ...(more.length > 0 && { more }) }
    : { kind: "explanation", text: frame.caption ?? frame.title };
}

/**
 * An animation's tour: a stop per frame of the path being shown, in order.
 * There is none unless some frame of the path shows code that resolves.
 */
export function animationTour(
  block: { id: string; title?: string },
  anchors: Anchors,
  path: readonly AnimationFrame[],
): GuidedTour | null {
  if (!path.some((frame) => frameSources(block.id, anchors, frame).length))
    return null;

  return {
    id: block.id,
    title: block.title,
    stops: path.map((frame): GuidedTourStop => {
      const content = frameContent(block.id, anchors, frame);

      return {
        anchor: {
          id: frameAnchorId(block.id, frame.key),
          title: frame.title,
          ...(frame.caption && { detail: frame.caption }),
          ...(content.kind === "source" && { peek: content.source }),
        },
        label: frame.title,
        ...(frame.caption && { detail: frame.caption }),
        content,
      };
    }),
  };
}
