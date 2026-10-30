import type { BlockProps } from "@canvas/blocks";
import { CodePeekCard } from "@canvas/CodePeek";
import { useReviewDebugSettings } from "@canvas/debug-settings";
import { DiagramHeader } from "@canvas/diagram-header";
import { diagramStyles } from "@canvas/diagram-styles";
import { useDiagramTourShell } from "@canvas/diagram-tour";
import { drawStyles } from "@canvas/draw-styles";
import { useOptionalReviewPanel } from "@canvas/review-panel";
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
import { Button, IconButton } from "@canvas/ui/button";
import { SegmentedControl } from "@canvas/ui/segmented";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import {
  type Block,
  anchorSelection,
  animationCode,
  animationCodeId,
} from "@dev.fast/whiteboard-document";
import { STAGE_KIT_CSS, STAGE_THEME } from "@review/animation-stage-kit";
import * as stylex from "@stylexjs/stylex";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useReportAnimationRun } from "./report-run";
import {
  type HostMessage,
  STAGE_BOOT,
  type SlotLayout,
  type StageInit,
  type StageMessage,
  stageMessageSchema,
} from "./stage-protocol";
import { stageRuntime } from "./stage-runtime";
import { SCALE } from "./stage-scale";

// Read on demand: a Worker may lack import.meta.url.
const stageUrl = () => new URL("./stage.html", import.meta.url).href;

const DEFAULT_DURATION = 3000;

// An auto-sized stage's height before it has reported one.
const STAGE_MIN_HEIGHT = 120;

// How long a new stage waits for its frames' measurement before it takes
// its current frame's height instead.
const MEASURE_WAIT = 1000;

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
    colorScheme: computed.colorScheme.includes("dark") ? "dark" : "light",
  };
}

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Blocks a stage may show with whiteboard.block(): any but animations,
 * which would nest stages. */
function embeddableBlocks(document: Block[]): Map<string, Block> {
  const found = new Map<string, Block>();

  const visit = (block: Block) => {
    if (block.id && block.type !== "animation") found.set(block.id, block);

    if ("children" in block) block.children.forEach(visit);
  };

  document.forEach(visit);

  return found;
}

/**
 * An agent's HTML animation, run in a sandboxed stage. Whiteboard pieces the
 * stage asks for (code peeks, other blocks) are drawn here, over the
 * placeholders the stage lays out, so they are the real components.
 */
