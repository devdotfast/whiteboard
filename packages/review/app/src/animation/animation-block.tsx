import type { BlockProps } from "@canvas/blocks";
import { CodePeekCard } from "@canvas/CodePeek";
import { DiagramHeader } from "@canvas/diagram-header";
import { drawStyles } from "@canvas/draw-styles";
import { useOptionalReviewSession } from "@canvas/host/review-session";
import { useOptionalReviewPanel } from "@canvas/review-panel";
import { fontSize, radius, tracking } from "@canvas/scale.stylex";
import { withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import { IconButton } from "@canvas/ui/button";
import { useTooltip } from "@canvas/use-tooltip";
import { anchorSelection } from "@review/lens-selection";
import { type Block, animationCodeId } from "@review/review-api/document";
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

import {
  type HostMessage,
  STAGE_BOOT,
  type SlotLayout,
  type StageInit,
  type StageMessage,
  stageMessageSchema,
} from "./stage-protocol";
import { stageRuntime } from "./stage-runtime";

const stageUrl = new URL("./stage.html", import.meta.url).href;

const DEFAULT_DURATION = 3000;

let animeSource: Promise<string> | undefined;

// anime.js's source, for the stage: its own chunk, fetched by the first
// animation rather than with the canvas.
const loadAnime = () =>
  (animeSource ??= import("@animejs-bundles/anime.umd.min.js?raw").then(
    (module) => module.default,
  ));

// The canvas properties a stage reads as --wb-<name>.
const THEME = {
  ink: "--ink",
  "ink-muted": "--ink-muted",
  "ink-faint": "--ink-faint",
  accent: "--accent",
  "accent-soft": "--accent-soft",
  "on-accent": "--on-accent",
  surface: "--surface",
  well: "--well",
  rule: "--rule",
  added: "--change-added",
  removed: "--change-removed",
  modified: "--change-modified",
  "added-bg": "--diff-added-bg",
  "removed-bg": "--diff-removed-bg",
  "modified-bg": "--diff-modified-bg",
  "font-sans": "--font-sans",
  "font-mono": "--font-mono",
  "font-serif": "--font-serif",
} as const;

function readTheme(element: Element): Record<string, string> {
  const computed = getComputedStyle(element);

  return Object.fromEntries(
    Object.entries(THEME).map(([name, property]) => [
      name,
      computed.getPropertyValue(property).trim(),
    ]),
  );
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
  const session = useOptionalReviewSession();
  const openPeek = useOptionalReviewPanel((state) => state.openPeek);
  const figureRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [settled, setSettled] = useState(-1);
  const [slots, setSlots] = useState<SlotLayout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;

  const embeddable = useMemo(
    () => embeddableBlocks(data.snapshot.document),
    [data.snapshot.document],
  );

  const frames = node.frames;
  const last = frames.length - 1;
  const frame = frames[Math.min(index, last)]!;
  const steps = frames.every((item) => item.label) ? frames : null;

  // A new stage for each edit of what it runs; frame changes reuse it.
  const stageKey = useMemo(
    () =>
      JSON.stringify([
        node.html,
        node.frames,
        node.code,
        [...embeddable.keys()],
      ]),
    [node.html, node.frames, node.code, embeddable],
  );

  const send = useCallback((message: HostMessage) => {
    portRef.current?.postMessage(message);
  }, []);

  const go = useCallback(
    (target: number, instant: boolean) => {
      const next = Math.max(0, Math.min(last, target));

      if (next === indexRef.current) return;
      setIndex(next);
      send({ type: "frame", index: next, instant });
    },
    [last, send],
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

  const onMessage = useRef<(message: StageMessage) => void>(() => {});

  onMessage.current = (message) => {
    switch (message.type) {
      case "slots":
        setSlots(message.slots);
        break;
      case "settled":
        setSettled(message.index);
        break;
      case "goto":
        go(
          frames.findIndex((item) => item.key === message.key),
          false,
        );
        break;
      case "step":
        go(indexRef.current + message.delta, false);

        break;
      case "reveal":
        reveal(message.name);
        break;
      case "error":
        setError(message.message);
        break;
      case "ready":
        break;
    }
  };

  // Hand the stage its runtime and a private port once its page loads.
  const boot = useCallback(() => {
    const target = frameRef.current?.contentWindow;
    const figure = figureRef.current;

    if (!target || !figure) return;
    portRef.current?.close();
    const channel = new MessageChannel();
    portRef.current = channel.port1;
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = stageMessageSchema.safeParse(event.data);

      if (message.success) onMessage.current(message.data);
    };

    setSlots([]);
    setError(null);
    target.postMessage(
      { type: STAGE_BOOT, runtime: stageRuntime.toString() },
      "*",
      [channel.port2],
    );

    const init: Omit<StageInit, "libraries"> = {
      type: "init",
      html: node.html,
      frames: frames.map(({ key, title, caption }) => ({
        key,
        title,
        caption,
      })),
      code: Object.keys(node.code),
      blocks: [...embeddable.keys()],
      theme: readTheme(figure),
      reducedMotion: reducedMotion(),
      frame: indexRef.current,
    };

    loadAnime().then(
      (source) =>
        channel.port1.postMessage({
          ...init,
          libraries: [source],
        } satisfies HostMessage),
      () => setError("The animation library could not be loaded."),
    );
  }, [node.html, node.code, frames, embeddable]);

  useEffect(() => () => portRef.current?.close(), []);

  // The canvas theme can change under a running stage.
  useEffect(
    () =>
      session?.surface.subscribe((event) => {
        if (event.event !== "themeChanged") return;
        requestAnimationFrame(() => {
          if (figureRef.current)
            send({ type: "theme", theme: readTheme(figureRef.current) });
        });
      }),
    [session, send],
  );

  // Play: hold each frame for its duration and until its motion ends.
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

    if (index >= last) setPlaying(false);
    else go(index + 1, false);
  }, [playing, timeUp, settled, index, last, go]);

  // An edit can drop frames from under the current one.
  useEffect(() => {
    if (index > last) setIndex(last);
  }, [index, last]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") go(index + 1, false);
    else if (event.key === "ArrowLeft") go(index - 1, false);
    else return;

    event.preventDefault();
  };

  return (
    <figure
      ref={figureRef}
      {...withClass("animation-block", styles.figure, drawStyles.blockChild)}
      aria-label={node.title}
    >
      <DiagramHeader
        kind="ANIMATION"
        title={node.title}
        meta={`${index + 1} / ${frames.length}`}
      />
      <div {...stylex.props(styles.stage)} style={{ height: node.height }}>
        <iframe
          key={stageKey}
          ref={frameRef}
          src={stageUrl}
          title={node.title}
          sandbox="allow-scripts"
          onLoad={boot}
          {...stylex.props(styles.frame)}
        />
        <div {...stylex.props(styles.overlays)}>
          {slots.map((slot) => (
            <SlotOverlay
              key={slot.slot}
              slot={slot}
              onHeight={(height) =>
                send({ type: "slot-size", slot: slot.slot, height })
              }
            >
              {slot.kind === "code"
                ? node.code[slot.ref] && (
                    <CodePeekCard
                      source={anchorSelection(node.code[slot.ref]!, node.pins)}
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
              aria-current={position === index ? "step" : undefined}
              onClick={() => go(position, Math.abs(position - index) > 1)}
              {...stylex.props(
                styles.step,
                position === index && styles.stepCurrent,
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
          disabled={index === 0}
          onClick={() => go(index - 1, false)}
        >
          <path d="M14.5 6.5 9 12l5.5 5.5" />
        </ControlButton>
        <ControlButton
          label={playing ? "Pause" : index >= last ? "Replay" : "Play"}
          onClick={() => {
            if (playing) return setPlaying(false);

            if (index >= last) go(0, true);

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
          disabled={index >= last}
          onClick={() => go(index + 1, false)}
        >
          <path d="M9.5 6.5 15 12l-5.5 5.5" />
        </ControlButton>
        <div {...stylex.props(styles.caption)} aria-live="polite">
          <strong data-review-copy-prose>{frame.title}</strong>
          {frame.caption && (
            <span data-review-copy-prose> {frame.caption}</span>
          )}
        </div>
        {!steps && (
          <div {...stylex.props(styles.dots)} role="group" aria-label="Frames">
            {frames.map((item, position) => (
              <FrameDot
                key={item.key}
                title={item.title}
                current={position === index}
                onClick={() => go(position, Math.abs(position - index) > 1)}
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

const styles = stylex.create({
  figure: {
    overflow: "hidden",
    margin: "18px 0 4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    font: `${fontSize.body}/1.5 ${tokens.fontMono}`,
  },
  stage: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: tokens.surface,
  },
  frame: {
    display: "block",
    width: "100%",
    height: "100%",
    borderWidth: 0,
    borderStyle: "none",
    colorScheme: "normal",
    backgroundColor: tokens.transparent,
  },
  // Over the stage but out of the pointer's way; each slot takes it back.
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
    gap: "4px",
    minHeight: "36px",
    padding: "0 12px 0 8px",
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
    marginLeft: "6px",
    paddingBlock: "8px",
    color: tokens.inkMuted,
    lineHeight: "18px",
  },
  dots: {
    display: "flex",
    flex: "0 0 auto",
    gap: "6px",
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
    display: "flex",
    overflowX: "auto",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  step: {
    display: "flex",
    flex: "1 1 0",
    alignItems: "center",
    justifyContent: "center",
    gap: "5px",
    minWidth: "fit-content",
    padding: "6px 10px",
    borderStyle: "none",
    borderBottomWidth: "2px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.transparent,
    backgroundColor: tokens.transparent,
    color: tokens.inkFaint,
    font: `${fontSize.micro} ${tokens.fontMono}`,
    letterSpacing: tracking.chrome,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: "-2px",
  },
  stepCurrent: {
    borderBottomColor: tokens.accent,
    color: tokens.ink,
  },
  stepIndex: {
    color: tokens.inkFaint,
  },
  error: {
    margin: 0,
    padding: "8px 12px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    color: tokens.changeRemoved,
  },
});
