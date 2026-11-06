import type {
  GuidedTour,
  GuidedTourStop,
  ReviewPeekContent,
  SourcePeekAnchor,
} from "@canvas/review-panel-model";
import { animationCodeId } from "@dev.fast/whiteboard-document";

/** What a tour stop is drawn from: an animation's frame or a clip's marker. */
export interface AnimationFrame {
  key: string;
  title: string;
  caption?: string;
  code?: string[];
}

type Anchors = ReadonlyMap<string, SourcePeekAnchor>;

/** The tour stop, and panel anchor, a frame stands for. */
export const frameAnchorId = (blockId: string, frameKey: string) =>
  `${blockId}:frame:${frameKey}`;

/** The tour stop, and panel anchor, a clip's marker stands for. */
export const markerAnchorId = (blockId: string, markerKey: string) =>
  `${blockId}:marker:${markerKey}`;

/** Code the reader opened from the drawing, shown at the stop it was opened
 * on until they step away. */
export interface OpenedCode {
  stop: string;
  name: string;
}

/** The code a frame lists that resolves. */
function frameSources(
  blockId: string,
  anchors: Anchors,
  frame: AnimationFrame,
) {
  return (frame.code ?? []).flatMap((name) => {
    const anchor = anchors.get(animationCodeId(blockId, name));

    return anchor ? [anchor.peek] : [];
  });
}

/** What a frame's stop shows: its code, or its words. */
function frameContent(
  blockId: string,
  anchors: Anchors,
  frame: AnimationFrame,
): ReviewPeekContent {
  const [source, ...more] = frameSources(blockId, anchors, frame);

  return source
    ? { kind: "source", source, ...(more.length > 0 && { more }) }
    : { kind: "explanation", text: frame.caption ?? frame.title };
}

/**
 * An animation's tour: a stop per frame of the path being shown, in order,
 * or a clip's: a stop per marker. There is none unless some frame or marker
 * shows code that resolves. `anchorId` names each stop: `frameAnchorId`, or
 * `markerAnchorId` for a clip. The stop `opened` names shows that code alone,
 * whatever its frame lists.
 */
export function animationTour(
  block: { id: string; title?: string },
  anchors: Anchors,
  path: readonly AnimationFrame[],
  anchorId: (blockId: string, key: string) => string = frameAnchorId,
  opened?: OpenedCode | null,
): GuidedTour | null {
  if (!path.some((frame) => frameSources(block.id, anchors, frame).length))
    return null;

  return {
    id: block.id,
    title: block.title,
    stops: path.map((frame): GuidedTourStop => {
      const named =
        opened?.stop === frame.key
          ? anchors.get(animationCodeId(block.id, opened.name))
          : undefined;

      const content: ReviewPeekContent = named
        ? { kind: "source", source: named.peek }
        : frameContent(block.id, anchors, frame);

      return {
        anchor: {
          id: anchorId(block.id, frame.key),
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