export function AnimationBlock({
  node,
  data,
  children,
}: BlockProps<"animation">) {
  const { theme } = useReviewDebugSettings();
  const openPeek = useOptionalReviewPanel((state) => state.openPeek);
  const figureRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const [index, setIndex] = useState(0);
  const [sequenceKeys, setSequenceKeys] = useState<string[] | null>(null);
  const sequenceRef = useRef<string[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [settled, setSettled] = useState(-1);
  const [contentHeight, setContentHeight] = useState(STAGE_MIN_HEIGHT);
  // The tallest frame of the scenario, from a hidden measuring copy.
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [measureRun, setMeasureRun] = useState<number | null>(null);
  const [measureLate, setMeasureLate] = useState(false);
  const slotSizesRef = useRef(new Map<string, number>());
  const remeasureTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const measureRuns = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<SlotLayout[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reportRun = useReportAnimationRun(data.snapshot.reviewId, node.id);

  // The inline figure's height while it is out fullscreen, held by a
  // placeholder so the document keeps its place.
  const [expanded, setExpanded] = useState<number | null>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const indexRef = useRef(index);
  indexRef.current = index;

  const embeddable = useMemo(
    () => embeddableBlocks(data.snapshot.document),
    [data.snapshot.document],
  );

  const frames = node.frames;

  const activeFrames = useMemo(() => {
    if (!sequenceKeys) return frames;
    const byKey = new Map(frames.map((item) => [item.key, item]));

    return sequenceKeys.flatMap((key) => {
      const item = byKey.get(key);

      return item ? [item] : [];
    });
  }, [frames, sequenceKeys]);

  const last = activeFrames.length - 1;
  const frame = frames[Math.min(index, frames.length - 1)]!;

  const activeIndex = Math.max(
    0,
    activeFrames.findIndex((item) => item.key === frame.key),
  );

  const steps = activeFrames.every((item) => item.label) ? activeFrames : null;

  // A new stage for each edit of what it runs; frame changes reuse it.
  const stageKey = useMemo(
    () =>
      JSON.stringify([
        node.html,
        node.height,
        node.frames,
        node.code,
        [...embeddable.keys()],
      ]),
    [node.html, node.height, node.frames, node.code, embeddable],
  );

  const send = useCallback((message: HostMessage) => {
    portRef.current?.postMessage(message);
  }, []);

  const go = useCallback(
    (target: number, instant: boolean) => {
      const keys = sequenceRef.current;

      const path = keys
        ? keys.flatMap((key) => {
            const item = frames.find((candidate) => candidate.key === key);

            return item ? [item] : [];
          })
        : frames;

      const currentKey = frames[indexRef.current]?.key;
      const currentPosition = path.findIndex((item) => item.key === currentKey);
      const position = Math.max(0, Math.min(path.length - 1, target));
      const next = frames.findIndex((item) => item.key === path[position]?.key);

      if (next < 0 || next === indexRef.current) return;
      setIndex(next);
      send({
        type: "frame",
        index: next,
        instant,
        direction:
          currentPosition < 0 || position === currentPosition
            ? "none"
            : position > currentPosition
              ? "forward"
              : "backward",
        adjacent: currentPosition >= 0 && position === currentPosition + 1,
      });
    },
    [frames, send],
  );

  const reveal = useCallback(
    (name: string) => {
      const anchor = data.anchors.get(animationCodeId(node.id, name));

      if (!anchor || !openPeek) return;
      openPeek({
        kind: "peek",
        anchor,
        content: { kind: "source", source: anchor.peek },
      });
    },
    [data.anchors, node.id, openPeek],
  );

  // A stage script's setSequence() and the scenario picker both land here.
  const selectSequence = (keys: string[]) => {
    const unique = new Set(keys);

    const valid =
      unique.size === keys.length &&
      keys.every((key) => frames.some((frame) => frame.key === key));

    if (!valid) return;

    if (
      sequenceRef.current?.length === keys.length &&
      sequenceRef.current.every((key, index) => key === keys[index])
    )
      return;

    sequenceRef.current = keys;
    setSequenceKeys(keys);
    setPlaying(false);
    setTimeUp(-1);
    const currentKey = frames[indexRef.current]?.key;

    const fallback = frames.findIndex((frame) => frame.key === keys[0]);

    const next = keys.includes(currentKey) ? indexRef.current : fallback;

    if (next !== indexRef.current) setIndex(next);

    // Refresh even a preserved key: lifecycle ranges, held scene changes,
    // and its timeline can differ when active order changes.
    send({
      type: "frame",
      index: next,
      instant: true,
      direction: "none",
      adjacent: false,
    });
  };

  const onMessage = useRef<(message: StageMessage) => void>(() => {});

  onMessage.current = (message) => {
    switch (message.type) {
      case "size":
        setContentHeight(Math.ceil(message.height));
        break;
      case "slots":
        setSlots(message.slots);
        break;
      case "settled":
        setSettled(message.index);
        break;
      case "goto": {
        const keys = sequenceRef.current;
        const path = keys ?? frames.map((item) => item.key);
        const position = path.indexOf(message.key);
        go(position, true);
        break;
      }

      case "step": {
        const keys = sequenceRef.current;
        const path = keys ?? frames.map((item) => item.key);
        const currentKey = frames[indexRef.current]?.key;
        go(path.indexOf(currentKey) + message.delta, false);
        break;
      }

      case "sequence":
        selectSequence(message.keys);
        break;

      case "reveal":
        reveal(message.name);
        break;
      case "error":
        setError(message.message);
        reportRun(message.message);
        break;
      case "ready":
        reportRun(null);
        break;
    }
  };

  const stageInit = useCallback(
    async (
      figure: Element,
      frame: number,
      sequence: string[] | null,
    ): Promise<StageInit> => {
      const [anime, fonts] = await Promise.all([loadAnime(), loadFonts()]);

      return {
        type: "init",
        html: node.html,
        kit: STAGE_KIT_CSS,
        autoSize: node.height === "auto",
        frames: frames.map(({ key, title, caption, data, code }) => ({
          key,
          title,
          caption,
          data,
          code,
        })),
        code: Object.keys(node.code),
        codeTitles: codeTitles(node, data.anchors),
        blocks: [...embeddable.keys()],
        ...readTheme(figure),
        scale: SCALE,
        reducedMotion: reducedMotion(),
        frame,
        ...(sequence && { sequence }),
        libraries: [anime],
        fonts,
      };
    },
    [node, frames, data.anchors, embeddable],
  );

  const bootedRef = useRef<HTMLIFrameElement | null>(null);

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
      setError("The animation left its stage.");

      return;
    }

    bootedRef.current = frameRef.current;
    const channel = new MessageChannel();
    portRef.current = channel.port1;
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = stageMessageSchema.safeParse(event.data);

      if (message.success) onMessage.current(message.data);
    };

    // A new stage starts in the scenario the reader had picked, or the first.
    const sequence =
      (
        node.scenarios?.find((scenario) =>
          sameKeys(scenario.frames, sequenceRef.current),
        ) ?? node.scenarios?.[0]
      )?.frames ?? null;

    sequenceRef.current = sequence;
    setSequenceKeys(sequence);

    if (sequence && !sequence.includes(frames[indexRef.current]!.key)) {
      indexRef.current = frames.findIndex((item) => item.key === sequence[0]);
      setIndex(indexRef.current);
    }

    setSlots([]);
    setError(null);
    target.postMessage(
      { type: STAGE_BOOT, runtime: stageRuntime.toString() },
      "*",
      [channel.port2],
    );

    stageInit(figure, indexRef.current, sequence).then(
      (init) => channel.port1.postMessage(init satisfies HostMessage),
      () => setError("The animation libraries or fonts could not be loaded."),
    );
  }, [node.scenarios, frames, stageInit]);

  useEffect(() => () => portRef.current?.close(), []);

  // Read after React commits the matching theme class. Listening to the host
  // event directly can race that commit and export a mixed palette (new neutral
  // workbench colors with the previous semantic surface colors).
  useLayoutEffect(() => {
    if (figureRef.current)
      send({ type: "theme", ...readTheme(figureRef.current) });
  }, [theme, send]);

  // Play: hold each active-sequence frame for its duration and until its motion ends.
  const [timeUp, setTimeUp] = useState(-1);

  useEffect(() => {
    if (!playing) return;

    const timer = setTimeout(
      () => setTimeUp(index),
      frame.duration ?? DEFAULT_DURATION,
    );

    return () => clearTimeout(timer);
  }, [playing, index, frame.duration]);

  useEffect(() => {
    if (!playing || timeUp !== index || settled !== index) return;

    if (activeIndex >= last) setPlaying(false);
    else go(activeIndex + 1, false);
  }, [playing, timeUp, settled, index, activeIndex, last, go]);

  // An edit can drop frames or a sequence selection from under the current one.
  useEffect(() => {
    if (!activeFrames.some((item) => item.key === frame.key)) go(0, true);
  }, [activeFrames, frame.key, go]);

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

  useEffect(() => remeasure(), [sequenceKeys, theme, remeasure]);
  useEffect(() => () => clearTimeout(remeasureTimer.current), []);

  const collapse = useCallback(() => setExpanded(null), []);

  const { portalTarget } = useDiagramTourShell(expanded !== null, collapse);

  // Focus follows the figure in and back out to the control that opened it.
  const wasExpanded = useRef(false);

  useEffect(() => {
    if (expanded !== null) closeRef.current?.focus();
    else if (wasExpanded.current) expandRef.current?.focus();

    wasExpanded.current = expanded !== null;
  }, [expanded]);

  const fullscreen = expanded !== null && portalTarget !== null;

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

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") go(activeIndex + 1, false);
    else if (event.key === "ArrowLeft") go(activeIndex - 1, false);
    else return;

    event.preventDefault();
  };

  const figure = (
    <figure
      ref={figureRef}
      {...withClass(
        "animation-block",
        styles.figure,
        fullscreen && styles.figureFullscreen,
        drawStyles.blockChild,
      )}
      aria-label={node.title}
    >
      <DiagramHeader
        kind="ANIMATION"
        title={node.title}
        titleStyle={styles.headerTitle}
        meta={`${activeIndex + 1} / ${activeFrames.length}`}
        action={
          <Button
            ref={fullscreen ? closeRef : expandRef}
            xstyle={diagramStyles.button}
            aria-label={
              fullscreen ? "Close expanded animation" : "Expand animation"
            }
            onClick={() =>
              fullscreen
                ? collapse()
                : setExpanded(figureRef.current?.offsetHeight ?? 0)
            }
          >
            {fullscreen ? "Close" : "Expand"}
          </Button>
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
            value={
              node.scenarios.find((scenario) =>
                sameKeys(scenario.frames, sequenceKeys),
              )?.key
            }
            options={node.scenarios.map(({ key, label }) => ({
              value: key,
              label,
            }))}
            onChange={(key) => {
              const keys = node.scenarios!.find(
                (scenario) => scenario.key === key,
              )!.frames;

              send({ type: "sequence", keys });
              selectSequence(keys);
            }}
          />
        </div>
      )}
      <div
        {...stylex.props(styles.stage, fullscreen && styles.stageFullscreen)}
      >
        <div
          ref={canvasRef}
          {...stylex.props(styles.canvas)}
          style={{
            height:
              node.height !== "auto"
                ? node.height
                : measuredHeight || measureLate
                  ? Math.max(contentHeight, measuredHeight)
                  : STAGE_MIN_HEIGHT,
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
          {node.height === "auto" && measureRun !== null && (
            <MeasuringStage
              key={measureRun}
              init={() => {
                const first = sequenceRef.current?.[0];

                return stageInit(
                  figureRef.current!,
                  first ? frames.findIndex((item) => item.key === first) : 0,
                  sequenceRef.current,
                ).then((init) => ({
                  ...init,
                  measure: true,
                  slotSizes: Object.fromEntries(slotSizesRef.current),
                }));
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
      {steps && (
        <div
          {...stylex.props(styles.steps)}
          role="group"
          aria-label="Steps"
          onKeyDown={onKeyDown}
        >
          {steps.map((item, position) => (
            <button
              key={item.key}
              type="button"
              aria-current={position === activeIndex ? "step" : undefined}
              onClick={() => go(position, Math.abs(position - activeIndex) > 1)}
              {...stylex.props(
                styles.step,
                position === activeIndex && styles.stepCurrent,
              )}
            >
              <span {...stylex.props(styles.stepIndex)}>{position + 1}</span>
              <span data-review-copy-prose>{item.label}</span>
            </button>
          ))}
        </div>
      )}
      <div {...stylex.props(styles.controls)} onKeyDown={onKeyDown}>
        <ControlButton
          label="Previous frame"
          disabled={activeIndex === 0}
          onClick={() => go(activeIndex - 1, false)}
        >
          <path d="M14.5 6.5 9 12l5.5 5.5" />
        </ControlButton>
        <ControlButton
          label={playing ? "Pause" : activeIndex >= last ? "Replay" : "Play"}
          onClick={() => {
            if (playing) return setPlaying(false);

            if (activeIndex >= last) go(0, true);

            setPlaying(true);
          }}
        >
          {playing ? (
            <path d="M9 6.5v11M15 6.5v11" />
          ) : (
            <path d="M8.5 6.5v11l9-5.5z" />
          )}
        </ControlButton>
        <ControlButton
          label="Next frame"
          disabled={activeIndex >= last}
          onClick={() => go(activeIndex + 1, false)}
        >
          <path d="M9.5 6.5 15 12l-5.5 5.5" />
        </ControlButton>
        {/* Every caption shares one cell, so the row keeps the tallest. */}
        <div {...stylex.props(styles.caption)} aria-live="polite">
          {activeFrames.map((item) => {
            const current = item.key === frame.key;

            return (
              <div
                key={item.key}
                {...stylex.props(
                  styles.captionText,
                  !current && styles.captionHidden,
                )}
              >
                <strong data-review-copy-prose={current || undefined}>
                  {item.title}
                </strong>
                {item.caption && (
                  <span data-review-copy-prose={current || undefined}>
                    {" "}
                    {item.caption}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {!steps && (
          <div {...stylex.props(styles.dots)} role="group" aria-label="Frames">
            {activeFrames.map((item, position) => (
              <FrameDot
                key={item.key}
                title={item.title}
                current={position === activeIndex}
                onClick={() =>
                  go(position, Math.abs(position - activeIndex) > 1)
                }
              />
            ))}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          The animation reported an error: {error}
        </p>
      )}
    </figure>
  );

  if (!fullscreen) return figure;

  // Portaled outside .review-app, so it carries the theme itself, as the
  // diagram tour overlay does.
  return (
    <>
      <div aria-hidden="true" style={{ height: expanded }} />
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
          aria-label={node.title ?? "Animation"}
        >
          {figure}
        </div>,
        portalTarget,
      )}
    </>
  );
}

const sameKeys = (left: readonly string[], right: readonly string[] | null) =>
  right?.length === left.length && left.every((key, i) => key === right[i]);

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

function ControlButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  const tooltip = useTooltip(label, { quick: true });

  return (
    <IconButton
      ref={tooltip}
      aria-label={label}
      size="small"
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        {...stylex.props(styles.icon)}
      >
        {children}
      </svg>
    </IconButton>
  );
}

/** What hovering a drawn element that opens code says: its label, file and
 * lines. */
function codeTitles(
  node: BlockProps<"animation">["node"],
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

function FrameDot({
  title,
  current,
  onClick,
}: {
  title: string;
  current: boolean;
  onClick(): void;
}) {
  const tooltip = useTooltip(title, { instant: true });

  return (
    <button
      ref={tooltip}
      type="button"
      aria-label={title}
      aria-current={current ? "step" : undefined}
      onClick={onClick}
      {...stylex.props(styles.dot, current && styles.dotCurrent)}
    />
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
    justifyContent: "safe center",
    minHeight: 0,
    overflowY: "auto",
    padding: { default: space.s32, [narrow]: space.s16 },
  },
  canvas: {
    position: "relative",
    flex: "0 0 auto",
    overflow: "hidden",
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
  icon: {
    width: "16px",
    height: "16px",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  caption: {
    flex: "1 1 auto",
    minWidth: 0,
    marginLeft: space.s6,
    paddingBlock: space.s8,
    display: "grid",
    color: tokens.inkMuted,
    lineHeight: leading.px18,
  },
  captionText: {
    gridArea: "1 / 1",
  },
  captionHidden: {
    visibility: "hidden",
  },
  dots: {
    display: "flex",
    flex: "0 0 auto",
    gap: space.s6,
  },
  dot: {
    width: "8px",
    height: "8px",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.inkFaint,
    borderRadius: radius.round,
    backgroundColor: tokens.transparent,
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: "2px",
  },
  dotCurrent: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
  },
  // A named step per frame, like a progress strip, instead of plain dots.
  steps: {
    display: { default: "flex", [narrow]: "grid" },
    gridTemplateColumns: {
      default: null,
      [narrow]: "repeat(4, minmax(0, 1fr))",
    },
    overflowX: { default: "auto", [narrow]: "visible" },
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  step: {
    display: "flex",
    flex: "1 1 0",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s4,
    minWidth: { default: "fit-content", [narrow]: 0 },
    padding: {
      default: `${space.s6} ${space.s10}`,
      [narrow]: `${space.s6} ${space.s4}`,
    },
    borderStyle: "none",
    borderBottomWidth: "2px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.transparent,
    backgroundColor: tokens.transparent,
    color: tokens.inkMuted,
    font: `${fontSize.micro} ${tokens.fontMono}`,
    letterSpacing: tracking.chrome,
    textAlign: "center",
    textTransform: "uppercase",
    whiteSpace: { default: "nowrap", [narrow]: "normal" },
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: "-2px",
  },
  stepCurrent: {
    borderBottomColor: tokens.accent,
    color: tokens.ink,
  },
  stepIndex: {
    color: "inherit",
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
