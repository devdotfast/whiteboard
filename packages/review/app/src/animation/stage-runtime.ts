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
  enter?: string;
  exit?: string;
  only?: string[];
}

export interface SceneSendOptions {
  tone?: Tone;
  /** Keep the chip at the target instead of fading it out on arrival. */
  stay?: boolean;
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
  /** Show the frame with this key. */
  goto(key: string): void;
  next(): void;
  prev(): void;
  /** Open the named code in the editor. */
  reveal(name: string): void;
  /** anime.js v4, also the global `anime`. */
  readonly anime: typeof Anime;
  /** A grid of cards, edges and chips with consistent spacing and routing.
   * Prefer it to arrow/token for request-flow and state diagrams. */
  scene(options?: { columns?: number }): Scene;
  /** The frame's segment of the stage timeline: it plays when the reader
   * steps into the frame, and lands at its end on a jump. */
  timeline(key: string): FrameTimeline;
  /** An SVG arrow between two elements that follows them as they move. */
  arrow(
    from: Element | string,
    to: Element | string,
    options?: ArrowOptions,
  ): SVGGElement;
  /** A dot, or a pill with a label, that travel() moves along arrows. */
  token(options?: { label?: string; tone?: Tone }): HTMLElement;
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

  addEventListener("error", (event) => fail(event.message));
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
  const handlers = new Map<string, Set<FrameHandler>>();
  let theme: Record<string, string> = {};
  let nextSlot = 0;
  let nextSceneId = 0;

  // Scene parts set a value per frame; these run on every frame change so a
  // jump lands on the right one.
  const sceneAppliers: ((index: number) => void)[] = [];

  const frames = () =>
    (init?.frames ?? []).map((frame, index) => ({ ...frame, index }));

