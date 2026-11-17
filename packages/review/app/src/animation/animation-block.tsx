import type { BlockProps } from "@canvas/blocks";
import { CodePeekCard } from "@canvas/CodePeek";
import { DiagramHeader } from "@canvas/diagram-header";
import { wbRuntime } from "@canvas/diagram/wb-runtime";
import { drawStyles } from "@canvas/draw-styles";
import { fontSize, leading, radius, space } from "@canvas/scale.stylex";
import { withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import { focusStyles } from "@canvas/ui/focus";
import { SegmentedControl } from "@canvas/ui/segmented";
import { textStyles } from "@canvas/ui/text";
import type { ReviewRenderedFrame } from "@dev.fast/review-protocol";
import {
  type DiagramBlock,
  anchorSelection,
} from "@dev.fast/whiteboard-document";
import { STAGE_KIT_CSS, STAGE_THEME } from "@review/animation-stage-kit";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useBoardStageHost } from "./board-stage";
import { useClipPlayer } from "./clip-player";
import { useFramePlayer } from "./frame-player";
import { StepStrip } from "./stage-controls";
import { type StageHost, type StageNode, codeEntry } from "./stage-host";
import type { PlayerStop, StagePlayer } from "./stage-player";
import {
  type HostMessage,
  STAGE_BOOT,
  STAGE_MIN_WIDTH,
  type SlotLayout,
  type StageColorScheme,
  type StageInit,
  type StageLibrary,
  type StageMessage,
  THREE_SPLIT,
  stageMessageSchema,
} from "./stage-protocol";
import { registerStageRenderer } from "./stage-renderer";
import { stageRuntime } from "./stage-runtime";
import { SCALE } from "./stage-scale";
import { stillPlayer } from "./still-player";

// Read on demand: a Worker may lack import.meta.url.
const stageUrl = () => new URL("./stage.html", import.meta.url).href;

// The space a diagram keeps around its drawing, inside the stage, so a
// label at its edge is not cut.
const DIAGRAM_INSET = 8;

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

// How long a render waits for a block the agent just wrote to finish
// drawing in on the board: past the longest draw step, a diagram's paint.
const DRAW_IN_WAIT = 6000;

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

const libraries = new Map<StageLibrary, Promise<string>>();

// A diagram's libraries, each its own chunk, fetched the first time a stage
// asks: ELK for layout, d3 and Plot for charts, three.js for 3D.
const loadLibrary = (name: StageLibrary) => {
  let source = libraries.get(name);

  if (!source) {
    source =
      name === "elk"
        ? import("@elk-bundles/elk.bundled.js?raw").then(
            (module) => module.default,
          )
        : name === "pele"
          ? import("../../vendor/pele-layout/pele-layout.global.js?raw").then(
              (module) => module.default,
            )
          : name === "three"
            ? Promise.all([
                import("@three-bundles/three.core.js?raw"),
                import("@three-bundles/three.module.js?raw"),
              ]).then(([core, module]) =>
                [core.default, module.default].join(THREE_SPLIT),
              )
            : Promise.all([
                import("@d3-bundles/d3.min.js?raw"),
                import("@plot-bundles/plot.umd.min.js?raw"),
              ]).then(([d3, plot]) => `${d3.default}\n${plot.default}`);
    libraries.set(name, source);
  }

  return source;
};

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

/** A diagram's claim about the code, as its stage reports it. */
interface Claim {
  label: string;
  names: string[];
}

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
export function AnimationBlock(
  props: BlockProps<"animation" | "clip" | "diagram">,
) {
  return <Stage node={props.node} host={useBoardStageHost(props)} />;
}

/** An edit to what a diagram's stage runs: a fresh stage draws it, at its
 * start, rather than one whose frames may have gone. */
export const diagramRevision = ({
  script,
  frames,
  scenarios,
  timeline,
  code,
  stage,
}: DiagramBlock) =>
  JSON.stringify([script, frames, scenarios, timeline, code, stage]);

