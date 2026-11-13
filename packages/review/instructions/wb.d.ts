/**
 * The `wb` global a diagram's script draws with. Read-only reference:
 * Whiteboard rewrites this file, and editing it changes nothing.
 *
 * The script is a JavaScript module (diagram.js): it may use top-level
 * await, and it imports nothing. diagram.html, when there is one, is in
 * the stage before it runs. It runs in a sandboxed stage with no
 * network; layout, charts and 3D load their libraries through `wb`:
 * `wb.layout()` (ELK), `wb.chart()` (Observable Plot), `await wb.three()`
 * (three.js).
 *
 * Stage coordinates are CSS pixels from the drawing's top left. The stage
 * keeps a small inset around the drawing (block.json `stage.inset`).
 */

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-object-parameters -- Documents a script API; Plot parses its own options. */

/** C4 kinds. They differ by outline, never by colour. */
export type NodeKind =
  | "person"
  | "system"
  | "container"
  | "component"
  | "database"
  | "queue"
  | "external";

/** A node's, group's or wire's state: lit, plain, or faded. */
export type NodeState = "default" | "active" | "dimmed";

/** A group's hue. "auto" takes the next in turn. */
export type GroupColor =
  | "neutral"
  | "sky"
  | "teal"
  | "green"
  | "amber"
  | "coral"
  | "rose"
  | "violet";

export interface NodeOptions {
  /** Stable id: wires and a frame's moves name the node by it. The label
   * when omitted. */
  id?: string;
  kind: NodeKind;
  /** The node's name. */
  label: string;
  /** The small caps line under the name; defaults to the kind. A container
   * or database usually adds its tech: "Container · Go". One line: about
   * 20 characters fit a node of the default width, and a longer one
   * widens the node. */
  tag?: string;
  /** Top-left corner in stage px. Give both for
   * `wb.layout({ mode: "manual" })`; leave both out when ELK places the
   * nodes. */
  x?: number;
  y?: number;
  /** 160 × 72 by default. A width is a least width: the node widens to
   * show its name and tag whole, about its middle when placed by hand. */
  width?: number;
  height?: number;
  state?: NodeState;
  /** The name, or names, in the block's `code` that back this node: where
   * it is defined. Every node but a person or an external system claims
   * something about the code, so one without code counts as unlinked,
   * unless the diagram has no `code` at all. `false` says it is not code,
   * such as a repository, a disk or a third-party service. */
  code?: string | string[] | false;
}

export interface GroupOptions {
  /** Stable id; the label when omitted. */
  id?: string;
  /** The group's name, drawn at its top left. */
  label: string;
  /** A small caps note after the name, like "Software system". */
  tag?: string;
  /** The nodes and groups it holds. Create inner groups first: a group
   * around groups becomes their boundary. */
  around?: HTMLElement[];
  /** Space between the group's edge and what it holds; 20 by default. */
  padding?: number;
  /** Which way the flow runs inside the group, when it differs from the
   * drawing's `wb.layout({ direction })`: a drawing that runs right can
   * stack one group's parts down, which keeps it closer to square. */
  direction?: "right" | "down";
  /** A box, for a group drawn without `around`. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** A group of groups is neutral by default; any other group is "auto".
   * Groups inside a coloured group are drawn as cards in its hue. */
  color?: GroupColor | "auto";
  state?: NodeState;
}

export interface EdgeOptions {
  /** Stable id; "<from>→<to>" when omitted. */
  id?: string;
  /** The nodes it joins, as `wb.node` returned them or by id. */
  from: HTMLElement | string;
  to: HTMLElement | string;
  /** A few words on the line, like "gRPC" or "GET /play". */
  label?: string;
  /** For something optional, asynchronous or not built yet. */
  dashed?: boolean;
  /** The call site that backs it: the line where `from` calls `to`. A wire
   * between two pieces of code claims something about it, so one without
   * code counts as unlinked; a wire to a person or an external system does
   * not unless it names code. `false` says it is not code. */
  code?: string | string[] | false;
  state?: NodeState;
}

export interface LayoutOptions {
  /** "elk" (the default) places every node, group, wire and label.
   * "manual" keeps the `x` and `y` you gave every node, routes each wire
   * from the side facing the other node, straight or bending twice,
   * moves a group's name along its header clear of the wires, and
   * sizes the stage to what you drew, at least `stage` in block.json. The
   * other options are for "elk". */
  mode?: "elk" | "manual";
  /** Which way the flow runs; "right" by default. A drawing laid out
   * "right" that is wider than the board's column is laid out "down"
   * instead, when that is narrower. */
  direction?: "right" | "down";
  /** Space between neighbouring nodes; 32 by default. */
  spacing?: number;
  /** Space between columns (or rows going down); 64 by default. */
  layerSpacing?: number;
}

