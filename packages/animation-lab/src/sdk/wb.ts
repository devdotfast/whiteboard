import type {
  Chapter,
  Frame,
  Scenario,
  SelectedItem,
  StageState,
  Timeline,
} from "../block/model";

type NodeKind =
  | "person"
  | "system"
  | "container"
  | "component"
  | "database"
  | "queue"
  | "external";

type NodeState = "default" | "active" | "dimmed";

type NodeOptions = {
  /** Stable id for selection; the label when omitted. */
  id?: string;
  kind: NodeKind;
  /** The node's name. */
  label: string;
  /** The small caps line under the name; defaults to the kind, and a
   * container or database usually adds its tech: "CONTAINER · NODE.JS". */
  tag?: string;
  /** Top-left corner in stage px. A person's head and a database's lid
   * reach a little above it. Leave both out when `wb.layout()` places the
   * nodes. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  state?: NodeState;
  /** Where to put it; the stage's body by default. */
  parent?: HTMLElement;
  /** The name, or names, in the block's `code` that back this node: where
   * it is defined. Every node but a person or an external system claims
   * something about the code, so one without code shows as unlinked. */
  code?: string | string[];
};

type GroupColor =
  | "neutral"
  | "sky"
  | "teal"
  | "green"
  | "amber"
  | "coral"
  | "rose"
  | "violet";

type GroupOptions = {
  /** Stable id for selection; the label when omitted. */
  id?: string;
  /** The group's name, drawn at its top left. */
  label: string;
  /** A small caps note after the name, like "Software system". */
  tag?: string;
  /** The nodes and groups it holds. The group sizes itself around them,
   * and a group that holds groups becomes their boundary. */
  around?: HTMLElement[];
  /** Space between the group's edge and what it holds; 20 by default. */
  padding?: number;
  /** A box in stage px, for a group drawn without `around`. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** A hue, or "auto" for the next one in turn. A group of groups is
   * neutral by default; any other group is "auto". Groups inside a
   * coloured group are drawn as white cards in its hue. */
  color?: GroupColor | "auto";
  state?: NodeState;
};

type EdgeOptions = {
  /** Stable id for selection; "<from>→<to>" when omitted. */
  id?: string;
  /** The nodes it joins, as `wb.node` returned them or by id. */
  from: HTMLElement | string;
  to: HTMLElement | string;
  /** A few words on the line, like "GET /play". */
  label?: string;
  /** For something optional, asynchronous or not built yet. */
  dashed?: boolean;
  /** The call site that backs it: the line where `from` calls `to`. An
   * edge between two pieces of code claims something about it, so one
   * without code shows as unlinked; an edge to a person or an external
   * system does not unless it names code. */
  code?: string | string[];
  state?: NodeState;
};

type LayoutOptions = {
  /** Which way the flow runs; "right" by default. */
  direction?: "right" | "down";
  /** Space between neighbouring nodes in px; 32 by default. */
  spacing?: number;
  /** Space between columns (or rows going down) in px; 64 by default. */
  layerSpacing?: number;
};

type ElkNode = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: {
    id: string;
    sources?: string[];
    targets?: string[];
    labels?: {
      text: string;
      width: number;
      height: number;
      x?: number;
      y?: number;
      layoutOptions?: Record<string, string>;
    }[];
    sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[];
  }[];
  layoutOptions?: Record<string, string>;
};

type Point = { x: number; y: number };

type Elk = { layout(graph: ElkNode): Promise<ElkNode> };

declare global {
  interface Window {
    /** Set by the stage document: imports ELK from the library map. */
    wbLoadElk?: () => Promise<{ default: new () => Elk }>;
    /** Set by the stage document: imports Observable Plot. */
    wbLoadPlot?: () => Promise<PlotModule>;
  }
}

/** Observable Plot as the stage loads it; scripts reach the whole module
 * through a chart's `Plot`. */
type PlotModule = { plot(options: PlotOptions): Element };

/** A Plot scale: the parts the stage reads or fills in. */
type PlotScale = {
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
};

/** Plot's top-level options; scripts may pass any other Plot option too. */
type PlotOptions = {
  width?: number;
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
};

type ChartContext = {
  /** The Observable Plot module: marks, scales and helpers. */
  Plot: PlotModule;
  /** The stage palette for the current theme; `series` is the chart order. */
  colors: unknown;
  width: number;
  height: number;
  frame: Frame | null;
  scenario: Scenario | null;
};

type ChartOptions = {
  /** Stable id for selection; the label when omitted. */
  id?: string;
  /** What the chart shows, for selection and code view headings. */
  label: string;
  /** Top-left corner and size in stage px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Returns Plot options for this moment. Called again whenever the theme,
   * scenario or frame changes, so it can emphasise what a step is about. */
  plot(context: ChartContext): PlotOptions;
  /** Where the data comes from: the query or code that produces it. */
  code?: string | string[];
};

type TokenOptions = {
  /** Text on the pill, like "GET /play/42"; a plain dot without one. */
  label?: string;
  /** "request" (filled accent) by default; "reply" is outlined, so a
   * response reads apart from the call that caused it. */
  tone?: "request" | "reply";
};

type TravelOptions = {
  /** Run the wire from its end back to its start, as a reply does. */
  reverse?: boolean;
  /** Pixels per millisecond, so long wires take longer; 0.18 by default.
   * A wire never takes under 600ms, so its label can be read. */
  speed?: number;
  /** Stops the trip where it is; the promise then resolves false. */
  signal?: AbortSignal;
};

/** Something drawn on a canvas that the reader can select: the script
 * says where it is on screen, since the DOM cannot. */
type SelectableRegion = SelectedItem & {
  /** Its box in stage px, now. */
  rect(): DOMRect;
  /** Whether a point in stage px is on it; its box when omitted. */
  hit?(x: number, y: number): boolean;
};

type Candidate = SelectedItem & { rect(): DOMRect };

type Moment = {
  chapter: Chapter | null;
  chapterIndex: number;
  /** Milliseconds since the chapter started. */
  chapterTime: number;
  /** The whole timeline's length in milliseconds. */
  duration: number;
};

type FrameChange = {
  index: number;
  previous: Frame | null;
  previousIndex: number;
};

/**
 * Installs the whiteboard SDK as `wb` in the animation's iframe. It runs
 * there from its source text, so it must not close over anything outside
 * its own body; the host passes everything it needs as arguments and later
 * sends `wb:state` messages as the reader picks scenarios and frames, and
 * `wb:time` messages while a timeline plays or the reader scrubs it.
 */
