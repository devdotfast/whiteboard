import type * as Anime from "animejs";
import type {
  AnimationParams,
  TargetsParam,
  Timeline,
  TimelinePosition,
} from "animejs";

import type {
  HostMessage,
  SlotLayout,
  StageColorScheme,
  StageFrame,
  StageInit,
  StageMessage,
} from "./stage-protocol";

declare global {
  interface Window {
    /** anime.js, in the animation stage only: its UMD build sets it. */
    anime?: typeof Anime;
  }
}

/** What a frame handler learns about the change that called it. */
export interface FrameChange {
  frame: StageFrame & { index: number };
  previous: (StageFrame & { index: number }) | undefined;
  direction: "forward" | "backward" | "none";
  /** The change skips motion: a jump, the first draw, or reduced motion. */
  instant: boolean;
}

type FrameResult = void | Animation | readonly Animation[] | Promise<void>;

type FrameHandler = (change: FrameChange) => FrameResult;

type Tone = "accent" | "added" | "removed" | "modified" | "muted";

/** Where a scene part sits: 1-based column and row, with optional row and
 * column spans. A wide peek spans columns: [1, 2, 1, 4] is row 2, four wide. */
export type Cell = [
  column: number,
  row: number,
  rowSpan?: number,
  colSpan?: number,
];

export interface SceneCardOptions {
  id: string;
  at: Cell;
  title?: string;
  /** The second line under the title; scene.on changes it per frame. */
  note?: string;
  tone?: Tone;
  /** Show from this frame on, hide from this one on, or only on these. */
  enter?: string;
  exit?: string;
  only?: string[];
  /** Frames during which the card is highlighted. */
  highlight?: string[];
}

export interface SceneItemOptions {
  enter?: string;
  exit?: string;
  only?: string[];
  tone?: Tone;
}

/** A per-frame change to a card, item, or badge, applied by scene.on. */
export interface SceneChange {
  /** The card's note line, or an item's or badge's text. `note` is accepted
   * as an alias, since that is the field cards declare. */
  text?: string;
  /** A tone, or "none" to clear it back to the neutral surface. */
  tone?: Tone | "none";
}

export interface SceneLinkOptions {
  label?: string;
  tone?: Tone;
  /** Dashed means async: a reply, a stream, a background send. */
  dashed?: boolean;
  /** Whether to draw an arrowhead. Defaults to true. */
  arrowhead?: boolean;
  enter?: string;
  exit?: string;
  only?: string[];
}

export interface SceneSendOptions {
  tone?: Tone;
  /** Keep the chip at the target instead of fading it out on arrival. */
  stay?: boolean;
  enter?: string;
  exit?: string;
  /** The only frames in which the chip is visible. */
  only?: string[];
}

/** A reference to a scene card: the card, its id, or its element. */
export type CardRef = SceneCard | string | Element;

export interface SceneCard {
  readonly element: HTMLElement;
  readonly id: string;
}

export interface SceneStore extends SceneCard {
  /** A small chip inside the store, e.g. one stored file. */
  item(label: string, options?: SceneItemOptions): HTMLElement;
}

export interface SceneTable extends SceneCard {
  /** A row of cells, matching the table's columns. */
  row(cells: string[], options?: SceneItemOptions): HTMLTableRowElement;
}

export interface SceneOptions {
  columns?: number;
  /** A selector or element to put the scene inside; defaults to document.body. */
  container?: string | HTMLElement;
  /** Stack cards when their cells become too narrow. Defaults to true. */
  responsive?: boolean;
}

export interface Scene {
  /** A labeled card: a service, a process, an actor. */
  actor(options: SceneCardOptions): SceneCard;
  /** A card that holds items, e.g. an object store. */
  store(options: SceneCardOptions): SceneStore;
  /** A card holding a small table with a header row. */
  table(options: SceneCardOptions & { columns: string[] }): SceneTable;
  /** A cell holding a code peek by name (as whiteboard.code). */
  peek(
    name: string,
    options: {
      at: Cell;
      enter?: string;
      exit?: string;
      only?: string[];
    },
  ): HTMLElement;
  /** A small pill above the scene; scene.on changes its text per frame. */
  badge(options: { text?: string; tone?: Tone }): HTMLElement;
  /** Change a card, item, or badge from this frame on: its text or tone.
   * The change holds until the next frame that changes the same part. */
  on(frame: string, part: CardRef, change: SceneChange): void;
  /** A straight edge between two cards that follows them as they move. */
  link(from: CardRef, to: CardRef, options?: SceneLinkOptions): SVGGElement;
  /** A chip that rides the edge from one card to another during a frame. It
   * moves at a fixed speed and fades out on arrival. */
  send(
    from: CardRef,
    to: CardRef,
    label: string,
    frame: string,
    options?: SceneSendOptions,
  ): void;
}

export interface ArrowOptions {
  label?: string;
  tone?: Tone;
  dashed?: boolean;
  /** Whether to draw an arrowhead. Defaults to true. */
  arrowhead?: boolean;
  /** Pixels the arrow bows to its left; negative bows it right. */
  bend?: number;
  /** The frame the arrow draws in on, and the frame it leaves on. */
  enter?: string;
  exit?: string;
  /** The only frames the arrow shows in. */
  only?: string[];
  /** Frames during which the arrow is highlighted. */
  highlight?: string[];
}

export interface TokenOptions {
  label?: string;
  tone?: Tone;
  /** Show the token at its authored position without requiring travel(). */
  visible?: boolean;
  /** The frame the token appears in, and the frame it leaves in. */
  enter?: string;
  exit?: string;
  /** The only frames the token shows in. */
  only?: string[];
}

/** One frame's part of the stage timeline. Numeric positions count from the
 * frame's start; strings are anime.js positions. */
export interface FrameTimeline {
  add(
    targets: TargetsParam,
    params: AnimationParams,
    position?: TimelinePosition,
  ): FrameTimeline;
  set(
    targets: TargetsParam,
    params: AnimationParams,
    position?: TimelinePosition,
  ): FrameTimeline;
  call(callback: () => void, position?: TimelinePosition): FrameTimeline;
}

/** The global `whiteboard` the stage's scripts call. */
export interface WhiteboardShim {
  readonly frames: readonly (StageFrame & { index: number })[];
  readonly frame: StageFrame & { index: number };
  readonly theme: Readonly<Record<string, string>>;
  /** Whether the whiteboard's theme is light or dark. */
  readonly colorScheme: StageColorScheme;
  readonly reducedMotion: boolean;
  /** A placeholder the host fills with the named code peek. */
  code(name: string): HTMLElement;
  /** A placeholder the host fills with another block of this whiteboard. */
  block(id: string): HTMLElement;
  /** Run when a frame shows; "*" runs on every frame. */
  on(key: string, handler: FrameHandler): () => void;
  /** element.animate that holds its end state and honors instant changes. */
  animate(
    target: Element | string,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    options?: number | KeyframeAnimationOptions,
  ): Animation;
  /** Select the ordered frame path used by host controls. Every key must name
   * a declared frame. The current frame is preserved when possible; otherwise
   * the host moves to the path's first frame. */
  setSequence(keys: readonly string[]): void;
  /** Show an active-sequence frame with this key. */
  goto(key: string): void;
  next(): void;
  prev(): void;
  /** Open the named code in the editor. */
  reveal(name: string): void;
  /** anime.js v4, also the global `anime`. */
  readonly anime: typeof Anime;
  /** A grid of cards, edges and chips with consistent spacing and routing.
   * Prefer it to arrow/token for request-flow and state diagrams. */
  scene(options?: SceneOptions): Scene;
  /** Removed. Throws, so a stage written for it says how to rebuild. */
  mermaid(...args: unknown[]): never;
  /** The frame's segment of the stage timeline: it plays when the reader
   * steps into the frame, and lands at its end on a jump. */
  timeline(key: string): FrameTimeline;
  /** An SVG arrow between two elements that follows them as they move. */
  arrow(from: CardRef, to: CardRef, options?: ArrowOptions): SVGGElement;
  /** A dot, or a pill with a label, that travel() moves along arrows.
   * Pass `visible` for a static marker at its authored position. */
  token(options?: TokenOptions): HTMLElement;
  /** Move a token along an arrow during a frame. It fades out on arrival
   * unless `stay` keeps it at the arrow's head. */
  travel(
    token: HTMLElement | string,
    arrow: SVGGElement,
    frame: string,
    options?: {
      duration?: number;
      ease?: string;
      position?: TimelinePosition;
      stay?: boolean;
    },
  ): void;
}

/**
 * The stage's whole runtime. The block sends this function's source to the
 * stage page, which runs it with the port, so it must not reference anything
 * outside its own body: no imports and no module-level values.
 */
