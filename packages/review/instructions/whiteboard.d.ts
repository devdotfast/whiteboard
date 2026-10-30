/**
 * The `whiteboard` global an animation's scripts call. Read-only
 * reference: Whiteboard rewrites this file, and editing it changes nothing.
 * The CSS classes and --wb-* variables every animation loads are in whiteboard.css beside it.
 *
 * Frames are states, not events: whatever a frame shows must also be right
 * when the reader jumps to it or steps back, not only when it plays.
 */

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-object-parameters -- Documents a script API; anime.js parses its own targets and params. */

/** Colors any scene part, arrow, token, or kit element (as data-tone). */
export type Tone = "accent" | "added" | "removed" | "modified" | "muted";

/** One frame, as your scripts read it. */
export interface Frame {
  key: string;
  title: string;
  caption?: string;
  /** The frame's own state, from its `data`: draw the frame from this. */
  data?: unknown;
  /** The code names the frame lists, for data-wb-open. */
  code?: string[];
  /** Its position in the active path. */
  index: number;
}

/** What a frame handler learns about the change that called it. */
export interface FrameChange {
  frame: Frame;
  previous: Frame | undefined;
  direction: "forward" | "backward" | "none";
  /** Skip motion and draw the end state: a jump, the first draw, or reduced
   * motion. */
  instant: boolean;
}

/** Return the animations a handler starts, or a finite promise, so playback
 * waits for them. */
export type FrameResult =
  | void
  | Animation
  | readonly Animation[]
  | Promise<void>;

export interface Whiteboard {
  /** The active path's frames, in order: a scenario's, or all of them. */
  readonly frames: readonly Frame[];
  /** The current frame object; read `.key` for its name. */
  readonly frame: Frame;
  /** The --wb-* theme values, by name without the prefix. */
  readonly theme: Readonly<Record<string, string>>;
  /** Whether the reader's theme is light or dark; <html> carries the same as
   * data-wb-theme. */
  readonly colorScheme: "light" | "dark";
  /** The reader's prefers-reduced-motion setting, live. Skip motion the
   * helpers do not manage when it is true. */
  readonly reducedMotion: boolean;

  /** Run when a frame shows; "*" runs on every frame, before frame-specific
   * handlers, and again when reduced motion changes. Cancel earlier work when
   * another frame shows. Returns an unsubscribe function. */
  on(key: string, handler: (change: FrameChange) => FrameResult): () => void;
  /** element.animate that holds its end state, lands at the end on a jump, and
   * skips motion under reduced motion. */
  animate(
    target: Element | string,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    options?: number | KeyframeAnimationOptions,
  ): Animation;
  /** The frame's part of one anime.js timeline: it plays when the reader steps
   * into the frame and lands at its end on a jump. A tween starts where the
   * frames before it left the element, so write only where it goes. */
  timeline(key: string): FrameTimeline;
  /** anime.js v4, also the global `anime`: easings, stagger, utils. */
  readonly anime: unknown;

  /** A placeholder the whiteboard fills with the block's code peek by name.
   * A peek is drawn over your HTML: do not draw or travel over it. It is about
   * 40px of header plus 18px a line, up to about 400px. */
  code(name: string): HTMLElement;
  /** A placeholder for another block of this whiteboard, by id. */
  block(id: string): HTMLElement;
  /** Open the named code beside the whiteboard. An element with
   * data-wb-open="name" does this when clicked, with no script. */
  reveal(name: string): void;

  /** Select the ordered path the host's controls step through, for a branch
   * the drawing decides. Every key must be a declared frame; repeating the
   * same path does nothing. Prefer `scenarios` on the block for paths the
   * reader picks. */
  setSequence(keys: readonly string[]): void;
  /** Jump to a frame of the active path. */
  goto(key: string): void;
  next(): void;
  prev(): void;

  /** A grid of cards with edges and moving chips: the quickest way to draw a
   * request flow or a few services whose notes change per frame. */
  scene(options?: SceneOptions): Scene;
  /** An SVG arrow between two elements that follows them as they move, for a
   * hand-made layout the scene cannot express. */
  arrow(from: CardRef, to: CardRef, options?: ArrowOptions): SVGGElement;
  /** A dot, or a pill with a label, that travel() moves along arrows. */
  token(options?: TokenOptions): HTMLElement;
  /** Move a token along an arrow during a frame, at the arrow's live geometry.
   * It fades out on arrival unless `stay` keeps it at the head. Trips append
   * to the frame; `position: 0` starts trips together, a number of
   * milliseconds sequences one after another. */
  travel(
    token: HTMLElement | string,
    arrow: SVGGElement,
    frame: string,
    options?: TravelOptions,
  ): void;
  /** Removed: throws, saying how to rebuild the diagram. */
  mermaid(...args: unknown[]): never;
}

export interface FrameTimeline {
  /** Numeric positions count milliseconds from the frame's start; "<" starts
   * at the previous call's end and "<<" at its beginning. */
  add(
    targets: unknown,
    params: object,
    position?: number | string,
  ): FrameTimeline;
  set(
    targets: unknown,
    params: object,
    position?: number | string,
  ): FrameTimeline;
  call(callback: () => void, position?: number | string): FrameTimeline;
}