export function installWb(initial: StageState, timeline: Timeline | null) {
  const chapters = timeline?.chapters ?? [];
  const duration = chapters.reduce((total, item) => total + item.duration, 0);

  // The chapter a time falls in; the end belongs to the last chapter.
  const momentAt = (time: number): Moment => {
    let start = 0;

    for (const [chapterIndex, chapter] of chapters.entries()) {
      if (
        time < start + chapter.duration ||
        chapterIndex === chapters.length - 1
      )
        return {
          chapter,
          chapterIndex,
          chapterTime: Math.min(Math.max(time - start, 0), chapter.duration),
          duration,
        };

      start += chapter.duration;
    }

    return { chapter: null, chapterIndex: -1, chapterTime: 0, duration };
  };

  const timeListeners = new Set<(time: number, moment: Moment) => void>();

  const scenarioListeners = new Set<(scenario: Scenario | null) => void>();

  const frameListeners = new Set<
    (frame: Frame | null, change: FrameChange) => void
  >();

  // The stage's palette, light and dark. Scripts take colours from here
  // (`var(--wb-ink)` in CSS, `wb.colors()` for canvas libraries) instead of
  // hard-coding them, so they follow the theme.
  const palette = {
    ink: ["#15181e", "#eef0f4"],
    muted: ["#5d6472", "#9199a8"],
    faint: ["#9aa0ab", "#5f6776"],
    surface: ["#ffffff", "#0c0f15"],
    raised: ["#f6f7f9", "#161a22"],
    line: ["#d8dbe1", "#2a303b"],
    accent: ["#2b55e6", "#5b7cff"],
  } satisfies Record<string, [string, string]>;

  type ColorName = keyof typeof palette;

  // Chart series, in this fixed order and never cycled: the dataviz
  // reference palette, validated against the stage's own surfaces in both
  // themes (adjacent pairs pass CVD and normal-vision separation). In light
  // mode slots 3–5 sit under 3:1 on white, so charts using them label their
  // series directly. Past three series in a scatter, fold into "Other".
  const SERIES = {
    light: [
      "#2a78d6",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
      "#6250d6",
      "#e34948",
    ],
    dark: [
      "#3987e5",
      "#d95926",
      "#199e70",
      "#c98500",
      "#d55181",
      "#008300",
      "#9085e9",
      "#e66767",
    ],
  };

  const darkQuery = matchMedia("(prefers-color-scheme: dark)");

  const themeListeners = new Set<
    (theme: "light" | "dark", colors: Colors) => void
  >();

  const themeOf = () => (darkQuery.matches ? "dark" : "light");

  const colorsOf = (theme: "light" | "dark") => {
    const side = theme === "dark" ? 1 : 0;

    return {
      ink: palette.ink[side],
      muted: palette.muted[side],
      faint: palette.faint[side],
      surface: palette.surface[side],
      raised: palette.raised[side],
      line: palette.line[side],
      accent: palette.accent[side],
      series: theme === "dark" ? SERIES.dark : SERIES.light,
    } satisfies Record<ColorName, string> & { series: string[] };
  };

  type Colors = ReturnType<typeof colorsOf>;

  // One script listener throwing must not stop the others, or leave the
  // stage half updated.
  const notify = <Args extends unknown[]>(
    listeners: Iterable<(...args: Args) => void>,
    ...args: Args
  ) => {
    for (const listener of listeners)
      try {
        listener(...args);
      } catch (error) {
        console.error(error);
      }
  };

  darkQuery.addEventListener("change", () => {
    const theme = themeOf();

    notify(themeListeners, theme, colorsOf(theme));
  });

  // Libraries bring light-only defaults. React Flow's are remapped onto the
  // palette so they follow the theme. React Flow marks itself "light" unless
  // told otherwise, so only an explicit `colorMode: "dark"` pins a scheme.
  const themeStyles = document.createElement("style");
  themeStyles.textContent = `
    :root {
      ${Object.entries(palette)
        .map(
          ([name, [light, dark]]) =>
            `--wb-${name}: light-dark(${light}, ${dark});`,
        )
        .join("\n      ")}
      color: var(--wb-ink);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .react-flow.dark { color-scheme: dark; }
    .react-flow {
      --xy-node-color: var(--wb-ink);
      --xy-node-background-color: var(--wb-surface);
      --xy-node-border: 1px solid var(--wb-faint);
      --xy-node-group-background-color: var(--wb-raised);
      --xy-node-boxshadow-hover: 0 1px 4px 1px light-dark(#15181e1f, #0000007a);
      --xy-node-boxshadow-selected: 0 0 0 1.5px var(--wb-accent);
      --xy-edge-stroke: var(--wb-faint);
      --xy-edge-stroke-selected: var(--wb-accent);
      --xy-connectionline-stroke: var(--wb-faint);
      --xy-edge-label-color: var(--wb-ink);
      --xy-edge-label-background-color: var(--wb-surface);
      --xy-handle-background-color: var(--wb-muted);
      --xy-handle-border-color: var(--wb-surface);
      --xy-background-color: transparent;
      --xy-background-pattern-dots-color: var(--wb-line);
      --xy-background-pattern-lines-color: var(--wb-line);
      --xy-background-pattern-cross-color: var(--wb-line);
      --xy-selection-background-color: light-dark(#2b55e614, #5b7cff1f);
      --xy-selection-border: 1px dotted var(--wb-accent);
      --xy-attribution-background-color: transparent;
      --xy-controls-button-background-color: var(--wb-surface);
      --xy-controls-button-background-color-hover: var(--wb-raised);
      --xy-controls-button-color: var(--wb-ink);
      --xy-controls-button-color-hover: var(--wb-ink);
      --xy-controls-button-border-color: var(--wb-line);
      --xy-minimap-background-color: var(--wb-surface);
      --xy-minimap-node-background-color: var(--wb-raised);
      --xy-minimap-node-stroke-color: var(--wb-faint);
      --xy-minimap-mask-background-color: light-dark(#f6f7f9b3, #0c0f15b3);
    }
  `;
  document.head.append(themeStyles);

  // Node kinds follow C4 and differ by outline, never by colour: colour is
  // left to animation, blue for active and a lighter outline for dimmed.
  // Every value has a light and a dark form; the stage follows the theme.
  const nodeStyles = document.createElement("style");
  nodeStyles.textContent = `
    .wb-node {
      --wb-fill: light-dark(#ffffff, #0c0f15);
      --wb-line: light-dark(#9aa0ab, #5f6776);
      --wb-label: light-dark(#15181e, #eef0f4);
      --wb-tag: light-dark(#5d6472, #9199a8);
      position: absolute;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 0 10px;
      border: 1.5px solid var(--wb-line);
      border-radius: 10px;
      background: var(--wb-fill);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      text-align: center;
      transition: background 200ms, border-color 200ms, color 200ms;
    }
    .wb-node-label {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      line-height: 16px;
      font-weight: 600;
      color: var(--wb-label);
    }
    .wb-node-tag {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: "Geist Mono", ui-monospace, monospace;
      font-size: 10px;
      line-height: 12px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--wb-tag);
    }
    .wb-node::before,
    .wb-node::after {
      box-sizing: border-box;
      border: 1.5px solid var(--wb-line);
      background: var(--wb-fill);
      transition: background 200ms, border-color 200ms;
    }

    /* A head on the shoulders. */
    .wb-node[data-kind="person"] { padding-top: 10px; }
    .wb-node[data-kind="person"]::before {
      content: "";
      position: absolute;
      top: -13px;
      left: 50%;
      width: 26px;
      height: 26px;
      margin-left: -13px;
      border-radius: 50%;
    }

    .wb-node[data-kind="system"] {
      border-width: 2px;
      border-radius: 8px;
      --wb-line: light-dark(#15181e, #eef0f4);
    }

    /* Two tabs across the left edge. */
    .wb-node[data-kind="component"] { border-radius: 4px; }
    .wb-node[data-kind="component"]::before,
    .wb-node[data-kind="component"]::after {
      content: "";
      position: absolute;
      left: -9px;
      width: 16px;
      height: 8px;
      border-radius: 2px;
    }
    .wb-node[data-kind="component"]::before { top: calc(50% - 13px); }
    .wb-node[data-kind="component"]::after { top: calc(50% + 5px); }

    /* A cylinder: a lid over a body with a rounded bottom. */
    .wb-node[data-kind="database"] {
      padding-top: 9px;
      border-top: 0;
      border-radius: 0 0 50% 50% / 0 0 12px 12px;
    }
    .wb-node[data-kind="database"]::before {
      content: "";
      position: absolute;
      top: -9px;
      left: -1.5px;
      right: -1.5px;
      height: 18px;
      border-radius: 50%;
    }

    /* A pipe on its side: a rounded left end, an open cap on the right. */
    .wb-node[data-kind="queue"] {
      padding-right: 18px;
      border-right: 0;
      border-radius: 12px 0 0 12px / 50% 0 0 50%;
    }
    .wb-node[data-kind="queue"]::after {
      content: "";
      position: absolute;
      top: -1.5px;
      bottom: -1.5px;
      right: -9px;
      width: 18px;
      border-radius: 50%;
    }

    .wb-node[data-kind="external"] {
      --wb-fill: light-dark(#f3f4f6, #12161e);
      --wb-label: light-dark(#5d6472, #9199a8);
      --wb-tag: light-dark(#9aa0ab, #5f6776);
      border-style: dashed;
    }

    .wb-node[data-state="active"] {
      --wb-fill: light-dark(#eef2ff, #1a2240);
      --wb-line: light-dark(#2b55e6, #5b7cff);
      --wb-label: light-dark(#15181e, #eef0f4);
      --wb-tag: light-dark(#2b55e6, #8fa6ff);
    }
    .wb-node[data-state="dimmed"],
    .wb-node[data-in-dimmed]:not([data-state="active"]) {
      --wb-line: light-dark(#e6e8ec, #262c37);
      --wb-label: light-dark(#9aa0ab, #5f6776);
      --wb-tag: light-dark(#cdd1d8, #343a46);
    }

    /* Groups are fields behind their nodes: a fill, a hairline and a name.
     * Every hue has the same lightness, so no group shouts. */
    .wb-group {
      --wb-hue-fill: light-dark(#f6f7f9, #161a22);
      --wb-hue-line: light-dark(#d8dbe1, #2a303b);
      --wb-hue-ink: light-dark(#15181e, #eef0f4);
      --wb-group-fill: var(--wb-hue-fill);
      --wb-group-line: var(--wb-hue-line);
      --wb-group-ink: var(--wb-hue-ink);
      position: absolute;
      box-sizing: border-box;
      /* An inset ring, not a border: a group inside another is placed from
       * its corner, and a border would shift it, more so when active. */
      box-shadow: inset 0 0 0 var(--wb-group-ring, 1px) var(--wb-group-line);
      border-radius: 12px;
      background: var(--wb-group-fill);
      transition: background 200ms, box-shadow 200ms;
    }
    .wb-group[data-boundary] { border-radius: 16px; }
    .wb-group-head {
      position: absolute;
      top: 13px;
      left: 15px;
      right: 15px;
      display: flex;
      align-items: baseline;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;
    }
    .wb-group[data-boundary] > .wb-group-head { top: 15px; left: 17px; }
    .wb-group-label {
      font: 600 12px/16px Inter, ui-sans-serif, system-ui, sans-serif;
      color: var(--wb-group-ink);
      transition: color 200ms;
    }
    .wb-group[data-boundary] > .wb-group-head > .wb-group-label { font-size: 13px; }
    .wb-group-tag {
      font-family: "Geist Mono", ui-monospace, monospace;
      font-size: 10px;
      line-height: 12px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: light-dark(#5d6472, #9199a8);
    }

    .wb-group[data-color="sky"] { --wb-hue-fill: light-dark(#edf8ff, #11232d); --wb-hue-line: light-dark(#c1def0, #1e3f51); --wb-hue-ink: light-dark(#00638f, #89cef6); }
    .wb-group[data-color="teal"] { --wb-hue-fill: light-dark(#eaf9f8, #0d2524); --wb-hue-line: light-dark(#bbe3df, #144340); --wb-hue-ink: light-dark(#006d68, #7ad7d1); }
    .wb-group[data-color="green"] { --wb-hue-fill: light-dark(#ecfaee, #162519); --wb-hue-line: light-dark(#c3e3c8, #27422c); --wb-hue-ink: light-dark(#206b38, #9ad5a5); }
    .wb-group[data-color="amber"] { --wb-hue-fill: light-dark(#fef5e6, #281f0f); --wb-hue-line: light-dark(#ebd6b5, #48381a); --wb-hue-ink: light-dark(#7b5200, #e3be80); }
    .wb-group[data-color="coral"] { --wb-hue-fill: light-dark(#fff1eb, #2d1c15); --wb-hue-line: light-dark(#f7cfc1, #513126); --wb-hue-ink: light-dark(#8d4226, #f7b198); }
    .wb-group[data-color="rose"] { --wb-hue-fill: light-dark(#fff0f5, #2c1a20); --wb-hue-line: light-dark(#f6ccd8, #502f39); --wb-hue-ink: light-dark(#8b3d58, #f5acc2); }
    .wb-group[data-color="violet"] { --wb-hue-fill: light-dark(#f6f3ff, #211e2d); --wb-hue-line: light-dark(#dbd3f7, #3c3552); --wb-hue-ink: light-dark(#604c91, #c8b9f9); }

    /* One coloured level: inside a coloured group, groups are cards in its
     * hue; inside a neutral boundary, a neutral group is a white card. */
    .wb-group:not([data-color="neutral"]) > .wb-group,
    .wb-group[data-color="neutral"] > .wb-group[data-color="neutral"] {
      --wb-hue-fill: light-dark(#ffffff, #0c0f15);
      --wb-hue-line: inherit;
      --wb-hue-ink: inherit;
    }

    /* State is drawn in the one accent over the hue; dimming drains it. */
    .wb-group[data-state="active"] {
      --wb-group-line: light-dark(#2b55e6, #5b7cff);
      --wb-group-ink: light-dark(#2b55e6, #8ea5ff);
      --wb-group-ring: 1.5px;
    }
    .wb-group[data-state="dimmed"],
    .wb-group[data-state="dimmed"] .wb-group {
      --wb-group-fill: light-dark(#f6f7f9, #161a22);
      --wb-group-line: light-dark(#e6e8ec, #262c37);
      --wb-group-ink: light-dark(#9aa0ab, #5f6776);
    }

    .wb-token {
      position: absolute;
      left: 0;
      top: 0;
      z-index: 5;
      box-sizing: border-box;
      min-width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--wb-accent);
      pointer-events: none;
      transform: translate(-50%, -50%);
      transition: opacity 150ms;
    }
    .wb-token[data-label] {
      height: 20px;
      padding: 0 8px;
      font: 500 10px/20px "Geist Mono", ui-monospace, monospace;
      color: light-dark(#ffffff, #0c0f15);
      white-space: nowrap;
    }
    .wb-token[data-label]::after { content: attr(data-label); }
    .wb-token[data-tone="reply"] {
      background: var(--wb-surface);
      border: 1.5px solid var(--wb-accent);
      color: var(--wb-accent);
      line-height: 17px;
    }
    .wb-token[hidden] { display: block; opacity: 0; }

    @media (prefers-reduced-motion: reduce) {
      .wb-node, .wb-node::before, .wb-node::after, .wb-group, .wb-group-label { transition: none; }
      .wb-token { transition: none; }
    }
  `;
  document.head.append(nodeStyles);

  // What a kind says in its tag when the script gives none.
  const kindNames: Record<NodeKind, string> = {
    person: "Person",
    system: "Software system",
    container: "Container",
    component: "Component",
    database: "Database",
    queue: "Queue",
    external: "External system",
  };

  // Selection. The host turns selection mode on and off; while it is on the
  // pointer highlights the selectable thing under it, a click selects just
  // that, and a shift-click adds or removes it. Every change is reported to
  // the host as `wb:selection`. What is selected stays outlined after the
  // mode is turned off, since it is still in the model's context.
  const regions = new Set<SelectableRegion>();
  const selected = new Map<string, Candidate>();
  let selecting = false;
  let hovered: Candidate | null = null;

  // Thin things get a wider, invisible stand-in to point at: a wire's hit
  // path and its label both stand for the wire.
  const proxies = new WeakMap<Element, Element>();

  const resolve = (target: EventTarget | null) =>
    target instanceof Element ? (proxies.get(target) ?? target) : null;

  const SELECTOR =
    "[data-wb-select], .react-flow__node[data-id], .react-flow__edge[data-id]";

  const describe = (element: Element): Candidate => {
    const rect = () => element.getBoundingClientRect();
    const own = element.getAttribute("data-wb-select");
    const dataId = element.getAttribute("data-id") ?? "";

    if (own !== null)
      return {
        id: own,
        label:
          element.getAttribute("data-wb-label") ??
          element.textContent?.trim() ??
          own,
        kind: element.getAttribute("data-wb-kind") ?? "element",
        rect,
      };

    if (element.classList.contains("react-flow__edge")) {
      const named = element
        .getAttribute("aria-label")
        ?.match(/^Edge from (.+) to (.+)$/);

      return {
        id: `edge:${dataId}`,
        label: named ? `${named[1]} → ${named[2]}` : dataId,
        kind: "edge",
        rect,
      };
    }

    return {
      id: `node:${dataId}`,
      label: element.textContent?.trim() || dataId,
      kind: "node",
      rect,
    };
  };

  const candidateAt = (event: MouseEvent): Candidate | null => {
    const element = resolve(event.target)?.closest(SELECTOR) ?? null;

    if (element) return describe(element);

    // Regions registered last are drawn last, so they win.
    for (const region of [...regions].reverse()) {
      const box = region.rect();

      const inside = region.hit
        ? region.hit(event.clientX, event.clientY)
        : event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom;

      if (inside) return region;
    }

    return null;
  };

  const report = () =>
    parent.postMessage(
      {
        type: "wb:selection",
        items: [...selected.values()].map(({ id, label, kind }) => ({
          id,
          label,
          kind,
        })),
      },
      "*",
    );

  const selectionStyles = document.createElement("style");
  selectionStyles.textContent = `
    .wb-selection { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
    .wb-outline {
      position: absolute;
      box-sizing: border-box;
      border-radius: 8px;
      border: 1.5px dashed light-dark(#2b55e6, #5b7cff);
    }
    .wb-outline[data-selected] {
      border: 2px solid light-dark(#2b55e6, #5b7cff);
      background: light-dark(#2b55e60f, #5b7cff1a);
    }
    .wb-outline-label {
      position: absolute;
      left: -2px;
      bottom: calc(100% + 4px);
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 2px 6px;
      border-radius: 4px;
      font: 600 11px/14px Inter, ui-sans-serif, system-ui, sans-serif;
      color: #fff;
      background: light-dark(#2b55e6, #5b7cff);
    }
    html[data-wb-selecting], html[data-wb-selecting] * { cursor: pointer !important; user-select: none !important; }
  `;
  document.head.append(selectionStyles);

  const layer = document.createElement("div");
  layer.className = "wb-selection";

  // Outlines follow their targets every frame, since animations move them.
  const outlines = new Map<string, HTMLDivElement>();

  const outline = (key: string, item: Candidate, isSelected: boolean) => {
    let box = outlines.get(key);

    if (!box) {
      box = document.createElement("div");
      box.className = "wb-outline";
      outlines.set(key, box);
      layer.append(box);
    }

    // Thin targets, like a straight edge, still get a box you can see.
    const rect = item.rect();
    const MIN = 16;
    const width = Math.max(rect.width + 8, MIN);
    const height = Math.max(rect.height + 8, MIN);
    Object.assign(box.style, {
      left: `${rect.left + rect.width / 2 - width / 2}px`,
      top: `${rect.top + rect.height / 2 - height / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    box.toggleAttribute("data-selected", isSelected);

    let tag = box.querySelector<HTMLSpanElement>(".wb-outline-label");

    if (isSelected && !tag) {
      tag = document.createElement("span");
      tag.className = "wb-outline-label";
      box.append(tag);
    }

    if (tag) {
      tag.hidden = !isSelected;
      tag.textContent = item.label;
    }
  };

  const draw = () => {
    const keep = new Set<string>();

    for (const [id, item] of selected) {
      outline(`selected:${id}`, item, true);
      keep.add(`selected:${id}`);
    }

    if (selecting && hovered && !selected.has(hovered.id)) {
      outline("hover", hovered, false);
      keep.add("hover");
    }

    for (const [key, box] of outlines)
      if (!keep.has(key)) {
        box.remove();
        outlines.delete(key);
      }

    if (selecting || selected.size) drawFrame = requestAnimationFrame(draw);
  };

  // One outline loop at a time, however often the selection changes.
  let drawFrame = 0;

  const redraw = () => {
    if (!layer.isConnected) document.body.append(layer);
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(draw);
  };

  const setSelecting = (on: boolean) => {
    selecting = on;
    hovered = null;
    document.documentElement.toggleAttribute("data-wb-selecting", on);
    redraw();
  };

  // While selecting, the pointer belongs to selection: nothing underneath
  // drags, pans or clicks. Only propagation stops, so a click still focuses
  // the stage and Escape reaches it.
  const swallow = (event: Event) => {
    if (selecting) event.stopPropagation();
  };

  for (const type of [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "dblclick",
  ])
    addEventListener(type, swallow, true);

  addEventListener(
    "pointermove",
    (event) => {
      if (!selecting) return;
      hovered = candidateAt(event);
    },
    true,
  );

  addEventListener(
    "pointerleave",
    () => {
      hovered = null;
    },
    true,
  );

  addEventListener(
    "click",
    (event) => {
      if (!selecting) return;
      event.preventDefault();
      event.stopPropagation();
      const item = candidateAt(event);

      if (event.shiftKey) {
        if (item && selected.has(item.id)) selected.delete(item.id);
        else if (item) selected.set(item.id, item);
      } else {
        selected.clear();

        if (item) selected.set(item.id, item);
      }

      report();
      redraw();
    },
    true,
  );

  const clear = () => {
    if (!selected.size) return;
    selected.clear();
    report();
    redraw();
  };

  // Escape steps out: first it clears the selection, then, with nothing
  // selected, it asks the host to leave selection mode.
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (selected.size) clear();
    else if (selecting) parent.postMessage({ type: "wb:select-exit" }, "*");
  });

  // Verify mode. The host checks every code name against the repository
  // and sends each one's state; the stage badges every claim with its
  // worst: checked, changed, or unlinked when nothing backs it. Clicking a
  // badge, or a linked claim at any time, asks the host to show its code.
  let verifying = false;
  let codeStatus: Record<string, "checked" | "changed"> = {};
  let focus = new Set<string>();

  const verifyStyles = document.createElement("style");
  verifyStyles.textContent = `
    .wb-verify { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
    .wb-badge {
      position: absolute;
      box-sizing: border-box;
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      margin: -9px 0 0 -9px;
      padding: 0;
      border-radius: 50%;
      border: 1.5px solid transparent;
      font: 700 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      pointer-events: auto;
    }
    .wb-badge[data-state="checked"] {
      background: light-dark(#ecfaee, #162519);
      border-color: light-dark(#206b38, #9ad5a5);
      color: light-dark(#206b38, #9ad5a5);
    }
    .wb-badge[data-state="changed"] {
      background: light-dark(#fef5e6, #281f0f);
      border-color: light-dark(#7b5200, #e3be80);
      color: light-dark(#7b5200, #e3be80);
    }
    .wb-badge[data-state="unlinked"] {
      background: var(--wb-surface);
      border: 1.5px dashed var(--wb-faint);
      color: var(--wb-muted);
    }
    .wb-badge[data-focus] { box-shadow: 0 0 0 3px light-dark(#2b55e640, #5b7cff59); }
    .wb-badge:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: 2px; }
    [data-wb-linked] { cursor: pointer; }
    html[data-wb-selecting] .wb-verify { display: none; }
  `;
  document.head.append(verifyStyles);

  const verifyLayer = document.createElement("div");
  verifyLayer.className = "wb-verify";
  const badges = new Map<Element, HTMLButtonElement>();

  // Names are stored as JSON, so a name may hold spaces.
  const namesOf = (element: Element): string[] => {
    try {
      const names: unknown = JSON.parse(
        element.getAttribute("data-wb-claim") ?? "[]",
      );

      return Array.isArray(names) ? names.map(String) : [];
    } catch {
      return [];
    }
  };

  const labelOf = (element: Element) =>
    (
      element.getAttribute("data-wb-claim-label") ??
      element.getAttribute("data-wb-label") ??
      element.textContent?.trim() ??
      "Claim"
    ).slice(0, 200);

  const stateOf = (names: string[]) =>
    !names.length
      ? "unlinked"
      : names.every((name) => codeStatus[name] === "checked")
        ? "checked"
        : "changed";

  const reveal = (element: Element) =>
    parent.postMessage(
      { type: "wb:reveal", names: namesOf(element), label: labelOf(element) },
      "*",
    );

  // A badge sits on a box's top-right corner, or on the middle of a line.
  const anchorPoint = (element: Element) => {
    if (element instanceof SVGGeometryElement) {
      const length = element.getTotalLength();
      const point = element.getPointAtLength(length / 2);
      const matrix = element.getScreenCTM();

      return matrix ? point.matrixTransform(matrix) : point;
    }

    const box = element.getBoundingClientRect();

    return { x: box.right - 4, y: box.top + 4 };
  };

  const drawBadges = () => {
    const claims = [...document.querySelectorAll("[data-wb-claim]")];

    for (const [element, badge] of badges)
      if (!verifying || !claims.includes(element)) {
        badge.remove();
        badges.delete(element);
      }

    if (!verifying) return;

    for (const element of claims) {
      let badge = badges.get(element);

      if (!badge) {
        badge = document.createElement("button");
        badge.type = "button";
        badge.className = "wb-badge";
        badge.addEventListener("click", () => reveal(element));
        badges.set(element, badge);
        verifyLayer.append(badge);
      }

      const names = namesOf(element);
      const state = stateOf(names);
      const point = anchorPoint(element);
      badge.dataset.state = state;
      badge.textContent = { checked: "✓", changed: "!", unlinked: "?" }[state];
      badge.toggleAttribute(
        "data-focus",
        names.some((name) => focus.has(name)),
      );
      badge.setAttribute(
        "aria-label",
        `${labelOf(element)}: ${{ checked: "matches the code", changed: "changed since it was linked", unlinked: "not linked to code" }[state]}`,
      );
      badge.title = badge.getAttribute("aria-label") ?? "";
      badge.style.left = `${point.x}px`;
      badge.style.top = `${point.y}px`;
    }

    // Badges follow their claims, which animations move.
    badgeFrame = requestAnimationFrame(drawBadges);
  };

  // One badge loop at a time, however often verify toggles.
  let badgeFrame = 0;

  const setVerifying = (on: boolean) => {
    verifying = on;

    if (!verifyLayer.isConnected) document.body.append(verifyLayer);

    cancelAnimationFrame(badgeFrame);
    badgeFrame = requestAnimationFrame(drawBadges);
  };

  // Clicking a linked claim shows its code, whether or not badges show.
  addEventListener("click", (event) => {
    const target = resolve(event.target);

    if (selecting || !target) return;
    const claim = target.closest("[data-wb-claim]");

    if (claim && namesOf(claim).length) reveal(claim);
  });

  // The host counts the claims for its summary, and hears again whenever
  // the script marks more, once per task.
  let claimsQueued = false;

  const queueClaims = () => {
    if (claimsQueued) return;
    claimsQueued = true;
    setTimeout(() => {
      claimsQueued = false;
      reportClaims();
    });
  };

  const reportClaims = () =>
    parent.postMessage(
      {
        type: "wb:claims",
        claims: [...document.querySelectorAll("[data-wb-claim]")].map(
          (element) => ({ label: labelOf(element), names: namesOf(element) }),
        ),
      },
      "*",
    );

  // Groups. Each one remembers its box in stage px and the nodes it holds
  // directly; groups it holds become its children in the DOM, so they paint
  // above it and take its hue.
  const AUTO_COLORS: GroupColor[] = [
    "sky",
    "amber",
    "green",
    "violet",
    "coral",
    "teal",
    "rose",
  ];

  let nextAuto = 0;
  const groupBoxes = new WeakMap<Element, DOMRect>();
  const groupNodes = new WeakMap<Element, HTMLElement[]>();

  // How far a kind's shape reaches past its box: a head, a lid, a cap, tabs.
  const reach = (element: Element) => {
    const kind = element.getAttribute("data-kind");

    return {
      top: kind === "person" ? 13 : kind === "database" ? 9 : 0,
      right: kind === "queue" ? 9 : 0,
      left: kind === "component" ? 9 : 0,
    };
  };

  // Stage coordinates start at the body's corner, inside the stage's inset;
  // screen positions convert through here.
  const origin = () => {
    const body = document.body.getBoundingClientRect();

    return { x: body.left, y: body.top };
  };

  const stageRect = (rect: DOMRect) => {
    const at = origin();

    return new DOMRect(
      rect.left - at.x,
      rect.top - at.y,
      rect.width,
      rect.height,
    );
  };

  const stageBox = (element: Element) => {
    const known = groupBoxes.get(element);

    if (known) return known;
    const rect = element.getBoundingClientRect();
    const extra = reach(element);

    return new DOMRect(
      rect.left - origin().x - extra.left,
      rect.top - origin().y - extra.top,
      rect.width + extra.left + extra.right,
      rect.height + extra.top,
    );
  };

  // A dimmed group dims the nodes it holds, and the ones its groups hold,
  // unless a node is lit itself.
  const syncDimmed = (group: Element) => {
    const dimmed = group.closest('.wb-group[data-state="dimmed"]') !== null;

    for (const node of groupNodes.get(group) ?? [])
      node.toggleAttribute("data-in-dimmed", dimmed);

    for (const child of group.querySelectorAll(":scope > .wb-group"))
      syncDimmed(child);
  };

  // Edges. One SVG under the nodes holds every edge's path; a label rides
  // the middle of its line. Each edge routes itself from its nodes' boxes
  // when drawn, and again when `wb.layout()` moves them.
  const edgeStyles = document.createElement("style");
  edgeStyles.textContent = `
    .wb-edges { position: absolute; left: 0; top: 0; z-index: 1; overflow: visible; pointer-events: none; }
    .wb-node { z-index: 2; }
    .wb-edge { fill: none; stroke: var(--wb-faint); stroke-width: 1.5; transition: stroke 200ms, opacity 200ms; }
    .wb-edge[data-dashed] { stroke-dasharray: 4 4; }
    .wb-edge[data-state="active"] { stroke: var(--wb-accent); }
    .wb-edge[data-state="dimmed"] { opacity: 0.35; }
    .wb-edges marker path { fill: context-stroke; stroke: none; }
    .wb-edge-hit { fill: none; stroke: transparent; stroke-width: 12; pointer-events: stroke; }
    .wb-edge-hit[data-wb-linked] { cursor: pointer; }
    .wb-edge-label {
      position: absolute;
      z-index: 2;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--wb-surface);
      font: 500 11px/14px Inter, ui-sans-serif, system-ui, sans-serif;
      color: var(--wb-muted);
      white-space: nowrap;
      transform: translate(-50%, -50%);
      transition: opacity 200ms;
    }
    .wb-edge-label[data-state="dimmed"] { opacity: 0.35; }
    @media (prefers-reduced-motion: reduce) { .wb-edge, .wb-edge-label { transition: none; } }
    /* Plot's tips and legends read these; tips sit on the stage surface. */
    .wb-chart { position: absolute; --plot-background: var(--wb-surface); }
    .wb-chart svg { display: block; }
    .wb-chart figure { margin: 0; }
  `;
  document.head.append(edgeStyles);

  const SVG = "http://www.w3.org/2000/svg";
  const edgeLayer = document.createElementNS(SVG, "svg");
  edgeLayer.classList.add("wb-edges");
  edgeLayer.setAttribute("width", "1");
  edgeLayer.setAttribute("height", "1");
  edgeLayer.innerHTML =
    '<defs><marker id="wb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z"/></marker></defs>';

  type Edge = {
    from: HTMLElement;
    to: HTMLElement;
    path: SVGPathElement;
    label: HTMLElement | null;
  };

  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  const nodesById = new Map<string, HTMLElement>();
  const allNodes: HTMLElement[] = [];
  const allGroups: HTMLElement[] = [];

  const placeLabel = (edge: Edge) => {
    if (!edge.label) return;
    const length = edge.path.getTotalLength();
    const point = edge.path.getPointAtLength(length / 2);
    edge.label.style.left = `${point.x}px`;
    edge.label.style.top = `${point.y}px`;
  };

  // One elbow, out of the side that faces the other node and into the
  // opposite side; the arrowhead stops just short of the box.
  const route = (edge: Edge) => {
    const a = stageBox(edge.from);
    const b = stageBox(edge.to);
    const midY = (box: DOMRect) => box.top + box.height / 2;
    const midX = (box: DOMRect) => box.left + box.width / 2;
    let d: string;

    if (b.left > a.right || b.right < a.left) {
      const forward = b.left > a.right;
      const x1 = forward ? a.right : a.left;
      const x2 = forward ? b.left - 2 : b.right + 2;
      const [y1, y2] = [midY(a), midY(b)];
      const mid = Math.round((x1 + x2) / 2);
      d =
        y1 === y2
          ? `M${x1} ${y1} H${x2}`
          : `M${x1} ${y1} H${mid} V${y2} H${x2}`;
    } else {
      const down = b.top > a.bottom;
      const y1 = down ? a.bottom : a.top;
      const y2 = down ? b.top - 2 : b.bottom + 2;
      const [x1, x2] = [midX(a), midX(b)];
      const mid = Math.round((y1 + y2) / 2);
      d =
        x1 === x2
          ? `M${x1} ${y1} V${y2}`
          : `M${x1} ${y1} V${mid} H${x2} V${y2}`;
    }

    edge.path.setAttribute("d", d);
    placeLabel(edge);
  };

  // Moves a group to `box` in stage px; a group inside another sits
  // relative to it.
  const placeGroup = (element: HTMLElement, box: DOMRect) => {
    groupBoxes.set(element, box);

    const parentBox = element.parentElement?.classList.contains("wb-group")
      ? groupBoxes.get(element.parentElement)
      : undefined;

    Object.assign(element.style, {
      left: `${box.left - (parentBox?.left ?? 0)}px`,
      top: `${box.top - (parentBox?.top ?? 0)}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  };

  const GROUP_PAD = 20;

  // A group's own padding, when its options gave one.
  const groupPads = new WeakMap<Element, number>();
  const padOf = (group: Element) => groupPads.get(group) ?? GROUP_PAD;

  const LABEL_MARGIN = 4;

  const groupHead = (element: Element) =>
    element.hasAttribute("data-boundary") ? 34 : 28;

  // Overlaps. Everything that must stay clear: nodes with what their shape
  // reaches past the box, edge labels and group heads; edges must not run
  // through a node they do not join, and a node must not poke into a group
  // that does not hold it. Tokens and badges come and go, so they are free.
  let layoutPending = false;

  const nameOf = (element: Element) =>
    element.querySelector(".wb-node-label, .wb-group-label")?.textContent ??
    element.textContent ??
    "";

  // Touching counts: things need a little air between them to read apart.
  const GAP = 2;

  const hits = (a: DOMRect, b: DOMRect) =>
    a.left < b.right + GAP &&
    b.left < a.right + GAP &&
    a.top < b.bottom + GAP &&
    b.top < a.bottom + GAP;

  const holds = (group: Element, node: HTMLElement): boolean =>
    (groupNodes.get(group) ?? []).includes(node) ||
    [...group.querySelectorAll(":scope > .wb-group")].some((child) =>
      holds(child, node),
    );

  // Something hidden or taken off the stage has no box to collide with.
  const shown = (element: Element, box: DOMRect) =>
    element.isConnected && box.width > 0 && box.height > 0;

  // A group's name is its label and tag, not the strip they sit in.
  const nameBox = (group: Element) => {
    const parts = [
      ...(group.querySelector(":scope > .wb-group-head")?.children ?? []),
    ].map((part) => part.getBoundingClientRect());

    if (!parts.length) return null;
    const left = Math.min(...parts.map((part) => part.left));
    const top = Math.min(...parts.map((part) => part.top));
    const right = Math.max(...parts.map((part) => part.right));
    const bottom = Math.max(...parts.map((part) => part.bottom));

    return stageRect(new DOMRect(left, top, right - left, bottom - top));
  };

  // Whether a line through `box` crosses it, sampling every `step` px.
  const crosses = (path: SVGPathElement, box: DOMRect, step: number) => {
    const length = path.getTotalLength();

    for (let at = 0; at <= length; at += step) {
      const point = path.getPointAtLength(at);

      if (
        point.x > box.left + 1 &&
        point.x < box.right - 1 &&
        point.y > box.top + 1 &&
        point.y < box.bottom - 1
      )
        return true;
    }

    return false;
  };

  const findOverlaps = () => {
    // Each finding names the edges whose labels it involves, so layout can
    // give those labels more room.
    const found: { text: string; labels: Edge[] }[] = [];

    const nodeBoxes = allNodes.flatMap((node) => {
      const box = stageBox(node);

      return shown(node, box) ? [{ node, box }] : [];
    });

    const groupNames = allGroups.flatMap((group) => {
      const box = nameBox(group);

      return box && shown(group, box) ? [{ group, box }] : [];
    });

    const charts = [...document.querySelectorAll(".wb-chart")].flatMap(
      (chart, index) => {
        const box = stageRect(chart.getBoundingClientRect());

        return shown(chart, box)
          ? [{ owner: null, name: `chart ${index + 1}`, box }]
          : [];
      },
    );

    const clear: { name: string; box: DOMRect; owner: Edge | null }[] = [
      ...nodeBoxes.map(({ node, box }) => ({
        name: nameOf(node),
        box,
        owner: null,
      })),
      ...edges.flatMap((edge) => {
        if (!edge.label) return [];
        const box = stageRect(edge.label.getBoundingClientRect());

        return shown(edge.label, box)
          ? [{ owner: edge, name: `label “${edge.label.textContent}”`, box }]
          : [];
      }),
      ...groupNames.map(({ group, box }) => ({
        owner: null,
        name: `${nameOf(group)}'s name`,
        box,
      })),
      ...charts,
    ];

    for (const [index, a] of clear.entries())
      for (const b of clear.slice(index + 1))
        if (hits(a.box, b.box))
          found.push({
            text: `${a.name} overlaps ${b.name}`,
            labels: [a.owner, b.owner].flatMap((owner) =>
              owner ? [owner] : [],
            ),
          });

    // An edge must not run under another edge's label.
    for (const edge of edges)
      for (const other of edges) {
        if (other === edge || !other.label) continue;
        const rect = stageRect(other.label.getBoundingClientRect());

        if (shown(other.label, rect) && crosses(edge.path, rect, 3))
          found.push({
            text: `the edge ${nameOf(edge.from)} → ${nameOf(edge.to)} runs under label “${other.label.textContent}”`,
            labels: [other],
          });
      }

    for (const edge of edges) {
      const line = `the edge ${nameOf(edge.from)} → ${nameOf(edge.to)}`;

      for (const { node, box } of nodeBoxes)
        if (
          node !== edge.from &&
          node !== edge.to &&
          crosses(edge.path, box, 4)
        )
          found.push({
            text: `${line} runs through ${nameOf(node)}`,
            labels: [],
          });

      // Wires cross group borders freely, but not a group's name.
      for (const { group, box } of groupNames)
        if (crosses(edge.path, box, 3))
          found.push({
            text: `${line} runs through ${nameOf(group)}'s name`,
            labels: [],
          });
    }

    const groupBoxList = allGroups.flatMap((group) => {
      const box = stageBox(group);

      return shown(group, box) ? [{ group, box }] : [];
    });

    for (const [index, { group, box }] of groupBoxList.entries()) {
      for (const { node, box: nodeBox } of nodeBoxes)
        if (!holds(group, node) && hits(box, nodeBox))
          found.push({
            text: `${nameOf(node)} pokes into the group ${nameOf(group)}`,
            labels: [],
          });

      // Groups nest or stand apart; they never half overlap.
      for (const { group: other, box: otherBox } of groupBoxList.slice(
        index + 1,
      ))
        if (
          !group.contains(other) &&
          !other.contains(group) &&
          hits(box, otherBox)
        )
          found.push({
            text: `the groups ${nameOf(group)} and ${nameOf(other)} overlap`,
            labels: [],
          });
    }

    return found;
  };

  const warnOverlaps = () => {
    const found = findOverlaps().map((item) => item.text);

    if (found.length)
      console.warn(
        `wb: ${found.length} overlap(s) on the stage:\n- ${found.join("\n- ")}`,
      );
  };

  // A drawing placed by hand is checked a moment after it loads, so a
  // script that awaits something before calling `wb.layout()` is not
  // checked half drawn; one that lays itself out is checked when the
  // layout lands.
  let laidOut = false;

  addEventListener("load", () =>
    setTimeout(() => {
      if (!laidOut && !layoutPending && allNodes.length) warnOverlaps();
    }, 1000),
  );

  // Chart transitions. A step redraws its chart whole; then each mark
  // eases from where the last drawing had it: bars and dots move and
  // resize, lines reshape, colours blend. A mark only one side has fades
  // in or out, as does text whose words changed and a line whose points
  // changed in number.
  const CHART_TWEEN_MS = 450;

  // Leaves are drawn; groups only hold them and carry shared attributes.
  const LEAVES = new Set([
    "rect",
    "circle",
    "ellipse",
    "line",
    "path",
    "polygon",
    "polyline",
    "text",
    "image",
  ]);

  const TWEENED = [
    "x",
    "y",
    "width",
    "height",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "transform",
    "fill",
    "stroke",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "stroke-width",
  ];

  const PAINTS = new Set(["fill", "stroke"]);

  const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

  // A colour as [r, g, b, a] from 0 to 255, or null for what is not one
  // (none, currentColor, a gradient).
  const colorProbe = document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });

  const rgba = (value: string) => {
    if (!colorProbe) return null;
    const sentinel = "#010203";
    colorProbe.fillStyle = sentinel;
    colorProbe.fillStyle = value;

    if (colorProbe.fillStyle === sentinel && value !== sentinel) return null;
    colorProbe.clearRect(0, 0, 1, 1);
    colorProbe.fillRect(0, 0, 1, 1);

    return [...colorProbe.getImageData(0, 0, 1, 1).data];
  };

  type Tween = (progress: number) => void;

  const mix = (from: number, to: number, progress: number) =>
    from + (to - from) * progress;

  // How one attribute eases, or null when it cannot: a colour blends, and
  // anything else whose numbers sit in the same text eases number by
  // number, as a path with the same commands does.
  const attributeTween = (
    element: Element,
    name: string,
    from: string,
    to: string,
  ): Tween | null => {
    if (PAINTS.has(name)) {
      const start = rgba(from);
      const end = rgba(to);

      if (!start || !end) return null;

      return (progress) => {
        if (progress >= 1) return element.setAttribute(name, to);

        const [r, g, b, a] = start.map((value, index) =>
          mix(value, end[index] ?? value, progress),
        );

        element.setAttribute(
          name,
          `rgba(${Math.round(r ?? 0)}, ${Math.round(g ?? 0)}, ${Math.round(b ?? 0)}, ${((a ?? 255) / 255).toFixed(3)})`,
        );
      };
    }

    const starts = (from.match(NUMBER) ?? []).map(Number);
    const ends = (to.match(NUMBER) ?? []).map(Number);

    if (
      !ends.length ||
      starts.length !== ends.length ||
      from.replace(NUMBER, "#") !== to.replace(NUMBER, "#")
    )
      return null;

    const texts = to.split(NUMBER);

    return (progress) =>
      progress >= 1
        ? element.setAttribute(name, to)
        : element.setAttribute(
            name,
            texts
              .map((text, index) => {
                const end = ends[index];

                return end === undefined
                  ? text
                  : `${text}${Math.round(mix(starts[index] ?? end, end, progress) * 100) / 100}`;
              })
              .join(""),
          );
  };

  // Every element under `root` by its place: its tag, its label (Plot
  // names each mark's group), and its turn among siblings like it.
  const placed = (root: Element) => {
    const found = new Map<string, Element>();

    const walk = (parent: Element, path: string) => {
      const seen = new Map<string, number>();

      for (const child of parent.children) {
        const name = `${child.tagName}[${child.getAttribute("aria-label") ?? ""}]`;
        const turn = seen.get(name) ?? 0;
        seen.set(name, turn + 1);
        const key = `${path}/${name}#${turn}`;
        found.set(key, child);
        walk(child, key);
      }
    };

    walk(root, "");

    return found;
  };

  const styled = (element: Element) =>
    element instanceof HTMLElement || element instanceof SVGElement
      ? element
      : null;

  /** Eases `next`, just drawn in `host`, from `previous`, the drawing it
   * replaced. Returns a function that ends it at once. */
  const tweenChart = (previous: Element, next: Element, host: Element) => {
    const before = placed(previous);
    const tweens: Tween[] = [];
    const appearing: Element[] = [];

    for (const [key, element] of placed(next)) {
      const old = before.get(key);
      const leaf = LEAVES.has(element.tagName);

      if (!old || (leaf && old.textContent !== element.textContent)) {
        if (leaf) appearing.push(element);
        continue;
      }

      let smooth = true;

      for (const name of TWEENED) {
        const from = old.getAttribute(name);
        const to = element.getAttribute(name);

        if (from === null || to === null || from === to) continue;
        const tween = attributeTween(element, name, from, to);

        if (tween) tweens.push(tween);
        else smooth = false;
      }

      // A leaf that eases stands in for its old self; one that cannot
      // crossfades with it.
      if (!leaf) continue;

      if (smooth) {
        const hidden = styled(old);

        if (hidden) hidden.style.visibility = "hidden";
      } else appearing.push(element);
    }

    // The old drawing lies over the new one, holding what fades out.
    const overlay = styled(previous);

    if (overlay)
      Object.assign(overlay.style, {
        position: "absolute",
        left: "0",
        top: "0",
        pointerEvents: "none",
      });

    host.append(previous);

    const fade = (progress: number) => {
      for (const element of appearing) {
        const shown = styled(element);

        if (shown) shown.style.opacity = String(progress);
      }

      if (overlay) overlay.style.opacity = String(1 - progress);
    };

    let frame = 0;

    const finish = () => {
      cancelAnimationFrame(frame);

      for (const tween of tweens) tween(1);
      fade(1);

      for (const element of appearing)
        styled(element)?.style.removeProperty("opacity");
      previous.remove();
    };

    const began = performance.now();

    const step = (now: number) => {
      const time = Math.min(1, (now - began) / CHART_TWEEN_MS);
      const progress = 1 - (1 - time) ** 3;

      for (const tween of tweens) tween(progress);
      fade(progress);

      if (time < 1) frame = requestAnimationFrame(step);
      else finish();
    };

    for (const tween of tweens) tween(0);
    fade(0);
    frame = requestAnimationFrame(step);

    return finish;
  };

  const wb = {
    /** The scenario the reader chose, or null when the block has none. */
    scenario: initial.scenario,
    /** The frame on screen, or null when the block has none. */
    frame: initial.frame,
    /** The frame's position from 0, or -1 without frames. */
    frameIndex: initial.frameIndex,
    /** Where the timeline is, in milliseconds; 0 without one. */
    time: 0,
    /** The timeline's length in milliseconds; 0 without one. */
    duration,
    /** The timeline's chapters in order; empty without one. */
    chapters,
    /** Calls `listener` with the timeline's current time now, and again
     * whenever it moves: every animation frame while it plays, and on every
     * scrub. Draw that exact moment (for example `timeline.seek(time)` on a
     * paused anime.js timeline), since time can jump either way. Returns a
     * function that stops it. */
    onTime(listener: (time: number, moment: Moment) => void) {
      timeListeners.add(listener);
      listener(wb.time, momentAt(wb.time));

      return () => {
        timeListeners.delete(listener);
      };
    },
    /** "light" or "dark", following the reader's theme. */
    get theme() {
      return themeOf();
    },
    /** The palette as plain hex for the current theme, for libraries that
     * cannot read CSS variables (a three.js material, a canvas). In CSS use
     * `var(--wb-ink)` and the like, which switch by themselves. */
    colors() {
      return colorsOf(themeOf());
    },
    /** Calls `listener` with the theme and its colours now and again
     * whenever the reader switches. Returns a function that stops it. */
    onTheme(listener: (theme: "light" | "dark", colors: Colors) => void) {
      themeListeners.add(listener);
      listener(themeOf(), colorsOf(themeOf()));

      return () => {
        themeListeners.delete(listener);
      };
    },
    /** Calls `listener` with the current scenario now and again whenever
     * the reader picks another. Returns a function that stops it. */
    onScenario(listener: (scenario: Scenario | null) => void) {
      scenarioListeners.add(listener);
      listener(wb.scenario);

      return () => {
        scenarioListeners.delete(listener);
      };
    },
    /** Calls `listener` with the current frame now (with no previous one),
     * and again on every step, with the frame it came from so the script
     * can animate the transition. Returns a function that stops it. */
    onFrame(listener: (frame: Frame | null, change: FrameChange) => void) {
      frameListeners.add(listener);
      listener(wb.frame, {
        index: wb.frameIndex,
        previous: null,
        previousIndex: -1,
      });

      return () => {
        frameListeners.delete(listener);
      };
    },
    /** Draws a node of one of the C4 kinds at stage position (x, y) and
     * returns its element. Change its state later with
     * `node.dataset.state = "active" | "dimmed" | "default"`; outline, fill
     * and text follow with a short transition. */
    node(options: NodeOptions) {
      const element = document.createElement("div");
      element.className = "wb-node";
      element.dataset.kind = options.kind;
      element.dataset.state = options.state ?? "default";
      element.style.left = `${options.x ?? 0}px`;
      element.style.top = `${options.y ?? 0}px`;
      element.style.width = `${options.width ?? 160}px`;
      element.style.height = `${options.height ?? 72}px`;

      const label = document.createElement("span");
      label.className = "wb-node-label";
      label.textContent = options.label;

      const tag = document.createElement("span");
      tag.className = "wb-node-tag";
      tag.textContent = options.tag ?? kindNames[options.kind];

      element.append(label, tag);

      // Edges and selection find a node by its id; a second node with the
      // same one gets a suffix, and a warning, instead of hiding the first.
      let key = options.id ?? options.label;

      if (nodesById.has(key)) {
        let count = 2;

        while (nodesById.has(`${key}#${count}`)) count++;
        console.warn(
          `wb.node: "${key}" is already a node; give each node its own id. This one is "${key}#${count}".`,
        );
        key = `${key}#${count}`;
      }

      wb.selectable(element, {
        id: key,
        label: options.label,
        kind: options.kind,
      });

      if (options.code || !["person", "external"].includes(options.kind))
        wb.code(element, options.code ?? [], options.label);

      allNodes.push(element);
      nodesById.set(key, element);

      (options.parent ?? document.body).append(element);

      return element;
    },
    /**
     * Draws a group behind the nodes and groups in `around`, sized to hold
     * them, and returns its element. Create inner groups first: a group
     * around groups becomes their boundary. Set its state later like a
     * node's, with `group.dataset.state`; a dimmed group dims what it holds.
     * Change its hue with `group.dataset.color`.
     */
    group(options: GroupOptions) {
      const around = options.around ?? [];

      const inner = around.filter((item) =>
        item.classList.contains("wb-group"),
      );

      const nodes = around.filter((item) => !inner.includes(item));

      let box = new DOMRect(
        options.x ?? 0,
        options.y ?? 0,
        options.width ?? 320,
        options.height ?? 160,
      );

      if (around.length) {
        const boxes = around.map(stageBox);
        const pad = options.padding ?? 20;
        const head = inner.length ? 34 : 28;
        const left = Math.min(...boxes.map((item) => item.left)) - pad;
        const top = Math.min(...boxes.map((item) => item.top)) - pad - head;
        const right = Math.max(...boxes.map((item) => item.right)) + pad;
        const bottom = Math.max(...boxes.map((item) => item.bottom)) + pad;
        box = new DOMRect(left, top, right - left, bottom - top);
      }

      const color =
        options.color === "auto" || (!options.color && !inner.length)
          ? AUTO_COLORS[nextAuto++ % AUTO_COLORS.length]
          : (options.color ?? "neutral");

      const element = document.createElement("div");
      element.className = "wb-group";
      element.dataset.color = color;
      element.dataset.state = options.state ?? "default";
      element.toggleAttribute("data-boundary", inner.length > 0);
      Object.assign(element.style, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });

      const head = document.createElement("div");
      head.className = "wb-group-head";
      const label = document.createElement("span");
      label.className = "wb-group-label";
      label.textContent = options.label;
      head.append(label);

      if (options.tag) {
        const tag = document.createElement("span");
        tag.className = "wb-group-tag";
        tag.textContent = options.tag;
        head.append(tag);
      }

      element.append(head);

      // Inner groups move inside, placed relative to this one.
      for (const child of inner) {
        const childBox = stageBox(child);
        child.style.left = `${childBox.left - box.left}px`;
        child.style.top = `${childBox.top - box.top}px`;
        element.append(child);
      }

      groupBoxes.set(element, box);
      groupNodes.set(element, nodes);

      if (options.padding !== undefined)
        groupPads.set(element, options.padding);
      allGroups.push(element);
      // Behind everything drawn so far: wires, nodes and other groups.
      document.body.prepend(element);
      new MutationObserver(() => syncDimmed(element)).observe(element, {
        attributes: true,
        attributeFilter: ["data-state"],
      });
      syncDimmed(element);
      wb.selectable(element, {
        id: options.id ?? options.label,
        label: options.label,
        kind: "group",
      });

      return element;
    },
    /**
     * Draws an arrow from one node to another and returns its path, which
     * `travel()` can move a token along. It leaves the side facing the
     * other node with one elbow, and reroutes when `wb.layout()` moves the
     * nodes. Change its state with `edge.dataset.state`, as for a node.
     */
    edge(options: EdgeOptions) {
      const find = (end: HTMLElement | string) => {
        const element = end instanceof HTMLElement ? end : nodesById.get(end);

        if (!element) throw new Error(`wb.edge: no node "${String(end)}"`);

        return element;
      };

      const from = find(options.from);
      const to = find(options.to);

      const name = (element: HTMLElement) =>
        element.querySelector(".wb-node-label")?.textContent ?? "";

      if (!edgeLayer.isConnected) document.body.prepend(edgeLayer);

      const path = document.createElementNS(SVG, "path");
      path.classList.add("wb-edge");
      path.setAttribute("marker-end", "url(#wb-arrow)");
      path.dataset.state = options.state ?? "default";
      path.toggleAttribute("data-dashed", Boolean(options.dashed));
      // The line is 1.5px; a 12px path over it takes the pointer for it.
      const hit = document.createElementNS(SVG, "path");
      hit.classList.add("wb-edge-hit");
      proxies.set(hit, path);
      edgeLayer.append(path, hit);

      new MutationObserver(() => {
        hit.setAttribute("d", path.getAttribute("d") ?? "");
        hit.toggleAttribute(
          "data-wb-linked",
          path.hasAttribute("data-wb-linked"),
        );
      }).observe(path, {
        attributes: true,
        attributeFilter: ["d", "data-wb-linked"],
      });

      let label: HTMLElement | null = null;

      if (options.label) {
        label = document.createElement("span");
        label.className = "wb-edge-label";
        label.textContent = options.label;
        proxies.set(label, path);
        document.body.append(label);
        // The label dims with its line.
        new MutationObserver(() => {
          if (label) label.dataset.state = path.dataset.state ?? "default";
        }).observe(path, { attributes: true, attributeFilter: ["data-state"] });
      }

      const edge = { from, to, path, label };
      edges.push(edge);
      route(edge);

      const title = `${name(from)} → ${name(to)}`;

      const outside = [from, to].some((end) =>
        ["person", "external"].includes(end.dataset.kind ?? ""),
      );

      if (options.code || !outside) wb.code(path, options.code ?? [], title);

      // Two wires between the same nodes need ids of their own.
      const base =
        options.id ??
        `${from.getAttribute("data-wb-select")}→${to.getAttribute("data-wb-select")}`;

      let id = base;

      for (let count = 2; edgeIds.has(id); count++) id = `${base}#${count}`;
      edgeIds.add(id);

      wb.selectable(path, { id, label: title, kind: "edge" });

      return path;
    },
    /** What collides on the stage, in words: nodes, edge labels and group
     * names that overlap, edges through nodes they do not join, and nodes
     * poking into groups that do not hold them. Empty when the drawing is
     * clear. The stage also warns in the console when it finds any. */
    overlaps() {
      return findOverlaps().map((item) => item.text);
    },
    /**
     * Places every node, group and edge drawn so far with ELK's layered
     * layout, so a script can leave out coordinates: nodes line up in
     * columns along the flow, groups wrap what they hold with room for
     * their names, and edges route around nodes at right angles. Await it
     * before reading positions or starting animations. The stage takes the
     * drawing's size, which it resolves to.
     */
    async layout(options: LayoutOptions = {}) {
      layoutPending = true;
      laidOut = true;
      const loadElk = window.wbLoadElk;

      if (!loadElk) throw new Error("wb.layout: the stage cannot load ELK");

      const { default: Layered } = await loadElk();
      const ids = new Map<string, HTMLElement>();
      const keys = new Map<HTMLElement, string>();

      const id = (element: HTMLElement) => {
        const key = `wb${ids.size}`;
        ids.set(key, element);
        keys.set(element, key);

        return key;
      };

      const nodeElk = (element: HTMLElement): ElkNode => {
        const extra = reach(element);

        return {
          id: id(element),
          width: element.offsetWidth + extra.left + extra.right,
          height: element.offsetHeight + extra.top,
        };
      };

      const grouped = new Set(
        allGroups.flatMap((group) => groupNodes.get(group) ?? []),
      );

      // A group is at least as wide as its name and tag, which ELK cannot
      // see, so the head never runs past the group's edge. The head
      // stretches with the group, so measure what it holds, not the head,
      // or every pass would widen the group again.
      const headWidth = (group: HTMLElement) => {
        const head = group.querySelector(":scope > .wb-group-head");
        const parts = [...(head?.children ?? [])];

        const gap = head
          ? parseFloat(getComputedStyle(head).columnGap) || 0
          : 0;

        return (
          parts.reduce((total, part) => total + part.scrollWidth, 0) +
          gap * Math.max(0, parts.length - 1) +
          2 * (padOf(group) - 4)
        );
      };

      const groupElk = (group: HTMLElement): ElkNode => ({
        id: id(group),
        layoutOptions: {
          "elk.padding": `[top=${padOf(group) + groupHead(group)},left=${padOf(group)},bottom=${padOf(group)},right=${padOf(group)}]`,
          "elk.nodeSize.constraints": "MINIMUM_SIZE",
          "elk.nodeSize.minimum": `(${Math.ceil(headWidth(group))}, 0)`,
        },
        children: [
          ...(groupNodes.get(group) ?? []).map(nodeElk),
          ...[...group.querySelectorAll<HTMLElement>(":scope > .wb-group")].map(
            groupElk,
          ),
        ],
      });

      // Labels sit at the tail of their edge, which keeps the drawing
      // compact. One that collides moves to the head, where it rarely has a
      // neighbour; one that still collides gets a layer of its own in the
      // middle of the edge, where ELK keeps everything clear of it but the
      // drawing grows wider.
      const placement = new Map<Edge, "TAIL" | "HEAD" | "CENTER">();

      const run = async () => {
        const graph: ElkNode = {
          id: "root",
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": options.direction === "down" ? "DOWN" : "RIGHT",
            "elk.hierarchyHandling": "INCLUDE_CHILDREN",
            "elk.edgeRouting": "ORTHOGONAL",
            "elk.spacing.nodeNode": String(options.spacing ?? 32),
            "elk.layered.spacing.nodeNodeBetweenLayers": String(
              options.layerSpacing ?? 64,
            ),
            "elk.spacing.edgeNode": "16",
            "elk.layered.spacing.edgeNodeBetweenLayers": "24",
            // The stage's inset keeps the drawing off its edges.
            "elk.padding": "[top=0,left=0,bottom=0,right=0]",
            "elk.json.edgeCoords": "ROOT",
            "elk.spacing.edgeLabel": "4",
            "elk.spacing.labelNode": "6",
          },
          children: [
            // Only what no group holds sits at the top.
            ...allNodes.flatMap((node) =>
              grouped.has(node) ? [] : [nodeElk(node)],
            ),
            ...allGroups.flatMap((group) =>
              group.parentElement?.classList.contains("wb-group")
                ? []
                : [groupElk(group)],
            ),
          ],
          edges: edges.flatMap((edge, index) => {
            const source = keys.get(edge.from);
            const target = keys.get(edge.to);

            // Labels go in a margin larger than drawn, so ELK makes room for
            // them with air around; each is drawn centred in its room.
            const labels = edge.label
              ? [
                  {
                    text: edge.label.textContent ?? "",
                    width: edge.label.offsetWidth + 2 * LABEL_MARGIN,
                    height: edge.label.offsetHeight + 2 * LABEL_MARGIN,
                    layoutOptions: {
                      "elk.edgeLabels.placement": placement.get(edge) ?? "TAIL",
                    },
                  },
                ]
              : [];

            return source && target
              ? [
                  {
                    id: `e${index}`,
                    sources: [source],
                    targets: [target],
                    labels,
                  },
                ]
              : [];
          }),
        };

        const result: ElkNode = await new Layered().layout(graph);

        // Shapes come back relative to their parent: walk down adding offsets.
        // Groups are placed outside in, so an inner one can sit relative to
        // the group holding it.
        const place = (item: ElkNode, offsetX: number, offsetY: number) => {
          const x = offsetX + (item.x ?? 0);
          const y = offsetY + (item.y ?? 0);
          const element = ids.get(item.id);

          if (element?.classList.contains("wb-group"))
            placeGroup(
              element,
              new DOMRect(x, y, item.width ?? 0, item.height ?? 0),
            );
          else if (element) {
            const extra = reach(element);
            element.style.left = `${x + extra.left}px`;
            element.style.top = `${y + extra.top}px`;
          }

          for (const child of item.children ?? []) place(child, x, y);
        };

        for (const child of result.children ?? []) place(child, 0, 0);

        for (const [index, edge] of edges.entries()) {
          const laid = result.edges?.find((item) => item.id === `e${index}`);
          const section = laid?.sections?.[0];

          if (!section) {
            route(edge);
            continue;
          }

          const points = [
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          ];

          edge.path.setAttribute(
            "d",
            points
              .map(
                (point, at) =>
                  `${at ? "L" : "M"}${Math.round(point.x)} ${Math.round(point.y)}`,
              )
              .join(" "),
          );

          const spot = laid?.labels?.[0];

          if (edge.label && spot?.x !== undefined && spot.y !== undefined) {
            edge.label.style.left = `${spot.x + spot.width / 2}px`;
            edge.label.style.top = `${spot.y + spot.height / 2}px`;
          } else placeLabel(edge);
        }

        return result;
      };

      let result = await run();

      for (const next of ["HEAD", "CENTER"] as const) {
        const crowded = new Set(findOverlaps().flatMap((item) => item.labels));

        if (!crowded.size) break;

        for (const edge of crowded) placement.set(edge, next);
        result = await run();
      }

      for (const group of allGroups) syncDimmed(group);

      layoutPending = false;
      warnOverlaps();

      // The block sizes the stage to the drawing.
      const size = { width: result.width ?? 0, height: result.height ?? 0 };
      parent.postMessage({ type: "wb:size", ...size }, "*");

      return size;
    },
    /**
     * Draws a chart with Observable Plot at stage position (x, y) and
     * returns its element. `plot` returns ordinary Plot options; the stage
     * fills in the size, its type and the chart palette in fixed order
     * (pass your own `color.scheme` or `color.range` to replace it), and
     * redraws on every theme, scenario and frame change. Plot's tips work
     * on hover: add `tip: true` to a mark, or `Plot.tip(data,
     * Plot.pointerX(...))` with `Plot.crosshairX` for a line.
     */
    chart(options: ChartOptions) {
      const element = document.createElement("div");
      element.className = "wb-chart";
      Object.assign(element.style, {
        left: `${options.x}px`,
        top: `${options.y}px`,
        width: `${options.width}px`,
        height: `${options.height}px`,
      });
      document.body.append(element);
      wb.selectable(element, {
        id: options.id ?? options.label,
        label: options.label,
        kind: "chart",
      });

      if (options.code) wb.code(element, options.code, options.label);

      let module: PlotModule | null = null;

      // The transition still running, ended at once by the next draw.
      let tweening: (() => void) | null = null;

      // A step eases from the last drawing; a theme switch and the first
      // drawing do not.
      const draw = (animate = false) => {
        if (!module) return;
        tweening?.();
        tweening = null;
        const previous = element.firstElementChild;
        const colors = colorsOf(themeOf());

        const own = options.plot({
          Plot: module,
          colors,
          width: options.width,
          height: options.height,
          frame: wb.frame,
          scenario: wb.scenario,
        });

        // A colour scale the script declares takes the series in order. One
        // it leaves out stays Plot's to infer, so a channel of literal
        // colours (a muted bar, text in ink) draws as written.
        const color =
          !own.color || own.color.scheme || own.color.range
            ? own.color
            : { range: colors.series, ...own.color };

        const next = module.plot({
          width: options.width,
          height: options.height,
          ...own,
          ...(color && { color }),
          style: {
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            fontSize: "11px",
            color: colors.muted,
            background: "transparent",
            overflow: "visible",
            ...own.style,
          },
        });

        element.replaceChildren(next);

        if (
          previous &&
          animate &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          tweening = tweenChart(previous, next, element);
      };

      const load = window.wbLoadPlot;

      if (!load) throw new Error("wb.chart: the stage cannot load Plot");

      void load().then((loaded) => {
        module = loaded;
        draw();
      });

      themeListeners.add(() => draw());
      scenarioListeners.add(() => draw(true));
      frameListeners.add(() => draw(true));

      return element;
    },
    /** A dot, or a pill with a label, for `travel()` to move along wires:
     * a request, a message, a piece of data. Change it between trips with
     * `token.dataset.label` and `token.dataset.tone`; `token.hidden` fades
     * it out. */
    token(options: TokenOptions = {}) {
      const element = document.createElement("div");
      element.className = "wb-token";
      element.hidden = true;

      if (options.label) element.dataset.label = options.label;

      element.dataset.tone = options.tone ?? "request";
      document.body.append(element);

      return element;
    },
    /** Moves `token` along an SVG path at a steady speed and resolves true
     * when it arrives, or false when `signal` stops it. Chain trips with
     * `await` to send something hop by hop. With reduced motion the token
     * waits on the middle of the wire instead of moving. */
    travel(
      token: HTMLElement,
      path: SVGPathElement,
      options: TravelOptions = {},
    ) {
      const length = path.getTotalLength();
      const duration = Math.max(length / (options.speed ?? 0.18), 600);
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

      const place = (progress: number) => {
        const along = options.reverse ? 1 - progress : progress;
        const matrix = path.getScreenCTM();
        const point = path.getPointAtLength(along * length);
        const screen = matrix ? point.matrixTransform(matrix) : point;
        token.style.left = `${screen.x - origin().x}px`;
        token.style.top = `${screen.y - origin().y}px`;
      };

      token.hidden = false;

      return new Promise<boolean>((resolve) => {
        if (options.signal?.aborted) return resolve(false);

        let frame = 0;
        let timer = 0;

        const stop = () => {
          cancelAnimationFrame(frame);
          clearTimeout(timer);
          resolve(false);
        };

        options.signal?.addEventListener("abort", stop, { once: true });

        const finish = () => {
          options.signal?.removeEventListener("abort", stop);
          resolve(true);
        };

        if (still) {
          place(0.5);
          timer = window.setTimeout(finish, Math.max(duration, 900));

          return;
        }

        const start = performance.now();

        const step = (now: number) => {
          const progress = Math.min((now - start) / duration, 1);
          place(progress);

          if (progress < 1) frame = requestAnimationFrame(step);
          else finish();
        };

        place(0);
        frame = requestAnimationFrame(step);
      });
    },
    /**
     * Lets the reader select something for the model's context. Pass an
     * element and what to call it, or for something drawn on a canvas, a
     * region that says where it is on screen. React Flow nodes and edges and
     * every `wb.node` are selectable already. Returns a function that undoes
     * it.
     */
    selectable(
      target: HTMLElement | SVGElement | SelectableRegion,
      item?: Partial<SelectedItem>,
    ) {
      if (target instanceof Element) {
        target.setAttribute("data-wb-select", item?.id ?? target.id);

        if (item?.label) target.setAttribute("data-wb-label", item.label);

        if (item?.kind) target.setAttribute("data-wb-kind", item.kind);

        return () => {
          for (const name of [
            "data-wb-select",
            "data-wb-label",
            "data-wb-kind",
          ])
            target.removeAttribute(name);
        };
      }

      regions.add(target);

      return () => {
        regions.delete(target);
      };
    },
    /**
     * Marks `target`, a node, a wire's path or anything drawn, as a claim
     * about the code, backed by the named entries in the block's `code`.
     * Pass no names for a claim nothing backs yet: verify mode shows it as
     * unlinked. A wire names its call site; a wire carrying two calls
     * names both. Clicking a linked claim opens its code beside the stage.
     */
    code(target: Element, names: string | string[] = [], label?: string) {
      const list = [names].flat();
      target.setAttribute("data-wb-claim", JSON.stringify(list));
      target.toggleAttribute("data-wb-linked", list.length > 0);

      if (label) target.setAttribute("data-wb-claim-label", label);

      queueClaims();
    },
    /** Adds a line reading "hello world" to the stage. */
    helloWorld() {
      const line = document.createElement("div");
      line.textContent = "hello world";
      document.body.append(line);
    },
  };

  addEventListener("message", (event: MessageEvent) => {
    if (event.source !== parent) return;

    if (event.data?.type === "wb:time") {
      const time: number = event.data.time;

      if (time === wb.time) return;
      wb.time = time;
      const moment = momentAt(time);

      notify(timeListeners, time, moment);

      return;
    }

    if (event.data?.type === "wb:select-mode") {
      setSelecting(event.data.on === true);

      return;
    }

    if (event.data?.type === "wb:select-clear") {
      clear();

      return;
    }

    if (event.data?.type === "wb:select-remove") {
      selected.delete(event.data.id);
      report();
      redraw();

      return;
    }

    if (event.data?.type === "wb:verify") {
      codeStatus = event.data.status;
      focus = new Set(event.data.focus);
      setVerifying(event.data.on);
      reportClaims();

      return;
    }

    // A replay is the same step again: scripts restart what it plays.
    if (event.data?.type === "wb:replay") {
      notify(frameListeners, wb.frame, {
        index: wb.frameIndex,
        previous: wb.frame,
        previousIndex: wb.frameIndex,
      });

      return;
    }

    if (event.data?.type !== "wb:state") return;
    const next: StageState = event.data.state;

    const newScenario = next.scenario?.id !== wb.scenario?.id;

    if (newScenario) {
      wb.scenario = next.scenario;

      notify(scenarioListeners, next.scenario);
    }

    // A scenario with steps of its own starts them over, even at the same
    // index.
    if (newScenario || next.frameIndex !== wb.frameIndex) {
      const change = {
        index: next.frameIndex,
        previous: wb.frame,
        previousIndex: wb.frameIndex,
      };

      wb.frame = next.frame;
      wb.frameIndex = next.frameIndex;

      notify(frameListeners, next.frame, change);
    }
  });

  Object.assign(globalThis, { wb });
}
