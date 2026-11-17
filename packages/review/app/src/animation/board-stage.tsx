// The board around a stage: its theme, draw queue and reports to the server,
// and the tour, peeks and fullscreen a stage on the board opens.

import type { ApiDocumentData } from "@canvas/api-document";
import type { BlockProps } from "@canvas/blocks";
import { useReviewDebugSettings } from "@canvas/debug-settings";
import { diagramStyles } from "@canvas/diagram-styles";
import { DiagramTourOverlay, useDiagramTourShell } from "@canvas/diagram-tour";
import {
  useDrawQueueControls,
  useMotionPhase,
} from "@canvas/draw-queue-provider";
import { countLabel } from "@canvas/format";
import { useReviewSession } from "@canvas/host/review-session";
import { useReviewPanel, useReviewPanelStore } from "@canvas/review-panel";
import type { SourcePeekAnchor } from "@canvas/review-panel-model";
import { space } from "@canvas/scale.stylex";
import { shellStyles } from "@canvas/shell-styles";
import { withClass } from "@canvas/stylex-props";
import { themeClass, themeStyles } from "@canvas/theme-styles";
import { tokens } from "@canvas/tokens.stylex";
import { captureUiEvent } from "@canvas/ui-telemetry";
import { Button } from "@canvas/ui/button";
import { useTooltip } from "@canvas/ui/tooltip";
import { useDiagramSelection } from "@canvas/use-diagram-selection";
import { useWhiteboardSettings } from "@canvas/whiteboard-settings";
import { type Block, animationCodeId } from "@dev.fast/whiteboard-document";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  animationTour,
  frameAnchorId,
  frameContent,
  markerAnchorId,
} from "./animation-tour";
import { useReportAnimationRun } from "./report-run";
import {
  type StageChrome,
  type StageChromeInput,
  type StageHost,
  type StageNode,
  codeEntry,
} from "./stage-host";

/** A stage on the board, from the board's own state. */
export function useBoardStageHost({
  node,
  data,
  children,
}: BlockProps<"animation" | "clip" | "diagram">): StageHost {
  const { theme } = useReviewDebugSettings();
  const { painted } = useDrawQueueControls();

  const codeTitles = useMemo(
    () => codeTitlesOf(node, data.anchors),
    [node, data.anchors],
  );

  const codeStatus = useMemo(
    () => (node.type === "diagram" ? codeStatusOf(node, data.anchors) : {}),
    [node, data.anchors],
  );

  const blocks = useMemo(
    () => embeddableBlocks(data.snapshot.document),
    [data.snapshot.document],
  );

  return {
    theme,
    codeTitles,
    codeStatus,
    blocks,
    renderBlocks: children,
    // A block from the agent's stream paints its first frame in when the
    // board gets to it, and holds the draw queue until its stage says it is
    // done.
    motion: useMotionPhase(node.id),
    painted,
    report: useReportAnimationRun(data.snapshot.reviewId, node.id),
    reviewId: data.snapshot.reviewId,
    useChrome: (stage) => useBoardChrome(stage, data),
  };
}

/** Blocks a stage may show with whiteboard.block(): any but animations and
 * clips, which would nest stages. */
function embeddableBlocks(document: Block[]): Map<string, Block> {
  const found = new Map<string, Block>();

  const visit = (block: Block) => {
    if (
      block.id &&
      block.type !== "animation" &&
      block.type !== "clip" &&
      block.type !== "diagram"
    )
      found.set(block.id, block);

    if ("children" in block) block.children.forEach(visit);
  };

  document.forEach(visit);

  return found;
}

/** Whether each of a diagram's code names still holds: a range the board
 * marked stale, or could not resolve, has changed. */
function codeStatusOf(
  node: BlockProps<"diagram">["node"],
  anchors: ReadonlyMap<string, SourcePeekAnchor>,
): Record<string, "checked" | "changed"> {
  return Object.fromEntries(
    Object.keys(node.code).map((name) => [
      name,
      node.id && anchors.has(animationCodeId(node.id, name))
        ? "checked"
        : "changed",
    ]),
  );
}

/** What hovering a drawn element that opens code says: its label, file and
 * lines. */
function codeTitlesOf(
  node: StageNode,
  anchors: ReadonlyMap<string, SourcePeekAnchor>,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(node.code).flatMap((name) => {
      const anchor = anchors.get(animationCodeId(node.id, name));

      if (!anchor) return [];
      const { file, start, end } = anchor.peek;
      const label = codeEntry(node, name)?.label ?? name;

      const lines =
        start.line === end.line ? `${start.line}` : `${start.line}–${end.line}`;

      return [[name, `${label} · ${file.split("/").at(-1)}:${lines}`]];
    }),
  );
}