export function stageRuntime(port: MessagePort): void {
  const root = document.documentElement;
  const post = (message: StageMessage) => port.postMessage(message);

  // The host shows the first 2000 characters.
  const fail = (message: string) =>
    post({ type: "error", message: message.slice(0, 2000) });

  addEventListener("error", (event) => {
    // A ResizeObserver whose callback resizes what it watches gets the rest
    // next frame. Chromium reports that as an error, but nothing failed.
    if (event.message.startsWith("ResizeObserver loop")) return;
    fail(event.message);
  });
  addEventListener("unhandledrejection", (event) => fail(String(event.reason)));

  // scene.on() takes untyped JS. Accept `note` as an alias for `text` (the
  // field cards declare), and fail loudly on any other key rather than
  // ignoring it, so a typo'd change never passes silently.
  const normalizeChange = (change: SceneChange): SceneChange => {
    for (const key of Object.keys(change))
      if (key !== "text" && key !== "tone" && key !== "note")
        throw new Error(
          `scene.on(): no change field "${key}" — use { text, tone }.`,
        );

    // SAFETY: `note` is the untyped alias for the note-line text.
    const note = (change as { note?: string }).note;

    return { text: change.text ?? note, tone: change.tone };
  };

  let init: StageInit | undefined;
  let current = -1;
  let showing = 0;
  let instantMode = false;
  let activeSequence: string[] | undefined;
  const handlers = new Map<string, Set<FrameHandler>>();
  let theme: Record<string, string> = {};
  let colorScheme: StageColorScheme = "dark";
  let nextSlot = 0;
  let nextSceneId = 0;
  let nextArrowClipId = 0;

  // Scene parts set a value per frame; these run on every frame change so a
  // jump lands on the right one.
  const sceneAppliers: ((key: string) => void)[] = [];

  const declaredFrames = () =>
    (init?.frames ?? []).map((frame, index) => ({ ...frame, index }));

  const frameIndex = (key: string) =>
    (init?.frames ?? []).findIndex((frame) => frame.key === key);

  const activeFrames = () => {
    const declared = declaredFrames();

    const ordered = activeSequence
      ? activeSequence.flatMap((key) => {
          const frame = declared.find((item) => item.key === key);

          return frame ? [frame] : [];
        })
      : declared;

    return ordered.map((frame, index) => ({ ...frame, index }));
  };

  const activeFrameIndex = (key: string) =>
    activeFrames().findIndex((frame) => frame.key === key);

  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const style = document.createElement("style");
  style.textContent = `
:root { --wb-duration: 450ms; color-scheme: light dark; }
*, *::before, *::after { box-sizing: border-box; }
button { color: inherit; font: inherit; }
html, body { margin: 0; height: 100%; }
html[data-wb-auto-size] body { height: auto; display: flow-root; }
body {
  overflow: hidden;
  background: transparent;
  color: var(--wb-ink);
  font: var(--wb-text-ui)/var(--wb-leading-normal) var(--wb-font-sans);
}
[data-enter], [data-exit], [data-only] {
  transition: opacity var(--wb-duration) ease, visibility 0s linear 0s;
}
[data-wb-state="before"], [data-wb-state="after"] {
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--wb-duration) ease, visibility 0s linear var(--wb-duration);
}
.wb-arrow[data-wb-state="before"] text, .wb-arrow[data-wb-state="after"] text { visibility: hidden; }
[data-wb-slot] { display: block; max-width: 100%; min-height: 40px; }

/* Layout. */
.wb-row { display: flex; align-items: center; justify-content: space-around; gap: var(--wb-space-48); padding: var(--wb-space-20) var(--wb-space-24); }
.wb-stack { display: flex; flex-direction: column; align-items: center; gap: var(--wb-space-20); padding: var(--wb-space-20) var(--wb-space-24); }
.wb-grid { display: grid; grid-template-columns: repeat(var(--wb-columns, 3), minmax(0, 1fr)); gap: var(--wb-space-16); padding: var(--wb-space-20) var(--wb-space-24); align-items: start; }
.wb-layers { display: grid; justify-items: center; align-items: start; }
.wb-layers > * { grid-area: 1 / 1; }
.wb-lane { position: relative; min-height: var(--wb-space-32); }
.wb-lane::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px dashed var(--wb-rule-soft); }

/* Text. */
.wb-title { margin: 0; color: var(--wb-ink); font: var(--wb-weight-semibold) var(--wb-text-title)/var(--wb-leading-tight) var(--wb-font-sans); }
.wb-caps { color: var(--wb-ink-muted); font: var(--wb-text-micro)/var(--wb-leading-normal) var(--wb-font-mono); letter-spacing: var(--wb-tracking-chrome); text-transform: uppercase; }
.wb-prose { margin: 0; color: var(--wb-ink); font: var(--wb-text-reading)/var(--wb-leading-prose) var(--wb-font-serif); }
.wb-mono { font-family: var(--wb-font-mono); }
.wb-code { padding: 0 var(--wb-space-4); border-radius: var(--wb-radius-small); background: var(--wb-well); color: var(--wb-ink); font-family: var(--wb-font-code); }
.wb-muted { color: var(--wb-ink-muted); }
.wb-faint { color: var(--wb-ink-faint); }

/* Surfaces. A card is the scene's box; a node is a card for a hand-made
   layout, centered and with a minimum width. */
.wb-card, .wb-node {
  min-width: 0;
  padding: var(--wb-space-8) var(--wb-space-12);
  border: 1px solid var(--wb-rule);
  border-radius: var(--wb-radius-surface);
  background: var(--wb-surface);
  color: var(--wb-ink);
  font: var(--wb-text-body)/var(--wb-leading-normal) var(--wb-font-mono);
  transition: opacity var(--wb-duration) ease, border-color var(--wb-duration) ease,
    background-color var(--wb-duration) ease, box-shadow var(--wb-duration) ease;
}
.wb-card { display: flex; flex-direction: column; gap: var(--wb-space-4); }
.wb-node { min-width: 88px; text-align: center; }
.wb-node small { display: block; color: var(--wb-ink-faint); font-size: var(--wb-text-micro); }
.wb-card-head { display: flex; align-items: center; gap: var(--wb-space-6); }
.wb-card-dot { flex: none; width: 7px; height: 7px; border-radius: var(--wb-radius-round); background: var(--wb-ink-faint); }
.wb-card-title { min-width: 0; overflow-wrap: anywhere; font-weight: var(--wb-weight-semibold); }
.wb-card-note { color: var(--wb-ink-muted); overflow-wrap: anywhere; font-size: var(--wb-text-micro); min-height: 12px; }
.wb-well { padding: var(--wb-space-12); border: 1px solid var(--wb-rule-soft); border-radius: var(--wb-radius-surface); background: var(--wb-well); }
.wb-well :is(.wb-item, .wb-chip, .wb-badge, .wb-code) { background: var(--wb-surface); }
.wb-rule { margin: var(--wb-space-12) 0; border: 0; border-top: 1px solid var(--wb-rule); }

/* Chips: a badge is a pill for a status, an item a chip in a list. */
.wb-items { display: flex; flex-wrap: wrap; gap: var(--wb-space-4); margin-top: var(--wb-space-2); }
.wb-item, .wb-chip {
  display: inline-block;
  padding: var(--wb-space-2) var(--wb-space-6);
  border: 1px solid var(--wb-rule);
  border-radius: var(--wb-radius-control);
  background: var(--wb-well);
  color: var(--wb-ink-muted);
  font: var(--wb-text-micro)/var(--wb-leading-normal) var(--wb-font-mono);
  transition: opacity var(--wb-duration) ease, border-color var(--wb-duration) ease, background-color var(--wb-duration) ease;
}
.wb-badge {
  display: inline-block;
  padding: var(--wb-space-2) var(--wb-space-8);
  border: 1px solid var(--wb-rule);
  border-radius: var(--wb-radius-pill);
  background: var(--wb-well);
  color: var(--wb-ink-muted);
  font: var(--wb-text-micro)/var(--wb-leading-normal) var(--wb-font-mono);
  letter-spacing: var(--wb-tracking-chrome);
}

/* Data. */
.wb-table { width: 100%; table-layout: fixed; margin-top: var(--wb-space-2); border-collapse: collapse; font: var(--wb-text-micro)/var(--wb-leading-normal) var(--wb-font-mono); }
.wb-table th, .wb-table td { padding: var(--wb-space-2) var(--wb-space-6); text-align: left; border-bottom: 1px solid var(--wb-rule); white-space: normal; overflow-wrap: anywhere; }
.wb-table th { color: var(--wb-ink-muted); font-weight: var(--wb-weight-semibold); }
.wb-table td { color: var(--wb-ink-muted); }

/* SVG: a shape drawn like a card, and text set inside it. */
.wb-shape { fill: var(--wb-surface); stroke: var(--wb-rule); stroke-width: 1; vector-effect: non-scaling-stroke; transition: fill var(--wb-duration) ease, stroke var(--wb-duration) ease; }
.wb-shape-text { fill: var(--wb-ink); font: var(--wb-text-body) var(--wb-font-mono); }

/* Tones: what a change adds, removes or alters; accent draws the eye and
   muted recedes. Every kit part takes data-tone. */
:is(.wb-card, .wb-node)[data-tone="accent"] { border-color: var(--wb-accent); }
:is(.wb-card, .wb-node, .wb-item, .wb-chip)[data-tone="added"] { border-color: var(--wb-added); background: var(--wb-added-bg); }
:is(.wb-card, .wb-node, .wb-item, .wb-chip)[data-tone="removed"] { border-color: var(--wb-removed); background: var(--wb-removed-bg); }
:is(.wb-card, .wb-node, .wb-item, .wb-chip)[data-tone="modified"] { border-color: var(--wb-modified); background: var(--wb-modified-bg); }
:is(.wb-card, .wb-node)[data-tone="muted"] { border-style: dashed; color: var(--wb-ink-muted); }
:is(.wb-item, .wb-chip)[data-tone="added"] { color: var(--wb-ink); }
:is(.wb-item, .wb-chip)[data-tone="muted"] { border-style: dashed; }
.wb-card[data-tone="accent"] .wb-card-dot { background: var(--wb-accent); }
.wb-card[data-tone="added"] .wb-card-dot { background: var(--wb-added); }
.wb-card[data-tone="removed"] .wb-card-dot { background: var(--wb-removed); }
.wb-card[data-tone="modified"] .wb-card-dot { background: var(--wb-modified); }
.wb-badge[data-tone="accent"] { border-color: var(--wb-accent); color: var(--wb-accent); }
.wb-badge[data-tone="added"] { border-color: var(--wb-added); color: var(--wb-added); }
.wb-badge[data-tone="removed"] { border-color: var(--wb-removed); color: var(--wb-removed); }
.wb-badge[data-tone="modified"] { border-color: var(--wb-modified); color: var(--wb-modified); }
.wb-table tr[data-tone="added"] td { color: var(--wb-ink); background: var(--wb-added-bg); }
.wb-table tr[data-tone="removed"] td { background: var(--wb-removed-bg); }
.wb-table tr[data-tone="modified"] td { background: var(--wb-modified-bg); }
.wb-shape[data-tone="accent"] { stroke: var(--wb-accent); }
.wb-shape[data-tone="added"] { stroke: var(--wb-added); fill: var(--wb-added-bg); }
.wb-shape[data-tone="removed"] { stroke: var(--wb-removed); fill: var(--wb-removed-bg); }
.wb-shape[data-tone="modified"] { stroke: var(--wb-modified); fill: var(--wb-modified-bg); }
.wb-shape[data-tone="muted"] { stroke-dasharray: 4 3; }
:is(.wb-card, .wb-node)[data-wb-highlit] { border-color: var(--wb-accent); box-shadow: 0 0 0 3px var(--wb-accent-soft); }
.wb-shape[data-wb-highlit] { stroke: var(--wb-accent); stroke-width: 2; }

/* Connectors and tokens. */
.wb-arrows, .wb-tokens { position: fixed; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.wb-line {
  fill: none;
  stroke: var(--wb-ink-faint);
  stroke-width: 1.5;
  marker-end: url(#wb-head);
  transition: stroke var(--wb-duration) ease, stroke-width var(--wb-duration) ease,
    stroke-dashoffset var(--wb-duration) ease;
}
.wb-arrow:not([data-dashed]) .wb-line { stroke-dasharray: var(--wb-length) var(--wb-length); }
.wb-arrow[data-dashed] .wb-line { stroke-dasharray: 5 4; }
.wb-arrow[data-wb-endpoint-detached] { display: none !important; }
.wb-arrow[data-wb-state="before"]:not([data-dashed]) .wb-line { stroke-dashoffset: var(--wb-length); }
.wb-arrow[data-tone="accent"] .wb-line, .wb-arrow[data-wb-highlit] .wb-line { stroke: var(--wb-accent); marker-end: url(#wb-head-accent); }
.wb-arrow[data-wb-highlit] .wb-line { stroke-width: 2.5; }
.wb-arrow[data-tone="added"] .wb-line { stroke: var(--wb-added); marker-end: url(#wb-head-added); }
.wb-arrow[data-tone="removed"] .wb-line { stroke: var(--wb-removed); marker-end: url(#wb-head-removed); }
.wb-arrow[data-tone="modified"] .wb-line { stroke: var(--wb-modified); marker-end: url(#wb-head-modified); }
.wb-arrow[data-wb-headless] .wb-line { marker-end: none; }
.wb-label {
  fill: var(--wb-ink-muted);
  font: var(--wb-text-micro) var(--wb-font-mono);
  text-anchor: middle;
  paint-order: stroke;
  stroke: var(--wb-surface);
  stroke-width: 4px;
  stroke-linejoin: round;
}
.wb-token {
  position: absolute;
  left: 0;
  top: 0;
  translate: -50% -50%;
  min-width: 12px;
  height: 12px;
  border-radius: var(--wb-radius-control);
  background: var(--wb-accent);
  box-shadow: 0 0 0 3px var(--wb-accent-soft);
  opacity: 0;
}
.wb-token[data-visible] { opacity: 1; }
[data-wb-travel-unrouted] { visibility: hidden !important; }
.wb-token[data-labelled] { height: auto; padding: var(--wb-space-2) var(--wb-space-8); color: var(--wb-token-accent-ink); font: var(--wb-text-micro)/var(--wb-leading-tight) var(--wb-font-mono); white-space: nowrap; }
.wb-token[data-tone="added"] { background: var(--wb-added); }
.wb-token[data-labelled][data-tone="added"] { color: var(--wb-token-added-ink); }
.wb-token[data-tone="removed"] { background: var(--wb-removed); }
.wb-token[data-labelled][data-tone="removed"] { color: var(--wb-token-removed-ink); }
.wb-token[data-tone="modified"] { background: var(--wb-modified); }
.wb-token[data-labelled][data-tone="modified"] { color: var(--wb-token-modified-ink); }
.wb-token[data-tone="muted"] { background: var(--wb-ink-faint); }
.wb-token[data-labelled][data-tone="muted"] { color: var(--wb-token-muted-ink); }

/* The scene. */
.wb-scene { display: grid; gap: var(--wb-space-28) var(--wb-space-48); padding: var(--wb-space-24); align-items: start; justify-items: stretch; min-width: 0; }
.wb-scene-compact { grid-template-columns: minmax(0, 1fr) !important; row-gap: var(--wb-space-48); }
.wb-scene-compact > * { grid-column: 1 / -1 !important; grid-row: auto !important; }
.wb-scene > [data-wb-state="before"], .wb-scene > [data-wb-state="after"],
.wb-items > [data-wb-state="before"], .wb-items > [data-wb-state="after"],
.wb-table tr[data-wb-state="before"], .wb-table tr[data-wb-state="after"] { display: none; }
.wb-scene-top { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--wb-space-8); margin-bottom: var(--wb-space-4); }
:root[data-wb-instant] *, :root[data-wb-instant] *::before, :root[data-wb-instant] *::after {
  transition: none !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
}`;
  document.head.append(style);

  const readableForeground = (background: string) => {
    const probe = document.createElement("span");
    probe.hidden = true;
    probe.style.color = background;
    document.body.append(probe);

    const channels = getComputedStyle(probe)
      .color.match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);

    probe.remove();

    if (!channels || channels.length !== 3) return "#000000";

    const [red, green, blue] = channels.map((channel) => {
      const value = channel! / 255;

      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });

    const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;

    // Black and white are the maximum-contrast choices for any solid color.
    return luminance > 0.179 ? "#000000" : "#ffffff";
  };

  const setProperties = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values))
      root.style.setProperty(`--wb-${name}`, value);
  };

  // The theme's own scheme, not the system's: native controls and
  // scrollbars a stage draws follow the whiteboard.
  const applyTheme = (
    values: Record<string, string>,
    scheme: StageColorScheme,
  ) => {
    theme = values;
    colorScheme = scheme;
    root.dataset.wbTheme = scheme;
    root.style.colorScheme = scheme;
    setProperties(values);

    for (const [tone, background] of [
      ["accent", "accent"],
      ["added", "added"],
      ["removed", "removed"],
      ["modified", "modified"],
      ["muted", "ink-faint"],
    ] as const)
      root.style.setProperty(
        `--wb-token-${tone}-ink`,
        readableForeground(`var(--wb-${background})`),
      );
  };

  const upgrade = (element: Element) => {
    if (!(element instanceof HTMLElement) || element.dataset.wbSlot) return;
    const code = element.dataset.wbCode;
    const block = element.dataset.wbBlock;

    if (code !== undefined && !init?.code.includes(code)) {
      fail(
        `Unknown code name "${code}". Declare it in the block's code field: ${init?.code.join(", ") || "none declared"}.`,
      );

      return;
    }

    if (block !== undefined && !init?.blocks.includes(block)) {
      fail(`Unknown block id "${block}".`);

      return;
    }

    if (code === undefined && block === undefined) return;
    element.dataset.wbSlot = `slot-${nextSlot++}`;
  };

  const upgradeAll = (scope: ParentNode) =>
    scope.querySelectorAll("[data-wb-code], [data-wb-block]").forEach(upgrade);

  const placeholder = (attribute: "wbCode" | "wbBlock", ref: string) => {
    const element = document.createElement("div");
    element.dataset[attribute] = ref;
    upgrade(element);

    if (!element.dataset.wbSlot)
      throw new Error(
        attribute === "wbCode"
          ? `Unknown code name "${ref}".`
          : `Unknown block id "${ref}".`,
      );

    return element;
  };

  // Elements with data-enter / data-exit show from their enter frame until
  // their exit frame; data-only shows them during the frames it lists. A
  // state, not an event, so a jump lands right.
  const applyStates = () => {
    const key = init?.frames[current]?.key ?? "";

    document
      .querySelectorAll<HTMLElement | SVGElement>("[data-highlight]")
      .forEach((element) =>
        element.toggleAttribute(
          "data-wb-highlit",
          (element.dataset.highlight ?? "").split(/\s+/).includes(key),
        ),
      );

    document
      .querySelectorAll<HTMLElement | SVGElement>("[data-enter], [data-exit]")
      .forEach((element) => {
        const position = activeFrameIndex(key);

        const enter = element.dataset.enter
          ? activeFrameIndex(element.dataset.enter)
          : 0;

        const exit = element.dataset.exit
          ? activeFrameIndex(element.dataset.exit)
          : Infinity;

        // An enter boundary outside this path never occurs. An exit boundary
        // outside it never ends an element that has already entered.
        element.dataset.wbState =
          enter < 0 || position < enter
            ? "before"
            : exit >= 0 && position >= exit
              ? "after"
              : "on";
      });

    document
      .querySelectorAll<HTMLElement | SVGElement>("[data-only]")
      .forEach((element) => {
        const only = (element.dataset.only ?? "").split(/\s+/);

        const position = activeFrameIndex(key);
        const activeOnly = only.map(activeFrameIndex).filter((at) => at >= 0);

        element.dataset.wbState = only.includes(key)
          ? "on"
          : activeOnly.length && position < Math.min(...activeOnly)
            ? "before"
            : "after";
      });

    for (const apply of sceneAppliers) apply(key);
  };

  const finished = (result: FrameResult): Promise<unknown>[] => {
    if (!result) return [];

    if (result instanceof Promise) return [result];

    if (result instanceof Animation) return [result.finished];

    if (Array.isArray(result))
      return result.flatMap((animation) =>
        animation instanceof Animation ? [animation.finished] : [],
      );

    return [];
  };

  const finite = (animation: Animation) =>
    Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity);

  const lib = (): typeof Anime => {
    const anime = window.anime;

    if (!anime) throw new Error("anime.js did not load in the stage.");

    return anime;
  };

  const resolve = (target: CardRef) => {
    const element =
      target instanceof Element
        ? target
        : target instanceof Object
          ? target.element
          : document.querySelector(target);

    if (!element) throw new Error(`Nothing matches ${String(target)}.`);

    return element;
  };

  // Frame timelines are queued while the scripts run, then built into one
  // anime.js timeline with a label at each frame's start, so a tween's
  // start value follows on from the frames before it.
  type Entry =
    | {
        kind: "add" | "set";
        targets: TargetsParam;
        params: AnimationParams;
        position?: TimelinePosition;
      }
    | { kind: "call"; callback: () => void; position?: TimelinePosition };

  const queued = new Map<string, Entry[]>();
  let built = false;
  let timeline: Timeline | undefined;

  const frameTimeline = (key: string): FrameTimeline => {
    if (frameIndex(key) < 0) throw new Error(`Unknown frame "${key}".`);

    if (built)
      throw new Error(
        "Add to frame timelines while the stage's scripts first run.",
      );

    let entries = queued.get(key);

    if (!entries) queued.set(key, (entries = []));
    const list = entries;

    const api: FrameTimeline = {
      add(targets, params, position) {
        list.push({ kind: "add", targets, params, position });

        return api;
      },
      set(targets, params, position) {
        list.push({ kind: "set", targets, params, position });

        return api;
      },
      call(callback, position) {
        list.push({ kind: "call", callback, position });

        return api;
      },
    };

    return api;
  };

  const buildTimeline = () => {
    built = true;
    timeline?.pause();
    timeline = undefined;

    if (!queued.size) return;

    const next = lib().createTimeline({
      autoplay: false,
      defaults: { duration: 600, ease: "outQuad" },
    });

    // Each frame starts 1ms after the one before ends, so landing on a
    // frame's end does not apply the next frame's first set(). Labels do not
    // extend the timeline, so an empty frame still needs its own start.
    let start = 0;

    for (const [index, frame] of activeFrames().entries()) {
      if (index) start = Math.max(next.duration, start) + 1;

      next.label(frame.key, start);

      for (const [order, entry] of (queued.get(frame.key) ?? []).entries()) {
        // Without a position, the frame's first call would start at the
        // timeline's end, which is before the frame's label.
        const position = Number.isFinite(entry.position)
          ? `${frame.key}+=${entry.position}`
          : (entry.position ?? (order ? undefined : frame.key));

        if (entry.kind === "call") next.call(entry.callback, position);
        else if (entry.kind === "add")
          next.add(entry.targets, entry.params, position);
        else next.set(entry.targets, entry.params, position);
      }
    }

    timeline = next;
  };

  let segmentToken = 0;

  // Land on the end of a frame's segment, or play the segment to its end.
  const playSegment = (key: string, play: boolean): Promise<void> => {
    const frames = activeFrames();
    const index = frames.findIndex((frame) => frame.key === key);
    const tl = timeline;
    const frame = frames[index];

    if (!tl || !frame) return Promise.resolve();
    const token = ++segmentToken;
    const start = tl.labels[frame.key] ?? 0;
    const next = frames[index + 1];
    const end = next ? (tl.labels[next.key] ?? tl.duration) - 1 : tl.duration;
    tl.pause();

    if (!play || end <= start) {
      tl.seek(end);

      return Promise.resolve();
    }

    tl.seek(start);
    tl.resume();

    return new Promise((done) => {
      const watch = () => {
        if (token !== segmentToken) return done();

        if (tl.currentTime >= end || tl.completed) {
          tl.pause();
          tl.seek(end);

          return done();
        }

        requestAnimationFrame(watch);
      };

      requestAnimationFrame(watch);
    });
  };

  const svg = "http://www.w3.org/2000/svg";

  interface ArrowRecord {
    group: SVGGElement;
    path: SVGPathElement;
    text?: SVGTextElement;
    clipPath: SVGClipPathElement;
    clipRect: SVGRectElement;
    from: Element;
    to: Element;
    bend: number;
    /** Pixels to shift the whole line sideways, for parallel edges. */
    offset: number;
    labelRoute?: {
      start: { x: number; y: number };
      control: { x: number; y: number };
      end: { x: number; y: number };
      normal: { x: number; y: number };
      tangent: { x: number; y: number };
      obstacles: DOMRect[];
    };
  }

  const arrows: ArrowRecord[] = [];

  const layer = <T extends Element>(selector: string, make: () => T): T => {
    const found = document.body.querySelector<T>(`:scope > ${selector}`);

    if (found) return found;
    const made = make();
    document.body.append(made);

    return made;
  };

  const arrowLayer = () =>
    layer("svg.wb-arrows", () => {
      const element = document.createElementNS(svg, "svg");
      element.setAttribute("class", "wb-arrows");
      element.innerHTML = `<defs>${[
        "",
        "accent",
        "added",
        "removed",
        "modified",
      ]
        .map(
          (tone) =>
            `<marker id="wb-head${tone && `-${tone}`}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" style="fill: var(--wb-${tone || "ink-faint"})"/></marker>`,
        )
        .join("")}</defs>`;

      return element;
    });

  const tokenLayer = () =>
    layer("div.wb-tokens", () => {
      const element = document.createElement("div");
      element.className = "wb-tokens";

      return element;
    });

  interface ClipBounds {
    left: number;
    right: number;
    top: number;
    bottom: number;
    clipped: boolean;
  }

  type AncestorClip = Omit<ClipBounds, "clipped">;

  // A measure pass can route hundreds of edges through the same scroller.
  // Cache its style and geometry only for that rAF; the next pass observes
  // every scroll, resize, and transform again.
  let clipGeometryCache: Map<Element, AncestorClip | null> | undefined;

  const clippingAncestors = (element: Element) => {
    const ancestors: Element[] = [];

    for (
      let ancestor = element.parentElement;
      ancestor && ancestor !== document.body && ancestor !== root;
      ancestor = ancestor.parentElement
    )
      ancestors.push(ancestor);

    return ancestors;
  };

  const ancestorClip = (ancestor: Element): AncestorClip | null => {
    if (clipGeometryCache?.has(ancestor))
      return clipGeometryCache.get(ancestor) ?? null;
    const style = getComputedStyle(ancestor);
    const clipsX = style.overflowX !== "visible";
    const clipsY = style.overflowY !== "visible";

    if (!clipsX && !clipsY) {
      clipGeometryCache?.set(ancestor, null);

      return null;
    }

    const rect = ancestor.getBoundingClientRect();

    // Overflow clips at the padding box. Account for transforms when
    // converting the element's CSS-pixel client metrics to viewport space.
    const boxWidth =
      ancestor instanceof HTMLElement ? ancestor.offsetWidth : rect.width;

    const boxHeight =
      ancestor instanceof HTMLElement ? ancestor.offsetHeight : rect.height;

    const scaleX = rect.width / (boxWidth || rect.width || 1);
    const scaleY = rect.height / (boxHeight || rect.height || 1);
    const left = rect.left + ancestor.clientLeft * scaleX;
    const top = rect.top + ancestor.clientTop * scaleY;

    const clip = {
      left: clipsX ? left : -1_000_000,
      right: clipsX ? left + ancestor.clientWidth * scaleX : 1_000_000,
      top: clipsY ? top : -1_000_000,
      bottom: clipsY ? top + ancestor.clientHeight * scaleY : 1_000_000,
    };

    clipGeometryCache?.set(ancestor, clip);

    return clip;
  };

  // Return the visible viewport-coordinate bounds imposed by overflow
  // ancestors shared by every element. An unconstrained axis remains large:
  // overflow-x must not accidentally become a vertical clip, or vice versa.
  const clipBounds = (...elements: Element[]): ClipBounds => {
    const shared = clippingAncestors(elements[0]!);

    if (elements.length > 1) {
      const others = elements
        .slice(1)
        .map((element) => new Set(clippingAncestors(element)));

      shared.splice(
        0,
        shared.length,
        ...shared.filter((ancestor) =>
          others.every((set) => set.has(ancestor)),
        ),
      );
    }

    const bounds: ClipBounds = {
      left: -1_000_000,
      right: 1_000_000,
      top: -1_000_000,
      bottom: 1_000_000,
      clipped: false,
    };

    for (const ancestor of shared) {
      const clip = ancestorClip(ancestor);

      if (!clip) continue;
      bounds.left = Math.max(bounds.left, clip.left);
      bounds.right = Math.min(bounds.right, clip.right);
      bounds.top = Math.max(bounds.top, clip.top);
      bounds.bottom = Math.min(bounds.bottom, clip.bottom);
      bounds.clipped = true;
    }

    return bounds;
  };

  const updateArrowClip = (arrow: ArrowRecord) => {
    const bounds = clipBounds(arrow.from, arrow.to);

    if (!bounds.clipped) {
      arrow.group.removeAttribute("clip-path");

      return;
    }

    const width = Math.max(0, bounds.right - bounds.left);
    const height = Math.max(0, bounds.bottom - bounds.top);

    arrow.clipRect.setAttribute("x", String(bounds.left));
    arrow.clipRect.setAttribute("y", String(bounds.top));
    arrow.clipRect.setAttribute("width", String(width));
    arrow.clipRect.setAttribute("height", String(height));
    arrow.group.setAttribute("clip-path", `url(#${arrow.clipPath.id})`);
  };

  // Where the line from a box's center toward a point leaves the box, with
  // a small gap.
  const edge = (
    rect: DOMRect,
    toward: { x: number; y: number },
    padding = 6,
  ) => {
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const dx = toward.x - x;
    const dy = toward.y - y;

    if (!dx && !dy) return { x, y };

    const scale =
      1 /
      Math.max(
        // A parallel axis adds no boundary constraint, including a point
        // anchor's zero extent. Avoid 0/0 while retaining Infinity on the
        // axis that reaches a zero-size boundary immediately.
        dx === 0 ? 0 : Math.abs(dx) / (rect.width / 2 + padding),
        dy === 0 ? 0 : Math.abs(dy) / (rect.height / 2 + padding),
      );

    return { x: x + dx * scale, y: y + dy * scale };
  };

  // Does the segment p→q cross rect r, grown by pad? Liang–Barsky clip.
  const crosses = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: DOMRect,
    pad: number,
  ) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;

    const limits: [number, number][] = [
      [-dx, p.x - (r.left - pad)],
      [dx, r.right + pad - p.x],
      [-dy, p.y - (r.top - pad)],
      [dy, r.bottom + pad - p.y],
    ];

    let t0 = 0;
    let t1 = 1;

    for (const [den, num] of limits) {
      if (den === 0) {
        if (num < 0) return false;

        continue;
      }

      const t = num / den;

      if (den < 0 ? t > t1 : t < t0) return false;

      if (den < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }

    return t0 < t1;
  };

  const route = (arrow: ArrowRecord) => {
    const endpointDetached =
      !arrow.from.isConnected ||
      !arrow.to.isConnected ||
      !arrow.from.checkVisibility() ||
      !arrow.to.checkVisibility();

    arrow.group.toggleAttribute("data-wb-endpoint-detached", endpointDetached);

    if (endpointDetached) {
      arrow.path.removeAttribute("d");
      arrow.labelRoute = undefined;

      return;
    }

    // Clipping can change while a shared scroll container moves even when the
    // routed path itself does not, so update it before the path early-return.
    updateArrowClip(arrow);
    const a = arrow.from.getBoundingClientRect();
    const b = arrow.to.getBoundingClientRect();
    const ax = a.x + a.width / 2;
    const ay = a.y + a.height / 2;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    // The line's unit normal: parallel offsets, auto-bows and label nudges
    // all move along it.
    const nx = -(by - ay) / length;
    const ny = (bx - ax) / length;

    // Cards sitting on the straight line between the two ends: bow the edge
    // clear of them. Labels avoid every card, including their own endpoints.
    const scope = arrow.from.closest(".wb-scene");
    const obstacles: DOMRect[] = [a, b];
    let avoid = 0;

    if (scope) {
      const p = { x: ax, y: ay };
      const q = { x: bx, y: by };

      for (const card of scope.querySelectorAll<HTMLElement>(".wb-card")) {
        if (card === arrow.from || card === arrow.to) continue;
        const r = card.getBoundingClientRect();

        obstacles.push(r);

        if (!crosses(p, q, r, 4)) continue;
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        // Signed distance of the card's centre from the a→b line.
        const signed = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / length;
        const span = Math.abs(signed) + Math.max(r.width, r.height) / 2 + 20;
        const bow = span * 2 * Math.sign(signed || 1);

        if (Math.abs(bow) > Math.abs(avoid)) avoid = bow;
      }
    }

    const bend = arrow.bend + Math.max(-240, Math.min(240, avoid));
    const px = nx * arrow.offset;
    const py = ny * arrow.offset;

    let control = {
      x: (ax + bx) / 2 + ((by - ay) / length) * bend + px,
      y: (ay + by) / 2 - ((bx - ax) / length) * bend + py,
    };

    let start = edge(a, control);
    let end = edge(b, control);

    if (bend === 0 && arrow.offset === 0) {
      const boundaryStart = edge(a, control, 0);
      const boundaryEnd = edge(b, control, 0);
      const tangentX = (bx - ax) / length;
      const tangentY = (by - ay) / length;

      const gutter =
        (boundaryEnd.x - boundaryStart.x) * tangentX +
        (boundaryEnd.y - boundaryStart.y) * tangentY;

      if (gutter > 0) {
        // Two fixed 6px endpoint gaps can consume a narrow positive gutter,
        // collapsing the endpoints while the centre-derived control remains
        // behind one of them. Keep up to 8px of directed line visible and put
        // a straight route's control between its final clipped endpoints.
        const padding = Math.min(6, Math.max(0, (gutter - 8) / 2));

        start = {
          x: boundaryStart.x + tangentX * padding,
          y: boundaryStart.y + tangentY * padding,
        };
        end = {
          x: boundaryEnd.x - tangentX * padding,
          y: boundaryEnd.y - tangentY * padding,
        };
      } else {
        // Overlapping boxes have no visible directed gutter. Do not invent a
        // backwards connector or a loop inside either endpoint.
        start = end = {
          x: (boundaryStart.x + boundaryEnd.x) / 2,
          y: (boundaryStart.y + boundaryEnd.y) / 2,
        };
      }

      control = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
    }

    start.x += px;
    start.y += py;
    end.x += px;
    end.y += py;
    const d = `M${start.x} ${start.y}Q${control.x} ${control.y} ${end.x} ${end.y}`;

    if (arrow.path.getAttribute("d") !== d) {
      arrow.path.setAttribute("d", d);
      arrow.group.style.setProperty(
        "--wb-length",
        String(arrow.path.getTotalLength()),
      );
    }

    arrow.labelRoute = {
      start,
      control,
      end,
      normal: { x: nx, y: ny },
      tangent: { x: (bx - ax) / length, y: (by - ay) / length },
      obstacles,
    };
  };

  const overlaps = (a: DOMRect, b: DOMRect, gap = 0) =>
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap;

  const placeArrowLabels = () => {
    const placed: DOMRect[] = [];

    // Host-like controls and overlay slots are authored outside scene cards,
    // but an edge label crossing one is just as unreadable. Treat their full
    // visible boxes (including a checkbox's wrapping label) as obstacles.
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, label, [data-wb-slot]",
      ),
    ].flatMap((element) =>
      element.checkVisibility({
        visibilityProperty: true,
        opacityProperty: true,
      })
        ? [element.getBoundingClientRect()]
        : [],
    );

    const endpoints = [
      ...new Set(arrows.flatMap(({ from, to }) => [from, to])),
    ].flatMap((element) =>
      element.checkVisibility({ visibilityProperty: true })
        ? [element.getBoundingClientRect()]
        : [],
    );

    for (const arrow of arrows) {
      const { text, labelRoute } = arrow;

      // Lifecycle-hidden labels must neither reserve a gutter nor displace a
      // visible label. Unscoped arrows have no state attribute and stay on.
      if (
        !text ||
        !labelRoute ||
        (arrow.group.dataset.wbState && arrow.group.dataset.wbState !== "on")
      )
        continue;

      const { start, control, end, normal, tangent, obstacles } = labelRoute;
      const baseX = (start.x + 2 * control.x + end.x) / 4;
      const baseY = (start.y + 2 * control.y + end.y) / 4 - 6;

      const previousX = Number(text.getAttribute("x") ?? 0);
      const previousY = Number(text.getAttribute("y") ?? 0);
      const bounds = text.getBBox();

      const relative = {
        left: bounds.x - previousX,
        top: bounds.y - previousY,
        width: bounds.width,
        height: bounds.height,
      };

      const clip = clipBounds(arrow.from, arrow.to);

      const viewport = {
        left: Math.max(0, clip.left),
        right: Math.min(innerWidth, clip.right),
        top: Math.max(0, clip.top),
        bottom: Math.min(innerHeight, clip.bottom),
      };

      const offsets: [number, number][] = [[0, 0]];

      // Search the nearest route-normal gutters first. Tangential alternatives
      // keep multiple labels from collapsing into the same otherwise-free spot.
      for (let distance = 14; distance <= 112; distance += 14) {
        offsets.push([distance, 0], [-distance, 0]);

        if (distance >= 28)
          offsets.push(
            [distance, 24],
            [distance, -24],
            [-distance, 24],
            [-distance, -24],
          );
      }

      // Raw toolkit diagrams can have several endpoint cards outside a scene.
      // A narrow gap may need a label farther along the route to remain clear.
      for (let along = 48; along <= 144; along += 24)
        for (let across = 0; across <= 112; across += 14)
          offsets.push(
            [across, along],
            [across, -along],
            [-across, along],
            [-across, -along],
          );

      // Reserve the packet's swept area, not just its current position. This
      // keeps a label still and readable throughout a trip instead of moving
      // it out of the chip's way on every animation frame.
      const flights: DOMRect[] = [];

      for (const travel of travels) {
        if (travel.arrow !== arrow) continue;
        const chip = travel.element.getBoundingClientRect();

        if (!chip.width || !chip.height) continue;
        const origin = travel.owner.placed;
        const left = chip.left - (origin?.x ?? 0);
        const top = chip.top - (origin?.y ?? 0);
        let previous = start;

        for (let step = 1; step <= 20; step++) {
          const t = step / 20;
          const u = 1 - t;

          const point = {
            x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
            y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
          };

          flights.push(
            new DOMRect(
              Math.min(previous.x, point.x) + left,
              Math.min(previous.y, point.y) + top,
              Math.abs(point.x - previous.x) + chip.width,
              Math.abs(point.y - previous.y) + chip.height,
            ),
          );
          previous = point;
        }
      }

      const collisions = [...obstacles, ...endpoints, ...controls, ...flights];
      let selected: { x: number; y: number; rect: DOMRect } | undefined;

      for (const [normalOffset, tangentOffset] of offsets) {
        const x = baseX + normal.x * normalOffset + tangent.x * tangentOffset;
        const y = baseY + normal.y * normalOffset + tangent.y * tangentOffset;

        const rect = new DOMRect(
          x + relative.left - 2,
          y + relative.top - 2,
          relative.width + 4,
          relative.height + 4,
        );

        const inViewport =
          rect.left >= viewport.left &&
          rect.right <= viewport.right &&
          rect.top >= viewport.top &&
          rect.bottom <= viewport.bottom;

        if (
          inViewport &&
          !collisions.some((obstacle) => overlaps(rect, obstacle, 3)) &&
          !placed.some((other) => overlaps(rect, other, 4))
        ) {
          selected = { x, y, rect };
          break;
        }
      }

      // Preserve the route-local fallback when a very constrained viewport has
      // no collision-free candidate; never hide or truncate the caller label.
      selected ??= {
        x: baseX,
        y: baseY,
        rect: new DOMRect(
          baseX + relative.left - 2,
          baseY + relative.top - 2,
          relative.width + 4,
          relative.height + 4,
        ),
      };
      const x = String(selected.x);
      const y = String(selected.y);

      if (text.getAttribute("x") !== x) text.setAttribute("x", x);

      if (text.getAttribute("y") !== y) text.setAttribute("y", y);
      placed.push(selected.rect);
    }
  };

  interface EdgeSpec {
    tone?: Tone;
    dashed?: boolean;
    arrowhead?: boolean;
    label?: string;
    enter?: string;
    exit?: string;
    only?: string[];
    highlight?: string[];
    bend?: number;
    offset?: number;
  }

  // Build an SVG edge between two elements, register it so it re-routes each
  // frame, and return its record. arrow() and scene links share this.
  const createEdge = (from: Element, to: Element, spec: EdgeSpec) => {
    const group = document.createElementNS(svg, "g");
    const path = document.createElementNS(svg, "path");
    const clipPath = document.createElementNS(svg, "clipPath");
    const clipRect = document.createElementNS(svg, "rect");
    const clipId = `wb-arrow-clip-${nextArrowClipId++}`;

    group.setAttribute("class", "wb-arrow");
    path.setAttribute("class", "wb-line");
    clipPath.id = clipId;
    clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
    clipPath.append(clipRect);
    arrowLayer().querySelector("defs")!.append(clipPath);
    group.append(path);

    if (spec.tone) group.dataset.tone = spec.tone;

    if (spec.dashed) group.dataset.dashed = "";

    if (spec.arrowhead === false) group.dataset.wbHeadless = "";

    if (spec.enter) group.dataset.enter = spec.enter;

    if (spec.exit) group.dataset.exit = spec.exit;

    if (spec.only) group.dataset.only = spec.only.join(" ");

    if (spec.highlight) group.dataset.highlight = spec.highlight.join(" ");

    const record: ArrowRecord = {
      group,
      path,
      clipPath,
      clipRect,
      from,
      to,
      bend: spec.bend ?? 0,
      offset: spec.offset ?? 0,
    };

    if (spec.label) {
      const text = document.createElementNS(svg, "text");
      text.setAttribute("class", "wb-label");
      text.textContent = spec.label;
      group.append(text);
      record.text = text;
    }

    arrowLayer().append(group);
    arrows.push(record);
    applyStates();
    route(record);
    placeArrowLabels();

    return record;
  };

  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const prefersReducedMotion = () => motionPreference.matches;

  const show = async (
    index: number,
    instant: boolean,
    direction?: FrameChange["direction"],
    adjacent?: boolean,
  ) => {
    const declared = declaredFrames();
    const declaredFrame = declared[index];

    if (!declaredFrame) return;
    const framePosition = activeFrameIndex(declaredFrame.key);
    const frame = { ...declaredFrame, index: framePosition };
    const previousDeclared = declared[current];

    const previousPosition = previousDeclared
      ? activeFrameIndex(previousDeclared.key)
      : -1;

    const previous =
      previousDeclared && previousPosition >= 0
        ? { ...previousDeclared, index: previousPosition }
        : undefined;

    const token = ++showing;
    instantMode = instant || prefersReducedMotion();

    if (instantMode) root.setAttribute("data-wb-instant", "");

    current = index;
    root.dataset.frame = frame.key;
    root.dataset.frameIndex = String(frame.index);
    applyStates();

    const change: FrameChange = {
      frame,
      previous,
      direction:
        direction ??
        (!previous
          ? "none"
          : frame.index > previous.index
            ? "forward"
            : frame.index < previous.index
              ? "backward"
              : "none"),
      instant: instantMode,
    };

    const waits: Promise<unknown>[] = [];

    for (const key of ["*", frame.key])
      for (const handler of handlers.get(key) ?? []) {
        try {
          waits.push(...finished(handler(change)));
        } catch (error) {
          fail(String(error));
        }
      }

    waits.push(
      playSegment(
        frame.key,
        !instantMode &&
          previous !== undefined &&
          (adjacent ?? index === previous.index + 1),
      ),
    );

    await nextFrame();

    if (instantMode) {
      for (const animation of document.getAnimations())
        if (finite(animation)) animation.finish();

      await nextFrame();
      root.removeAttribute("data-wb-instant");
    } else {
      waits.push(
        ...document
          .getAnimations()
          .filter(finite)
          .map((animation) => animation.finished),
      );
      await Promise.allSettled(waits);
    }

    if (token === showing) {
      // Skipping motion belongs to this frame change. Later button/slider
      // interactions must animate even when the reader arrived by a jump.
      instantMode = false;
      post({ type: "settled", index });
    }
  };

  // A stage can outlive a host or inspector preference change. Notify custom
  // frame renderers even when the frame key stays the same, so the live
  // whiteboard.reducedMotion getter cannot leave stale semantic content behind.
  motionPreference.addEventListener("change", () => {
    if (current >= 0) show(current, true).catch((error) => fail(String(error)));
  });

  const makeToken = (label?: string, tone?: Tone) => {
    const element = document.createElement("div");
    element.className = "wb-token";

    if (tone) element.dataset.tone = tone;

    if (label) {
      element.dataset.labelled = "";
      element.textContent = label;
    }

    tokenLayer().append(element);

    return element;
  };

  interface TravelOwner {
    active: { value: number };
    placed?: TravelBinding;
  }

  interface TravelBinding {
    id: number;
    element: Element;
    arrow: ArrowRecord;
    owner: TravelOwner;
    progress: { value: number };
    x?: number;
    y?: number;
  }

  const travels: TravelBinding[] = [];
  const travelOwners = new Map<Element, TravelOwner>();

  // Motion-path helpers resolve transforms while a tween renders. Keep the
  // normalized progress separately so a routed path can move underneath an
  // active or retained token without replaying the frame. A reused element is
  // placed only by the binding selected at the current timeline position.
  const placeTravel = (travel: TravelBinding) => {
    if (travel.owner.active.value !== travel.id) return;
    const { path } = travel.arrow;
    const routed = Boolean(path.getAttribute("d"));
    travel.element.toggleAttribute("data-wb-travel-unrouted", !routed);

    if (!routed) return;
    const length = path.getTotalLength();

    const point = path.getPointAtLength(
      length * Math.max(0, Math.min(1, travel.progress.value)),
    );

    const matrix = path.getCTM();

    const x = matrix
      ? point.x * matrix.a + point.y * matrix.c + matrix.e
      : point.x;

    const y = matrix
      ? point.x * matrix.b + point.y * matrix.d + matrix.f
      : point.y;

    if (travel.owner.placed === travel && travel.x === x && travel.y === y)
      return;
    travel.owner.placed = travel;
    travel.x = x;
    travel.y = y;
    // Set only the motion translations. Anime retains unrelated transform
    // components on caller-provided tokens just as createMotionPath did.
    lib().set(travel.element, { translateX: x, translateY: y });
  };

  // Tween normalized progress along an edge during a frame. Geometry is read
  // when the token is placed, rather than captured when the timeline is built.
  const travelAlong = (
    element: Element,
    record: ArrowRecord,
    frame: string,
    options: {
      duration?: number;
      ease?: string;
      position?: TimelinePosition;
      stay?: boolean;
    },
  ) => {
    let owner = travelOwners.get(element);

    if (!owner) {
      owner = { active: { value: travels.length } };
      travelOwners.set(element, owner);
    }

    const travel: TravelBinding = {
      id: travels.length,
      element,
      arrow: record,
      owner,
      progress: { value: 0 },
    };

    travels.push(travel);

    const segment = frameTimeline(frame)
      .set(owner.active, { value: travel.id }, options.position)
      .set(element, { opacity: 1 }, "<")
      .add(
        travel.progress,
        {
          value: 1,
          duration: options.duration ?? 900,
          ease: options.ease ?? "inOutQuad",
        },
        "<",
      );

    // A token left at an edge's head covers the node it points at.
    if (!options.stay) segment.add(element, { opacity: 0, duration: 250 }, "<");
  };

  // One shared id per element, for pairing parallel edges and lookups.
  const idOf = (el: HTMLElement) =>
    (el.dataset.wbSceneId ??= `wb${nextSceneId++}`);

  const applyLifecycle = (
    el: HTMLElement,
    options: {
      enter?: string;
      exit?: string;
      only?: string[];
      highlight?: string[];
    },
  ) => {
    if (options.enter) el.dataset.enter = options.enter;

    if (options.exit) el.dataset.exit = options.exit;

    if (options.only) el.dataset.only = options.only.join(" ");

    if (options.highlight) el.dataset.highlight = options.highlight.join(" ");
  };

  // A grid of cards, routed edges, and chips that ride them. The scene owns
  // spacing, edge drawing, and chip motion, so every scene reads the same.
  const scene = (options: SceneOptions): Scene => {
    const columns = options.columns ?? 3;
    const grid = document.createElement("div");
    grid.className = "wb-scene";
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    (options.container ? resolve(options.container) : document.body).append(
      grid,
    );

    if (options.responsive !== false && columns > 1) {
      // Preserve declared cells on wider layouts. In a narrow container, use
      // reading order rather than shrinking cards, tables and labels to fit.
      const reflow = () => {
        const style = getComputedStyle(grid);

        const padding =
          parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);

        const gap = parseFloat(style.columnGap);
        grid.classList.toggle(
          "wb-scene-compact",
          grid.clientWidth < columns * 140 + (columns - 1) * gap + padding,
        );
      };

      let layoutFrame: number | undefined;
      new ResizeObserver(() => {
        if (layoutFrame !== undefined) return;
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = undefined;
          reflow();
        });
      }).observe(grid);
      reflow();
    }

    const nodes = new Map<string, HTMLElement>();
    const links = new Map<string, ArrowRecord>();
    const pairCount = new Map<string, number>();
    const sendCount = new Map<string, number>();
    let topBar: HTMLElement | undefined;

    // A card, item or badge whose text or tone changes per frame. One applier
    // resolves them all each frame, so a jump lands on the right state.
    interface Stateful {
      el: HTMLElement;
      base: SceneChange;
      changes: { at: number; change: SceneChange }[];
      setText?: (text: string) => void;
    }

    const byElement = new Map<HTMLElement, Stateful>();

    const track = (
      el: HTMLElement,
      base: SceneChange,
      setText?: (text: string) => void,
    ) => {
      byElement.set(el, { el, base, changes: [], setText });
    };

    sceneAppliers.push((key) => {
      const position = activeFrameIndex(key);

      for (const part of byElement.values()) {
        let { tone, text } = part.base;

        for (const { at, change } of part.changes) {
          const changeKey = init?.frames[at]?.key;
          const changePosition = changeKey ? activeFrameIndex(changeKey) : -1;

          if (changePosition >= 0 && changePosition <= position) {
            if (change.tone !== undefined) tone = change.tone;

            if (change.text !== undefined) text = change.text;
          }
        }

        if (tone && tone !== "none") part.el.dataset.tone = tone;
        else delete part.el.dataset.tone;

        // A part with no text of its own clears a later frame's on a step back.
        part.setText?.(text ?? "");
      }
    });

    const place = (el: HTMLElement, [column, row, rowSpan, colSpan]: Cell) => {
      el.style.gridColumn = colSpan
        ? `${column} / span ${colSpan}`
        : String(column);
      el.style.gridRow = rowSpan ? `${row} / span ${rowSpan}` : String(row);
      el.style.order = String((row - 1) * columns + column);
    };

    const cardEl = (ref: CardRef): HTMLElement => {
      if (ref instanceof Element) {
        // SAFETY: an Element ref is one of the <div> cards this module makes.
        return ref as HTMLElement;
      }

      if (ref instanceof Object) return ref.element;
      const found = nodes.get(ref) ?? document.getElementById(ref);

      if (!found) throw new Error(`No scene card "${ref}".`);

      // SAFETY: scene cards are the <div> elements this module registers.
      return found as HTMLElement;
    };

    const card = (kind: string, options: SceneCardOptions) => {
      const el = document.createElement("div");
      el.className = "wb-card";
      el.dataset.kind = kind;
      el.id = options.id;
      place(el, options.at);
      applyLifecycle(el, options);

      const head = document.createElement("div");
      head.className = "wb-card-head";
      const dot = document.createElement("i");
      dot.className = "wb-card-dot";
      const title = document.createElement("span");
      title.className = "wb-card-title";
      title.textContent = options.title ?? options.id;
      head.append(dot, title);
      el.append(head);

      const note = document.createElement("div");
      note.className = "wb-card-note";
      el.append(note);
      track(el, { tone: options.tone, text: options.note }, (text) => {
        note.textContent = text;
      });

      grid.append(el);
      nodes.set(options.id, el);

      return { element: el, id: options.id };
    };

    const makeLink = (
      from: CardRef,
      to: CardRef,
      options: SceneLinkOptions,
    ) => {
      const a = cardEl(from);
      const b = cardEl(to);
      const ak = idOf(a);
      const bk = idOf(b);
      const pair = [ak, bk].sort().join("|");
      const n = pairCount.get(pair) ?? 0;
      pairCount.set(pair, n + 1);
      // Fan parallel edges apart: 0, +9, -9, +18, …
      const offset = n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 9;
      const record = createEdge(a, b, { ...options, offset });
      links.set(`${ak}>${bk}`, record);

      return record;
    };

    const link = (from: CardRef, to: CardRef, options: SceneLinkOptions = {}) =>
      makeLink(from, to, options).group;

    const item = (
      host: HTMLElement,
      label: string,
      options: SceneItemOptions,
    ) => {
      const el = document.createElement("div");
      el.className = "wb-item";
      el.textContent = label;
      applyLifecycle(el, options);
      track(el, { tone: options.tone, text: label }, (text) => {
        el.textContent = text;
      });
      host.append(el);

      return el;
    };

    return {
      actor: (options) => card("actor", options),
      store(options) {
        const base = card("store", options);
        const items = document.createElement("div");
        items.className = "wb-items";
        base.element.append(items);

        return { ...base, item: (label, o = {}) => item(items, label, o) };
      },
      table(options) {
        const base = card("table", options);
        const el = document.createElement("table");
        el.className = "wb-table";
        const head = el.createTHead().insertRow();

        for (const column of options.columns) {
          const th = document.createElement("th");
          th.textContent = column;
          head.append(th);
        }

        const body = el.createTBody();
        base.element.append(el);

        return {
          ...base,
          row(cells, o = {}) {
            const tr = body.insertRow();

            for (const value of cells) tr.insertCell().textContent = value;
            applyLifecycle(tr, o);
            track(tr, { tone: o.tone });

            return tr;
          },
        };
      },
      peek(name, options) {
        const slot = placeholder("wbCode", name);
        place(slot, options.at);
        applyLifecycle(slot, options);
        grid.append(slot);

        return slot;
      },
      badge(options) {
        if (!topBar) {
          topBar = document.createElement("div");
          topBar.className = "wb-scene-top";
          grid.before(topBar);
        }

        const el = document.createElement("div");
        el.className = "wb-badge";
        topBar.append(el);
        track(el, { tone: options.tone, text: options.text }, (text) => {
          el.textContent = text;
        });

        return el;
      },
      on(frame, part, change) {
        const at = frameIndex(frame);

        if (at < 0) throw new Error(`Unknown frame "${frame}".`);
        const entry = byElement.get(cardEl(part));

        if (!entry)
          throw new Error("scene.on() takes a scene card, item, or badge.");
        entry.changes.push({ at, change: normalizeChange(change) });
        entry.changes.sort((a, b) => a.at - b.at);
      },
      link,
      send(from, to, label, frame, options = {}) {
        if (frameIndex(frame) < 0) throw new Error(`Unknown frame "${frame}".`);
        const a = cardEl(from);
        const b = cardEl(to);
        const key = `${idOf(a)}>${idOf(b)}`;
        const record = links.get(key) ?? makeLink(a, b, {});
        const chip = makeToken(label, options.tone);
        applyLifecycle(chip, options);
        const length = record.path.getTotalLength() || 1;
        const stagger = `${frame}|${key}`;
        const nth = sendCount.get(stagger) ?? 0;

        sendCount.set(stagger, nth + 1);

        // One fixed speed, so a longer edge takes proportionally longer.
        const duration = Math.min(
          1500,
          Math.max(450, Math.round(length / 0.32)),
        );

        travelAlong(chip, record, frame, {
          duration,
          position: nth * 200,
          stay: options.stay,
        });
      },
    };
  };

  const whiteboard: WhiteboardShim = {
    get frames() {
      return activeFrames();
    },
    get frame() {
      const key = init?.frames[Math.max(current, 0)]?.key;

      return activeFrames().find((frame) => frame.key === key)!;
    },
    get theme() {
      return { ...theme };
    },
    get colorScheme() {
      return colorScheme;
    },
    get reducedMotion() {
      return prefersReducedMotion();
    },
    code: (name) => placeholder("wbCode", name),
    block: (id) => placeholder("wbBlock", id),
    on(key, handler) {
      if (key !== "*" && frameIndex(key) < 0)
        throw new Error(`Unknown frame "${key}".`);
      let set = handlers.get(key);

      if (!set) handlers.set(key, (set = new Set()));
      set.add(handler);

      return () => set.delete(handler);
    },
    animate(target, keyframes, options) {
      const element =
        target instanceof Element ? target : document.querySelector(target);

      if (!element) throw new Error(`Nothing matches ${String(target)}.`);

      const timing: KeyframeAnimationOptions =
        options instanceof Object ? options : { duration: options };

      const animation = element.animate(keyframes, {
        duration: 450,
        easing: "ease",
        fill: "both",
        ...timing,
      });

      if ((instantMode || prefersReducedMotion()) && finite(animation))
        animation.finish();

      return animation;
    },
    setSequence(keys) {
      const sequence = [...keys];

      if (!sequence.length)
        throw new Error("setSequence() needs at least one frame key.");

      if (new Set(sequence).size !== sequence.length)
        throw new Error("setSequence() frame keys must be unique.");

      for (const key of sequence)
        if (frameIndex(key) < 0) throw new Error(`Unknown frame "${key}".`);

      if (
        activeSequence?.length === sequence.length &&
        activeSequence.every((key, index) => key === sequence[index])
      )
        return;

      activeSequence = sequence;

      if (built) buildTimeline();

      if (current >= 0) applyStates();

      post({ type: "sequence", keys: sequence });
    },
    goto(key) {
      if (frameIndex(key) < 0) throw new Error(`Unknown frame "${key}".`);

      if (activeSequence && !activeSequence.includes(key))
        throw new Error(`Frame "${key}" is not in the active sequence.`);
      post({ type: "goto", key });
    },
    next: () => post({ type: "step", delta: 1 }),
    prev: () => post({ type: "step", delta: -1 }),
    reveal(name) {
      if (!init?.code.includes(name))
        throw new Error(`Unknown code name "${name}".`);
      post({ type: "reveal", name });
    },
    get anime() {
      return lib();
    },
    timeline: frameTimeline,
    arrow(from, to, options = {}) {
      return createEdge(resolve(from), resolve(to), options).group;
    },
    token(options = {}) {
      const token = makeToken(options.label, options.tone);

      if (options.visible) token.dataset.visible = "";
      applyLifecycle(token, options);

      return token;
    },
    travel(token, arrow, frame, options = {}) {
      const record = arrows.find((item) => item.group === arrow);

      if (!record)
        throw new Error("travel() takes an arrow from whiteboard.arrow().");

      travelAlong(resolve(token), record, frame, options);
    },
    scene: (options = {}) => scene(options),
    mermaid: () => {
      throw new Error(
        "whiteboard.mermaid() was removed from animations. Rebuild the diagram as a whiteboard.scene, or show the whole graph in a flow_diagram block.",
      );
    },
  };

  Object.defineProperty(window, "whiteboard", { value: whiteboard });

  // Scripts set through innerHTML do not run. Run each one, in order, from a
  // blob URL: the stage's policy allows blob: scripts and no inline ones.
  const runScripts = async (scripts: HTMLScriptElement[]) => {
    for (const original of scripts) {
      const script = document.createElement("script");

      for (const { name, value } of original.attributes)
        script.setAttribute(name, value);

      if (!original.src) {
        script.src = URL.createObjectURL(
          new Blob([original.textContent ?? ""], { type: "text/javascript" }),
        );
      }

      await new Promise<void>((resolve) => {
        script.onload = () => resolve();
        script.onerror = () => {
          fail(
            original.src
              ? `The stage cannot load ${original.src}: it has no network access.`
              : "A stage script failed to load.",
          );
          resolve();
        };

        original.replaceWith(script);
      });
    }
  };

  const runSources = async (sources: string[]) => {
    for (const source of sources)
      await new Promise<void>((done) => {
        const script = document.createElement("script");
        script.src = URL.createObjectURL(
          new Blob([source], { type: "text/javascript" }),
        );
        script.onload = () => done();
        script.onerror = () => {
          fail("A stage library failed to load.");
          done();
        };

        document.head.append(script);
      });
  };

  // The host draws over each slot, so it needs where each one is now. Read
  // every frame and send only changes; rAF stops while the stage is hidden.
  let lastLayout = "";
  let lastHeight = -1;

  const measure = () => {
    clipGeometryCache = new Map();
    arrows.forEach(route);
    placeArrowLabels();
    travels.forEach(placeTravel);
    const slots: SlotLayout[] = [];

    document.querySelectorAll<HTMLElement>("[data-wb-slot]").forEach((el) => {
      const rect = el.getBoundingClientRect();
      let opacity = 1;

      for (
        let node: Element | null = el;
        node && opacity > 0;
        node = node.parentElement
      )
        opacity *= Number(getComputedStyle(node).opacity);

      slots.push({
        slot: el.dataset.wbSlot!,
        kind: el.dataset.wbCode !== undefined ? "code" : "block",
        ref: el.dataset.wbCode ?? el.dataset.wbBlock!,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        opacity: Math.round(opacity * 1000) / 1000,
        visible:
          rect.width > 0 &&
          opacity > 0.001 &&
          el.checkVisibility({ visibilityProperty: true }),
      });
    });

    const layout = JSON.stringify(slots);

    if (layout !== lastLayout) {
      lastLayout = layout;
      post({ type: "slots", slots });
    }

    if (init?.autoSize) {
      // Natural body height includes slot-size feedback from host overlays.
      // Exclude viewport-sized drawing layers to avoid a resize feedback loop.
      let bottom = document.body.getBoundingClientRect().bottom;

      for (const element of document.body.querySelectorAll("*")) {
        // Global drawing layers are viewport-sized. Their descendants can
        // have geometry far outside authored overflow viewports, but neither
        // the layers nor those descendants are layout content.
        if (element.closest(".wb-arrows, .wb-tokens")) continue;

        if (
          !element.checkVisibility({
            visibilityProperty: true,
            opacityProperty: true,
          })
        )
          continue;
        const rect = element.getBoundingClientRect();
        const clipped = clipBounds(element);
        const left = Math.max(rect.left, clipped.left);
        const right = Math.min(rect.right, clipped.right);
        const top = Math.max(rect.top, clipped.top);
        const visibleBottom = Math.min(rect.bottom, clipped.bottom);

        if (right <= left || visibleBottom <= top) continue;
        bottom = Math.max(bottom, visibleBottom);
      }

      const height = Math.max(120, Math.ceil(bottom));

      if (height !== lastHeight) {
        lastHeight = height;
        post({ type: "size", height });
      }
    }

    clipGeometryCache = undefined;
    requestAnimationFrame(measure);
  };

  const start = async (message: StageInit) => {
    init = message;
    root.toggleAttribute("data-wb-auto-size", message.autoSize);
    setProperties(message.scale);
    applyTheme(message.theme, message.colorScheme);
    const fonts = document.createElement("style");
    fonts.textContent = message.fonts;
    document.head.append(fonts);
    document.body.innerHTML = message.html;
    upgradeAll(document.body);

    new MutationObserver((records) => {
      for (const record of records)
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            upgrade(node);
            upgradeAll(node);
          }
        });
    }).observe(document.body, { childList: true, subtree: true });

    await runSources(message.libraries);
    await runScripts([...document.body.querySelectorAll("script")]);
    arrows.forEach(route);
    buildTimeline();
    post({ type: "ready" });
    requestAnimationFrame(measure);
    const requestedKey = message.frames[message.frame]?.key;
    const firstActive = activeSequence?.[0];

    const initial =
      activeSequence && !activeSequence.includes(requestedKey)
        ? frameIndex(firstActive!)
        : message.frame;

    await show(initial, true);
  };

  port.onmessage = (event: MessageEvent<HostMessage>) => {
    const message = event.data;

    switch (message.type) {
      case "init":
        if (!init) start(message).catch((error) => fail(String(error)));
        break;
      case "frame":
        if (init)
          show(
            message.index,
            message.instant,
            message.direction,
            message.adjacent,
          ).catch((error) => fail(String(error)));
        break;
      case "theme":
        applyTheme(message.theme, message.colorScheme);
        break;
      case "slot-size": {
        const slot = document.querySelector<HTMLElement>(
          `[data-wb-slot="${message.slot}"]`,
        );

        if (slot) slot.style.height = `${message.height}px`;
        break;
      }
    }
  };
}
