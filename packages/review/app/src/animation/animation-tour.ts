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
 * An animation's tour: a stop per frame of the path being shown, in order,
 * or a clip's: a stop per marker. There is none unless some frame or marker
 * shows code that resolves. `anchorId` names each stop: `frameAnchorId`, or
 * `markerAnchorId` for a clip.
 */
export function animationTour(
  block: { id: string; title?: string },
  anchors: Anchors,
  path: readonly AnimationFrame[],
  anchorId: (blockId: string, key: string) => string = frameAnchorId,
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