/** A block's stage, with the player its kind steps or plays with. */
export function Stage({ node, host }: { node: StageNode; host: StageHost }) {
  if (node.type === "clip") return <ClipStage node={node} host={host} />;

  if (node.type === "animation") return <FrameStage node={node} host={host} />;

  if (node.frames) return <DiagramFrameStage node={node} host={host} />;

  if (node.timeline) return <DiagramTimelineStage node={node} host={host} />;

  return <DiagramStillStage node={node} host={host} />;
}

type KindProps<K extends "animation" | "clip" | "diagram"> = {
  node: BlockProps<K>["node"];
  host: StageHost;
};

function DiagramFrameStage({ node, host }: KindProps<"diagram">) {
  const port = useStagePort();

  return (
    <StageBlock
      node={node}
      host={host}
      port={port}
      player={useFramePlayer(
        { frames: node.frames ?? [], scenarios: node.scenarios },
        port.send,
        { track: true },
      )}
    />
  );
}

function DiagramTimelineStage({ node, host }: KindProps<"diagram">) {
  const port = useStagePort();

  const markers = useMemo(
    () =>
      (node.timeline?.chapters ?? []).map(({ key, title, caption, code }) => ({
        key,
        title,
        caption,
        code,
      })),
    [node.timeline],
  );

  return (
    <StageBlock
      node={node}
      host={host}
      port={port}
      player={useClipPlayer({ markers }, port.send, { track: true })}
    />
  );
}

function DiagramStillStage({ node, host }: KindProps<"diagram">) {
  const port = useStagePort();

  return (
    <StageBlock
      node={node}
      host={host}
      port={port}
      player={stillPlayer(node.title)}
    />
  );
}

function FrameStage({ node, host }: KindProps<"animation">) {
  const port = useStagePort();

  return (
    <StageBlock
      node={node}
      host={host}
      port={port}
      player={useFramePlayer(node, port.send)}
    />
  );
}

function ClipStage({ node, host }: KindProps<"clip">) {
  const port = useStagePort();

  return (
    <StageBlock
      node={node}
      host={host}
      port={port}
      player={useClipPlayer(node, port.send)}
    />
  );
}