export interface TravelOptions {
  duration?: number;
  ease?: string;
  position?: number | string;
  stay?: boolean;
}

/** A scene card, its id, or an element. */
export type CardRef = SceneCard | string | Element;

/** 1-based column and row, with optional row and column spans: [1, 2, 1, 4] is
 * row 2, four columns wide. */
export type Cell = [
  column: number,
  row: number,
  rowSpan?: number,
  colSpan?: number,
];

export interface SceneOptions {
  /** Declared columns; default 3. Three cards with short labels fit a row at
   * the document's width; past four, use a second row. */
  columns?: number;
  /** Where the scene goes; defaults to the animation's body. */
  container?: string | HTMLElement;
  /** Fold into fewer columns when narrow, then one. Default true. */
  responsive?: boolean;
}

export interface Scene {
  /** A labeled card: a service, a process, an actor. */
  actor(options: SceneCardOptions): SceneCard;
  /** A card that holds items, e.g. a queue or a cache. */
  store(options: SceneCardOptions): SceneStore;
  /** A card holding a small table with a header row. */
  table(options: SceneCardOptions & { columns: string[] }): SceneTable;
  /** A cell holding a code peek by name. Span columns when the code needs
   * width; a one-column peek clips long lines. */
  peek(
    name: string,
    options: { at: Cell; enter?: string; exit?: string; only?: string[] },
  ): HTMLElement;
  /** A pill above the scene, e.g. a version; on() changes its text. */
  badge(options: { text?: string; tone?: Tone }): HTMLElement;
  /** Change a card's note, or an item's or badge's text, or a tone, from this
   * frame on, until a later frame changes it. Follows the active path. */
  on(frame: string, part: CardRef, change: SceneChange): void;
  /** A straight edge between two cards that follows them. It bows around
   * cards in the way; keep the cells between linked cards empty. */
  link(from: CardRef, to: CardRef, options?: SceneLinkOptions): SVGGElement;
  /** A chip that rides the edge during a frame at one fixed speed, drawing the
   * edge if there is none. Keep labels to about 12 characters. */
  send(
    from: CardRef,
    to: CardRef,
    label: string,
    frame: string,
    options?: SceneSendOptions,
  ): void;
}

export interface SceneCard {
  readonly element: HTMLElement;
  readonly id: string;
}

export interface SceneStore extends SceneCard {
  /** A chip inside the store. */
  item(label: string, options?: SceneItemOptions): HTMLElement;
}

export interface SceneTable extends SceneCard {
  /** A row of cells, matching the table's columns. */
  row(cells: string[], options?: SceneItemOptions): HTMLTableRowElement;
}

/** When a part shows: from `enter` on, until `exit`, or `only` in these frames.
 * With a scenario, enter and exit follow its order; only matches keys. Hidden
 * parts take no space. */
interface Lifecycle {
  enter?: string;
  exit?: string;
  only?: string[];
}

export interface SceneCardOptions extends Lifecycle {
  /** Names the card for link, send and on. */
  id: string;
  at: Cell;
  /** The first line; defaults to the id. */
  title?: string;
  /** The second line; on() changes it per frame. */
  note?: string;
  tone?: Tone;
  /** Frames during which the card is ringed. */
  highlight?: string[];
  /** The code the card opens when clicked: a name in the block's code. */
  code?: string;
}

export interface SceneItemOptions extends Lifecycle {
  tone?: Tone;
}

export interface SceneChange {
  /** The card's note, or an item's or badge's text. `note` works too. */
  text?: string;
  /** "none" clears the tone back to the neutral surface. */
  tone?: Tone | "none";
}

export interface SceneLinkOptions extends Lifecycle {
  label?: string;
  tone?: Tone;
  /** Dashed means async: a reply, a stream, a background send. */
  dashed?: boolean;
  /** Default true; false for an undirected guide or relationship. */
  arrowhead?: boolean;
}

export interface SceneSendOptions extends Lifecycle {
  tone?: Tone;
  /** Keep the chip at its target instead of fading it out; scope when it shows
   * with enter, exit or only. */
  stay?: boolean;
}

export interface ArrowOptions extends Lifecycle {
  label?: string;
  tone?: Tone;
  dashed?: boolean;
  /** Default true. */
  arrowhead?: boolean;
  /** Pixels the arrow bows to its left; negative bows right. Two arrows
   * pointing at each other need the same sign to sit on opposite sides. */
  bend?: number;
  /** Frames during which the arrow is ringed. */
  highlight?: string[];
}

export interface TokenOptions extends Lifecycle {
  label?: string;
  tone?: Tone;
  /** Show it as a static marker where you place it (left and top; it centers
   * itself), without travel(). Otherwise it stays hidden until it travels. */
  visible?: boolean;
}

declare global {
  const whiteboard: Whiteboard;
}
