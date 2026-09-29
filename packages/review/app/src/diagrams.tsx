import type { Step } from "@review/review-api/document";
import * as stylex from "@stylexjs/stylex";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeMouseHandler,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge as ReactFlowEdge,
  type EdgeProps as ReactFlowEdgeProps,
  type Node as ReactFlowNode,
  type NodeProps as ReactFlowNodeProps,
  getStraightPath,
} from "@xyflow/react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useReviewDebugSettings } from "./debug-settings";
import { DiagramHeader } from "./diagram-header";
import { diagramStyles } from "./diagram-styles";
import { hasTextSelectionWithin } from "./diagram-text-selection";
import { DiagramTourOverlay, useDiagramTourShell } from "./diagram-tour";
import { useMotionPhase } from "./draw-queue-provider";
import { drawStyles } from "./draw-styles";
import { useReviewSession } from "./host/review-session";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import type { GuidedTour, PeekAnchor } from "./review-panel-model";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { captureUiEvent } from "./ui-telemetry";

type SequenceParticipantNodeData = {
  participant: SequenceParticipant;
  height: number;
  messages: SequenceMessage[];
  messageGap: number;
  messageTop: number;
};

type SequenceParticipantFlowNode = ReactFlowNode<
  SequenceParticipantNodeData,
  "sequenceParticipant"
>;

type SequenceMessageEdgeData = {
  message: SequenceMessage;
  index: number;
  width: number;
  active: boolean;
  openTour: (anchor?: string) => void;
  stepNumber: number | null;
};

type SequenceMessageFlowEdge = ReactFlowEdge<
  SequenceMessageEdgeData,
  "sequenceMessage"
>;

const sequenceNodeTypes = { sequenceParticipant: SequenceParticipantNode };

const sequenceEdgeTypes = { sequenceMessage: SequenceMessageEdge };

export function sequenceMessageColor(isActive: boolean): string {
  return isActive ? "var(--accent)" : "var(--edge-muted)";
}

/** The canonical `sequence` block as the document stores it. */
export interface SequenceDiagramProps {
  id: string;
  title: string;
  actors: Record<string, string>;
  steps: readonly Step[];
}

export interface SequenceParticipant {
  id: string;
  label: string;
}

export interface SequenceMessage {
  id: string;
  from: SequenceParticipant;
  to: SequenceParticipant;
  label: string;
  style: Step["style"];
  source?: Step["source"];
  code?: Step["code"];
  explanation?: string;
}

export interface SequenceView {
  id: string;
  title: string;
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
}

/** Pure layout input: participants in lane order and one message per step.
 * Actor names are the participant ids; nothing here reaches back into the
 * authoring runtime. */
export function sequenceView(block: SequenceDiagramProps): SequenceView {
  const participant = (name: string): SequenceParticipant => ({
    id: name,
    label: block.actors[name] ?? name,
  });

  const messages = block.steps.map((step, index): SequenceMessage => {
    const message: SequenceMessage = {
      id: step.id ?? `${block.id}-step-${index + 1}`,
      from: participant(step.from),
      to: participant(step.to),
      label: step.label,
      style: step.style,
    };

    if (step.source) message.source = step.source;

    if (step.code) message.code = step.code;

    if (step.explanation !== undefined) message.explanation = step.explanation;

    return message;
  });

  return {
    id: block.id,
    title: block.title,
    participants: participantsForMessages(messages),
    messages,
  };
}

/** The side panel and guided tour key their state by anchor; a message is
 * its own anchor. */
function panelAnchor(message: SequenceMessage): PeekAnchor {
  const anchor: PeekAnchor = {
    id: message.id,
    title: message.label,
  };

  if (message.source) anchor.peek = message.source;

  return anchor;
}

export function createSequenceTourEntry(sequence: SequenceView): GuidedTour {
  return {
    id: sequence.id,
    title: sequence.title,
    telemetryKind: "sequence" as const,
    stops: sequence.messages.map((message) => ({
      anchor: panelAnchor(message),
      label: message.label,
      detail: `${message.from.label} -> ${message.to.label}`,
      content: message.code
        ? { kind: "inline-code" as const, ...message.code }
        : message.source
          ? { kind: "source" as const, source: message.source }
          : { kind: "explanation" as const, text: message.explanation },
    })),
  };
}