function StageBlock({
  node,
  host,
  port: { portRef, showingRef, send },
  player,
}: {
  node: StageNode;
  host: StageHost;
  port: StagePort;
  player: StagePlayer;
}) {
  const { theme } = host;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [contentHeight, setContentHeight] = useState(STAGE_MIN_HEIGHT);
  // The board's reading width, or the widest the stage's content has
  // reached past its edge in any frame: the stage keeps that width and a
  // narrower block scrolls it.
  const [minWidth, setMinWidth] = useState(STAGE_MIN_WIDTH);
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
  const diagram = node.type === "diagram" ? node : null;

  // A clip, or a diagram with a timeline: one played timeline with markers.
  const clip =
    node.type === "clip" ||
    (diagram !== null && diagram.timeline !== undefined);

  const still = diagram !== null && !diagram.frames && !diagram.timeline;
  const noun = diagram ? "diagram" : clip ? "clip" : "animation";

  // A diagram's claims and what its stage found drawn wrong, as it last
  // reported them.
  const [claims, setClaims] = useState<Claim[]>([]);
  const [findings, setFindings] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  const status = host.codeStatus;

  // Each claim counts once: it matches when all its code holds, has changed
  // when some does not, and is unlinked when it names none.
  const tally = useMemo(() => {
    const count = { matches: 0, changed: 0, unlinked: 0 };
    const changed: string[] = [];
    const unlinked: string[] = [];

    for (const claim of claims)
      if (!claim.names.length) {
        count.unlinked++;
        unlinked.push(claim.label);
      } else if (claim.names.every((name) => status[name] === "checked"))
        count.matches++;
      else {
        count.changed++;
        changed.push(claim.label);
      }

    return { ...count, changedLabels: changed, unlinkedLabels: unlinked };
  }, [claims, status]);

  // How many times a diagram's stage has run its script to the end.
  const [runs, setRuns] = useState(0);

  const reportRun = host.report;

  // A block from the agent's stream paints its first frame in when the board
  // gets to it, and holds the draw queue until its stage says it is done.
  const { motion, painted } = host;
  const motionRef = useRef(motion);
  motionRef.current = motion;

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

  const [room, setRoom] = useState<{ width: number; height: number } | null>(
    null,
  );

  const roomRef = useRef<HTMLDivElement>(null);
  const embeddable = host.blocks;
  const { activeIndex } = player;

  const { figureRef, fullscreen, inlineWidth, ...chrome } = host.useChrome({
    node,
    player,
    noun,
    inlineWidth: () => Math.max(canvasRef.current?.clientWidth ?? 0, minWidth),
  });

  // A new stage for each edit of what it runs; frame changes reuse it.
  const stageKey = useMemo(
    () =>
      JSON.stringify(
        node.type === "diagram"
          ? [
              node.html,
              node.script,
              node.stage,
              node.frames,
              node.scenarios,
              node.timeline,
              node.code,
            ]
          : [
              node.html,
              node.height,
              node.type === "clip" ? node.markers : node.frames,
              node.code,
              [...embeddable.keys()],
            ],
      ),
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

  const onMessage = useRef<(message: StageMessage) => void>(() => {});

  onMessage.current = (message) => {
    const showing = showingRef.current;

    switch (message.type) {
      case "size":
        if (message.height !== undefined)
          setContentHeight(Math.ceil(message.height));

        if (message.width > 0)
          setMinWidth((widest) => Math.max(widest, Math.ceil(message.width)));
        break;
      case "slots":
        setSlots(message.slots);
        break;
      case "reveal":
        chrome.reveal(message.name);
        break;
      case "library":
        loadLibrary(message.name).then(
          (source) => send({ type: "library", name: message.name, source }),
          () => setError(`The ${message.name} library could not be loaded.`),
        );
        break;
      case "claims":
        setClaims(message.claims);
        break;
      case "findings":
        setFindings(message.findings);
        setNotes(message.notes ?? []);
        break;
      case "escape":
        chrome.escape();
        break;
      case "error":
        setError(message.message);
        reportRun({ error: message.message });
        // A broken stage must not hold the queue.
        paintRef.current.failed = true;
        endPaint();
        break;
      case "ready":
        // A diagram reports with what it found, once that is in.
        if (diagram) setRuns((count) => count + 1);
        else reportRun({ error: null });
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
      const [anime, fonts] = await Promise.all([
        node.type === "diagram" ? null : loadAnime(),
        loadFonts(),
      ]);

      return {
        type: "init",
        ...kind,
        html: node.type === "diagram" ? "" : node.html,
        kit: STAGE_KIT_CSS,
        autoSize: node.type === "diagram" || node.height === "auto",
        code: Object.keys(node.code),
        codeTitles: host.codeTitles,
        blocks: [...embeddable.keys()],
        ...readTheme(figure),
        scale: SCALE,
        reducedMotion: reducedMotion(),
        paint,
        libraries: anime === null ? [] : [anime],
        fonts,
        ...(node.type === "diagram" && {
          diagram: {
            html: node.html,
            script: node.script,
            inset: node.stage?.inset ?? DIAGRAM_INSET,
            room: canvasRef.current?.clientWidth ?? 0,
            ...(node.stage && {
              size: { width: node.stage.width, height: node.stage.height },
            }),
            scenarios: (node.scenarios ?? []).map(({ key, label, frames }) => ({
              key,
              label,
              frames,
            })),
            chapters: node.timeline?.chapters ?? [],
          },
        }),
      };
    },
    [node, host.codeTitles, embeddable],
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
      {
        type: STAGE_BOOT,
        runtime: (node.type === "diagram"
          ? wbRuntime
          : stageRuntime
        ).toString(),
      },
      "*",
      [channel.port2],
    );

    setClaims([]);
    setFindings([]);
    stageInit(figure, kind, paint).then(
      (init) => channel.port1.postMessage(init satisfies HostMessage),
      () => {
        setError(`The ${noun} libraries or fonts could not be loaded.`);
        endPaint();
      },
    );
  }, [noun, node.type, endPaint, portRef, showingRef, stageInit]);

  // A diagram tells the server what its script did and what it drew wrong,
  // for the agent that wrote it.
  const reportDiagram = useEffectEvent(() => {
    // A step's label cut off on the step bar under the stage.
    const labels = [
      ...(canvasRef.current
        ?.closest(".animation-block")
        ?.querySelectorAll<HTMLElement>("[data-stop-label]") ?? []),
    ];

    const cut = labels.flatMap((label) =>
      label.scrollWidth > label.clientWidth + 1
        ? [
            `The step label “${label.textContent}” is cut off on the step bar: about ${Math.max(1, Math.floor(((label.textContent?.length ?? 0) * label.clientWidth) / label.scrollWidth))} characters fit in its place there. Shorten it, and let the caption say the rest.`,
          ]
        : [],
    );

    // A diagram of something outside the repository defines no code, so
    // nothing in it is unlinked.
    const linked = Object.keys(node.code).length > 0;

    reportRun({
      error: errorRef.current,
      findings: [...findings, ...cut],
      notes,
      claims: {
        matches: tally.matches,
        changed: tally.changed,
        unlinked: linked ? tally.unlinked : 0,
        changedLabels: tally.changedLabels.slice(0, 20),
        unlinkedLabels: linked ? tally.unlinkedLabels.slice(0, 20) : [],
      },
    });
  });

  useEffect(() => {
    if (runs > 0) reportDiagram();
  }, [runs, findings, notes, tally]);

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
    async (asked: string): Promise<ReviewRenderedFrame> => {
      const deadline = Date.now() + RENDER_WAIT;

      // "scenario:frame" shows the frame in that scenario; a frame key alone
      // shows it in the scenario showing, or else the first that has it.
      const colon = asked.indexOf(":");
      const wanted = colon < 0 ? undefined : asked.slice(0, colon);
      const key = asked.slice(colon + 1);

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

      // Chromium holds back a stage scrolled out of view, and its moves
      // would never end: bring it into view before it is asked to step.
      const bringIntoView = () => {
        const figure = figureRef.current;
        const view = figure?.ownerDocument.defaultView;

        if (!figure || !view)
          throw new Error(`The ${noun} is not on the board.`);

        figure.scrollIntoView({
          block: figure.offsetHeight > view.innerHeight ? "start" : "nearest",
          behavior: "instant",
        });

        return { figure, view };
      };

      bringIntoView();
      await until(() => paintRef.current.ready, "start in time");

      const listed = (stops: readonly PlayerStop[]) =>
        stops.some((item) => item.key === key);

      if (wanted !== undefined && playerRef.current.scenario !== wanted) {
        if (!node.scenarios?.some((item) => item.key === wanted))
          throw new Error(`${wanted} is not a scenario of the ${noun}.`);
        playerRef.current.selectScenario(wanted);
        await until(
          () =>
            playerRef.current.scenario === wanted &&
            listed(playerRef.current.stops),
          `switch to scenario ${wanted} in time`,
        );
      }

      if (!listed(playerRef.current.stops)) {
        const scenario =
          node.type !== "clip" && !clip
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
      else if (node.frames) {
        const index = node.frames.findIndex((frame) => frame.key === key);
        await until(
          () => showing.shownFrame === index && showing.askedFrame === null,
          `settle on frame ${key} in time`,
        );
      }

      // Its height follows the tallest frame once measured; a measure that
      // takes too long does not hold the render.
      await until(
        () => !measuringRef.current,
        "measure",
        Date.now() + MEASURE_WAIT,
      ).catch(() => {});
      await nextFrame();
      await nextFrame();

      // Again, now that it has its height for the frame.
      const { figure, view } = bringIntoView();

      // A block an agent just wrote draws in on the board once it is in
      // view: capture it after that, not halfway through its wipe. A queue
      // that never settles does not hold the render.
      const block = figure.closest<HTMLElement>("[data-review-node-id]");

      await until(
        () => !block?.dataset.motion,
        "finish drawing in",
        Date.now() + DRAW_IN_WAIT,
      ).catch(() => {});

      // The stage fades in only while on screen, so it is waited for here,
      // in view, and not before the scroll.
      await until(
        () => !paintRef.current.wanted || paintRef.current.painted,
        "paint in time",
      );

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

      // A diagram's stage reports what it drew wrong once it has run.
      if (diagram) await nextFrame();

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
    if (!node.id || host.reviewId === undefined) return;

    return registerStageRenderer(host.reviewId, node.id, {
      show: (key) => show(key),
    });
  }, [host.reviewId, node.id]);

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

  const fixedHeight =
    node.type !== "diagram" && node.height !== "auto" ? node.height : null;

  // A diagram is one drawing its stage measures itself; an animation's
  // frames are measured by a hidden copy first.
  const stageHeight =
    fixedHeight !== null
      ? fixedHeight
      : diagram
        ? contentHeight
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
      // What a diagram's stage found drawn wrong, once its script has run:
      // the agent reads it through the server; tests and devtools here.
      data-stage-ran={diagram && runs > 0 ? "" : undefined}
      data-findings={
        diagram && findings.length ? findings.join("\n") : undefined
      }
      data-notes={diagram && notes.length ? notes.join("\n") : undefined}
      tabIndex={player.onFigureKeyDown ? 0 : undefined}
      onKeyDown={player.onFigureKeyDown}
    >
      <DiagramHeader
        kind={diagram ? "DIAGRAM" : clip ? "CLIP" : "ANIMATION"}
        title={node.title}
        meta={still ? undefined : `${activeIndex + 1} / ${player.stops.length}`}
        action={chrome.action}
      />
      {diagram?.description && (
        <p {...stylex.props(styles.description)}>{diagram.description}</p>
      )}
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
            style={
              scaled
                ? {
                    height: stageHeight,
                    width: inlineWidth,
                    transform: `scale(${scale})`,
                  }
                : undefined
            }
          >
            {/* The stage takes its height here, not from the box around it:
                a scrollbar under a wide stage then adds to the box instead
                of taking from the stage. */}
            <div
              {...stylex.props(styles.sheet)}
              style={{ minWidth, height: stageHeight }}
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

                      if (slotSizesRef.current.get(slot.slot) === height)
                        return;
                      slotSizesRef.current.set(slot.slot, height);
                      clearTimeout(remeasureTimer.current);
                      remeasureTimer.current = setTimeout(remeasure, 100);
                    }}
                  >
                    {slot.kind === "code"
                      ? codeEntry(node, slot.ref) && (
                          <CodePeekCard
                            source={anchorSelection(
                              codeEntry(node, slot.ref)!.source,
                              node.pins,
                            )}
                            heightMode="capped"
                            xstyle={styles.peek}
                          />
                        )
                      : embeddable.get(slot.ref) &&
                        host.renderBlocks([embeddable.get(slot.ref)!])}
                  </SlotOverlay>
                ))}
              </div>
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
      {player.controls !== null && (
        <div {...stylex.props(styles.controls)} onKeyDown={player.onKeyDown}>
          {player.controls}
        </div>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          The {noun} reported an error: {error}
        </p>
      )}
    </figure>
  );

  return chrome.frame(figure);
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
    // The stage keeps its width, and a narrower block scrolls it sideways
    // rather than folding the drawing.
    overflowX: "auto",
    overflowY: "hidden",
  },
  canvasScaled: {
    transformOrigin: "0 0",
  },
  // The stage and what the host draws over it, at the width and height the
  // stage asked.
  sheet: {
    position: "relative",
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
  description: {
    margin: 0,
    padding: `${space.s6} ${space.s12}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.inkMuted,
    font: `${fontSize.body}/${leading.normal} ${tokens.chromeFont}`,
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
