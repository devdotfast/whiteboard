import type { BlockProps } from "@canvas/blocks";
import { CodePeekCard } from "@canvas/CodePeek";
import { useReviewDebugSettings } from "@canvas/debug-settings";
import { DiagramHeader } from "@canvas/diagram-header";
import { diagramStyles } from "@canvas/diagram-styles";
import { DiagramTourOverlay, useDiagramTourShell } from "@canvas/diagram-tour";
import {
  useDrawQueueControls,
  useMotionPhase,
} from "@canvas/draw-queue-provider";
import { drawStyles } from "@canvas/draw-styles";
import { countLabel } from "@canvas/format";
import { useReviewSession } from "@canvas/host/review-session";
import { useReviewPanel, useReviewPanelStore } from "@canvas/review-panel";
import type { SourcePeekAnchor } from "@canvas/review-panel-model";
import {
  fontSize,
  leading,
  radius,
  space,
  tracking,
} from "@canvas/scale.stylex";
import { shellStyles } from "@canvas/shell-styles";
import { withClass } from "@canvas/stylex-props";
import { themeClass, themeStyles } from "@canvas/theme-styles";
import { tokens } from "@canvas/tokens.stylex";
import { captureUiEvent } from "@canvas/ui-telemetry";
import { Button } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { SegmentedControl } from "@canvas/ui/segmented";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import { useDiagramSelection } from "@canvas/use-diagram-selection";
import { useWhiteboardSettings } from "@canvas/whiteboard-settings";
import type { ReviewRenderedFrame } from "@dev.fast/review-protocol";
import {
  type Block,
  anchorSelection,
  animationCode,
  animationCodeId,
} from "@dev.fast/whiteboard-document";
import { STAGE_KIT_CSS, STAGE_THEME } from "@review/animation-stage-kit";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
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
import { useClipPlayer } from "./clip-player";
import { useFramePlayer } from "./frame-player";
import { useReportAnimationRun } from "./report-run";
import { StepStrip } from "./stage-controls";
import type { PlayerStop, StagePlayer } from "./stage-player";
import {
  type HostMessage,
  STAGE_BOOT,
  type SlotLayout,
  type StageColorScheme,
  type StageInit,
  type StageMessage,
  stageMessageSchema,
} from "./stage-protocol";
import { registerStageRenderer } from "./stage-renderer";
import { stageRuntime } from "./stage-runtime";
import { SCALE } from "./stage-scale";

// Read on demand: a Worker may lack import.meta.url.
const stageUrl = () => new URL("./stage.html", import.meta.url).href;

// An auto-sized stage's height before it has reported one.
const STAGE_MIN_HEIGHT = 120;

// How long a new stage waits for its frames' measurement before it takes
// its current frame's height instead.
const MEASURE_WAIT = 1000;

// Fullscreen, the stage keeps its inline layout and scales to fit the room:
// at most 2x, past which a drawing made for a column reads as a poster, and
// at least 0.4x, below which its text cannot be read and the room scrolls.
const STAGE_MAX_SCALE = 2;
const STAGE_MIN_SCALE = 0.4;

// How long a render waits for the stage to boot, paint, show the stop asked
// for and settle, within Desktop's own wait on the verb.
const RENDER_WAIT = 30_000;

// A render polls on a timer, not on animation frames: a window in the
// background may paint no frame for a while, and a timer still runs there.
const RENDER_POLL = 50;

// How many frames a render gives the figure to come to rest in the window
// before it measures where it is: enough for a smooth scroll to finish.
const RENDER_STILL_FRAMES = 60;

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// A frame to lay out and paint, or the poll's wait where none comes.
const nextFrame = () =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, RENDER_POLL * 4);

    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });

let animeSource: Promise<string> | undefined;

// anime.js's source, for the stage: its own chunk, fetched by the first
// animation rather than with the canvas.
const loadAnime = () =>
  (animeSource ??= import("@animejs-bundles/anime.umd.min.js?raw").then(
    (module) => module.default,
  ));

let fontRules: Promise<string> | undefined;

const fontFiles = import.meta.glob<string>("../fonts/*.woff2", {
  query: "?inline",
  import: "default",
});