function participantsForMessages(
  messages: SequenceMessage[],
): SequenceParticipant[] {
  const participants = new Map<
    string,
    { actor: SequenceParticipant; order: number }
  >();

  const outgoing = new Map<string, Set<string>>();
  const incomingCount = new Map<string, number>();

  for (const message of messages) {
    if (!participants.has(message.from.id)) {
      participants.set(message.from.id, {
        actor: message.from,
        order: participants.size,
      });
      incomingCount.set(message.from.id, 0);
    }

    if (!participants.has(message.to.id)) {
      participants.set(message.to.id, {
        actor: message.to,
        order: participants.size,
      });
      incomingCount.set(message.to.id, 0);
    }

    if (message.from.id === message.to.id) continue;
    const targets = outgoing.get(message.from.id) ?? new Set<string>();

    if (!targets.has(message.to.id)) {
      targets.add(message.to.id);
      outgoing.set(message.from.id, targets);
      incomingCount.set(
        message.to.id,
        (incomingCount.get(message.to.id) ?? 0) + 1,
      );
    }
  }

  const byFirstSeen = (left: string, right: string) =>
    (participants.get(left)?.order ?? 0) -
    (participants.get(right)?.order ?? 0);

  const ready = [...participants.keys()]
    .filter((id) => (incomingCount.get(id) ?? 0) === 0)
    .sort(byFirstSeen);

  const ordered: SequenceParticipant[] = [];
  const consumed = new Set<string>();

  while (ready.length > 0) {
    const id = ready.shift()!;

    if (consumed.has(id)) continue;
    consumed.add(id);
    const actor = participants.get(id)?.actor;

    if (actor) ordered.push(actor);

    for (const target of outgoing.get(id) ?? []) {
      incomingCount.set(target, (incomingCount.get(target) ?? 0) - 1);

      if ((incomingCount.get(target) ?? 0) === 0) {
        ready.push(target);
        ready.sort(byFirstSeen);
      }
    }
  }

  for (const [id, participant] of [...participants.entries()].sort(
    (left, right) => left[1].order - right[1].order,
  )) {
    if (!consumed.has(id)) ordered.push(participant.actor);
  }

  return ordered;
}

export function SequenceDiagram(block: SequenceDiagramProps) {
  const { id, title, actors, steps } = block;

  // Memoize on the block's fields, not the props object: a live JSON snapshot
  // keeps its node references stable, so the tour and layout memos survive
  // re-renders and edits elsewhere in the document.
  const sequence = useMemo(
    () => sequenceView({ id, title, actors, steps }),
    [id, title, actors, steps],
  );

  const session = useReviewSession();
  const { theme } = useReviewDebugSettings();
  const tour = useMemo(() => createSequenceTourEntry(sequence), [sequence]);

  // The tour IS the fullscreen mode: the inline figure becomes the stage
  // and the standard GuidedTourPanel docks beside it. A stored anchor this
  // tour no longer has leaves it closed.
  const panelStore = useReviewPanelStore();

  const tourState = useReviewPanel((state) =>
    state.overlayTour?.tourId === tour.id &&
    tour.stops.some((stop) => stop.anchor.id === state.overlayTour!.anchor)
      ? state.overlayTour
      : null,
  );

  const tourAnchor = tourState?.anchor ?? null;
  const tourOpen = tourState !== null;

  const openTour = useCallback(
    (anchor?: string) => {
      if (anchor) {
        captureUiEvent(session, "peek_opened", { via: "diagram" });
      }

      const nextAnchor = anchor ?? tourAnchor ?? tour.stops[0]?.anchor.id;

      if (!nextAnchor) return;

      if (!tourOpen) {
        captureUiEvent(session, "tour_started", { steps: tour.stops.length });
      }

      panelStore
        .getState()
        .openOverlayTour({ tourId: tour.id, kind: "sequence" }, nextAnchor);
    },
    [panelStore, session, tour, tourAnchor, tourOpen],
  );

  const { closeOverlayTour: closeTour, moveOverlayTour: changeTourAnchor } =
    panelStore.getState();

  const {
    overlayRef,
    portalTarget,
    paneResize: tourPaneResize,
  } = useDiagramTourShell(tourOpen, closeTour);

  return (
    <>
      <SequenceDiagramFigure
        sequence={sequence}
        theme={theme}
        stopCount={tour.stops.length}
        openTour={openTour}
        activeTourAnchor={null}
      />
      {tourOpen && portalTarget
        ? createPortal(
            <DiagramTourOverlay
              tour={tour}
              activeAnchor={tourState.anchor}
              revealRequest={tourState.revealRequest}
              paneWidth={tourPaneResize.width}
              separatorProps={tourPaneResize.separatorProps}
              overlayRef={overlayRef}
              onActiveAnchorChange={changeTourAnchor}
              onClose={closeTour}
            >
              <SequenceDiagramFigure
                sequence={sequence}
                theme={theme}
                stopCount={tour.stops.length}
                openTour={openTour}
                activeTourAnchor={tourAnchor}
                onCloseTour={closeTour}
              />
            </DiagramTourOverlay>,
            portalTarget,
          )
        : null}
    </>
  );
}