/** One movement in a step, as frames.json writes it. */
export interface Move {
  from: string;
  to: string;
  /** The wire it rides, by its `wb.edge` id, when two join the same nodes. */
  edge?: string;
  /** The move goes wrong, such as a refused write, a no vote or an abort:
   * its token is red. */
  failed?: boolean;
  /** The message never arrives, such as a request that times out or a
   * reply that never comes: its token stops halfway, red and faded. */
  lost?: boolean;
  /** Text on the token, such as `GET /orders/42`. */
  label?: string;
  /** Draw it as a reply, outlined. A move against its wire's direction is
   * one already, so this is for a reply riding a wire of its own. */
  reply?: boolean;
  /** Milliseconds to wait before it sets off, such as 700 for a reply that
   * follows its request in the same step, or a staggered fan-out. */
  delay?: number;
}

/** A frame, as frames.json writes it. */
export interface Frame {
  key: string;
  title: string;
  /** The word or two on the step bar. */
  label?: string;
  caption?: string;
  /** Yours: any JSON from frames.json, for the script to show this step. */
  data?: unknown;
  code?: string[];
  moves?: Move[];
}

/** A scenario: its key, label and frames in order. */
export interface Scenario {
  key: string;
  label: string;
  frames: Frame[];
}

/** Where the reader came from, for a script that animates a step. */
export interface FrameChange {
  /** The new frame's position in the scenario, from 0. */
  index: number;
  previous: Frame | null;
  previousIndex: number;
}

/** A chapter of a played diagram, as block.json's timeline writes it. */
export interface Chapter {
  key: string;
  title: string;
  caption?: string;
  duration: number;
  code?: string[];
}

/** Where the playhead is in a played diagram. */
export interface Moment {
  chapter: Chapter | null;
  chapterIndex: number;
  /** Milliseconds since the chapter started. */
  chapterTime: number;
  /** The whole timeline's length in milliseconds. */
  duration: number;
}

/** The board's colours in the current theme, as plain colours for a
 * script and for libraries that cannot read CSS variables; markup reads
 * the same ones as CSS variables. `var(--wb-ink)`, `--wb-muted` and
 * `--wb-faint` for text, `--wb-surface` and `--wb-raised` for fills,
 * `--wb-line` for borders, `--wb-accent` for what is active. For change and
 * state: `--wb-added` (green), `--wb-removed` (red) and `--wb-modified`
 * (amber), each with a `-bg` fill such as `--wb-removed-bg`. Fonts:
 * `--wb-font-sans`, `--wb-font-mono`. */
export interface Colors {
  ink: string;
  muted: string;
  faint: string;
  surface: string;
  raised: string;
  line: string;
  accent: string;
  /** Change and state, such as a limit crossed: green, red and amber. */
  added: string;
  removed: string;
  modified: string;
  /** Chart series in fixed order: never cycle them. */
  series: string[];
}

/** Observable Plot, as `wb.chart` hands it to `plot`. */
export interface PlotModule {
  plot(options: PlotOptions): Element;
}

/** Plot's options; any other Plot option works too. */
export interface PlotOptions {
  /** The heading the reader sees above the chart. */
  title?: string;
  /** A line under the title. */
  subtitle?: string;
  /** Leave out: the chart's box in `wb.chart` sets its size. */
  width?: number;
  /** Leave out: the chart's box in `wb.chart` sets its size. */
  height?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  grid?: boolean;
  x?: PlotScale;
  y?: PlotScale;
  color?: PlotScale;
  style?: {
    fontFamily?: string;
    fontSize?: string;
    color?: string;
    background?: string;
    overflow?: string;
  };
  marks?: unknown[];
}

export interface PlotScale {
  domain?: unknown[];
  range?: unknown[];
  scheme?: string;
  legend?: boolean;
  label?: string | null;
  type?: string;
  grid?: boolean;
  tickFormat?: unknown;
  ticks?: unknown;
  nice?: boolean;
  zero?: boolean;
  padding?: number;
}

export interface ChartContext {
  /** The Observable Plot module: marks, scales and helpers. */
  Plot: PlotModule;
  /** The palette for the current theme; `series` is the chart order. */
  colors: Colors;
  width: number;
  height: number;
  frame: Frame | null;
  scenario: Scenario | null;
}

export interface ChartOptions {
  /** Stable id; the label when omitted. */
  id?: string;
  /** What the chart shows, for selection and the code view. It is not
   * drawn: give `plot` a `title` for one the reader sees. */
  label: string;
  /** Top-left corner and size. Left out, a chart takes the board's
   * column, 240px tall, under whatever was drawn before it. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Returns Plot options for this moment. Called again on every theme,
   * scenario and frame change, so it can stress what a step is about. */
  plot(context: ChartContext): PlotOptions;
  /** Where the data comes from: the query or code that produces it. */
  code?: string | string[];
}