// The canvas's @font-face rules with each face inlined. The stage's policy
// admits data: fonts only, and it cannot see the canvas's own faces.
const loadFonts = () =>
  (fontRules ??= (async () => {
    const [{ default: rules }, files] = await Promise.all([
      import("../fonts/fonts.css?raw"),
      Promise.all(
        Object.entries(fontFiles).map(
          async ([file, load]): Promise<[string, string]> => [
            file.replace("../fonts/", ""),
            await load(),
          ],
        ),
      ).then((entries) => new Map(entries)),
    ]);

    return rules.replace(/url\(\.\/([^)]+)\)/g, (source, file: string) => {
      const data = files.get(file);

      return data ? `url(${data})` : source;
    });
  })());

function readTheme(element: Element): Pick<StageInit, "theme" | "colorScheme"> {
  const computed = getComputedStyle(element);

  return {
    theme: Object.fromEntries(
      Object.entries(STAGE_THEME).map(([name, property]) => [
        name,
        computed.getPropertyValue(property).trim(),
      ]),
    ),
    colorScheme: schemeOf(computed.colorScheme),
  };
}

// The host's own light or dark palette, or the reader's where it follows the
// system: "light dark" names both, and would read as dark on a light page.
export function schemeOf(colorScheme: string): StageColorScheme {
  const named = colorScheme.split(/\s+/);

  if (named.includes("light") && named.includes("dark"))
    return matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

  return named.includes("dark") ? "dark" : "light";
}

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Blocks a stage may show with whiteboard.block(): any but animations and
 * clips, which would nest stages. */
function embeddableBlocks(document: Block[]): Map<string, Block> {
  const found = new Map<string, Block>();

  const visit = (block: Block) => {
    if (block.id && block.type !== "animation" && block.type !== "clip")
      found.set(block.id, block);

    if ("children" in block) block.children.forEach(visit);
  };

  document.forEach(visit);

  return found;
}

type StageBlockProps = BlockProps<"animation" | "clip">;

/** What the stage was last asked to show and what it reports showing: a
 * frame's index once it settled there, or a clip's marker once the playhead
 * reached it. A render waits for the two to agree. */
interface StageShowing {
  askedFrame: number | null;
  shownFrame: number | null;
  askedMarker: string | null;
  shownMarker: string | null;
}

const nothingShowing = (): StageShowing => ({
  askedFrame: null,
  shownFrame: null,
  askedMarker: null,
  shownMarker: null,
});

/** The channel to the stage showing: set when it boots. */
function useStagePort() {
  const portRef = useRef<MessagePort | null>(null);
  const showingRef = useRef(nothingShowing());

  const send = useCallback((message: HostMessage) => {
    const showing = showingRef.current;

    if (message.type === "frame") {
      showing.askedFrame = message.index;
      showing.shownFrame = null;
    } else if (message.type === "seek") {
      showing.askedMarker = message.marker;
      showing.shownMarker = null;
    }

    portRef.current?.postMessage(message);
  }, []);

  return { portRef, showingRef, send };
}

type StagePort = ReturnType<typeof useStagePort>;

/**
 * An agent's HTML animation or clip, run in a sandboxed stage. Whiteboard
 * pieces the stage asks for (code peeks, other blocks) are drawn here, over
 * the placeholders the stage lays out, so they are the real components. An
 * animation's reader steps through frames; a clip's plays one timeline.
 */
export function AnimationBlock(props: StageBlockProps) {
  return props.node.type === "clip" ? (
    <ClipStage {...props} node={props.node} />
  ) : (
    <FrameStage {...props} node={props.node} />
  );
}

function FrameStage(props: BlockProps<"animation">) {
  const port = useStagePort();

  return (
    <StageBlock
      {...props}
      port={port}
      player={useFramePlayer(props.node, port.send)}
    />
  );
}

function ClipStage(props: BlockProps<"clip">) {
  const port = useStagePort();

  return (
    <StageBlock
      {...props}
      port={port}
      player={useClipPlayer(props.node, port.send)}
    />
  );
}