function SequenceDiagramFigure({
  sequence,
  theme,
  stopCount,
  openTour,
  activeTourAnchor,
  onCloseTour,
}: {
  sequence: SequenceView;
  theme: ReturnType<typeof useReviewDebugSettings>["theme"];
  stopCount: number;
  openTour: (anchor?: string) => void;
  activeTourAnchor: string | null;
  /** Present when the figure is the fullscreen tour stage: the header swaps
   * its Tour button for a close control and message dots show stop numbers. */
  onCloseTour?: () => void;
}) {
  const stage = onCloseTour !== undefined;
  const sequenceScrollRef = useRef<HTMLDivElement | null>(null);
  const panelMotion = useReviewPanel((state) => state.motion);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const scroll = sequenceScrollRef.current;

    if (!scroll) return;
    const update = () => setAvailableWidth(scroll.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroll);

    return () => observer.disconnect();
  }, []);

  // Lanes spread across the full diagram width; 176px is the floor below which
  // the body scrolls horizontally instead of compressing further.
  const laneWidth = Math.max(
    176,
    Math.floor(availableWidth / Math.max(1, sequence.participants.length)),
  );

  const messageTop = 112;
  const messageGap = 76;
  const width = Math.max(320, sequence.participants.length * laneWidth);
  const height = messageTop + sequence.messages.length * messageGap + 42;

  const reactFlowNodes: SequenceParticipantFlowNode[] = useMemo(
    () =>
      sequence.participants.map((participant, index) => ({
        id: participant.id,
        type: "sequenceParticipant",
        position: { x: index * laneWidth, y: 0 },
        // A width stamped inline goes stale when the lane is measured
        // before the container settles, so the lane reads the live variable;
        // initialWidth only sizes it until React Flow first measures it.
        initialWidth: laneWidth,
        height,
        // The lane spans the whole diagram over the message arrows; left
        // interactive it would steal their hover. Its label keeps its own
        // pointer events.
        style: {
          width: "var(--sequence-lane-width, 176px)",
          pointerEvents: "none",
        },
        className: stylex.props(styles.lane).className,
        data: {
          participant,
          height,
          messages: sequence.messages,
          messageGap,
          messageTop,
        },
        draggable: false,
        selectable: false,
      })),
    [height, laneWidth, sequence],
  );

  const reactFlowEdges: SequenceMessageFlowEdge[] = useMemo(
    () =>
      sequence.messages.map((message, index) => {
        const isActive = activeTourAnchor === message.id;
        const color = sequenceMessageColor(isActive);

        return {
          id: message.id,
          type: "sequenceMessage",
          source: message.from.id,
          target: message.to.id,
          sourceHandle: sequenceHandleId(message.id, "source"),
          targetHandle: sequenceHandleId(message.id, "target"),
          markerEnd: {
            type:
              message.style === "async"
                ? MarkerType.Arrow
                : MarkerType.ArrowClosed,
            color,
          },
          style: {
            stroke: color,
            strokeDasharray: message.style === "return" ? "6 4" : undefined,
          },
          data: {
            message,
            index,
            width,
            active: isActive,
            openTour,
            stepNumber: onCloseTour ? index + 1 : null,
          },
          className: stylex.props(
            styles.message,
            isActive && styles.messageActive,
          ).className,
          zIndex: isActive ? 2 : 1,
        };
      }),
    [activeTourAnchor, onCloseTour, openTour, sequence, width],
  );

  const onEdgeClick: EdgeMouseHandler<SequenceMessageFlowEdge> = (
    event,
    edge,
  ) => {
    event.stopPropagation();

    if (edge.data) openTour(edge.data.message.id);
  };

  const scrollSequenceHorizontally = useCallback((event: WheelEvent) => {
    const scroll = event.currentTarget;

    if (
      !(scroll instanceof HTMLElement) ||
      !scrollDiagramHorizontally(scroll, event)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    const scroll = sequenceScrollRef.current;

    if (!scroll) return;
    scroll.addEventListener("wheel", scrollSequenceHorizontally, {
      capture: true,
      passive: false,
    });

    return () =>
      scroll.removeEventListener("wheel", scrollSequenceHorizontally, {
        capture: true,
      });
  }, [scrollSequenceHorizontally]);
  useEffect(() => {
    const scroll = sequenceScrollRef.current;

    if (!scroll || !activeTourAnchor) return;

    const nextScrollLeft = sequenceActiveMessageScrollTarget({
      sequence,
      activeAnchor: activeTourAnchor,
      laneWidth,
      viewportWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      currentScrollLeft: scroll.scrollLeft,
    });

    const nextScrollTop = sequenceActiveMessageScrollTopTarget({
      sequence,
      activeAnchor: activeTourAnchor,
      messageTop,
      messageGap,
      viewportHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
      currentScrollTop: scroll.scrollTop,
    });

    const left =
      nextScrollLeft !== null &&
      Math.abs(nextScrollLeft - scroll.scrollLeft) >= 1
        ? nextScrollLeft
        : undefined;

    const top =
      nextScrollTop !== null && Math.abs(nextScrollTop - scroll.scrollTop) >= 1
        ? nextScrollTop
        : undefined;

    if (left === undefined && top === undefined) return;
    scroll.scrollTo({
      left,
      top,
      behavior: panelMotion === "restored" ? "auto" : "smooth",
    });
  }, [activeTourAnchor, laneWidth, panelMotion, sequence]);

  // SAFETY: the `--sequence-*` keys are CSS custom properties, which React
  // forwards to style.setProperty; the CSSProperties typings only omit custom
  // names.
  const style = {
    "--sequence-width": `${width}px`,
    "--sequence-height": `${height}px`,
    "--sequence-lane-width": `${laneWidth}px`,
  } as CSSProperties;

  return (
    <>
      <figure
        {...withClass(
          "sequence-diagram",
          styles.figure,
          stage && styles.stage,
          Boolean(activeTourAnchor) &&
            (stage ? styles.stageActive : styles.active),
          drawStyles.blockChild,
        )}
        style={style}
        tabIndex={-1}
        data-sequence-tour-id={sequence.id}
      >
        <DiagramHeader
          kind="SEQ"
          title={sequence.title}
          meta={`${stopCount} ${stopCount === 1 ? "stop" : "stops"}`}
          xstyle={styles.header}
          action={
            // The tour panel's header owns the close control fullscreen.
            onCloseTour ? null : (
              <button
                type="button"
                {...withClass("diagram-tour-button", diagramStyles.control)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openTour();
                }}
              >
                Tour
              </button>
            )
          }
        />
        <div
          ref={sequenceScrollRef}
          {...stylex.props(styles.body)}
          onClick={() => openTour()}
        >
          <ReactFlow
            {...stylex.props(styles.canvas)}
            colorMode={theme}
            nodes={reactFlowNodes}
            edges={reactFlowEdges}
            nodeTypes={sequenceNodeTypes}
            edgeTypes={sequenceEdgeTypes}
            onEdgeClick={onEdgeClick}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panActivationKeyCode={null}
            panOnDrag={false}
            preventScrolling={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
          />
        </div>
      </figure>
    </>
  );
}