export interface TokenOptions {
  /** Text on the pill, like "GET /play"; a plain dot without one. About
   * 16 characters show; the rest is cut and shows on hover. */
  label?: string;
  /** "request" (filled) by default; "reply" is outlined; "error" is red. */
  tone?: "request" | "reply" | "error";
}

export interface TravelOptions {
  /** Run the wire from its end back to its start, as a reply does. */
  reverse?: boolean;
  /** Pixels per millisecond; 0.18 by default. A trip takes at least 600ms. */
  speed?: number;
  /** Stops the trip where it is; the promise then resolves false. */
  signal?: AbortSignal;
  /** Puts the token at the end at once, as a jump to a step does. */
  instant?: boolean;
  /** How far along the wire the trip ends, from 0 to 1; 1 by default. */
  to?: number;
}

export interface Wb {
  /** The scenario the reader picked, or null without scenarios. */
  scenario: Scenario | null;
  /** The frame showing, or null without frames. */
  frame: Frame | null;
  /** The frame's position in the scenario from 0, or -1 without frames. */
  frameIndex: number;
  /** A played diagram's playhead in milliseconds; 0 without a timeline. */
  time: number;
  /** The timeline's length in milliseconds; 0 without one. */
  duration: number;
  /** The timeline's chapters in order; empty without one. */
  chapters: Chapter[];

  /** Draws a node and returns its element, whose `dataset.id` is the
   * node's id. Set its state later with `node.dataset.state`. */
  node(options: NodeOptions): HTMLElement;
  /** Draws a group behind what it holds and returns its element. Change
   * its hue with `group.dataset.color`. */
  group(options: GroupOptions): HTMLElement;
  /** Draws a wire between two nodes and returns its path. */
  edge(options: EdgeOptions): SVGPathElement;
  /** Lays out everything drawn so far. With ELK (the default), a layered
   * layout: nodes in columns along the flow, groups around what they hold,
   * wires at right angles with their labels clear. With `mode: "manual"`,
   * the nodes stay where you put them and only the wires are routed. Call
   * it once, after the last node, group and wire, and await it before
   * reading positions. Resolves to the drawing's size, which the stage
   * takes. */
  layout(options?: LayoutOptions): Promise<{ width: number; height: number }>;
  /** What collides now, in words. `session_render` reports the same as
   * findings, so you rarely need to call it. */
  overlaps(): string[];

  /** Calls `listener` with the frame showing and on every step after. It
   * runs once the moves have lit the step, so states it sets stay, such as a
   * node lit on a step with no moves. */
  onFrame(
    listener: (frame: Frame | null, change: FrameChange) => void,
  ): () => void;
  /** Calls `listener` with the scenario now and when the reader picks
   * another. */
  onScenario(listener: (scenario: Scenario | null) => void): () => void;
  /** Runs when the reader picks another scenario: undo what you started. */
  onCleanup(cleanup: () => void): void;
  /** The moves engine: each frame's `moves` play by themselves, and
   * lighting follows them. `manual()` hands tokens and lighting to you. */
  moves: { manual(): void };
  /** A token to move along a wire with `travel`. */
  token(options?: TokenOptions): HTMLElement;
  /** Moves `token` along a wire, from just outside the node at its start to
   * just short of the node at its end, so it never covers either; resolves
   * true on arrival, false when `signal` stops it. */
  travel(
    token: HTMLElement,
    path: SVGPathElement,
    options?: TravelOptions,
  ): Promise<boolean>;
  /** Calls `listener` with the playhead now and as it moves, in a played
   * diagram. Draw that exact moment: time can jump either way. */
  onTime(listener: (time: number, moment: Moment) => void): () => void;

  /** Marks anything drawn as a claim backed by the named code. Nodes,
   * wires and charts take `code` instead. */
  code(target: Element, names?: string | string[], label?: string): void;
  /** Gives something drawn an id, a label and a kind, as nodes and wires
   * have. Returns a function that undoes it. */
  selectable(
    target: Element,
    item?: { id?: string; label?: string; kind?: string },
  ): () => void;

  /** Draws a chart with Observable Plot in the stage's palette. */
  chart(options: ChartOptions): HTMLElement;
  /** three.js, for a 3D scene: resolves to its module, as `import * as
   * THREE from "three"` would. Loaded on first call; the stage has no
   * network, so this is the only way to reach it. */
  three(): Promise<typeof import("three")>;

  /** "light" or "dark", following the board, not the system. */
  readonly theme: "light" | "dark";
  /** Whether the reader asked for less motion. */
  readonly reducedMotion: boolean;
  /** The palette as plain colours for the current theme. */
  colors(): Colors;
  /** Calls `listener` with the theme now and on every switch. */
  onTheme(
    listener: (theme: "light" | "dark", colors: Colors) => void,
  ): () => void;
}

declare global {
  const wb: Wb;
}