function StageBlock({
  node,
  data,
  children,
  port: { portRef, showingRef, send },
  player,
}: StageBlockProps & { port: StagePort; player: StagePlayer }) {
  const { theme } = useReviewDebugSettings();
  const panelStore = useReviewPanelStore();
  const session = useReviewSession();
  const { diagramFullscreenOnClick } = useWhiteboardSettings();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [contentHeight, setContentHeight] = useState(STAGE_MIN_HEIGHT);
  // The tallest frame of the scenario, from a hidden measuring copy, so the
  // stage does not change height as the reader steps through frames.
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [measureRun, setMeasureRun] = useState<number | null>(null);
  const [measureLate, setMeasureLate] = useState(false);
  const slotSizesRef = useRef(new Map<string, number>());
  const remeasureTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const measureRuns = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<SlotLayout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const clip = node.type === "clip";
  const noun = clip ? "clip" : "animation";

  const reportRun = useReportAnimationRun(data.snapshot.reviewId, node.id);

  // A block from the agent's stream paints its first frame in when the board
  // gets to it, and holds the draw queue until its stage says it is done.
  const motion = useMotionPhase(node.id);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const { painted } = useDrawQueueControls();

  // The stage showing now: whether it boots unseen, has run its scripts, was
  // told to paint, has painted, and reported an error.
  const paintRef = useRef({
    wanted: false,
    ready: false,
    sent: false,
    painted: false,
    failed: false,
  });

  // A no-op unless the queue is painting this block.
  const endPaint = useCallback(() => {
    if (node.id) painted(node.id);
  }, [node.id, painted]);

  // Fullscreen without a tour. Either way, a placeholder holds the inline
  // figure's height so the document keeps its place.
  const [expanded, setExpanded] = useState(false);
  const [held, setHeld] = useState(0);

  // The stage's inline width, which it keeps fullscreen, scaled to the room.
  const [inlineWidth, setInlineWidth] = useState(0);

  const [room, setRoom] = useState<{ width: number; height: number } | null>(
    null,
  );

  const roomRef = useRef<HTMLDivElement>(null);

  // What the figure leaves behind when it moves to the overlay: a placeholder
  // of its height, and the width its stage was laid out at.
  const holdInline = () => {
    setHeld(figureRef.current?.offsetHeight ?? 0);
    setInlineWidth(canvasRef.current?.clientWidth ?? 0);
  };

  const openRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const embeddable = useMemo(
    () => embeddableBlocks(data.snapshot.document),
    [data.snapshot.document],
  );

  const { stops, activeIndex } = player;
  const stop = stops[activeIndex];
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

  // A new stage for each edit of what it runs; frame changes reuse it.
  const stageKey = useMemo(
    () =>
      JSON.stringify([
        node.html,
        node.height,
        node.type === "clip" ? node.markers : node.frames,
        node.code,
        [...embeddable.keys()],
      ]),
    [node, embeddable],
  );

  // Paint once the stage is ready and the queue has reached this block, or
  // has given up on it: the content must appear either way.
  const paintStage = () => {
    const stage = paintRef.current;
    const phase = motionRef.current;

    if (phase === "painting" && stage.failed) endPaint();

    if (!stage.wanted || !stage.ready || stage.sent || phase === "queued")
      return;
    stage.sent = true;
    send({ type: "paint" });
  };

  const onPhase = useEffectEvent(paintStage);

  useEffect(() => onPhase(), [motion]);

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

  const onMessage = useRef<(message: StageMessage) => void>(() => {});

  onMessage.current = (message) => {
    const showing = showingRef.current;

    switch (message.type) {
      case "size":
        setContentHeight(Math.ceil(message.height));
        break;
      case "slots":
        setSlots(message.slots);
        break;
      case "reveal":
        reveal(message.name);
        break;
      case "error":
        setError(message.message);
        reportRun(message.message);
        // A broken stage must not hold the queue.
        paintRef.current.failed = true;
        endPaint();
        break;
      case "ready":
        reportRun(null);
        paintRef.current.ready = true;
        paintStage();
        break;
      case "painted":
        paintRef.current.painted = true;
        endPaint();
        break;
      case "settled":
        showing.shownFrame = message.index;

        if (showing.askedFrame === message.index) showing.askedFrame = null;
        player.receive(message);
        break;
      case "marker":
        showing.shownMarker = message.key;

        if (showing.askedMarker === message.key) showing.askedMarker = null;
        player.receive(message);
        break;
      default:
        player.receive(message);
    }
  };

  const bootedRef = useRef<HTMLIFrameElement | null>(null);
  const bootPlayer = useEffectEvent(() => player.boot());

  // The stage's first message, for the stage showing and for a measuring copy.
  const stageInit = useCallback(
    async (
      figure: Element,
      kind: ReturnType<StagePlayer["boot"]>,
      paint: boolean,
    ): Promise<StageInit> => {
      const [anime, fonts] = await Promise.all([loadAnime(), loadFonts()]);

      return {
        type: "init",
        ...kind,
        html: node.html,
        kit: STAGE_KIT_CSS,
        autoSize: node.height === "auto",
        code: Object.keys(node.code),
        codeTitles: codeTitles(node, data.anchors),
        blocks: [...embeddable.keys()],
        ...readTheme(figure),
        scale: SCALE,
        reducedMotion: reducedMotion(),
        paint,
        libraries: [anime],
        fonts,
      };
    },
    [node, data.anchors, embeddable],
  );

  // What a measuring copy of an animation boots with: the scenario showing,
  // from its first frame. A clip has one timeline and no frames to measure.
  const measureKind = (): ReturnType<StagePlayer["boot"]> | null => {
    if (node.type !== "animation") return null;

    const sequence =
      node.scenarios?.find((scenario) => scenario.key === player.scenario)
        ?.frames ?? null;

    const first = sequence
      ? node.frames.findIndex((frame) => frame.key === sequence[0])
      : 0;

    return {
      mode: "frames",
      frames: node.frames.map(
        ({ key, title, caption, data: frameData, code }) => ({
          key,
          title,
          caption,
          data: frameData,
          code,
        }),
      ),
      markers: [],
      scenarios: [],
      frame: Math.max(0, first),
      ...(sequence && { sequence }),
    };
  };

  // Hand the stage its runtime and a private port when its page first loads.
  // A later load in the same frame is a page the stage navigated to, which
  // gets neither. A new frame, for an edit or for going fullscreen, boots.
  const boot = useCallback(() => {
    const target = frameRef.current?.contentWindow;
    const figure = figureRef.current;

    if (!target || !figure) return;
    portRef.current?.close();

    if (bootedRef.current === frameRef.current) {
      portRef.current = null;
      setSlots([]);
      setError(`The ${noun} left its stage.`);
      endPaint();

      return;
    }

    bootedRef.current = frameRef.current;
    const channel = new MessageChannel();
    portRef.current = channel.port1;
    showingRef.current = nothingShowing();
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = stageMessageSchema.safeParse(event.data);

      if (message.success) onMessage.current(message.data);
    };

    const kind = bootPlayer();
    setSlots([]);
    setError(null);

    // Unseen until painted only while the queue is drawing (or about to draw)
    // this block. A stage replaced mid-paint starts over.
    const paint =
      (motionRef.current === "painting" || motionRef.current === "queued") &&
      !reducedMotion();

    paintRef.current = {
      wanted: paint,
      ready: false,
      sent: false,
      painted: false,
      failed: false,
    };

    if (!paint) endPaint();
    target.postMessage(
      { type: STAGE_BOOT, runtime: stageRuntime.toString() },
      "*",
      [channel.port2],
    );

    stageInit(figure, kind, paint).then(
      (init) => channel.port1.postMessage(init satisfies HostMessage),
      () => {
        setError(`The ${noun} libraries or fonts could not be loaded.`);
        endPaint();
      },
    );
  }, [noun, endPaint, portRef, showingRef, stageInit]);

  // An agent rendering a stop reads the block as it is now, whatever
  // render it was registered in.
  const playerRef = useRef(player);
  playerRef.current = player;
  const errorRef = useRef(error);
  errorRef.current = error;
  const measuringRef = useRef(false);
  measuringRef.current = measureRun !== null;

  // Shows a stop for an agent: once the stage is up and painted, in the
  // scenario that has the stop, at rest, scrolled into view.
  const show = useEffectEvent(
    async (key: string): Promise<ReviewRenderedFrame> => {
      const deadline = Date.now() + RENDER_WAIT;

      // A covered or minimized window paints no frame, and its timers slow to
      // a crawl, so nothing here would move: say so instead of waiting.
      const hidden = () => {
        if (figureRef.current?.ownerDocument.visibilityState === "hidden")
          throw new Error(
            "Desktop's window is hidden, minimized or covered by other windows, so the stage cannot draw. Bring it onto the screen and render again.",
          );
      };

      // A stage that failed shows what it has: the render reports the error.
      const until = async (
        condition: () => boolean,
        what: string,
        by = deadline,
      ) => {
        while (!condition() && !paintRef.current.failed) {
          hidden();

          if (Date.now() > by) throw new Error(`The ${noun} did not ${what}.`);
          await wait(RENDER_POLL);
        }
      };

      hidden();

      await until(() => paintRef.current.ready, "start in time");

      const listed = (stops: readonly PlayerStop[]) =>
        stops.some((stop) => stop.key === key);

      if (!listed(playerRef.current.stops)) {
        const scenario =
          node.type === "animation"
            ? node.scenarios?.find((item) => item.frames.includes(key))
            : undefined;

        if (!scenario)
          throw new Error(
            `${key} is not a ${clip ? "marker" : "frame"} of the ${noun}.`,
          );
        playerRef.current.selectScenario(scenario.key);
        await until(
          () => listed(playerRef.current.stops),
          `switch to scenario ${scenario.key} in time`,
        );
      }

      const { stops } = playerRef.current;
      const position = stops.findIndex((stop) => stop.key === key);
      playerRef.current.pick(position, "render");

      const showing = showingRef.current;

      if (clip)
        await until(
          () => showing.shownMarker === key && showing.askedMarker === null,
          `reach marker ${key} in time`,
        );
      else {
        const index = node.frames.findIndex((frame) => frame.key === key);
        await until(
          () => showing.shownFrame === index && showing.askedFrame === null,
          `settle on frame ${key} in time`,
        );
      }

      const paint = paintRef.current;
      await until(() => !paint.wanted || paint.painted, "paint in time");

      // Its height follows the tallest frame once measured; a measure that
      // takes too long does not hold the render.
      await until(
        () => !measuringRef.current,
        "measure",
        Date.now() + MEASURE_WAIT,
      ).catch(() => {});
      await nextFrame();
      await nextFrame();

      const figure = figureRef.current;
      const view = figure?.ownerDocument.defaultView;

      if (!figure || !view) throw new Error(`The ${noun} is not on the board.`);

      figure.scrollIntoView({
        block: figure.offsetHeight > view.innerHeight ? "start" : "nearest",
        behavior: "instant",
      });

      // Measure once the figure holds still: a scroll may still be moving, and
      // a block above may still be taking its height.
      let box = figure.getBoundingClientRect();

      for (let frame = 0; frame < RENDER_STILL_FRAMES; frame++) {
        await nextFrame();
        const next = figure.getBoundingClientRect();

        const still =
          Math.abs(next.top - box.top) < 0.5 &&
          Math.abs(next.left - box.left) < 0.5 &&
          Math.abs(next.height - box.height) < 0.5 &&
          Math.abs(next.width - box.width) < 0.5;

        box = next;

        if (still) break;
      }

      const x = Math.max(0, box.left);
      const y = Math.max(0, box.top);
      const right = Math.min(view.innerWidth, box.right);
      const bottom = Math.min(view.innerHeight, box.bottom);
      const width = Math.max(0, right - x);
      const height = Math.max(0, bottom - y);
      const stop = stops[position]!;

      return {
        frame: { key, title: stop.title, position, count: stops.length },
        ...(playerRef.current.scenario !== undefined && {
          scenario: playerRef.current.scenario,
        }),
        rect: { x, y, width, height },
        clipped: width < box.width - 1 || height < box.height - 1,
        error: errorRef.current,
      };
    },
  );

  useEffect(() => {
    if (!node.id) return;

    return registerStageRenderer(data.snapshot.reviewId, node.id, {
      show: (key) => show(key),
    });
  }, [data.snapshot.reviewId, node.id]);

  // Measure again in a new copy after anything that can move a frame's layout.
  const remeasure = useCallback(() => {
    clearTimeout(remeasureTimer.current);
    setMeasureRun(++measureRuns.current);
  }, []);

  // A new stage keeps its first height until its frames are measured, so it
  // grows once, to its tallest frame, rather than to its current one first.
  useEffect(() => {
    setMeasuredHeight(0);
    setMeasureLate(false);
    slotSizesRef.current.clear();
    remeasure();
    const timer = setTimeout(() => setMeasureLate(true), MEASURE_WAIT);

    return () => clearTimeout(timer);
  }, [stageKey, remeasure]);

  useEffect(() => remeasure(), [player.scenario, theme, remeasure]);
  useEffect(() => () => clearTimeout(remeasureTimer.current), []);

  useEffect(() => () => portRef.current?.close(), [portRef]);

  // Read after React commits the matching theme class. Listening to the host
  // event directly can race that commit and export a mixed palette (new neutral
  // workbench colors with the previous semantic surface colors).
  useLayoutEffect(() => {
    if (figureRef.current)
      send({ type: "theme", ...readTheme(figureRef.current) });
  }, [theme, send]);

  const { closeOverlayTour, moveOverlayTour } = panelStore.getState();
  const collapse = useCallback(() => setExpanded(false), []);
  const close = tourOpen ? closeOverlayTour : collapse;

  const { portalTarget } = useDiagramTourShell(tourOpen || expanded, close);

  const fullscreen = (tourOpen || expanded) && portalTarget !== null;

  // Fullscreen, the room the controls leave the stage, inside its padding.
  useLayoutEffect(() => {
    const element = roomRef.current;

    if (!fullscreen || !element) {
      setRoom(null);

      return;
    }

    const read = () => {
      const style = getComputedStyle(element);

      setRoom({
        width:
          element.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
        height:
          element.clientHeight -
          Number.parseFloat(style.paddingTop) -
          Number.parseFloat(style.paddingBottom),
      });
    };

    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);

    return () => observer.disconnect();
  }, [fullscreen]);

  // Going fullscreen draws a new canvas; a resize changes its width.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;
    let width = canvas.clientWidth;
    remeasure();

    const observer = new ResizeObserver(() => {
      if (canvas.clientWidth === width) return;
      width = canvas.clientWidth;
      remeasure();
    });

    observer.observe(canvas);

    return () => observer.disconnect();
  }, [fullscreen, remeasure]);

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

  const stageHeight =
    node.height !== "auto"
      ? node.height
      : measuredHeight || measureLate
        ? Math.max(contentHeight, measuredHeight)
        : STAGE_MIN_HEIGHT;

  // Fullscreen, the stage keeps its inline width, so its layout and its
  // measured height hold, and scales to fit the room: up on a wide screen,
  // down beside the tour's pane. A narrower stage would fold the drawing.
  const scaled = fullscreen && inlineWidth > 0;

  const scale =
    scaled && room
      ? Math.min(
          STAGE_MAX_SCALE,
          Math.max(
            STAGE_MIN_SCALE,
            Math.min(room.width / inlineWidth, room.height / stageHeight),
          ),
        )
      : 1;

  const figure = (
    <figure
      ref={figureRef}
      {...withClass(
        "animation-block",
        styles.figure,
        fullscreen && styles.figureFullscreen,
        drawStyles.blockChild,
        player.onFigureKeyDown !== undefined && focusStyles.ring,
      )}
      aria-label={node.title}
      tabIndex={player.onFigureKeyDown ? 0 : undefined}
      onKeyDown={player.onFigureKeyDown}
    >
      <DiagramHeader
        kind={clip ? "CLIP" : "ANIMATION"}
        title={node.title}
        titleStyle={styles.headerTitle}
        meta={`${activeIndex + 1} / ${stops.length}`}
        action={
          fullscreen ? (
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
          )
        }
      />
      {node.scenarios && (
        <div {...stylex.props(styles.scenarios)}>
          <span
            aria-hidden="true"
            {...stylex.props(textStyles.eyebrow, styles.scenarioLabel)}
          >
            Scenario
          </span>
          <SegmentedControl
            label="Scenario"
            value={player.scenario}
            options={node.scenarios.map(({ key, label }) => ({
              value: key,
              label,
            }))}
            onChange={player.selectScenario}
          />
        </div>
      )}
      <div
        ref={roomRef}
        {...stylex.props(styles.stage, fullscreen && styles.stageFullscreen)}
      >
        <div
          {...stylex.props(styles.zoom)}
          style={
            scaled
              ? { width: inlineWidth * scale, height: stageHeight * scale }
              : undefined
          }
        >
          <div
            ref={canvasRef}
            {...stylex.props(styles.canvas, scaled && styles.canvasScaled)}
            style={{
              height: stageHeight,
              ...(scaled && {
                width: inlineWidth,
                transform: `scale(${scale})`,
              }),
            }}
          >
            <iframe
              key={stageKey}
              ref={frameRef}
              src={stageUrl()}
              title={node.title}
              sandbox="allow-scripts"
              onLoad={boot}
              {...stylex.props(styles.frame)}
            />
            {node.type === "animation" &&
              node.height === "auto" &&
              measureRun !== null && (
                <MeasuringStage
                  key={measureRun}
                  init={() => {
                    const kind = measureKind();

                    return stageInit(figureRef.current!, kind!, false).then(
                      (init) => ({
                        ...init,
                        measure: true,
                        slotSizes: Object.fromEntries(slotSizesRef.current),
                      }),
                    );
                  }}
                  onMeasured={(height) => {
                    setMeasuredHeight(height);
                    setMeasureRun(null);
                  }}
                />
              )}
            <div {...stylex.props(styles.overlays)}>
              {slots.map((slot) => (
                <SlotOverlay
                  key={slot.slot}
                  slot={slot}
                  onHeight={(height) => {
                    send({ type: "slot-size", slot: slot.slot, height });

                    if (slotSizesRef.current.get(slot.slot) === height) return;
                    slotSizesRef.current.set(slot.slot, height);
                    clearTimeout(remeasureTimer.current);
                    remeasureTimer.current = setTimeout(remeasure, 100);
                  }}
                >
                  {slot.kind === "code"
                    ? node.code[slot.ref] && (
                        <CodePeekCard
                          source={anchorSelection(
                            animationCode(node.code[slot.ref]!).source,
                            node.pins,
                          )}
                          heightMode="capped"
                          xstyle={styles.peek}
                        />
                      )
                    : embeddable.get(slot.ref) &&
                      children([embeddable.get(slot.ref)!])}
                </SlotOverlay>
              ))}
            </div>
          </div>
        </div>
      </div>
      {player.afterStage}
      {player.strip && (
        <StepStrip
          label={player.strip.label}
          items={player.strip.items}
          activeIndex={activeIndex}
          timer={player.strip.timer}
          onPick={(position) => player.pick(position, "controls")}
          onKeyDown={player.onKeyDown}
        />
      )}
      <div {...stylex.props(styles.controls)} onKeyDown={player.onKeyDown}>
        {player.controls}
      </div>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          The {noun} reported an error: {error}
        </p>
      )}
    </figure>
  );

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
          aria-label={node.title ?? (clip ? "Clip" : "Animation")}
        >
          {figure}
        </div>,
        portalTarget,
      )}
    </>
  );
}