function SequenceParticipantNode({
  data,
}: ReactFlowNodeProps<SequenceParticipantFlowNode>) {
  const { participant, height, messages, messageGap, messageTop } = data;

  const activeMessages = messages.filter(
    (message) =>
      message.from.id === participant.id || message.to.id === participant.id,
  );

  return (
    <div {...stylex.props(styles.participant)} style={{ height }}>
      <div {...stylex.props(styles.participantLabelAnchor)}>
        <span
          {...stylex.props(styles.participantLabel)}
          title={participant.label}
        >
          {participant.label}
        </span>
      </div>
      <div {...stylex.props(styles.lifeline)} />
      {activeMessages.flatMap((message, index) => {
        const messageIndex = messages.findIndex(
          (item) => item.id === message.id,
        );

        const top = messageTop + messageIndex * messageGap;
        const isSelfLoop = message.from.id === message.to.id;

        const handles: Array<{
          id: string;
          type: "source" | "target";
          side: Position.Left | Position.Right;
        }> = [];

        if (message.from.id === participant.id) {
          handles.push({
            id: sequenceHandleId(message.id, "source"),
            type: "source",
            side: isSelfLoop ? Position.Right : Position.Right,
          });
        }

        if (message.to.id === participant.id) {
          handles.push({
            id: sequenceHandleId(message.id, "target"),
            type: "target",
            side: isSelfLoop ? Position.Right : Position.Left,
          });
        }

        return handles.map((handle) => (
          <Handle
            key={`${message.id}-${handle.type}-${index}`}
            id={handle.id}
            type={handle.type}
            position={handle.side}
            {...stylex.props(styles.handle)}
            style={{
              left: "50%",
              top: sequenceMessageHandleTop(message, handle.type, top),
            }}
          />
        ));
      })}
    </div>
  );
}