  const frameIndex = (key: string) =>
    (init?.frames ?? []).findIndex((frame) => frame.key === key);

  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const style = document.createElement("style");
  style.textContent = `
:root { --wb-duration: 450ms; color-scheme: light dark; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  overflow: hidden;
  background: transparent;
  color: var(--wb-ink);
  font: 13px/1.5 var(--wb-font-sans, system-ui, sans-serif);
}
[data-enter], [data-exit], [data-only] {
  transition: opacity var(--wb-duration) ease, visibility 0s linear 0s;
}
[data-wb-state="before"], [data-wb-state="after"] {
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--wb-duration) ease, visibility 0s linear var(--wb-duration);
}
[data-wb-slot] { display: block; max-width: 100%; min-height: 40px; }
.wb-row { display: flex; align-items: center; justify-content: space-around; gap: 48px; padding: 20px 24px; }
.wb-layers { display: grid; justify-items: center; align-items: start; }
.wb-layers > * { grid-area: 1 / 1; }
.wb-stack { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 20px 24px; }
.wb-node {
  min-width: 88px;
  padding: 8px 12px;
  border: 1px solid var(--wb-rule);
  border-radius: 8px;
  background: var(--wb-surface);
  color: var(--wb-ink);
  font: 12px/1.4 var(--wb-font-mono, monospace);
  text-align: center;
  transition: opacity var(--wb-duration) ease, border-color var(--wb-duration) ease,
    background-color var(--wb-duration) ease, box-shadow var(--wb-duration) ease;
}
.wb-node small { display: block; color: var(--wb-ink-faint); font-size: 10px; }
.wb-node[data-tone="accent"] { border-color: var(--wb-accent); }
.wb-node[data-tone="added"] { border-color: var(--wb-added); background: var(--wb-added-bg); }
.wb-node[data-tone="removed"] { border-color: var(--wb-removed); background: var(--wb-removed-bg); }
.wb-node[data-tone="modified"] { border-color: var(--wb-modified); background: var(--wb-modified-bg); }
.wb-node[data-tone="muted"] { border-style: dashed; color: var(--wb-ink-faint); }
.wb-node[data-wb-highlit] { border-color: var(--wb-accent); box-shadow: 0 0 0 3px var(--wb-accent-soft); }
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
.wb-arrow[data-wb-state="before"]:not([data-dashed]) .wb-line { stroke-dashoffset: var(--wb-length); }
.wb-arrow[data-tone="accent"] .wb-line, .wb-arrow[data-wb-highlit] .wb-line { stroke: var(--wb-accent); marker-end: url(#wb-head-accent); }
.wb-arrow[data-wb-highlit] .wb-line { stroke-width: 2.5; }
.wb-arrow[data-tone="added"] .wb-line { stroke: var(--wb-added); marker-end: url(#wb-head-added); }
.wb-arrow[data-tone="removed"] .wb-line { stroke: var(--wb-removed); marker-end: url(#wb-head-removed); }
.wb-arrow[data-tone="modified"] .wb-line { stroke: var(--wb-modified); marker-end: url(#wb-head-modified); }
.wb-label {
  fill: var(--wb-ink-muted);
  font: 10px var(--wb-font-mono, monospace);
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
  border-radius: 6px;
  background: var(--wb-accent);
  box-shadow: 0 0 0 3px var(--wb-accent-soft);
  opacity: 0;
}
.wb-token[data-labelled] { height: auto; padding: 2px 8px; color: var(--wb-on-accent); font: 10px/1.4 var(--wb-font-mono, monospace); white-space: nowrap; }
.wb-token[data-tone="added"] { background: var(--wb-added); }
.wb-token[data-tone="removed"] { background: var(--wb-removed); }
.wb-token[data-tone="modified"] { background: var(--wb-modified); }
.wb-token[data-tone="muted"] { background: var(--wb-ink-faint); }
.wb-scene { display: grid; gap: 28px 44px; padding: 24px; align-items: start; justify-items: stretch; }
.wb-scene-top { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-bottom: 4px; }
.wb-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--wb-rule);
  border-radius: 10px;
  background: var(--wb-surface);
  color: var(--wb-ink);
  font: 12px/1.4 var(--wb-font-mono, monospace);
  transition: opacity var(--wb-duration) ease, border-color var(--wb-duration) ease,
    background-color var(--wb-duration) ease, box-shadow var(--wb-duration) ease;
}
.wb-card-head { display: flex; align-items: center; gap: 6px; }
.wb-card-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--wb-ink-faint); }
.wb-card-title { font-weight: 600; letter-spacing: .02em; }
.wb-card-note { color: var(--wb-ink-faint); font-size: 10px; min-height: 12px; }
.wb-card[data-tone="accent"] { border-color: var(--wb-accent); }
.wb-card[data-tone="accent"] .wb-card-dot { background: var(--wb-accent); }
.wb-card[data-tone="added"] { border-color: var(--wb-added); background: var(--wb-added-bg); }
.wb-card[data-tone="added"] .wb-card-dot { background: var(--wb-added); }
.wb-card[data-tone="removed"] { border-color: var(--wb-removed); background: var(--wb-removed-bg); }
.wb-card[data-tone="removed"] .wb-card-dot { background: var(--wb-removed); }
.wb-card[data-tone="modified"] { border-color: var(--wb-modified); background: var(--wb-modified-bg); }
.wb-card[data-tone="modified"] .wb-card-dot { background: var(--wb-modified); }
.wb-card[data-tone="muted"] { border-style: dashed; color: var(--wb-ink-faint); }
.wb-card[data-wb-highlit] { border-color: var(--wb-accent); box-shadow: 0 0 0 3px var(--wb-accent-soft); }
.wb-items { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px; }
.wb-item {
  padding: 2px 6px;
  border: 1px solid var(--wb-rule);
  border-radius: 6px;
  background: var(--wb-well);
  color: var(--wb-ink-muted);
  font-size: 10px;
  transition: opacity var(--wb-duration) ease, border-color var(--wb-duration) ease, background-color var(--wb-duration) ease;
}
.wb-item[data-tone="added"] { border-color: var(--wb-added); background: var(--wb-added-bg); color: var(--wb-ink); }
.wb-item[data-tone="removed"] { border-color: var(--wb-removed); background: var(--wb-removed-bg); }
.wb-item[data-tone="modified"] { border-color: var(--wb-modified); background: var(--wb-modified-bg); }
.wb-item[data-tone="muted"] { color: var(--wb-ink-faint); }
.wb-table { width: 100%; margin-top: 2px; border-collapse: collapse; font-size: 10px; }
.wb-table th, .wb-table td { padding: 2px 6px; text-align: left; border-bottom: 1px solid var(--wb-rule); white-space: nowrap; }
.wb-table th { color: var(--wb-ink-faint); font-weight: 600; }
.wb-table td { color: var(--wb-ink-muted); }
.wb-table tr[data-tone="added"] td { color: var(--wb-ink); background: var(--wb-added-bg); }
.wb-table tr[data-tone="removed"] td { background: var(--wb-removed-bg); }
.wb-table tr[data-tone="modified"] td { background: var(--wb-modified-bg); }
.wb-badge {
  padding: 2px 8px;
  border: 1px solid var(--wb-rule);
  border-radius: 999px;
  background: var(--wb-well);
  color: var(--wb-ink-muted);
  font: 10px/1.5 var(--wb-font-mono, monospace);
  letter-spacing: .03em;
}
.wb-badge[data-tone="accent"] { border-color: var(--wb-accent); color: var(--wb-accent); }
.wb-badge[data-tone="added"] { border-color: var(--wb-added); color: var(--wb-added); }
.wb-badge[data-tone="removed"] { border-color: var(--wb-removed); color: var(--wb-removed); }
.wb-badge[data-tone="modified"] { border-color: var(--wb-modified); color: var(--wb-modified); }
:root[data-wb-instant] *, :root[data-wb-instant] *::before, :root[data-wb-instant] *::after {
  transition: none !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
}`;
  document.head.append(style);