/** A hidden copy of the stage that shows every frame of the scenario in
 * turn and reports the tallest. Each frame's scripts run while it shows, as
 * they would for a reader, so nothing they leave behind reaches the stage the
 * reader sees. */
function MeasuringStage({
  init,
  onMeasured,
}: {
  init(): Promise<StageInit>;
  onMeasured(height: number): void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const initRef = useRef(init);
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;

  // Boot on the first load only; a later one is a page the stage navigated to.
  const boot = useCallback(() => {
    const target = ref.current?.contentWindow;

    if (!target || portRef.current) return;
    const channel = new MessageChannel();
    portRef.current = channel.port1;

    channel.port1.onmessage = (event: MessageEvent) => {
      const message = stageMessageSchema.safeParse(event.data);

      if (message.success && message.data.type === "measured")
        onMeasuredRef.current(message.data.height);
    };

    target.postMessage(
      { type: STAGE_BOOT, runtime: stageRuntime.toString() },
      "*",
      [channel.port2],
    );
    initRef.current().then(
      (message) => channel.port1.postMessage(message satisfies HostMessage),
      () => {},
    );
  }, []);

  useEffect(() => () => portRef.current?.close(), []);

  return (
    <iframe
      ref={ref}
      src={stageUrl()}
      title="Measuring copy"
      sandbox="allow-scripts"
      aria-hidden="true"
      tabIndex={-1}
      inert
      onLoad={boot}
      {...stylex.props(styles.frame, styles.measuring)}
    />
  );
}

/** A host component drawn where the stage put its placeholder. */
function SlotOverlay({
  slot,
  onHeight,
  children,
}: {
  slot: SlotLayout;
  onHeight(height: number): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;

    const observer = new ResizeObserver(() =>
      onHeightRef.current(Math.ceil(element.offsetHeight)),
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-animation-slot={slot.kind}
      {...stylex.props(styles.slot)}
      style={{
        transform: `translate(${slot.x}px, ${slot.y}px)`,
        width: slot.width,
        opacity: slot.opacity,
        visibility: slot.visible ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
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

/** What hovering a drawn element that opens code says: its label, file and
 * lines. */
function codeTitles(
  node: StageBlockProps["node"],
  anchors: ReadonlyMap<string, SourcePeekAnchor>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(node.code).flatMap(([name, entry]) => {
      const anchor = anchors.get(animationCodeId(node.id, name));

      if (!anchor) return [];
      const { file, start, end } = anchor.peek;
      const label = animationCode(entry).label ?? name;

      const lines =
        start.line === end.line ? `${start.line}` : `${start.line}–${end.line}`;

      return [[name, `${label} · ${file.split("/").at(-1)}:${lines}`]];
    }),
  );
}

const narrow = "@media (max-width: 720px)";

const styles = stylex.create({
  figure: {
    overflow: "hidden",
    margin: `${space.s18} 0 ${space.s4}`,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    font: `${fontSize.body}/${leading.normal} ${tokens.fontMono}`,
  },
  headerTitle: {
    overflow: { default: null, [narrow]: "visible" },
    textOverflow: { default: null, [narrow]: "clip" },
    whiteSpace: { default: null, [narrow]: "normal" },
  },
  figureFullscreen: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minHeight: 0,
    margin: 0,
  },
  // The scenario picker, a strip between the header and the stage that
  // scrolls sideways when its scenarios outrun the width.
  scenarios: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    overflowX: "auto",
    padding: `${space.s6} ${space.s12}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
  },
  scenarioLabel: {
    flex: "0 0 auto",
  },
  // Room around the stage so its drawing does not run into the card's edges.
  stage: {
    padding: space.s16,
    backgroundColor: tokens.surface,
  },
  // Fullscreen, the stage takes the room the controls leave and centers the
  // drawing in it, scrolling when the drawing is taller.
  stageFullscreen: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "safe center",
    minHeight: 0,
    overflow: "auto",
    padding: { default: space.s32, [narrow]: space.s16 },
  },
  // The scaled stage's footprint, so the room centres and scrolls it whole.
  zoom: {
    flex: "0 0 auto",
    width: "100%",
  },
  canvas: {
    position: "relative",
    flex: "0 0 auto",
    overflow: "hidden",
  },
  canvasScaled: {
    transformOrigin: "0 0",
  },
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
  frame: {
    display: "block",
    width: "100%",
    height: "100%",
    borderWidth: 0,
    borderStyle: "none",
    // The page's own scheme, which is the one the stage is told to use. A
    // frame whose scheme differs from its page gets an opaque backdrop.
    colorScheme: "inherit",
    backgroundColor: tokens.transparent,
  },
  // Over the stage but out of the pointer's way; each slot takes it back.
  // Laid out at the stage's width but never seen; still rendered, so the
  // browser does not throttle its frames.
  measuring: {
    position: "absolute",
    inset: 0,
    opacity: 0,
    pointerEvents: "none",
  },
  overlays: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
  },
  slot: {
    position: "absolute",
    top: 0,
    left: 0,
    pointerEvents: "auto",
  },
  // The peek's own block margins would push it off its placeholder.
  peek: {
    width: "100%",
    maxWidth: "100%",
    marginBlock: 0,
    marginInline: 0,
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    minHeight: "36px",
    padding: `0 ${space.s12} 0 ${space.s8}`,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  error: {
    margin: 0,
    padding: `${space.s8} ${space.s12}`,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    color: tokens.changeRemoved,
  },
});