export function sequenceMessageHandleTop(
  message: { from: { id: string }; to: { id: string } },
  handleType: "source" | "target",
  messageTop: number,
): number {
  return message.from.id === message.to.id && handleType === "target"
    ? messageTop + 24
    : messageTop;
}

export function sequenceSelfMessagePath(input: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  width: number;
}): string {
  const loopDirection = input.sourceX + 72 > input.width ? -1 : 1;
  const loopX = input.sourceX + loopDirection * 54;

  return `M ${input.sourceX} ${input.sourceY} H ${loopX} V ${input.targetY} H ${input.targetX}`;
}

function SequenceMessageEdge(
  props: ReactFlowEdgeProps<SequenceMessageFlowEdge>,
) {
  const data = props.data;

  if (!data) return null;
  const isSelfLoop = props.source === props.target;
  const loopDirection = props.sourceX + 72 > data.width ? -1 : 1;
  const loopX = props.sourceX + loopDirection * 54;

  const edgePath = isSelfLoop
    ? sequenceSelfMessagePath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetX: props.targetX,
        targetY: props.targetY,
        width: data.width,
      })
    : getStraightPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetX: props.targetX,
        targetY: props.targetY,
      })[0];

  const labelX = isSelfLoop
    ? (props.sourceX + loopX) / 2
    : (props.sourceX + props.targetX) / 2;

  const labelY = props.sourceY - 12;

  const stepMotion = useMotionPhase(data.message.id);
  const stage = data.stepNumber !== null;

  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        // The arrowhead is the last stroke: it appears once the line has run.
        markerEnd={
          stepMotion === "outline" || stepMotion === "stroke"
            ? undefined
            : props.markerEnd
        }
        // The class is a marker for tests. The stroke color is the edge's
        // inline style, so it holds while the line is drawn.
        className={
          withClass(
            "sequence-message",
            styles.message,
            data.active && styles.messageActive,
            (stepMotion === "outline" || stepMotion === "stroke") &&
              styles.messageDrawing,
            stepMotion === "queued" && drawStyles.hidden,
            stepMotion === "stroke" && drawStyles.traceQuick,
            stepMotion === "outline" && drawStyles.traceLine,
          ).className
        }
        style={props.style}
        pathLength={1}
        data-motion={stepMotion}
      />
      <path
        d={edgePath}
        {...stylex.props(styles.hitArea)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          data.openTour(data.message.id);
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          {...stylex.props(
            styles.dot,
            data.active && styles.dotActive,
            stage && styles.stopBadge,
            stage && data.active && styles.stopBadgeActive,
            stepMotion === "attention" && styles.dotAttention,
            stepMotion === "queued" && drawStyles.hidden,
            stepMotion === "fill" && drawStyles.stepPop,
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${props.sourceX}px,${props.sourceY}px)`,
          }}
          data-review-anchor-id={data.message.id}
          data-motion={stepMotion}
          onClick={(event) => {
            event.stopPropagation();
            data.openTour(data.message.id);
          }}
          aria-label={data.message.label}
        >
          {data.stepNumber}
        </button>
        <div
          {...stylex.props(
            styles.labelAnchor,
            stepMotion === "queued" && drawStyles.hidden,
            (stepMotion === "outline" || stepMotion === "stroke") &&
              drawStyles.labelStep,
          )}
          data-motion={stepMotion}
          style={{
            transform: `translate(-50%, -100%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          <span
            role="button"
            tabIndex={0}
            {...stylex.props(styles.label, data.active && styles.labelActive)}
            data-review-anchor-id={data.message.id}
            onClick={(event) => {
              event.stopPropagation();

              if (hasTextSelectionWithin(event.currentTarget)) return;
              data.openTour(data.message.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              data.openTour(data.message.id);
            }}
          >
            {data.message.label}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

interface HorizontalScrollEvent {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
}

interface SequenceActiveMessageScrollInput {
  sequence: SequenceView;
  activeAnchor: string | null;
  laneWidth: number;
  viewportWidth: number;
  scrollWidth: number;
  currentScrollLeft: number;
  padding?: number;
}

function scrollDiagramHorizontally(
  scroll: HTMLElement,
  event: HorizontalScrollEvent,
) {
  const delta =
    event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;

  if (delta === 0 || scroll.scrollWidth <= scroll.clientWidth) return false;

  const nextLeft = Math.min(
    Math.max(scroll.scrollLeft + delta, 0),
    scroll.scrollWidth - scroll.clientWidth,
  );

  if (nextLeft === scroll.scrollLeft) return false;
  scroll.scrollLeft = nextLeft;

  return true;
}

export function sequenceActiveMessageScrollTarget({
  sequence,
  activeAnchor,
  laneWidth,
  viewportWidth,
  scrollWidth,
  currentScrollLeft,
  padding = 24,
}: SequenceActiveMessageScrollInput) {
  const maxScrollLeft = scrollWidth - viewportWidth;

  if (!activeAnchor || maxScrollLeft <= 0 || viewportWidth <= 0) return null;

  const activeMessage = sequence.messages.find(
    (message) => message.id === activeAnchor,
  );

  if (!activeMessage) return null;

  const fromIndex = sequence.participants.findIndex(
    (participant) => participant.id === activeMessage.from.id,
  );

  const toIndex = sequence.participants.findIndex(
    (participant) => participant.id === activeMessage.to.id,
  );

  if (fromIndex < 0 || toIndex < 0) return null;

  const leftLane = Math.min(fromIndex, toIndex);
  const rightLane = Math.max(fromIndex, toIndex);
  const targetLeft = Math.max(0, leftLane * laneWidth - padding);

  const targetRight = Math.min(
    scrollWidth,
    (rightLane + 1) * laneWidth + padding,
  );

  const visibleLeft = currentScrollLeft;
  const visibleRight = currentScrollLeft + viewportWidth;

  const clampScrollLeft = (left: number) =>
    Math.min(Math.max(left, 0), maxScrollLeft);

  if (targetLeft >= visibleLeft && targetRight <= visibleRight) {
    return currentScrollLeft;
  }

  if (targetRight - targetLeft > viewportWidth) {
    return clampScrollLeft(targetLeft);
  }

  if (targetLeft < visibleLeft) {
    return clampScrollLeft(targetLeft);
  }

  return clampScrollLeft(targetRight - viewportWidth);
}

interface SequenceActiveMessageScrollTopInput {
  sequence: SequenceView;
  activeAnchor: string | null;
  messageTop: number;
  messageGap: number;
  viewportHeight: number;
  scrollHeight: number;
  currentScrollTop: number;
  padding?: number;
}

// Vertical counterpart of sequenceActiveMessageScrollTarget: long diagrams
// scroll inside a viewport-capped body, so stepping the tour must also bring
// the active message's row into view. Row y derives from the same layout
// constants that position the message edges.
export function sequenceActiveMessageScrollTopTarget({
  sequence,
  activeAnchor,
  messageTop,
  messageGap,
  viewportHeight,
  scrollHeight,
  currentScrollTop,
  padding = 24,
}: SequenceActiveMessageScrollTopInput) {
  const maxScrollTop = scrollHeight - viewportHeight;

  if (!activeAnchor || maxScrollTop <= 0 || viewportHeight <= 0) return null;

  const messageIndex = sequence.messages.findIndex(
    (message) => message.id === activeAnchor,
  );

  if (messageIndex < 0) return null;

  const rowTop = messageTop + messageIndex * messageGap;
  const targetTop = Math.max(0, rowTop - padding);
  const targetBottom = Math.min(scrollHeight, rowTop + messageGap + padding);
  const visibleTop = currentScrollTop;
  const visibleBottom = currentScrollTop + viewportHeight;

  const clampScrollTop = (top: number) =>
    Math.min(Math.max(top, 0), maxScrollTop);

  if (targetTop >= visibleTop && targetBottom <= visibleBottom) {
    return currentScrollTop;
  }

  if (targetBottom - targetTop > viewportHeight) {
    return clampScrollTop(targetTop);
  }

  if (targetTop < visibleTop) {
    return clampScrollTop(targetTop);
  }

  return clampScrollTop(targetBottom - viewportHeight);
}

function sequenceHandleId(
  messageId: string,
  handleType: "source" | "target",
): string {
  return `${handleType}-${messageId}`;
}

const inDocument = ":is(.review-document *)";

// Where the theme defines --diagram-border (a .review-app inside the canvas
// scope).
// (:scope is the canvas root, so an app portaled out of it does not count.)
const inApp = ":is(:scope .review-app *)";

const labelHover = `0 0 0 2px ${tokens.accentShadow}, 0 6px 14px ${tokens.shadowColorStrong}`;

const styles = stylex.create({
  // Inline, a sequence reads as part of the prose: the text column's measure,
  // lanes spreading to fill it. The fullscreen tour is the escape hatch.
  figure: {
    position: "relative",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    width: {
      default: "100%",
      "@media (max-width: 720px)": {
        default: "100%",
        [inDocument]: "calc(100cqi - 16px)",
      },
    },
    minWidth: 0,
    maxWidth: {
      default: "100%",
      [inDocument]: `min(${tokens.reviewProseMaxWidth}, calc(100cqi - ${tokens.reviewDocumentPaddingInline} - ${tokens.reviewDocumentPaddingInline}))`,
    },
    // Natural height; the document scrolls, not the diagram. The body
    // scrolls only past about forty steps.
    height: "auto",
    minHeight: `min(${tokens.sequenceHeight}, 260px)`,
    maxHeight: "3200px",
    marginBlock: "24px",
    marginInline: { default: 0, [inDocument]: "auto" },
    paddingTop: 0,
    overflow: "hidden",
    // Without --diagram-border the border drops out whole, as the shorthand
    // it replaces did.
    borderWidth: { default: null, [inApp]: "1px" },
    borderStyle: { default: null, [inApp]: "solid" },
    borderColor: { default: null, [inApp]: tokens.diagramBorder },
    borderRadius: "6px",
    backgroundColor: tokens.diagramSurface,
    boxShadow: "none",
    cursor: "pointer",
  },
  active: {
    borderColor: tokens.selection,
    boxShadow: `0 0 0 2px ${tokens.selectionShadow}`,
  },
  // The tour stage: the figure fills the overlay without its card chrome.
  stage: {
    width: "100%",
    maxWidth: "none",
    height: "100%",
    minHeight: 0,
    marginBlock: 0,
    marginInline: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: 0,
    boxShadow: "none",
  },
  stageActive: {
    borderColor: tokens.selection,
  },
  header: {
    justifyContent: "space-between",
    fontSize: "12px",
    fontWeight: 700,
  },
  // No overscroll-behavior: Chrome latches wheel gestures to the nearest
  // scroll container even when it has nothing to scroll, and `contain` would
  // stop them chaining up to the document scroller.
  body: {
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
  },
  // React Flow sizes its root inline at 100%; the min pair keeps the canvas
  // at its natural size so the body scrolls to the clipped remainder.
  canvas: {
    minWidth: tokens.sequenceWidth,
    minHeight: tokens.sequenceHeight,
    backgroundColor: tokens.diagramCanvasBg,
  },
  // Its text reads like the prose around it.
  lane: {
    userSelect: "text",
  },
  participant: {
    position: "relative",
    width: "100%",
  },
  // The chip sizes to the name, capped at the lane: a long label uses the
  // whole lane before it ellipsizes (its title carries the full name).
  participantLabelAnchor: {
    position: "relative",
    zIndex: 40,
    width: "fit-content",
    minWidth: "min(148px, 100%)",
    maxWidth: "calc(100% - 16px)",
    margin: "24px auto 0",
    pointerEvents: "all",
  },
  participantLabel: {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    padding: "6px 10px",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: "6px",
    backgroundColor: tokens.surface,
    boxShadow: { default: "none", ":hover": labelHover },
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: "11.5px",
    fontWeight: 700,
    textAlign: "center",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    pointerEvents: "all",
  },
  lifeline: {
    position: "absolute",
    top: "62px",
    bottom: "18px",
    left: "50%",
    marginLeft: "-0.5px",
    borderLeftWidth: "1px",
    borderLeftStyle: "dashed",
    borderLeftColor: tokens.ruleSoft,
  },
  // Edge endpoints sit exactly on the lane: left: 50% places the handle's
  // left edge, so the handle centers itself on it.
  handle: {
    width: "1px",
    height: "1px",
    minWidth: 0,
    minHeight: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    opacity: 0,
    pointerEvents: "none",
    transform: "translate(-50%, -50%)",
  },
  message: {
    strokeWidth: "1.25px",
    cursor: "pointer",
  },
  messageActive: {
    strokeWidth: "2.4px",
  },
  messageDrawing: {
    strokeWidth: "1.6px",
  },
  hitArea: {
    fill: "none",
    stroke: tokens.transparent,
    strokeWidth: "18px",
    cursor: "pointer",
    pointerEvents: "stroke",
  },
  dot: {
    position: "absolute",
    zIndex: 3,
    width: "11px",
    height: "11px",
    padding: 0,
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: "50%",
    backgroundColor: tokens.surface,
  },
  dotAttention: {
    borderColor: tokens.accent,
    boxShadow: `0 0 0 3px ${tokens.markerGlow}`,
  },
  dotActive: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
  },
  // On the stage the dots grow into numbered stop badges.
  stopBadge: {
    display: "grid",
    placeItems: "center",
    width: "18px",
    height: "18px",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: "10px",
    lineHeight: 1,
  },
  stopBadgeActive: {
    color: tokens.onAccent,
  },
  labelAnchor: {
    position: "absolute",
    zIndex: 40,
    display: "inline-flex",
    alignItems: "center",
    pointerEvents: "all",
  },
  label: {
    position: "relative",
    zIndex: 4,
    maxWidth: "calc(var(--sequence-lane-width, 176px) - 12px)",
    padding: "0 3px",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 0,
    backgroundColor: tokens.transparent,
    boxShadow: { default: "none", ":hover": labelHover },
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: "11.5px",
    fontWeight: 500,
    lineHeight: "14px",
    overflowWrap: "anywhere",
    textAlign: "center",
    whiteSpace: "normal",
    cursor: "pointer",
  },
  labelActive: {
    color: tokens.accent,
    fontWeight: 700,
  },
});