  const applyTheme = (values: Record<string, string>) => {
    theme = values;

    for (const [name, value] of Object.entries(values))
      root.style.setProperty(`--wb-${name}`, value);
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
        const enter = element.dataset.enter
          ? frameIndex(element.dataset.enter)
          : 0;

        const exit = element.dataset.exit
          ? frameIndex(element.dataset.exit)
          : Infinity;

        element.dataset.wbState =
          current < enter ? "before" : current >= exit ? "after" : "on";
      });

    document
      .querySelectorAll<HTMLElement | SVGElement>("[data-only]")
      .forEach((element) => {
        const only = (element.dataset.only ?? "").split(/\s+/);

        element.dataset.wbState = only.includes(key)
          ? "on"
          : current < Math.min(...only.map(frameIndex))
            ? "before"
            : "after";
      });

    for (const apply of sceneAppliers) apply(Math.max(current, 0));
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

  const resolve = (target: Element | string) => {
    const element =
      target instanceof Element ? target : document.querySelector(target);

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

    if (!queued.size) return;

    const next = lib().createTimeline({
      autoplay: false,
      defaults: { duration: 600, ease: "outQuad" },
    });

    // Each frame starts 1ms after the one before ends, so landing on a
    // frame's end does not apply the next frame's first set(). Labels do not
    // extend the timeline, so an empty frame still needs its own start.
    let start = 0;

    for (const [index, frame] of (init?.frames ?? []).entries()) {
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
  const playSegment = (index: number, play: boolean): Promise<void> => {
    const frames = init?.frames ?? [];
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
    from: Element;
    to: Element;
    bend: number;
    /** Pixels to shift the whole line sideways, for parallel edges. */
    offset: number;
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

  // Where the line from a box's center toward a point leaves the box, with
  // a small gap.
  const edge = (rect: DOMRect, toward: { x: number; y: number }) => {
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const dx = toward.x - x;
    const dy = toward.y - y;

    if (!dx && !dy) return { x, y };

    const scale =
      1 /
      Math.max(
        Math.abs(dx) / (rect.width / 2 + 6),
        Math.abs(dy) / (rect.height / 2 + 6),
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
    // clear of them, and keep their rects so the label can dodge them too.
    const scope = arrow.from.closest(".wb-scene");
    const obstacles: DOMRect[] = [];
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

    const control = {
      x: (ax + bx) / 2 + ((by - ay) / length) * bend + px,
      y: (ay + by) / 2 - ((bx - ax) / length) * bend + py,
    };

    const start = edge(a, control);
    const end = edge(b, control);
    start.x += px;
    start.y += py;
    end.x += px;
    end.y += py;
    const d = `M${start.x} ${start.y}Q${control.x} ${control.y} ${end.x} ${end.y}`;

    if (arrow.path.getAttribute("d") === d) return;
    arrow.path.setAttribute("d", d);
    arrow.group.style.setProperty(
      "--wb-length",
      String(arrow.path.getTotalLength()),
    );

    if (arrow.text) {
      let lx = (start.x + 2 * control.x + end.x) / 4;
      let ly = (start.y + 2 * control.y + end.y) / 4 - 6;

      // Push the label off any card it still lands on, along the line's normal.
      for (const r of obstacles) {
        const on =
          lx >= r.left - 2 &&
          lx <= r.right + 2 &&
          ly >= r.top - 2 &&
          ly <= r.bottom + 2;

        if (!on) continue;

        const side = Math.sign(
          nx * (lx - r.x - r.width / 2) + ny * (ly - r.y - r.height / 2) || 1,
        );

        const push = r.height / 2 + 12;

        lx += nx * side * push;
        ly += ny * side * push;
      }

      arrow.text.setAttribute("x", String(lx));
      arrow.text.setAttribute("y", String(ly));
    }
  };

  interface EdgeSpec {
    tone?: Tone;
    dashed?: boolean;
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
    group.setAttribute("class", "wb-arrow");
    path.setAttribute("class", "wb-line");
    group.append(path);

    if (spec.tone) group.dataset.tone = spec.tone;

    if (spec.dashed) group.dataset.dashed = "";

    if (spec.enter) group.dataset.enter = spec.enter;

    if (spec.exit) group.dataset.exit = spec.exit;

    if (spec.only) group.dataset.only = spec.only.join(" ");

    if (spec.highlight) group.dataset.highlight = spec.highlight.join(" ");

    const record: ArrowRecord = {
      group,
      path,
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
    route(record);
    applyStates();

    return record;
  };

  const show = async (index: number, instant: boolean) => {
    const list = frames();
    const frame = list[index];

    if (!frame) return;
    const previous = list[current];
    const token = ++showing;
    instantMode = instant || Boolean(init?.reducedMotion);

    if (instantMode) root.setAttribute("data-wb-instant", "");

    current = index;
    root.dataset.frame = frame.key;
    root.dataset.frameIndex = String(index);
    applyStates();

    const change: FrameChange = {
      frame,
      previous,
      direction: !previous
        ? "none"
        : index > previous.index
          ? "forward"
          : index < previous.index
            ? "backward"
            : "none",
      instant: instantMode,
    };

    const waits: Promise<unknown>[] = [];

    for (const key of [frame.key, "*"])
      for (const handler of handlers.get(key) ?? []) {
        try {
          waits.push(...finished(handler(change)));
        } catch (error) {
          fail(String(error));
        }
      }

    waits.push(
      playSegment(
        index,
        !instantMode && previous !== undefined && index === previous.index + 1,
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

    if (token === showing) post({ type: "settled", index });
  };

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

  // Tween an element along an edge's path during a frame. It appears at the
  // start, rides the line, and fades out on arrival unless it should stay.
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
    const motion = lib().svg.createMotionPath(record.path);

    if (!motion) throw new Error("The edge has no path yet.");

    const segment = frameTimeline(frame)
      .set(element, { opacity: 1 }, options.position)
      .add(
        element,
        {
          translateX: motion.translateX,
          translateY: motion.translateY,
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
  const scene = (columns: number): Scene => {
    const grid = document.createElement("div");
    grid.className = "wb-scene";
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    document.body.append(grid);

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

    sceneAppliers.push((index) => {
      for (const part of byElement.values()) {
        let { tone, text } = part.base;

        for (const { at, change } of part.changes)
          if (at <= index) {
            if (change.tone !== undefined) tone = change.tone;

            if (change.text !== undefined) text = change.text;
          }

        if (tone && tone !== "none") part.el.dataset.tone = tone;
        else delete part.el.dataset.tone;

        if (text !== undefined) part.setText?.(text);
      }
    });

    const place = (el: HTMLElement, [column, row, rowSpan, colSpan]: Cell) => {
      el.style.gridColumn = colSpan
        ? `${column} / span ${colSpan}`
        : String(column);
      el.style.gridRow = rowSpan ? `${row} / span ${rowSpan}` : String(row);
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
      return frames();
    },
    get frame() {
      return frames()[Math.max(current, 0)]!;
    },
    get theme() {
      return { ...theme };
    },
    get reducedMotion() {
      return Boolean(init?.reducedMotion);
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

      if (instantMode && finite(animation)) animation.finish();

      return animation;
    },
    goto(key) {
      if (frameIndex(key) < 0) throw new Error(`Unknown frame "${key}".`);
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
      return makeToken(options.label, options.tone);
    },
    travel(token, arrow, frame, options = {}) {
      const record = arrows.find((item) => item.group === arrow);

      if (!record)
        throw new Error("travel() takes an arrow from whiteboard.arrow().");

      travelAlong(resolve(token), record, frame, options);
    },
    scene: (options = {}) => scene(options.columns ?? 3),
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

  const measure = () => {
    arrows.forEach(route);
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

    requestAnimationFrame(measure);
  };

  const start = async (message: StageInit) => {
    init = message;
    applyTheme(message.theme);
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
    await show(message.frame, true);
  };

  port.onmessage = (event: MessageEvent<HostMessage>) => {
    const message = event.data;

    switch (message.type) {
      case "init":
        if (!init) start(message).catch((error) => fail(String(error)));
        break;
      case "frame":
        if (init)
          show(message.index, message.instant).catch((error) =>
            fail(String(error)),
          );
        break;
      case "theme":
        applyTheme(message.theme);
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