/** The tour, the code peeks beside the board, and fullscreen. */
function useBoardChrome(
  { node, player, noun, inlineWidth: measureInline }: StageChromeInput,
  data: ApiDocumentData,
): StageChrome {
  const { theme } = useReviewDebugSettings();
  const panelStore = useReviewPanelStore();
  const session = useReviewSession();
  const { diagramFullscreenOnClick } = useWhiteboardSettings();

  // Fullscreen without a tour. Either way, a placeholder holds the inline
  // figure's height so the document keeps its place.
  const [expanded, setExpanded] = useState(false);
  const [held, setHeld] = useState(0);

  // The stage's inline width, which it keeps fullscreen, scaled to the room.
  const [inlineWidth, setInlineWidth] = useState(0);

  const openRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const { stops, activeIndex } = player;
  const stop = stops[activeIndex];

  // A clip, or a diagram with a timeline: one played timeline with markers.
  const clip =
    node.type === "clip" ||
    (node.type === "diagram" && node.timeline !== undefined);

  const anchorId = clip ? markerAnchorId : frameAnchorId;

  // A stop per frame of the path showing, or per marker, when they show code.
  const tour = useMemo(
    () =>
      animationTour(
        { id: node.id, title: node.title },
        data.anchors,
        stops,
        anchorId,
      ),
    [node.id, node.title, data.anchors, stops, anchorId],
  );

  const frameAnchor = tour && stop ? anchorId(node.id, stop.key) : null;

  // Unlike a diagram's, the tour stays open on a stop it no longer has: a
  // scenario switch moves it to the frame showing instead.
  const overlay = useReviewPanel((state) =>
    tour && state.overlayTour?.tourId === node.id ? state.overlayTour : null,
  );

  const tourOpen = overlay !== null;

  // Set while the column shows this tour.
  const { anchor: inlineAnchor, figureRef } = useDiagramSelection(
    tour,
    tourOpen || expanded,
  );

  // What the figure leaves behind when it moves to the overlay: a placeholder
  // of its height, and the width its stage was laid out at.
  const holdInline = () => {
    setHeld(figureRef.current?.offsetHeight ?? 0);
    setInlineWidth(measureInline());
  };

  const openTour = () => {
    if (!tour || !frameAnchor) return;

    if (!tourOpen) {
      captureUiEvent(session, "tour_started", { steps: tour.stops.length });

      if (!expanded) holdInline();
    }

    setExpanded(false);
    panelStore
      .getState()
      .openOverlayTour({ tourId: node.id, kind: "animation" }, frameAnchor);
  };

  // A drawn element's code opens beside the board with the tour, at the
  // frame showing, or with the tour fullscreen.
  const reveal = (name: string) => {
    const anchor = data.anchors.get(animationCodeId(node.id, name));

    if (!anchor) return;
    captureUiEvent(session, "peek_opened", { via: "diagram" });
    const { openPeek, moveOverlayTour, active } = panelStore.getState();

    const tourStop = tour?.stops.find((item) => item.anchor.id === frameAnchor);

    if (!tour || !tourStop || !stop)
      return openPeek({
        kind: "peek",
        anchor,
        content: { kind: "source", source: anchor.peek },
      });

    if (tourOpen) return moveOverlayTour(tourStop.anchor.id, { reveal: true });

    if (expanded || diagramFullscreenOnClick) return openTour();

    openPeek({
      kind: "peek",
      anchor: tourStop.anchor,
      content: frameContent(node.id, data.anchors, stop, name),
      tour: {
        definition: tour,
        revealRequest: (active?.tour?.revealRequest ?? 0) + 1,
      },
    });
  };

  const { closeOverlayTour, moveOverlayTour } = panelStore.getState();
  const collapse = useCallback(() => setExpanded(false), []);
  const close = tourOpen ? closeOverlayTour : collapse;

  const { portalTarget } = useDiagramTourShell(tourOpen || expanded, close);

  const fullscreen = (tourOpen || expanded) && portalTarget !== null;

  // Focus follows the figure in and back out to the control that opened it.
  const wasFullscreen = useRef(false);

  useEffect(() => {
    if (fullscreen) closeRef.current?.focus();
    else if (wasFullscreen.current) openRef.current?.focus();

    wasFullscreen.current = fullscreen;
  }, [fullscreen]);

  // The tour's panel picked a stop (its Next, a click, its scroll): show
  // that frame, moving to it when it is the next one. A stop the tour no
  // longer has, after a scenario switch, gives way to the frame showing.
  const followPanel = useEffectEvent(() => {
    const anchor = panelStore.getState().overlayTour?.anchor;

    if (!tour || !frameAnchor || !anchor) return;
    const position = tour.stops.findIndex((item) => item.anchor.id === anchor);

    if (position < 0) moveOverlayTour(frameAnchor, { reveal: true });
    else if (position !== activeIndex) player.pick(position, "tour");
  });

  const overlayAnchor = overlay?.anchor;

  useEffect(() => {
    if (overlayAnchor) followPanel();
  }, [overlayAnchor, tour]);

  // The column's tour picked a stop (its Next, a click, its scroll): show
  // that frame, as the overlay's panel does.
  const followColumn = useEffectEvent(() => {
    if (!tour || fullscreen || !inlineAnchor) return;

    const position = tour.stops.findIndex(
      (item) => item.anchor.id === inlineAnchor,
    );

    if (position >= 0 && position !== activeIndex)
      player.pick(position, "tour");
  });

  useEffect(() => {
    if (inlineAnchor) followColumn();
  }, [inlineAnchor, tour]);

  // The frame changed some other way (the controls, playback, the stage, a
  // scenario): the open tour follows it, fullscreen or in the column. Each
  // side writes only what differs, so neither echoes the other.
  const followFrame = useEffectEvent(() => {
    const { overlayTour, active, openPeek } = panelStore.getState();

    if (!tour || !frameAnchor) return;

    if (overlayTour?.tourId === node.id) {
      if (overlayTour.anchor !== frameAnchor)
        moveOverlayTour(frameAnchor, { reveal: true });

      return;
    }

    const tourStop = tour.stops.find((item) => item.anchor.id === frameAnchor);

    if (
      !inlineAnchor ||
      fullscreen ||
      !tourStop ||
      (active?.anchor?.id === frameAnchor && active.tour?.definition === tour)
    )
      return;
    openPeek({
      kind: "peek",
      anchor: tourStop.anchor,
      content: tourStop.content,
      tour: {
        definition: tour,
        revealRequest: (active?.tour?.revealRequest ?? 0) + 1,
      },
    });
  });

  // Not on mount: a restored tour's stop leads the frame there.
  const followed = useRef({ frameAnchor, tour });

  useEffect(() => {
    if (
      followed.current.frameAnchor === frameAnchor &&
      followed.current.tour === tour
    )
      return;
    followed.current = { frameAnchor, tour };
    followFrame();
  }, [frameAnchor, tour]);

  const action = fullscreen ? (
    <Button
      ref={closeRef}
      xstyle={diagramStyles.button}
      aria-label={tourOpen ? "Close tour" : `Close expanded ${noun}`}
      onClick={close}
    >
      Close
    </Button>
  ) : tour ? (
    <TourButton
      buttonRef={openRef}
      stops={tour.stops.length}
      onClick={openTour}
    />
  ) : (
    <Button
      ref={openRef}
      xstyle={diagramStyles.button}
      aria-label={`Expand ${noun}`}
      onClick={() => {
        holdInline();
        setExpanded(true);
      }}
    >
      Expand
    </Button>
  );

  const frame = (figure: ReactElement) => {
    if (!fullscreen) return figure;

    const placeholder = <div aria-hidden="true" style={{ height: held }} />;

    if (tour && overlay)
      return (
        <>
          {placeholder}
          {createPortal(
            <DiagramTourOverlay
              tour={tour}
              activeAnchor={overlay.anchor}
              revealRequest={overlay.revealRequest}
              onActiveAnchorChange={moveOverlayTour}
              onClose={closeOverlayTour}
            >
              {figure}
            </DiagramTourOverlay>,
            portalTarget,
          )}
        </>
      );

    // Portaled outside .review-app, so it carries the theme itself, as the
    // diagram tour overlay does.
    return (
      <>
        {placeholder}
        {createPortal(
          <div
            {...withClass(
              `review-app--theme-${theme}`,
              themeStyles.vars,
              themeClass(theme),
              styles.overlay,
              shellStyles.clearsWindowControls,
            )}
            role="dialog"
            aria-modal="true"
            aria-label={node.title}
          >
            {figure}
          </div>,
          portalTarget,
        )}
      </>
    );
  };

  return {
    figureRef,
    fullscreen,
    inlineWidth,
    action,
    reveal,
    escape: () => {
      if (fullscreen) close();
    },
    frame,
  };
}

/** Opens the tour; its tooltip counts the stops. */
function TourButton({
  buttonRef,
  stops,
  onClick,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  stops: number;
  onClick(): void;
}) {
  const tooltip = useTooltip(countLabel(stops, "stop"), { quick: true });

  const ref = useCallback(
    (button: HTMLButtonElement | null) => {
      buttonRef.current = button;

      return tooltip(button);
    },
    [buttonRef, tooltip],
  );

  return (
    <Button
      ref={ref}
      className="diagram-tour-button"
      xstyle={diagramStyles.button}
      data-tour-target="diagram-tour"
      onClick={onClick}
    >
      Tour
    </Button>
  );
}

const narrow = "@media (max-width: 720px)";

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: tokens.reviewDebugLayer,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    padding: { default: space.s24, [narrow]: space.s8 },
    backgroundColor: tokens.bg,
  },
});
