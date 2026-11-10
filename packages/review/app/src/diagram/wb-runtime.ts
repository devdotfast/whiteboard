// The `wb` SDK a diagram's script draws with, and the stage runtime around
// it. The block sends this function's source to the sandboxed stage, which
// runs it with its port, so it must not close over anything outside its own
// body: the types below vanish when it compiles, and nothing else may be
// referenced from module scope.

import type {
  DiagramStage,
  HostMessage,
  StageFrame,
  StageInit,
  StageLibrary,
  StageMessage,
  StageMove,
} from "@canvas/animation/stage-protocol";

// oxlint-disable-next-line no-restricted-imports -- The reference ships beside the instructions, outside the canvas source; the wb object below satisfies it, so the two cannot drift.
import type * as Reference from "../../../instructions/wb";

/** A frame, as the script reads it. */
type Frame = StageFrame;

/** A scenario: its key, label and frames in order. */
type Scenario = { key: string; label: string; frames: Frame[] };

type Chapter = DiagramStage["chapters"][number];

/** What a selectable thing says about itself. */
type SelectedItem = { id: string; label: string; kind: string };

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
  /** Stable id: edges and moves name the node by it. The label when
   * omitted. */
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
  /** The name, or names, in the block's `code` that back this node: where
   * it is defined. Every node but a person or an external system claims
   * something about the code, so one without code counts as unlinked;
   * `false` says it is not code, such as a repository or a disk. */
  code?: string | string[] | false;
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
  /** Stable id; the label when omitted. */
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
  /** Which way the flow runs inside the group, when it differs from the
   * drawing's: a drawing that runs right can stack a group's parts down,
   * which keeps it closer to square. */
  direction?: "right" | "down";
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
  /** Stable id; "<from>→<to>" when omitted. */
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
   * without code counts as unlinked; an edge to a person or an external
   * system does not unless it names code. `false` says it is not code. */
  code?: string | string[] | false;
  state?: NodeState;
};

type LayoutOptions = {
  /** "elk" (the default) places everything; "manual" keeps the `x` and `y`
   * each node was given and only routes the wires and sizes the stage. */
  mode?: "elk" | "manual";
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
  ports?: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    layoutOptions?: Record<string, string>;
  }[];
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

/** Observable Plot as the stage loads it; scripts reach the whole module
 * through a chart's `Plot`. */
type PlotModule = { plot(options: PlotOptions): Element };

declare global {
  interface Window {
    /** ELK's constructor, once the host sent its build. */
    ELK?: new () => Elk;
    /** Observable Plot, once the host sent its build. */
    Plot?: PlotModule;
    /** three.js's module, once the host sent its build. */
    THREE?: typeof import("three");
  }
}

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

/** The stage palette for one theme, as plain colours. */
type Palette = Record<
  | "ink"
  | "muted"
  | "faint"
  | "surface"
  | "raised"
  | "line"
  | "accent"
  | "added"
  | "removed"
  | "modified",
  string
> & { series: string[] };

type ChartContext = {
  /** The Observable Plot module: marks, scales and helpers. */
  Plot: PlotModule;
  /** The stage palette for the current theme; `series` is the chart order. */
  colors: Palette;
  width: number;
  height: number;
  frame: Frame | null;
  scenario: Scenario | null;
};

type ChartOptions = {
  /** Stable id; the label when omitted. */
  id?: string;
  /** What the chart shows, for selection and code view headings. */
  label: string;
  /** Top-left corner and size in stage px. Left out, a chart takes the
   * board's column, 240px tall, under whatever was drawn before it. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
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
   * response reads apart from the call that caused it; "error" is filled
   * red, for a call that fails or is refused. */
  tone?: "request" | "reply" | "error";
};

type TravelOptions = {
  /** Run the wire from its end back to its start, as a reply does. */
  reverse?: boolean;
  /** Pixels per millisecond, so long wires take longer; 0.18 by default.
   * A wire never takes under 600ms, so its label can be read. */
  speed?: number;
  /** Stops the trip where it is; the promise then resolves false. */
  signal?: AbortSignal;
  /** Puts the token at the end at once, as a jump to a step does. */
  instant?: boolean;
  /** How far along the wire the trip ends, from 0 to 1; 1 by default. */
  to?: number;
};

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

export function wbRuntime(port: MessagePort): void {
  port.onmessage = (event: MessageEvent<HostMessage>) => {
    if (event.data.type !== "init") return;
    port.onmessage = null;
    start(event.data);
  };

  function start(init: StageInit) {
    const diagram = init.diagram!;
    const send = (message: StageMessage) => port.postMessage(message);
    const chapters = diagram.chapters;
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

    // Listeners added before the first step shows, which hear it then.
    const unheard = new Set<
      (frame: Frame | null, change: FrameChange) => void
    >();

    const first = (): FrameChange => ({
      index: wb.frameIndex,
      previous: null,
      previousIndex: -1,
    });

    const hearFirst = () => {
      const listeners = [...unheard];
      unheard.clear();
      notify(listeners, wb.frame, first());
    };

    // The stage's palette comes from the board's theme, which the host pushes
    // on boot and on every switch. Scripts take colours from here
    // (`var(--wb-ink)` in CSS, `wb.colors()` for canvas libraries) instead of
    // hard-coding them, so they follow the theme.
    const paletteNames = {
      ink: "ink",
      muted: "ink-muted",
      faint: "ink-faint",
      surface: "surface",
      raised: "surface-raised",
      line: "rule",
      accent: "accent",
      added: "added",
      removed: "removed",
      modified: "modified",
    } as const;

    type ColorName = keyof typeof paletteNames;

    let boardTheme = init.theme;
    let scheme = init.colorScheme;

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

    const themeListeners = new Set<
      (theme: "light" | "dark", colors: Colors) => void
    >();

    const themeOf = () => scheme;

    // A colour CSS resolved may still read as color(srgb …) or oklch(), which
    // libraries cannot parse: paint it on a pixel and read it back as rgb.
    const probe = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });

    const plain = (value: string) => {
      if (!probe || !value) return value;
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#000";
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;

      return a === 255
        ? `rgb(${r}, ${g}, ${b})`
        : `rgba(${r}, ${g}, ${b}, ${Math.round(((a ?? 0) / 255) * 100) / 100})`;
    };

    // The board's values may hold light-dark() or var(), which only CSS
    // resolves: read each through an element, then as plain rgb.
    const swatch = document.createElement("span");
    swatch.hidden = true;
    document.head.append(swatch);

    const colorsOf = (theme: "light" | "dark") => {
      const color = (name: ColorName) => {
        swatch.style.color = `var(--wb-${paletteNames[name]})`;

        return plain(getComputedStyle(swatch).color);
      };

      return {
        ink: color("ink"),
        muted: color("muted"),
        faint: color("faint"),
        surface: color("surface"),
        raised: color("raised"),
        line: color("line"),
        accent: color("accent"),
        added: color("added"),
        removed: color("removed"),
        modified: color("modified"),
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

    // The board's theme, as --wb-* properties and the scheme light-dark()
    // follows; the stage's own fonts come inlined from the host.
    const themeStyles = document.createElement("style");

    const applyTheme = () => {
      document.documentElement.style.colorScheme = scheme;
      themeStyles.textContent = `
    :root {
      ${Object.entries(boardTheme)
        .map(([name, value]) => `--wb-${name}: ${value};`)
        .join("\n      ")}
      ${Object.entries(paletteNames)
        // Names the board already sets (ink, surface, accent) need no alias.
        .flatMap(([name, from]) =>
          name === from ? [] : [`--wb-${name}: var(--wb-${from});`],
        )
        .join("\n      ")}
      color: var(--wb-ink);
      font-family: var(--wb-font-sans);
    }
    html { box-sizing: border-box; height: 100%; padding: ${diagram.inset}px; background: transparent; }
    /* The body is as wide as the page, centred in a wider stage. */
    body { position: relative; display: flow-root; margin: 0 auto; min-height: 100%; background: transparent; }
  `;
    };

    applyTheme();
    document.head.append(themeStyles);

    const fontStyles = document.createElement("style");
    fontStyles.textContent = init.fonts;
    document.head.append(fontStyles);

    // Node kinds follow C4 and differ by outline, never by colour: colour is
    // left to animation, blue for active and a lighter outline for dimmed.
    // Every value has a light and a dark form; the stage follows the theme.
    // A token's label stops at this width; a resting token keeps this much
    // air between itself and the arrowhead or node its wire meets.
    const TOKEN_WIDTH = 128;

    // The narrowest a labelled token gets on a short wire.
    const TOKEN_LEAST = 36;
    const TOKEN_AIR = 6;

    // The label each resting token hides, shown again when it leaves.
    const covering = new WeakMap<Element, HTMLElement[]>();

    const uncover = (token: Element) => {
      for (const label of covering.get(token) ?? [])
        label.removeAttribute("data-covered");

      covering.delete(token);
    };

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
      font-family: var(--wb-font-sans);
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
      font-family: var(--wb-font-mono);
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
    .wb-group[data-head="end"] > .wb-group-head { justify-content: flex-end; }
    .wb-group[data-tagless] > .wb-group-head > .wb-group-tag { display: none; }
    .wb-group[data-head="bottom"] > .wb-group-head { top: auto; bottom: 11px; }
    .wb-group-label {
      font: 600 12px/16px var(--wb-font-sans);
      color: var(--wb-group-ink);
      transition: color 200ms;
    }
    .wb-group[data-boundary] > .wb-group-head > .wb-group-label { font-size: 13px; }
    .wb-group-tag {
      font-family: var(--wb-font-mono);
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
    /* A long label is cut, whole in its tooltip, so a token never grows
       over the nodes beside its wire. */
    .wb-token[data-label] {
      max-width: ${TOKEN_WIDTH}px;
      height: 20px;
      padding: 0 8px;
      overflow: hidden;
      font: 500 10px/20px var(--wb-font-mono);
      color: light-dark(#ffffff, #0c0f15);
      white-space: nowrap;
      text-overflow: ellipsis;
      pointer-events: auto;
    }
    .wb-token[data-label]::after { content: attr(data-label); }
    .wb-token[data-tone="reply"] {
      background: var(--wb-surface);
      border: 1.5px solid var(--wb-accent);
      color: var(--wb-accent);
      line-height: 17px;
    }
    .wb-token[data-tone="error"] { background: var(--wb-removed); }
    .wb-token[data-lost] { opacity: 0.6; }
    /* A lost token fades its fill, not its label, so the label still reads
       in either theme. */
    .wb-token[data-lost][data-label] {
      opacity: 1;
      background: color-mix(in srgb, var(--wb-removed) 45%, var(--wb-surface));
      color: var(--wb-ink);
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

    // Thin things get a wider, invisible stand-in to point at: a wire's hit
    // path and its label both stand for the wire.
    const proxies = new WeakMap<Element, Element>();

    const resolve = (target: EventTarget | null) =>
      target instanceof Element ? (proxies.get(target) ?? target) : null;

    // A linked claim shows its code when clicked, and takes focus.
    const claimStyles = document.createElement("style");
    claimStyles.textContent = `
    [data-wb-linked] { cursor: pointer; }
    .wb-node:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: 3px; }
    .wb-edge:focus-visible { stroke: var(--wb-accent); stroke-width: 3; outline: none; }
    .wb-chart:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: 4px; }
  `;
    document.head.append(claimStyles);

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

    const reveal = (element: Element) => {
      const [name] = namesOf(element);

      if (name) send({ type: "reveal", name });
    };

    // Clicking a linked claim shows its code.
    addEventListener("click", (event) => {
      const target = resolve(event.target);

      if (!target) return;
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
      send({
        type: "claims",
        claims: [...document.querySelectorAll("[data-wb-claim]")]
          .slice(0, 2000)
          .map((element) => ({
            label: labelOf(element),
            names: namesOf(element).slice(0, 16),
          })),
      });

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

    // How far a kind's shape reaches past its box: a head, a lid, a cap.
    const reach = (element: Element) => {
      const kind = element.getAttribute("data-kind");

      return {
        top: kind === "person" ? 13 : kind === "database" ? 9 : 0,
        right: kind === "queue" ? 9 : 0,
        left: 0,
      };
    };

    // Where wb draws: the element in diagram.html marked data-wb-drawing, or
    // the page's only element when there is no diagram.html. Set before the
    // script runs.
    let mount: HTMLElement | null = null;

    // The mount, for a call that draws. diagram.html without one leaves the
    // drawing nowhere to go: say where it belongs instead of guessing.
    const drawingHost = (call: string) => {
      if (mount) return mount;

      throw new Error(
        `${call}: diagram.html has no element with data-wb-drawing, so the drawing has nowhere to go. Add <div data-wb-drawing></div> where it belongs in the page.`,
      );
    };

    // Stage coordinates start at the mount's corner; screen positions
    // convert through here.
    const origin = () => {
      const corner = (mount ?? document.body).getBoundingClientRect();

      return { x: corner.left, y: corner.top };
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
      font: 500 11px/14px var(--wb-font-sans);
      color: var(--wb-muted);
      white-space: nowrap;
      transform: translate(-50%, -50%);
      transition: opacity 200ms;
    }
    .wb-edge-label[data-state="dimmed"] { opacity: 0.35; }
    /* A token resting over a wire's label says more than it; the label
       comes back when the token goes. */
    .wb-edge-label[data-covered] { opacity: 0; }
    @media (prefers-reduced-motion: reduce) { .wb-edge, .wb-edge-label { transition: none; } }
    /* Plot's tips and legends read these; tips sit on the stage surface. */
    .wb-chart { position: absolute; --plot-background: var(--wb-surface); }
    .wb-chart svg { display: block; }
    .wb-chart figure { margin: 0; }
    .wb-chart h2 { margin: 0 0 2px; font: 600 13px/18px var(--wb-font-sans); color: var(--wb-ink); }
    .wb-chart h3 { margin: 0 0 6px; font: 400 12px/16px var(--wb-font-sans); color: var(--wb-muted); }
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

    // Each wire by its id, for a move that names the one it rides.
    const edgesById = new Map<string, Edge>();
    const nodesById = new Map<string, HTMLElement>();
    const allNodes: HTMLElement[] = [];
    const allGroups: HTMLElement[] = [];

    // How far apart wires sit where they meet the same side of a node, and
    // where their elbows turn when several turn beside each other.
    const PORT_GAP = 12;

    type Side = "left" | "right" | "top" | "bottom";

    type Sides = { from: Side; to: Side };

    // The side of each end a hand-placed wire leaves and enters: the side
    // that faces the other node.
    const sidesOf = (edge: Edge): Sides => {
      const a = stageBox(edge.from);
      const b = stageBox(edge.to);

      if (b.left > a.right) return { from: "right", to: "left" };

      if (b.right < a.left) return { from: "left", to: "right" };

      return b.top > a.bottom
        ? { from: "bottom", to: "top" }
        : { from: "top", to: "bottom" };
    };

    // The wires that meet `edge`'s node at one end on the same side, itself
    // among them.
    const sharing = (edge: Edge, end: "from" | "to") => {
      const node = edge[end];
      const side = sidesOf(edge)[end];

      return edges.filter(
        (other) =>
          (other.from === node && sidesOf(other).from === side) ||
          (other.to === node && sidesOf(other).to === side),
      );
    };

    // Where along its side a wire meets a node, from the middle. Wires that
    // share a side spread out in the order of where they come from, so
    // they neither merge nor cross there.
    const offsetAt = (edge: Edge, end: "from" | "to") => {
      const node = edge[end];
      const across = ["left", "right"].includes(sidesOf(edge)[end]);
      const shared = sharing(edge, end);

      if (shared.length < 2) return 0;

      const far = (other: Edge) => {
        const box = stageBox(other.from === node ? other.to : other.from);

        return across ? box.top + box.height / 2 : box.left + box.width / 2;
      };

      const order = shared.toSorted((one, two) => far(one) - far(two));

      return (order.indexOf(edge) - (order.length - 1) / 2) * PORT_GAP;
    };

    // A hand-placed wire's two ends, before its elbow: `across` when it
    // leaves a node's left or right side.
    type Run = { across: boolean; start: Point; end: Point };

    // The end of `edge` other than the one at `node`'s `side`.
    const otherEnd = (edge: Edge, node: HTMLElement, side: Side) =>
      edge.from === node && sidesOf(edge).from === side ? "to" : "from";

    // Where a wire meets a node along its side, spread from the middle.
    const portAt = (edge: Edge, end: "from" | "to") => {
      const box = stageBox(edge[end]);
      const across = ["left", "right"].includes(sidesOf(edge)[end]);

      return (
        (across ? box.top + box.height / 2 : box.left + box.width / 2) +
        offsetAt(edge, end)
      );
    };

    // Whether every wire on `edge`'s side at one end can meet it level with
    // where it meets its other node, and so run straight: each lands
    // inside the side, PORT_GAP clear of its corners and of each other.
    const level = (edge: Edge, end: "from" | "to") => {
      const node = edge[end];
      const side = sidesOf(edge)[end];
      const box = stageBox(node);
      const across = ["left", "right"].includes(side);
      const low = across ? box.top : box.left;
      const high = across ? box.bottom : box.right;

      const ports = sharing(edge, end)
        .map((other) => portAt(other, otherEnd(other, node, side)))
        .toSorted((one, two) => one - two);

      return ports.every(
        (port, at) =>
          port > low + PORT_GAP &&
          port < high - PORT_GAP &&
          (at === 0 || port - ports[at - 1]! >= PORT_GAP),
      );
    };

    // Out of the side that faces the other node and into the opposite
    // side; the arrowhead stops just short of the box. Where one end's
    // side spans the other's ports, as a tall node beside a column does,
    // that end meets each wire level with its other end and they run
    // straight; the busier end gives way when both could.
    const runOf = (edge: Edge): Run => {
      const a = stageBox(edge.from);
      const b = stageBox(edge.to);
      let start = portAt(edge, "from");
      let finish = portAt(edge, "to");
      const fromLevel = level(edge, "from");
      const toLevel = level(edge, "to");

      if (
        fromLevel &&
        (!toLevel || sharing(edge, "from").length >= sharing(edge, "to").length)
      )
        start = finish;
      else if (toLevel) finish = start;

      if (b.left > a.right || b.right < a.left) {
        const forward = b.left > a.right;

        return {
          across: true,
          start: { x: forward ? a.right : a.left, y: start },
          end: { x: forward ? b.left - 2 : b.right + 2, y: finish },
        };
      }

      const down = b.top > a.bottom;

      return {
        across: false,
        start: { x: start, y: down ? a.bottom : a.top },
        end: { x: finish, y: down ? b.top - 2 : b.bottom + 2 },
      };
    };

    // A point's place along a run's node sides, and across them.
    const along = (run: Run, point: Point) => (run.across ? point.y : point.x);

    const athwart = (run: Run, point: Point) =>
      run.across ? point.x : point.y;

    // How far an elbow turns from halfway. Wires that share a side at their
    // busier end and turn the same way take lanes PORT_GAP apart, the one
    // that turns furthest nearest the node, so in a fan-out they neither
    // run together nor cross.
    const laneOf = (edge: Edge, runs: Map<Edge, Run>) => {
      const run = runs.get(edge)!;

      const busy =
        sharing(edge, "from").length >= sharing(edge, "to").length
          ? "from"
          : "to";

      const node = edge[busy];
      const side = sidesOf(edge)[busy];

      // A wire's end at the busy node, and its other end.
      const ends = (other: Edge) => {
        const each = runs.get(other)!;

        return other.from === node && sidesOf(other).from === side
          ? { each, near: each.start, far: each.end }
          : { each, near: each.end, far: each.start };
      };

      const turn = (other: Edge) => {
        const { each, near, far } = ends(other);

        return Math.sign(along(each, far) - along(each, near));
      };

      const way = turn(edge);

      const lane = sharing(edge, busy)
        .filter((other) => {
          const { each } = ends(other);

          return (
            each.across === run.across &&
            along(each, each.start) !== along(each, each.end) &&
            turn(other) === way
          );
        })
        .toSorted((one, two) => {
          const first = ends(one);
          const second = ends(two);

          return (
            -way *
            (along(first.each, first.near) - along(second.each, second.near))
          );
        });

      if (lane.length < 2) return 0;

      const { near, far } = ends(edge);
      const outward = Math.sign(athwart(run, far) - athwart(run, near)) || 1;

      return (lane.indexOf(edge) - (lane.length - 1) / 2) * PORT_GAP * outward;
    };

    // Each hand-placed wire's corners, for its label to find a straight
    // stretch on.
    const corners = new WeakMap<Edge, Point[]>();

    const routeWith = (edge: Edge, runs: Map<Edge, Run>) => {
      const run = runs.get(edge)!;
      const { start, end } = run;
      let points: Point[] = [start, end];

      if (along(run, start) !== along(run, end)) {
        const mid = Math.round(
          (athwart(run, start) + athwart(run, end)) / 2 + laneOf(edge, runs),
        );

        points = run.across
          ? [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end]
          : [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end];
      }

      corners.set(edge, points);
      edge.path.setAttribute(
        "d",
        points
          .map((point, at) => `${at ? "L" : "M"}${point.x} ${point.y}`)
          .join(" "),
      );
      placeLabel(edge);
    };

    const runsNow = () => new Map(edges.map((edge) => [edge, runOf(edge)]));

    // One elbow per wire: see runOf and laneOf.
    const route = (edge: Edge) => routeWith(edge, runsNow());

    const routeAll = () => {
      const runs = runsNow();

      for (const edge of edges) routeWith(edge, runs);
    };

    // Where a label sits, and whether its wire runs across there: the
    // wire's middle, or for a wire busier at one end, toward its quieter
    // end, clear of where the busy end's wires turn: the middle of an
    // elbow's last stretch, or three quarters along a straight wire, when
    // the label fits there. Labels in a fan-out sit apart beside the nodes
    // they reach.
    const labelSpot = (edge: Edge) => {
      const points = corners.get(edge);
      const busier = sharing(edge, "from").length - sharing(edge, "to").length;

      if (points && busier !== 0) {
        const [a, b] =
          busier > 0 ? [points.at(-2), points.at(-1)] : [points[0], points[1]];

        const share = points.length === 2 ? (busier > 0 ? 0.75 : 0.25) : 0.5;

        if (a && b) {
          const across = a.y === b.y;

          const size = across
            ? (edge.label?.offsetWidth ?? 0)
            : (edge.label?.offsetHeight ?? 0);

          // The label's half length along the stretch, with air at the
          // node's end.
          const room =
            Math.hypot(b.x - a.x, b.y - a.y) * Math.min(share, 1 - share);

          const x = a.x + (b.x - a.x) * share;
          const y = a.y + (b.y - a.y) * share;

          if (room >= size / 2 + 8 && clearOfNodes(edge, x, y))
            return { x, y, across };
        }
      }

      // The middle, or the nearest place to it that is clear.
      const length = edge.path.getTotalLength();

      const at = (share: number) => {
        const point = edge.path.getPointAtLength(length * share);

        const ahead = edge.path.getPointAtLength(
          Math.min(length * share + 2, length),
        );

        return {
          x: point.x,
          y: point.y,
          across: Math.abs(ahead.x - point.x) >= Math.abs(ahead.y - point.y),
        };
      };

      return (
        [0.5, 0.4, 0.6, 0.3, 0.7]
          .map(at)
          .find((spot) => clearOfNodes(edge, spot.x, spot.y)) ?? at(0.5)
      );
    };

    // Whether a box lies across a group's edge: partly in, partly out.
    const straddles = (box: DOMRect, group: Element) => {
      const edge = stageBox(group);

      return (
        shown(group, edge) &&
        hits(box, edge) &&
        !(
          box.left >= edge.left &&
          box.right <= edge.right &&
          box.top >= edge.top &&
          box.bottom <= edge.bottom
        )
      );
    };

    // Whether a label centred at (x, y) keeps clear of every node, and of
    // every group's edge and name.
    const clearOfNodes = (edge: Edge, x: number, y: number) => {
      const width = edge.label?.offsetWidth ?? 0;
      const height = edge.label?.offsetHeight ?? 0;
      const box = new DOMRect(x - width / 2, y - height / 2, width, height);

      return (
        allNodes.every((node) => {
          const other = stageBox(node);

          return !shown(node, other) || !hits(box, other);
        }) &&
        allGroups.every((group) => {
          const name = nameBox(group);

          return !straddles(box, group) && !(name && hits(box, name));
        })
      );
    };

    // A label sits on its spot. Wires between the same two nodes run side
    // by side, so the outer two labels move off their wires to the outer
    // sides, and any between stay on theirs.
    const placeLabel = (edge: Edge) => {
      if (!edge.label) return;
      const spot = labelSpot(edge);
      let { x, y } = spot;

      // The other wires count once they have been routed.
      const side = edges
        .flatMap((other) =>
          (other === edge || other.path.getAttribute("d")) &&
          ((other.from === edge.from && other.to === edge.to) ||
            (other.from === edge.to && other.to === edge.from))
            ? [{ other, at: labelSpot(other) }]
            : [],
        )
        .toSorted((one, two) =>
          spot.across ? one.at.y - two.at.y : one.at.x - two.at.x,
        )
        .map(({ other }) => other);

      if (side.length > 1) {
        const way = side[0] === edge ? -1 : side.at(-1) === edge ? 1 : 0;

        if (spot.across) y += way * (edge.label.offsetHeight / 2 + 4);
        else x += way * (edge.label.offsetWidth / 2 + 4);
      }

      edge.label.style.left = `${x}px`;
      edge.label.style.top = `${y}px`;
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

    // A group's own flow, when its options turn it.
    const groupDirections = new WeakMap<Element, "right" | "down">();

    // A group's own padding, when its options gave one.
    const groupPads = new WeakMap<Element, number>();
    const padOf = (group: Element) => groupPads.get(group) ?? GROUP_PAD;

    const LABEL_MARGIN = 4;

    // A node's size when the script gives none; it widens to fit its name.
    const NODE_WIDTH = 160;
    const NODE_HEIGHT = 72;

    // How wide a line of text lays out whole, ellipsis or not.
    const textWidth = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);

      return range.getBoundingClientRect().width;
    };

    // How much wider a box must be to show its text whole, or 0. clientWidth
    // is rounded, so less than a pixel over is not cut: a cut loses at least
    // an ellipsis' width.
    const shortBy = (element: HTMLElement) => {
      const over = textWidth(element) - element.clientWidth;

      return over > 1 ? Math.ceil(over) : 0;
    };

    const groupHead = (element: Element) =>
      element.hasAttribute("data-boundary") ? 34 : 28;

    // Overlaps. Everything that must stay clear: nodes with what their shape
    // reaches past the box, edge labels and group heads; edges must not run
    // through a node they do not join, and a node must not poke into a group
    // that does not hold it. Tokens come and go, so they are free.
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

    // A group's name is its label and tag, not the strip they sit in, with
    // air to either side.
    const NAME_AIR = 4;

    const nameBox = (group: Element) => {
      const parts = [
        ...(group.querySelector(":scope > .wb-group-head")?.children ?? []),
      ].map((part) => part.getBoundingClientRect());

      if (!parts.length) return null;
      const left = Math.min(...parts.map((part) => part.left));
      const top = Math.min(...parts.map((part) => part.top));
      const right = Math.max(...parts.map((part) => part.right));
      const bottom = Math.max(...parts.map((part) => part.bottom));

      // A wire that passes the name within NAME_AIR still reads as through it.
      return stageRect(
        new DOMRect(
          left - NAME_AIR,
          top,
          right - left + 2 * NAME_AIR,
          bottom - top,
        ),
      );
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

    // A drawing placed by hand that reaches past the stage's top or left
    // edge, such as a group's name above a node at y 0, moves in as one so
    // nothing is cut off.
    const intoStage = () => {
      const placed = [
        ...allNodes,
        ...allGroups,
        ...document.querySelectorAll<HTMLElement>(".wb-chart"),
      ];

      let left = 0;
      let top = 0;

      for (const element of placed) {
        const box = stageBox(element);

        if (!shown(element, box)) continue;
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
      }

      if (left >= 0 && top >= 0) return;
      const dx = -left;
      const dy = -top;

      // Outer groups first: an inner one sits relative to its outer one.
      const depth = (group: Element) => {
        let count = 0;

        for (
          let parent = group.parentElement?.closest(".wb-group");
          parent;
          parent = parent.parentElement?.closest(".wb-group")
        )
          count++;

        return count;
      };

      for (const group of allGroups.toSorted((a, b) => depth(a) - depth(b))) {
        const box = groupBoxes.get(group);

        if (box)
          placeGroup(
            group,
            new DOMRect(box.x + dx, box.y + dy, box.width, box.height),
          );
      }

      for (const element of [
        ...allNodes,
        ...document.querySelectorAll<HTMLElement>(".wb-chart"),
      ]) {
        element.style.left = `${(Number.parseFloat(element.style.left) || 0) + dx}px`;
        element.style.top = `${(Number.parseFloat(element.style.top) || 0) + dy}px`;
      }
    };

    // Moves a group's name into the first stretch of its header that no
    // wire crosses and that holds it whole. Whether it found one.
    const slideName = (group: HTMLElement) => {
      const head = group.querySelector<HTMLElement>(":scope > .wb-group-head");
      const name = nameBox(group);

      if (!head || !name) return false;
      const strip = stageRect(head.getBoundingClientRect());

      const crossings = [strip.left - NAME_AIR, strip.right + NAME_AIR];

      for (const edge of edges) {
        const length = edge.path.getTotalLength();

        for (let at = 0; at <= length; at += 2) {
          const point = edge.path.getPointAtLength(at);

          if (point.y > strip.top - 1 && point.y < strip.bottom + 1)
            crossings.push(point.x);
        }
      }

      crossings.sort((one, two) => one - two);

      for (const [at, left] of crossings.entries()) {
        const right = crossings[at + 1];

        if (right === undefined || right - left < name.width + 4) continue;
        delete group.dataset.head;
        head.style.paddingLeft = `${Math.max(0, left + NAME_AIR + 2 - strip.left)}px`;

        if (!nameCrossed(group)) return true;
        head.style.paddingLeft = "";
      }

      return false;
    };

    // Moves a group's name clear of the wires that cross it: to the other
    // end of its header, then to a clear stretch between, then the same
    // without its tag. Whether it is clear.
    const clearName = (group: HTMLElement) => {
      group
        .querySelector<HTMLElement>(":scope > .wb-group-head")
        ?.style.removeProperty("padding-left");

      if (!nameCrossed(group)) return true;
      group.dataset.head = "end";

      if (!nameCrossed(group) || slideName(group)) return true;
      group.toggleAttribute("data-tagless", true);
      group.dataset.head = "end";

      if (!nameCrossed(group) || slideName(group)) return true;
      // Nowhere is clear: the name stays at the start, with its tag.
      delete group.dataset.head;
      group.removeAttribute("data-tagless");

      return false;
    };

    // Whether a wire runs through a group's name, or close enough to touch it.
    const nameCrossed = (group: Element) => {
      const box = nameBox(group);

      return box !== null && edges.some((edge) => crosses(edge.path, box, 3));
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

      // A chart takes the room it draws, which can run past its box.
      const charts = [...document.querySelectorAll(".wb-chart")].flatMap(
        (chart, index) => {
          const rect = stageRect(chart.getBoundingClientRect());

          const box = new DOMRect(
            rect.x,
            rect.y,
            Math.max(rect.width, chart.scrollWidth),
            Math.max(rect.height, chart.scrollHeight),
          );

          return shown(chart, box)
            ? [
                {
                  owner: null,
                  name: `chart "${chart.getAttribute("data-wb-label") ?? index + 1}"`,
                  box,
                },
              ]
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

      // A label must not sit across a group's edge, half in and half out.
      for (const edge of edges) {
        if (!edge.label) continue;
        const box = stageRect(edge.label.getBoundingClientRect());

        if (!shown(edge.label, box)) continue;

        for (const group of allGroups)
          if (straddles(box, group))
            found.push({
              text: `label “${edge.label.textContent}” sits on ${nameOf(group)}'s edge: give the group less padding, or move the nodes so the wire crosses it clear of the label`,
              labels: [edge],
            });
      }

      // An edge must not run under another edge's label.
      for (const edge of edges)
        for (const other of edges) {
          if (other === edge || !other.label) continue;
          const rect = stageRect(other.label.getBoundingClientRect());

          if (shown(other.label, rect) && crosses(edge.path, rect, 3))
            found.push({
              text: `the edge ${nameOf(edge.from)} → ${nameOf(edge.to)} runs under label “${other.label.textContent}”: drop the label or move a node so the wires part, and if ELK placed it, place the drawing by hand`,
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
              text: `${line} runs through ${nameOf(group)}'s name: no stretch of its header between the wires holds it. Shorten the name, give the group more padding, or bring the wire in from the side`,
              labels: [],
            });
      }

      // Text cut off with an ellipsis: the reader cannot see the rest.
      for (const { node } of nodeBoxes)
        for (const [selector, what] of [
          [".wb-node-label", "name"],
          [".wb-node-tag", "tag"],
        ] as const) {
          const text = node.querySelector<HTMLElement>(selector);
          const short = text ? shortBy(text) : 0;

          if (text && short > 0)
            found.push({
              text: `${nameOf(node)}'s ${what} “${text.textContent}” is cut off: it needs the node about ${node.offsetWidth + short + reach(node).left + reach(node).right}px wide`,
              labels: [],
            });
        }

      for (const { group } of groupNames) {
        const head = group.querySelector<HTMLElement>(
          ":scope > .wb-group-head",
        );

        if (head && head.scrollWidth > head.clientWidth + 1)
          found.push({
            text: `${nameOf(group)}'s name and tag are cut off: they need the group about ${group.offsetWidth + head.scrollWidth - head.clientWidth + 2}px wide. Shorten them, or give the group more padding`,
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

    // Nodes given no position, which a manual layout leaves in the corner.
    const unplaced = new WeakSet<Element>();

    // Everything else the stage noticed was drawn wrong: moves without a
    // wire, code names the block does not define, a node id used twice.
    const notes = new Set<string>();

    // What the drawing gets wrong goes to the host, which shows the agent
    // that wrote it, and to the console.
    const reportFindings = () => {
      const found = [
        ...new Set([...findOverlaps().map((item) => item.text), ...notes]),
      ].slice(0, 100);

      if (found.length)
        console.warn(
          `wb: ${found.length} finding(s):\n- ${found.join("\n- ")}`,
        );

      send({
        type: "findings",
        findings: found.map((text) => text.slice(0, 500)),
      });
    };

    // A drawing placed by hand is checked once its script has run; one that
    // lays itself out is checked when the layout lands.
    let laidOut = false;

    // The frames, the path the reader picked through them, and the scenario
    // that path is.
    const frames = init.frames;
    let sequence = init.sequence ?? null;

    const pathOf = () =>
      sequence
        ? sequence.flatMap((key) => frames.filter((frame) => frame.key === key))
        : frames;

    const scenarioFor = (keys: string[] | null): Scenario | null => {
      const found = keys
        ? diagram.scenarios.find(
            (item) =>
              item.frames.length === keys.length &&
              item.frames.every((key, index) => key === keys[index]),
          )
        : undefined;

      return found
        ? {
            key: found.key,
            label: found.label,
            frames: found.frames.flatMap((key) =>
              frames.filter((frame) => frame.key === key),
            ),
          }
        : null;
    };

    const initialFrame = frames[init.frame] ?? null;

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
    // number, as a path with the same commands does. It ends on the value
    // as written.
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
      scenario: scenarioFor(sequence),
      /** The frame on screen, or null when the block has none. */
      frame: initialFrame,
      /** The frame's position from 0, or -1 without frames. */
      frameIndex: initialFrame
        ? pathOf().findIndex((frame) => frame.key === initialFrame.key)
        : -1,
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

        // Before the stage first shows a step, a listener waits to hear it
        // until the moves have lit it, so the script's own states win.
        if (ready) listener(wb.frame, first());
        else unheard.add(listener);

        return () => {
          frameListeners.delete(listener);
        };
      },
      /** The moves engine: each frame's `moves` play by themselves. Call
       * `wb.moves.manual()` to drive tokens and lighting yourself. */
      moves: {
        manual() {
          manual = true;
          trip?.abort();
        },
      },
      /** Runs when the reader picks another scenario: undo what you started
       * (timers, tokens, states) so the new one starts clean. */
      onCleanup(cleanup: () => void) {
        cleanups.add(cleanup);
      },
      /** Whether the reader asked for less motion; `wb.travel` already
       * rests tokens mid-wire then. */
      /** three.js, for a 3D scene: resolves to its module, as `import * as
       * THREE from "three"` would. Loaded on first call. */
      async three() {
        await library("three");

        if (!window.THREE) throw new Error("wb.three: three.js did not load.");

        return window.THREE;
      },
      get reducedMotion() {
        return init.reducedMotion;
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

        // x, y, width and height are the box around everything the shape
        // draws: a person's head and a database's lid
        // sit inside them, so placed boxes add up.
        const extra = reach(element);
        element.style.left = `${(options.x ?? 0) + extra.left}px`;
        element.style.top = `${(options.y ?? 0) + extra.top}px`;

        if (options.x === undefined || options.y === undefined)
          unplaced.add(element);

        const outer = {
          width: options.width ?? NODE_WIDTH,
          height: options.height ?? NODE_HEIGHT,
        };

        element.style.width = `${outer.width - extra.left - extra.right}px`;
        element.style.height = `${outer.height - extra.top}px`;

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
          notes.add(
            `"${key}" is the id of two nodes; give each node its own id. The second is "${key}#${count}".`,
          );
          key = `${key}#${count}`;
        }

        wb.selectable(element, {
          id: key,
          label: options.label,
          kind: options.kind,
        });

        if (
          options.code !== false &&
          (options.code || !["person", "external"].includes(options.kind))
        )
          wb.code(element, options.code ?? [], options.label);

        element.dataset.id = key;
        allNodes.push(element);
        nodesById.set(key, element);

        drawingHost("wb.node").append(element);

        // A node grows to show its name and tag whole: from 160px given no
        // width, and from its width given one. Placed by hand, it grows
        // about its middle, so a column of nodes stays lined up.
        const style = getComputedStyle(element);

        const padding =
          element.offsetWidth -
          element.clientWidth +
          Number.parseFloat(style.paddingLeft) +
          Number.parseFloat(style.paddingRight);

        const needed = Math.ceil(
          Math.max(textWidth(label), textWidth(tag)) + padding + 2,
        );

        if (needed > element.offsetWidth) {
          // Placed by hand at a width it outgrows, it no longer lines up
          // with what it was placed beside: say so.
          if (options.width !== undefined && options.x !== undefined) {
            const wide = needed + extra.left + extra.right;

            element.style.left = `${Number.parseFloat(element.style.left) - Math.round((needed - element.offsetWidth) / 2)}px`;
            notes.add(
              `${options.label} grew from ${options.width}px to ${wide}px wide to show its name and tag, so it no longer lines up with what it was placed beside: give it width ${wide} and line the rest up to it, or shorten its name or tag.`,
            );
          }

          element.style.width = `${needed}px`;
        }

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

        // A group grows about its middle to show its name and tag whole,
        // as a node does.
        drawingHost("wb.group").prepend(element);
        const over = head.scrollWidth - head.clientWidth;

        if (over > 1) {
          const grow = Math.ceil(over) + 2;

          box = new DOMRect(
            box.left - Math.floor(grow / 2),
            box.top,
            box.width + grow,
            box.height,
          );

          Object.assign(element.style, {
            left: `${box.left}px`,
            width: `${box.width}px`,
          });
        }

        // Inner groups move inside, placed relative to this one.
        for (const child of inner) {
          const childBox = stageBox(child);
          child.style.left = `${childBox.left - box.left}px`;
          child.style.top = `${childBox.top - box.top}px`;
          element.append(child);
        }

        groupBoxes.set(element, box);
        groupNodes.set(element, nodes);

        if (options.direction) groupDirections.set(element, options.direction);

        if (options.padding !== undefined)
          groupPads.set(element, options.padding);
        allGroups.push(element);
        // Behind everything drawn so far: wires, nodes and other groups.
        drawingHost("wb.group").prepend(element);
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

        if (!edgeLayer.isConnected) drawingHost("wb.edge").prepend(edgeLayer);

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
          drawingHost("wb.edge").append(label);
          // The label dims with its line.
          new MutationObserver(() => {
            if (label) label.dataset.state = path.dataset.state ?? "default";
          }).observe(path, {
            attributes: true,
            attributeFilter: ["data-state"],
          });
        }

        const edge = { from, to, path, label };
        edges.push(edge);

        // A new wire can share a side with ones drawn before it.
        routeAll();

        const title = `${name(from)} → ${name(to)}`;

        const outside = [from, to].some((end) =>
          ["person", "external"].includes(end.dataset.kind ?? ""),
        );

        if (options.code !== false && (options.code || !outside))
          wb.code(path, options.code ?? [], title);

        // Two wires between the same nodes need ids of their own.
        const base =
          options.id ??
          `${from.getAttribute("data-wb-select")}→${to.getAttribute("data-wb-select")}`;

        let id = base;

        for (let count = 2; edgeIds.has(id); count++) id = `${base}#${count}`;
        edgeIds.add(id);

        const own = edges.find((item) => item.path === path);

        if (own) edgesById.set(id, own);

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
        // By hand, the nodes stay where the script put them: the wires are
        // routed again, in case a node moved, a group's name moves clear of
        // them, and the stage takes what was drawn, at least the size
        // block.json gives.
        if (options.mode === "manual") {
          for (const node of allNodes)
            if (unplaced.has(node))
              notes.add(
                `Node "${nameOf(node)}" has no x and y; a manual layout needs both on every node`,
              );

          intoStage();

          // Every wire first, then the labels, which read where the other
          // wire between the same nodes runs.
          routeAll();

          for (const edge of edges) placeLabel(edge);

          for (const group of allGroups) clearName(group);

          laidOut = true;
          reportFindings();
          const drawn = extent();

          const size = {
            width: Math.max(diagram.size?.width ?? 0, drawn.width),
            height: Math.max(diagram.size?.height ?? 0, drawn.height),
          };

          reportSize();

          return size;
        }

        layoutPending = true;
        laidOut = true;
        await library("elk");
        const Layered = window.ELK;

        if (!Layered) throw new Error("wb.layout: ELK did not load.");
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

        // Room inside a group: its padding, and its name above or below.
        const paddingOf = (group: HTMLElement) =>
          `[top=${padOf(group) + (headBelow.has(group) ? 0 : groupHead(group))},left=${padOf(group)},bottom=${padOf(group) + (headBelow.has(group) ? groupHead(group) : 0)},right=${padOf(group)}]`;

        const groupElk = (group: HTMLElement): ElkNode => ({
          id: id(group),
          layoutOptions: {
            "elk.padding": paddingOf(group),
            "elk.nodeSize.constraints": "MINIMUM_SIZE",
            "elk.nodeSize.minimum": `(${Math.ceil(headWidth(group))}, 0)`,
          },
          children: [
            ...(groupNodes.get(group) ?? []).map(nodeElk),
            ...[
              ...group.querySelectorAll<HTMLElement>(":scope > .wb-group"),
            ].map(groupElk),
          ],
        });

        // Labels sit at the tail of their edge, which keeps the drawing
        // compact. One that collides moves to the head, where it rarely has a
        // neighbour; one that still collides gets a layer of its own in the
        // middle of the edge, where ELK keeps everything clear of it but the
        // drawing grows wider.
        const placement = new Map<Edge, "TAIL" | "HEAD" | "CENTER">();

        // Groups whose name sits at the bottom, clear of wires from above.
        const headBelow = new Set<HTMLElement>();

        let rootDirection: "right" | "down" =
          options.direction === "down" ? "down" : "right";

        const elkDirection = (direction: "right" | "down") =>
          direction === "down" ? "DOWN" : "RIGHT";

        const common = {
          "elk.algorithm": "layered",
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "elk.edgeRouting": "ORTHOGONAL",
          "elk.spacing.nodeNode": String(options.spacing ?? 32),
          "elk.layered.spacing.nodeNodeBetweenLayers": String(
            options.layerSpacing ?? 64,
          ),
          "elk.spacing.edgeNode": "16",
          "elk.layered.spacing.edgeNodeBetweenLayers": "24",
          "elk.json.edgeCoords": "ROOT",
          "elk.spacing.edgeLabel": "4",
          "elk.spacing.labelNode": "6",
        };

        // Labels go in a margin larger than drawn, so ELK makes room for
        // them with air around; each is drawn centred in its room.
        const edgeElk = (
          edge: Edge,
          index: number,
          source: string,
          target: string,
        ) => ({
          id: `e${index}`,
          sources: [source],
          targets: [target],
          labels: edge.label
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
            : [],
        });

        // A group that turns the flow (its own direction, unlike the
        // drawing's) is laid out on its own first, then placed in the
        // drawing as one box. ELK cannot turn the flow inside one layout.
        const turnedGroups = () =>
          allGroups.filter((group) => {
            const direction = groupDirections.get(group);

            if (!direction || direction === rootDirection) return false;

            // One turned group inside another follows the outer one.
            for (
              let parent = group.parentElement?.closest(".wb-group");
              parent;
              parent = parent.parentElement?.closest(".wb-group")
            ) {
              const outer = groupDirections.get(parent);

              if (outer && outer !== rootDirection) return false;
            }

            return true;
          });

        let turned = turnedGroups();

        // The turned group each node is drawn in, if any.
        const turnedOf = (element: HTMLElement) =>
          turned.find(
            (group) => group.contains(element) || holds(group, element),
          );

        const run = async () => {
          ids.clear();
          keys.clear();

          // Each turned group's own layout, and where each thing it holds
          // sits in it.
          const inside = new Map<
            HTMLElement,
            { result: ElkNode; boxes: Map<HTMLElement, DOMRect> }
          >();

          for (const group of turned) {
            const held = edges.flatMap((edge, index) =>
              turnedOf(edge.from) === group && turnedOf(edge.to) === group
                ? [{ edge, index }]
                : [],
            );

            const children = groupElk(group).children ?? [];

            const result: ElkNode = await new Layered().layout({
              id: "inside",
              layoutOptions: {
                ...common,
                "elk.direction": elkDirection(groupDirections.get(group)!),
                "elk.padding": paddingOf(group),
              },
              children,
              edges: held.flatMap(({ edge, index }) => {
                const source = keys.get(edge.from);
                const target = keys.get(edge.to);

                return source && target
                  ? [edgeElk(edge, index, source, target)]
                  : [];
              }),
            });

            const boxes = new Map<HTMLElement, DOMRect>();

            const walk = (item: ElkNode, x: number, y: number) => {
              const element = ids.get(item.id);
              const at = { x: x + (item.x ?? 0), y: y + (item.y ?? 0) };

              if (element)
                boxes.set(
                  element,
                  new DOMRect(at.x, at.y, item.width ?? 0, item.height ?? 0),
                );

              for (const child of item.children ?? []) walk(child, at.x, at.y);
            };

            for (const child of result.children ?? []) walk(child, 0, 0);
            result.width = Math.max(result.width ?? 0, headWidth(group));
            inside.set(group, { result, boxes });
          }

          // A wire into or out of a turned group meets it at a port on its
          // side, level with the node it joins.
          const ports = new Map<HTMLElement, NonNullable<ElkNode["ports"]>>();

          const portFor = (
            edge: Edge,
            index: number,
            end: "from" | "to",
          ): string | undefined => {
            const node = edge[end];
            const group = turnedOf(node);

            if (!group) return keys.get(node);
            const laid = inside.get(group)!;
            const box = laid.boxes.get(node);

            if (!box) return undefined;
            const across = rootDirection === "right";
            const incoming = end === "to";
            const id = `${keys.get(group)}-p${index}-${end}`;

            ports.set(group, [
              ...(ports.get(group) ?? []),
              {
                id,
                width: 1,
                height: 1,
                x: across
                  ? incoming
                    ? 0
                    : (laid.result.width ?? 0)
                  : box.x + box.width / 2,
                y: across
                  ? box.y + box.height / 2
                  : incoming
                    ? 0
                    : (laid.result.height ?? 0),
                layoutOptions: {
                  "elk.port.side": across
                    ? incoming
                      ? "WEST"
                      : "EAST"
                    : incoming
                      ? "NORTH"
                      : "SOUTH",
                },
              },
            ]);

            return id;
          };

          // In the drawing, a turned group is one fixed box with its ports.
          const leaves = new Map<HTMLElement, ElkNode>();

          const outerOf = (group: HTMLElement): ElkNode => {
            const laid = inside.get(group);

            if (!laid) {
              const node = groupElk(group);

              return {
                ...node,
                children: [
                  ...(groupNodes.get(group) ?? []).map(nodeElk),
                  ...[
                    ...group.querySelectorAll<HTMLElement>(
                      ":scope > .wb-group",
                    ),
                  ].map(outerOf),
                ],
              };
            }

            const leaf: ElkNode = {
              id: keys.get(group) ?? id(group),
              width: laid.result.width ?? 0,
              height: laid.result.height ?? 0,
              ports: [],
              layoutOptions: { "elk.portConstraints": "FIXED_POS" },
            };

            leaves.set(group, leaf);

            return leaf;
          };

          const graph: ElkNode = {
            id: "root",
            layoutOptions: {
              ...common,
              "elk.direction": elkDirection(rootDirection),
              // The stage's inset keeps the drawing off its edges.
              "elk.padding": "[top=0,left=0,bottom=0,right=0]",
            },
            children: [
              // Only what no group holds sits at the top.
              ...allNodes.flatMap((node) =>
                grouped.has(node) ? [] : [nodeElk(node)],
              ),
              ...allGroups.flatMap((group) =>
                group.parentElement?.classList.contains("wb-group")
                  ? []
                  : [outerOf(group)],
              ),
            ],
          };

          // Wires are added once every node has its id; a turned group's
          // ports come with them.
          graph.edges = edges.flatMap((edge, index) => {
            const group = turnedOf(edge.from);

            if (group && group === turnedOf(edge.to)) return [];
            const source = portFor(edge, index, "from");
            const target = portFor(edge, index, "to");

            return source && target
              ? [edgeElk(edge, index, source, target)]
              : [];
          });

          // Wires that meet the same node from the same side spread along
          // it, so each keeps its own way in.
          for (const [group, leaf] of leaves) {
            const own = ports.get(group) ?? [];
            const across = rootDirection === "right";
            const shared = new Map<string, NonNullable<ElkNode["ports"]>>();

            for (const port of own) {
              const spot = `${port.x},${port.y}`;
              shared.set(spot, [...(shared.get(spot) ?? []), port]);
            }

            for (const together of shared.values())
              for (const [index, port] of together.entries()) {
                const offset = (index - (together.length - 1) / 2) * PORT_GAP;

                if (across) port.y = (port.y ?? 0) + offset;
                else port.x = (port.x ?? 0) + offset;
              }

            leaf.ports = own;
          }

          const result: ElkNode = await new Layered().layout(graph);

          // Shapes come back relative to their parent: walk down adding offsets.
          // Groups are placed outside in, so an inner one can sit relative to
          // the group holding it. A turned group's own layout goes inside it.
          const origins = new Map<HTMLElement, Point>();

          const place = (item: ElkNode, offsetX: number, offsetY: number) => {
            const x = offsetX + (item.x ?? 0);
            const y = offsetY + (item.y ?? 0);
            const element = ids.get(item.id);

            if (element?.classList.contains("wb-group")) {
              placeGroup(
                element,
                new DOMRect(x, y, item.width ?? 0, item.height ?? 0),
              );

              const laid = inside.get(element);

              if (laid) {
                origins.set(element, { x, y });

                for (const child of laid.result.children ?? [])
                  place(child, x, y);
              }
            } else if (element) {
              const extra = reach(element);
              element.style.left = `${x + extra.left}px`;
              element.style.top = `${y + extra.top}px`;
            }

            for (const child of item.children ?? []) place(child, x, y);
          };

          for (const child of result.children ?? []) place(child, 0, 0);

          for (const [index, edge] of edges.entries()) {
            const group = turnedOf(edge.from);
            const within = group && group === turnedOf(edge.to);
            const source = within ? inside.get(group)!.result : result;
            const shift = within ? origins.get(group)! : { x: 0, y: 0 };
            const laid = source.edges?.find((item) => item.id === `e${index}`);
            const section = laid?.sections?.[0];

            if (!section) {
              route(edge);
              continue;
            }

            const points = [
              section.startPoint,
              ...(section.bendPoints ?? []),
              section.endPoint,
            ].map((point) => ({ x: point.x + shift.x, y: point.y + shift.y }));

            // A wire that met a turned group at its port runs on to the
            // node inside, straight across.
            const reachNode = (end: "from" | "to") => {
              const home = turnedOf(edge[end]);
              const origin = home && origins.get(home);
              const box = home && inside.get(home)?.boxes.get(edge[end]);

              if (within || !origin || !box) return null;
              const across = rootDirection === "right";
              const at = end === "to" ? points.at(-1)! : points[0]!;

              return across
                ? {
                    x: origin.x + (end === "to" ? box.x : box.right),
                    y: at.y,
                  }
                : {
                    x: at.x,
                    y: origin.y + (end === "to" ? box.y : box.bottom),
                  };
            };

            const first = reachNode("from");
            const last = reachNode("to");

            if (first) points.unshift(first);

            if (last) points.push(last);

            corners.delete(edge);
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
              edge.label.style.left = `${spot.x + shift.x + spot.width / 2}px`;
              edge.label.style.top = `${spot.y + shift.y + spot.height / 2}px`;
            } else placeLabel(edge);
          }

          return result;
        };

        let result = await run();

        // A drawing laid out across that comes out wider than the board's
        // column is laid out down instead, when that fits: the reader would
        // otherwise scroll sideways.
        const room = diagram.room - 2 * diagram.inset;

        if (
          rootDirection === "right" &&
          room > 0 &&
          (result.width ?? 0) > room
        ) {
          const across = result;
          rootDirection = "down";
          turned = turnedGroups();
          result = await run();

          // Down only when it fits; a drawing too wide either way stays as
          // asked, and the agent is told to place it by hand.
          if ((result.width ?? 0) > room) {
            notes.add(
              `Laid out right the drawing is ${Math.round(across.width ?? 0)}px wide, and laid out down ${Math.round(result.width ?? 0)}px, but the board's column holds ${Math.round(room)}px: place it by hand with wb.layout({ mode: "manual" }), or draw less.`,
            );
            rootDirection = "right";
            turned = turnedGroups();
            result = await run();
          }
        }

        for (const next of ["HEAD", "CENTER"] as const) {
          const crowded = new Set(
            findOverlaps().flatMap((item) => item.labels),
          );

          if (!crowded.size) break;

          for (const edge of crowded) placement.set(edge, next);
          result = await run();
        }

        // A wire that enters a group can cross its name. The name moves to
        // the other end of the header, then drops its tag; if a wire crosses
        // it still, the header moves to the group's bottom and the layout
        // runs again with room for it there.
        for (const group of allGroups) {
          if (clearName(group)) continue;
          group.dataset.head = "bottom";
          headBelow.add(group);
        }

        if (headBelow.size) result = await run();

        for (const group of allGroups) syncDimmed(group);

        layoutPending = false;
        reportFindings();

        // The block sizes the stage to the drawing.
        const size = { width: result.width ?? 0, height: result.height ?? 0 };
        drawing = size;
        reportSize();

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
      chart(given: ChartOptions) {
        // What the script leaves out: the column's width, under what is
        // drawn so far.
        const above = extent().height;

        const options = {
          ...given,
          x: given.x ?? 0,
          y: given.y ?? (above > 0 ? above + CHART_GAP : 0),
          width:
            given.width ??
            (diagram.room > 0
              ? Math.max(240, diagram.room - 2 * diagram.inset)
              : CHART_WIDTH),
          height: given.height ?? CHART_HEIGHT,
        };

        const element = document.createElement("div");
        element.className = "wb-chart";
        Object.assign(element.style, {
          left: `${options.x}px`,
          top: `${options.y}px`,
          width: `${options.width}px`,
          height: `${options.height}px`,
        });
        drawingHost("wb.chart").append(element);
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

          // The chart's box sets its size: a width or height in the Plot
          // options is the box's, so it is set there and not here.
          const {
            width: _width,
            height: _height,
            ...own
          } = options.plot({
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

          const render = (height: number) =>
            module!.plot({
              width: options.width,
              height,
              ...own,
              ...(color && { color }),
              style: {
                fontFamily: getComputedStyle(
                  document.documentElement,
                ).getPropertyValue("--wb-font-sans"),
                fontSize: "11px",
                color: colors.muted,
                background: "transparent",
                overflow: "visible",
                ...own.style,
              },
            });

          // Plot warns in the console, and marks the chart with a ⚠, when
          // its data does not draw as asked: the warnings become findings.
          const warnings: string[] = [];

          const plotted = (height: number) => {
            const warn = console.warn;

            console.warn = (...args: unknown[]) => {
              warnings.push(args.map(String).join(" "));
              warn(...args);
            };

            try {
              return render(height);
            } finally {
              console.warn = warn;
            }
          };

          let next = plotted(options.height);
          element.replaceChildren(next);

          // A title, subtitle or legend sits above the plot: the plot gives
          // up that much height so the whole chart fits its box.
          const over = next.getBoundingClientRect().height - options.height;

          if (over > 1) {
            warnings.length = 0;
            next = plotted(Math.max(40, Math.floor(options.height - over)));
            element.replaceChildren(next);
          }

          const drawn = next.getBoundingClientRect().height;

          for (const warning of new Set(warnings))
            notes.add(`Chart "${options.label}" warns: ${warning}`);

          if (warnings.length) reportFindings();

          // Text that runs into other text, such as two event labels at
          // nearby dates or crowded ticks: the first few pairs, with how far
          // they overlap across. A text's box runs a fifth of its height
          // above and below its letters, so only the middle counts.
          const texts = [...next.querySelectorAll("text")].flatMap((text) => {
            const words = text.textContent?.trim() ?? "";
            const box = text.getBoundingClientRect();
            const air = box.height / 5;

            return words && box.width && box.height
              ? [
                  {
                    words,
                    box: new DOMRect(
                      box.x,
                      box.y + air,
                      box.width,
                      box.height - 2 * air,
                    ),
                  },
                ]
              : [];
          });

          let clashes = 0;

          for (const [index, one] of texts.entries())
            for (const two of texts.slice(index + 1)) {
              const wide =
                Math.min(one.box.right, two.box.right) -
                Math.max(one.box.left, two.box.left);

              const tall =
                Math.min(one.box.bottom, two.box.bottom) -
                Math.max(one.box.top, two.box.top);

              if (wide <= 2 || tall <= 2 || clashes >= 3) continue;
              clashes++;
              notes.add(
                `Chart "${options.label}": “${one.words}” runs into “${two.words}” by ${Math.ceil(wide)}px across: move one with dx or dy, give the chart more width, or drop one`,
              );
            }

          // Text over the data, such as a note set at the top of the frame
          // where a line runs high, or text past the chart's edges, where it
          // is cut: the first few, with where to move them. A chart with a
          // legend is a figure whose swatches are svgs too: the plot is the
          // largest.
          const area = (element: Element) => {
            const box = element.getBoundingClientRect();

            return box.width * box.height;
          };

          const plot = next.matches("svg")
            ? next
            : ([...next.querySelectorAll("svg")].toSorted(
                (a, b) => area(b) - area(a),
              )[0] ?? next);

          const edge = plot.getBoundingClientRect();

          const marks = [
            ...plot.querySelectorAll<SVGGeometryElement>(
              '[aria-label="line"] path, [aria-label="dot"] circle',
            ),
          ];

          const points = marks.flatMap((mark) => {
            const matrix = mark.getScreenCTM();

            if (!matrix) return [];
            const length = mark.getTotalLength();
            const count = Math.min(400, Math.ceil(length / 3));

            return Array.from({ length: count + 1 }, (_, index) => {
              const at = mark.getPointAtLength((length * index) / count);

              return new DOMPoint(at.x, at.y).matrixTransform(matrix);
            });
          });

          let crowded = 0;

          for (const { words, box } of texts) {
            if (crowded >= 3) break;
            const past = Math.max(edge.left - box.left, box.right - edge.right);

            if (past > 1) {
              crowded++;
              notes.add(
                `Chart "${options.label}": “${words}” runs ${Math.ceil(past)}px past the chart's ${box.right > edge.right ? "right" : "left"} edge and is cut: anchor it inside the plot with textAnchor, or move it with dx`,
              );
              continue;
            }

            const over = points.some(
              (point) =>
                point.x > box.left &&
                point.x < box.right &&
                point.y > box.top &&
                point.y < box.bottom,
            );

            if (over) {
              crowded++;
              notes.add(
                `Chart "${options.label}": “${words}” sits on the data, where a line or dot runs through it: move it to where the data is not, such as frameAnchor "bottom" for a line that runs high, or with dy`,
              );
            }
          }

          if (clashes || crowded) reportFindings();

          if (drawn > options.height + 1) {
            notes.add(
              `Chart "${options.label}" draws ${Math.ceil(drawn)}px tall in its ${options.height}px box: give it more height, or less above the plot.`,
            );
            reportFindings();
          }

          if (previous && animate && !init.reducedMotion)
            tweening = tweenChart(previous, next, element);
        };

        library("plot").then(
          () => {
            module = window.Plot ?? null;
            draw();
            reportSize();
          },
          (error: Error) => fail(`${error.name}: ${error.message}`),
        );

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
        drawingHost("wb.token").append(element);

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
        const still = init.reducedMotion;
        token.title = token.dataset.label ?? "";

        // The token keeps clear of the nodes at either end and of the
        // arrowhead: it leaves from outside the first and stops before the
        // arrowhead, so it never covers it or a node's name. On a wire too
        // short for that, a labelled token across it narrows to fit, cutting
        // its label; one that still cannot fit crosses at the middle.
        token.style.maxWidth = "";

        const clear = (at: number, toward: number) => {
          const a = path.getPointAtLength(at);
          const b = path.getPointAtLength(toward);
          const across = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

          return (
            (across ? token.offsetWidth : token.offsetHeight) / 2 + TOKEN_AIR
          );
        };

        // The arrowhead is drawn back from the wire's end, its tip on the
        // end: 7 of the marker's 8 units, in stroke widths.
        const arrow = path.hasAttribute("marker-end")
          ? 7 * (Number.parseFloat(getComputedStyle(path).strokeWidth) || 1)
          : 0;

        let near = clear(0, Math.min(2, length));
        let far = clear(length, Math.max(length - 2, 0)) + arrow;

        if (length <= near + far && token.dataset.label) {
          const room = length - 4 * TOKEN_AIR - arrow;
          token.style.maxWidth = `${Math.max(TOKEN_LEAST, room)}px`;
          near = clear(0, Math.min(2, length));
          far = clear(length, Math.max(length - 2, 0)) + arrow;
        }

        const roomy = length > near + far;
        const first = roomy ? near : length / 2;
        const last = roomy ? length - far : length / 2;

        const place = (progress: number) => {
          const along = options.reverse ? 1 - progress : progress;
          const matrix = path.getScreenCTM();
          const point = path.getPointAtLength(first + along * (last - first));
          const screen = matrix ? point.matrixTransform(matrix) : point;
          token.style.left = `${screen.x - origin().x}px`;
          token.style.top = `${screen.y - origin().y}px`;
        };

        token.hidden = false;
        uncover(token);

        // Whether the token, where it is now, touches a node.
        const touching = () => {
          const box = stageRect(token.getBoundingClientRect());

          return allNodes.some((node) => {
            const other = stageBox(node);

            return shown(node, other) && hits(box, other);
          });
        };

        // A bent wire whose last stretch is too short for the token would
        // rest it against the node it reaches: it rests further back,
        // around the bend, where it is clear, if anywhere past halfway is.
        let end = 1;

        if ((options.to ?? 1) >= 1 && last > first) {
          const step = 4 / (last - first);

          place(1);

          if (touching())
            for (let at = 1 - step; at >= 0.5; at -= step) {
              place(at);

              if (!touching()) {
                end = at;
                break;
              }
            }
        }

        // At rest, a token hides any wire label it lies over, and its own
        // wire's label when the two read the same. The findings name a label
        // cut short or a node it touches.
        const rest = () => {
          const box = stageRect(token.getBoundingClientRect());
          const said = token.dataset.label?.trim().toLowerCase();

          const covered = edges.flatMap((edge) =>
            edge.label &&
            shown(edge.label, edge.label.getBoundingClientRect()) &&
            (hits(box, stageRect(edge.label.getBoundingClientRect())) ||
              (edge.path === path &&
                !!said &&
                edge.label.textContent?.trim().toLowerCase() === said))
              ? [edge.label]
              : [],
          );

          for (const label of covered) label.dataset.covered = "";
          covering.set(token, covered);

          const text = token.dataset.label;
          const step = wb.frame ? ` on step ${wb.frame.key}` : "";

          // The label is the token's ::after, which scrollWidth counts.
          const short = text
            ? Math.max(0, token.scrollWidth - token.clientWidth)
            : 0;

          if (text && short > 0)
            notes.add(
              `The token “${text}”${step} is cut off on its ${Math.round(path.getTotalLength())}px wire: it needs about ${Math.round(path.getTotalLength() + short)}px. Shorten it, or lengthen the wire.`,
            );

          for (const node of allNodes) {
            const nodeBox = stageBox(node);

            if (shown(node, nodeBox) && hits(box, nodeBox))
              notes.add(
                `The token${text ? ` “${text}”` : ""}${step} rests against ${nameOf(node)}, with no clear place on its wire to stop: lengthen the wire's last straight stretch to about the label's width plus 40px, or shorten the label.`,
              );
          }

          reportFindings();
        };

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
            rest();
            resolve(true);
          };

          // How far along the trip ends.
          const reach = Math.min(Math.max(options.to ?? 1, 0), 1) * end;

          if (options.instant) {
            place(reach);
            finish();

            return;
          }

          if (still) {
            place(reach / 2);
            timer = window.setTimeout(finish, Math.max(duration, 900));

            return;
          }

          const start = performance.now();

          const step = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            place(progress * reach);

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
      selectable(target: Element, item?: Partial<SelectedItem>) {
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
      },
      /**
       * Marks `target`, a node, a wire's path or anything drawn, as a claim
       * about the code, backed by the named entries in the block's `code`.
       * Pass no names for a claim nothing backs yet: the board counts it as
       * unlinked. A wire names its call site; a wire carrying two calls
       * names both. Clicking a linked claim opens its code beside the stage.
       */
      code(target: Element, names: string | string[] = [], label?: string) {
        const list = [names].flat();
        target.setAttribute("data-wb-claim", JSON.stringify(list));
        target.toggleAttribute("data-wb-linked", list.length > 0);

        if (label) target.setAttribute("data-wb-claim-label", label);

        // A linked claim takes focus, so the keyboard reaches its code.
        if (list.length) {
          target.setAttribute("tabindex", "0");
          target.setAttribute("role", "button");
          target.setAttribute(
            "aria-label",
            `${labelOf(target)}: open its code`,
          );
        } else
          for (const name of ["tabindex", "role", "aria-label"])
            target.removeAttribute(name);

        for (const name of list)
          if (!init.code.includes(name))
            notes.add(
              `"${labelOf(target)}" names code "${name}", which the diagram's code does not define.`,
            );

        queueClaims();
      },
    } satisfies Reference.Wb;

    // Errors. Whatever stops the script, or throws later, goes to the host,
    // which shows it under the diagram and to the agent that wrote it.
    const fail = (message: string) =>
      send({ type: "error", message: message.slice(0, 2000) });

    // An error's name and message, or what was thrown, as text.
    const describe = (thrown: Error | string | null | undefined) =>
      thrown instanceof Error
        ? `${thrown.name}: ${thrown.message}`
        : String(thrown ?? "Unknown error");

    addEventListener("error", (event) => {
      const where = event.lineno ? ` (diagram.js line ${event.lineno})` : "";
      fail(`${describe(event.error ?? event.message)}${where}`);
    });
    addEventListener("unhandledrejection", (event) =>
      fail(describe(event.reason)),
    );

    // Libraries come from the host on first use: the stage has no network.
    // Each UMD build defines its global (ELK, Plot) when it runs.
    const waiting = new Map<
      StageLibrary,
      { resolve(): void; reject(error: Error): void }
    >();

    const loaded = new Map<StageLibrary, Promise<void>>();

    function library(name: StageLibrary): Promise<void> {
      let promise = loaded.get(name);

      if (!promise) {
        promise = new Promise<void>((resolve, reject) => {
          waiting.set(name, { resolve, reject });
          send({ type: "library", name });
        });
        loaded.set(name, promise);
      }

      return promise;
    }

    const runLibrary = (name: StageLibrary, source: string) => {
      const wait = waiting.get(name);

      if (!wait) return;
      waiting.delete(name);

      const blob = (text: string) =>
        URL.createObjectURL(new Blob([text], { type: "text/javascript" }));

      const script = document.createElement("script");

      if (name === "three") {
        // three.js is an ES module that imports its core: each loads from a
        // blob, the module pointed at the core's, and a last module puts
        // the whole on window. The host joins them with THREE_SPLIT from
        // stage-protocol, written out here since this runs from its source.
        const [core = "", module = ""] = source.split(
          "\n/*wb:three.module*/\n",
        );

        const main = blob(
          module.replaceAll("'./three.core.js'", JSON.stringify(blob(core))),
        );

        script.type = "module";
        script.src = blob(
          `import * as THREE from ${JSON.stringify(main)}; window.THREE = THREE;`,
        );
      } else script.src = blob(source);

      script.onload = () => wait.resolve();
      script.onerror = () =>
        wait.reject(new Error(`The ${name} library could not load.`));
      document.head.append(script);
    };

    // Size. The stage holds the page, plus the inset on every side. The
    // mount takes the drawing's size: what layout measured or how far what
    // the script drew reaches, whichever is more, and at least the size
    // block.json gives, so nothing drawn is ever cut off. The page around it
    // lays out as any page does.
    let drawing: { width: number; height: number } | null = null;

    // A chart placed by the stage: the gap above it, its width without a
    // column to fill, and its height.
    const CHART_GAP = 24;
    const CHART_WIDTH = 688;
    const CHART_HEIGHT = 240;

    // How far what the script drew reaches: nodes, groups, wires and
    // charts. Tokens come and go, and what is fixed to the stage's window is
    // as big as the stage already.
    const extent = () => {
      let width = 0;
      let height = 0;

      for (const element of mount?.children ?? []) {
        if (
          !(element instanceof HTMLElement || element instanceof SVGElement) ||
          (element instanceof HTMLElement && element.hidden) ||
          element.classList.contains("wb-token") ||
          getComputedStyle(element).position === "fixed"
        )
          continue;
        const box = stageRect(element.getBoundingClientRect());
        width = Math.max(width, box.right);
        height = Math.max(height, box.bottom);
      }

      return { width, height };
    };

    // How big the page draws: diagram.html with what it places with
    // position: absolute, and anything the script added to the body itself.
    const pageReach = () => {
      const body = document.body.getBoundingClientRect();
      let width = 0;
      let height = 0;

      for (const element of document.body.children) {
        if (
          !(element instanceof HTMLElement || element instanceof SVGElement) ||
          (element instanceof HTMLElement && element.hidden) ||
          getComputedStyle(element).position === "fixed"
        )
          continue;
        const rect = element.getBoundingClientRect();

        const [wide, tall] =
          element === markup
            ? [
                Math.max(markup.offsetWidth, markup.scrollWidth),
                Math.max(markup.offsetHeight, markup.scrollHeight),
              ]
            : [rect.width, rect.height];

        width = Math.max(width, rect.left - body.left + wide);
        height = Math.max(height, rect.top - body.top + tall);
      }

      return { width, height };
    };

    function reportSize() {
      const given = diagram.size;

      if (mount) {
        const drawn = extent();

        const width = Math.ceil(
          Math.max(drawing?.width ?? 0, drawn.width, given?.width ?? 0),
        );

        const height = Math.ceil(
          Math.max(drawing?.height ?? 0, drawn.height, given?.height ?? 0),
        );

        // A box of its own size, as an image is: a flex row or grid track
        // holding it cannot squeeze it.
        Object.assign(mount.style, {
          width: `${width}px`,
          height: `${height}px`,
          minWidth: `${width}px`,
          minHeight: `${height}px`,
          flexShrink: "0",
        });
      }

      const reach = pageReach();
      const room = diagram.room - 2 * diagram.inset;

      const box = {
        width: Math.max(reach.width, mount ? 0 : (given?.width ?? 0)),
        height: Math.max(reach.height, mount ? 0 : (given?.height ?? 0)),
      };

      const limit = (value: number) =>
        Math.min(4000, Math.ceil(Math.max(0, value) + 2 * diagram.inset));

      // Wider than the board's column, the stage scrolls sideways: say what
      // reaches furthest, and how far over it is.
      if (room > 0 && box.width > room + 1) {
        const reaching = [
          ...allNodes.map((node) => ({ name: nameOf(node), element: node })),
          ...allGroups.map((group) => ({
            name: `the group ${nameOf(group)}`,
            element: group,
          })),
          ...[...document.querySelectorAll<HTMLElement>(".wb-chart")].map(
            (chart) => ({
              name: `the chart "${chart.getAttribute("data-wb-label") ?? ""}"`,
              element: chart,
            }),
          ),
        ].flatMap(({ name, element }) => {
          const edge = stageBox(element);

          return shown(element, edge) ? [{ name, right: edge.right }] : [];
        });

        const furthest = reaching.toSorted((a, b) => b.right - a.right)[0];
        const over = Math.ceil(box.width - room);

        // Where the drawing starts in the page: 0 unless diagram.html puts
        // something to its left.
        const offset = mount
          ? Math.round(
              mount.getBoundingClientRect().left -
                document.body.getBoundingClientRect().left,
            )
          : 0;

        const into =
          offset > 0
            ? `, and the drawing starts ${offset}px into the page`
            : "";

        notes.add(
          furthest && furthest.right + offset > room
            ? `The diagram is ${Math.ceil(box.width)}px wide, but the board's column holds ${Math.floor(room)}px, so the reader scrolls sideways. ${furthest.name[0]!.toUpperCase()}${furthest.name.slice(1)} reaches furthest, to x = ${Math.round(furthest.right)}, a group's padding included${into}: move it ${over}px left, or narrow what is across.`
            : `The page is ${Math.ceil(reach.width)}px wide, but the board's column holds ${Math.floor(room)}px, so the reader scrolls sideways: narrow diagram.html's layout to ${Math.floor(room)}px, or put what sits beside the drawing under it.`,
        );
        reportFindings();
      }

      // The body narrows to the page and centres.
      document.body.style.width = `${Math.ceil(Math.max(0, box.width))}px`;

      send({
        type: "size",
        width: limit(box.width),
        height: limit(box.height),
      });
    }

    // Moves. A frame's movements play by themselves: a token rides each wire
    // once. What the step's moves touch lights up, the rest of the request's
    // path stays plain, and what it never touches dims. `wb.moves.manual()` hands all of it to the
    // script.
    let manual = false;
    let trip: AbortController | null = null;
    const cleanups = new Set<() => void>();

    const usesMoves = () => frames.some((frame) => frame.moves?.length);

    // The wire a move rides: the one it names, or else the one between its
    // nodes that runs its way, or else one that runs back.
    const wireBetween = (from: string, to: string, id?: string) => {
      const start = nodesById.get(from);
      const end = nodesById.get(to);
      const named = id === undefined ? undefined : edgesById.get(id);

      if (named && named.from === start && named.to === end)
        return { edge: named, reverse: false };

      if (named && named.from === end && named.to === start)
        return { edge: named, reverse: true };

      if (id !== undefined) return null;

      const forward = edges.find(
        (edge) => edge.from === start && edge.to === end,
      );

      if (forward) return { edge: forward, reverse: false };
      const back = edges.find((edge) => edge.from === end && edge.to === start);

      return back ? { edge: back, reverse: true } : null;
    };

    const movesOf = (frame: Frame | null | undefined) => frame?.moves ?? [];

    const light = () => {
      const path = pathOf();
      const all = path.flatMap(movesOf);

      const reset = () => {
        for (const element of [...allNodes, ...allGroups])
          element.dataset.state = "default";

        for (const edge of edges) edge.path.dataset.state = "default";
      };

      if (!all.length) return reset();

      // Only this step's moves light; earlier steps go back to plain.
      const step = movesOf(path[wb.frameIndex]);
      const touched = new Set(all.flatMap((move) => [move.from, move.to]));
      const reached = new Set(step.flatMap((move) => [move.from, move.to]));

      const element = (id: string) => nodesById.get(id);

      const touchedNodes = new Set(
        [...touched].flatMap((id) => element(id) ?? []),
      );

      const reachedNodes = new Set(
        [...reached].flatMap((id) => element(id) ?? []),
      );

      const grouped = new Set(
        allGroups.flatMap((group) => groupNodes.get(group) ?? []),
      );

      const used = new Set(
        step.flatMap(
          (move) => wireBetween(move.from, move.to, move.edge)?.edge ?? [],
        ),
      );

      const ours = new Set(
        all.flatMap(
          (move) => wireBetween(move.from, move.to, move.edge)?.edge ?? [],
        ),
      );

      for (const node of allNodes)
        node.dataset.state = reachedNodes.has(node)
          ? "active"
          : touchedNodes.has(node) || grouped.has(node)
            ? "default"
            : "dimmed";

      for (const group of allGroups) {
        const lit = (groupNodes.get(group) ?? []).some((node) =>
          touchedNodes.has(node),
        );

        group.dataset.state = group.hasAttribute("data-boundary")
          ? "default"
          : lit
            ? "active"
            : "dimmed";
      }

      for (const edge of edges)
        edge.path.dataset.state = used.has(edge)
          ? "active"
          : ours.has(edge)
            ? "default"
            : "dimmed";
    };

    const pause = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });

    // One move: its token rides the wire once and rests just short of the
    // far end, where the reader can read it. The reader replays the step to see it
    // again. Resolves when the trip is done, so the step can settle.
    const riding = new Map<Edge, HTMLElement>();

    const move = async (
      step: StageMove,
      signal: AbortSignal,
      instant: boolean,
    ) => {
      const wire = wireBetween(step.from, step.to, step.edge);

      if (!wire) return;

      const token = wb.token({
        label: step.label,
        tone:
          step.failed || step.lost
            ? "error"
            : (step.reply ?? wire.reverse)
              ? "reply"
              : "request",
      });

      signal.addEventListener(
        "abort",
        () => {
          uncover(token);
          token.remove();
        },
        { once: true },
      );

      // A jump to the step shows where its moves end, at once and in order.
      if (!instant) await pause(step.delay ?? 0, signal);

      if (signal.aborted) return;

      // A later trip on the same wire, such as the reply to a request, takes
      // over from the token resting there, so the two never stack.
      const before = riding.get(wire.edge);

      if (before) {
        uncover(before);
        before.hidden = true;
      }

      riding.set(wire.edge, token);

      // A message that never arrives stops halfway and fades there.
      if (step.lost) token.dataset.lost = "";

      await wb.travel(token, wire.edge.path, {
        reverse: wire.reverse,
        signal,
        instant,
        to: step.lost ? 0.5 : 1,
      });
    };

    const playMoves = async (frame: Frame | null, instant: boolean) => {
      trip?.abort();
      trip = new AbortController();

      if (manual || !usesMoves()) return;

      const steps = movesOf(frame);

      if (!steps.length) return;
      // Moves that wait start after those that do not, so on a jump the
      // reply still takes over from its request.
      const ordered = steps.toSorted((a, b) => (a.delay ?? 0) - (b.delay ?? 0));

      await Promise.all(
        ordered.map((step) => move(step, trip!.signal, instant)),
      );
    };

    // The ids of the wires that join two nodes, for a move that names one
    // that does not.
    const joining = (from: string, to: string) => {
      const ends = new Set([nodesById.get(from), nodesById.get(to)]);

      const ids = [...edgesById].flatMap(([id, edge]) =>
        ends.has(edge.from) && ends.has(edge.to) && ends.size === 2
          ? [`"${id}"`]
          : [],
      );

      return ids.length ? `; the wires that do are ${ids.join(", ")}` : "";
    };

    // Every move must ride a wire: say which do not.
    const checkMoves = () => {
      for (const frame of frames)
        for (const step of movesOf(frame)) {
          const missing = [step.from, step.to].filter(
            (id) => !nodesById.has(id),
          );

          if (missing.length)
            notes.add(
              `Frame ${frame.key} moves ${step.from} → ${step.to}, but no node has the id ${missing.join(" or ")}.`,
            );
          else if (!wireBetween(step.from, step.to, step.edge))
            notes.add(
              step.edge === undefined
                ? `Frame ${frame.key} moves ${step.from} → ${step.to}, but no wire joins them.`
                : `Frame ${frame.key} moves ${step.from} → ${step.to} along "${step.edge}", but no wire with that id joins them${joining(step.from, step.to)}.`,
            );
        }
    };

    // Frames. The host says which frame shows; the script hears it through
    // `wb.onFrame` and the moves play. The stage tells the host once the
    // first trip of every move is done.
    let ready = false;
    let frameIndex = init.frame;
    let heard = init.frame;
    let lit = false;

    // The page: diagram.html, as wide as it draws unless its own styles say
    // otherwise, or the mount alone without it. What it places with
    // position: absolute is placed from its corner and counts toward the
    // stage's size.
    const markup = document.createElement("div");
    markup.className = "wb-html";
    markup.innerHTML = diagram.html ?? "<div data-wb-drawing></div>";

    // Rules that name the document reach nothing once scoped to the page,
    // and rules for wb's own elements stop at the mount: say so.
    const strayRules: string[] = [];

    // diagram.html's styles reach the page and the mount itself, never what
    // wb draws inside it, so a bare `div { padding }` cannot resize a node.
    // Keyframes, fonts and registered properties stay global, as @scope
    // cannot hold them.
    for (const style of markup.querySelectorAll("style")) {
      const sheet = new CSSStyleSheet();

      try {
        sheet.replaceSync(style.textContent ?? "");
      } catch {
        continue;
      }

      const global: string[] = [];
      const scoped: string[] = [];

      for (const rule of sheet.cssRules) {
        const keep =
          rule instanceof CSSKeyframesRule ||
          rule instanceof CSSFontFaceRule ||
          rule instanceof CSSPropertyRule;

        (keep ? global : scoped).push(rule.cssText);

        if (
          rule instanceof CSSStyleRule &&
          /(^|[\s,>+~(])(html|body)\b|:root|\.wb-(node|group|edge|token|chart)/.test(
            rule.selectorText,
          )
        )
          strayRules.push(rule.selectorText);
      }

      style.textContent = `${global.join("\n")}\n@scope (.wb-html) to ([data-wb-drawing] > *) {\n${scoped.join("\n")}\n}`;
    }

    const mounts = [
      ...markup.querySelectorAll<HTMLElement>("[data-wb-drawing]"),
    ];

    mount = mounts[0] ?? null;

    if (mount) mount.style.position = "relative";

    // Anything marked data-wb-from shows from that frame on, data-wb-until
    // up to that frame, and data-wb-only on the frames it lists alone,
    // whether diagram.html or the script drew it; an element with several
    // shows where all of them hold. From and until follow the scenario
    // showing: a from frame it skips never comes, and an until frame it
    // skips never ends it. What hides gives up its room once it has faded
    // out, and the stage takes the new size. Without frames, all of it shows.
    const stepped = "[data-wb-from], [data-wb-until], [data-wb-only]";

    const markupStyles = document.createElement("style");
    markupStyles.textContent = `
    .wb-html { position: relative; width: max-content; max-width: 4000px; }
    :is(${stepped}) {
      transition: opacity 240ms ease, translate 240ms ease, display 240ms allow-discrete;
    }
    [data-wb-hidden] { display: none !important; opacity: 0; translate: 0 4px; }
    @starting-style {
      :is(${stepped}):not([data-wb-hidden]) { opacity: 0; translate: 0 4px; }
    }
    .wb-instant :is(${stepped}) { transition: none; }
    @media (prefers-reduced-motion: reduce) {
      :is(${stepped}) { transition: none; }
      [data-wb-hidden] { translate: none; }
    }
  `;
    document.head.append(markupStyles);

    const keysOf = (element: HTMLElement) => ({
      from: element.dataset.wbFrom?.trim(),
      until: element.dataset.wbUntil?.trim(),
      only: element.dataset.wbOnly?.split(/\s+/).filter(Boolean),
    });

    // The frame orders a reader can step through: each scenario's, or the
    // frames as declared.
    const orders = diagram.scenarios.length
      ? diagram.scenarios.map((scenario) => scenario.frames)
      : [frames.map((frame) => frame.key)];

    // A key no frame has, or a range that ends before it starts, never
    // shows: say which.
    const checkMarkup = () => {
      const declared = new Set(frames.map((frame) => frame.key));

      for (const element of document.body.querySelectorAll<HTMLElement>(
        stepped,
      )) {
        const { from, until, only } = keysOf(element);

        const named = [
          ...(from === undefined ? [] : [["data-wb-from", from] as const]),
          ...(until === undefined ? [] : [["data-wb-until", until] as const]),
          ...(only ?? []).map((key) => ["data-wb-only", key] as const),
        ];

        for (const [attribute, key] of named)
          if (!frames.length)
            notes.add(
              `An element has ${attribute}, but the diagram has no frames: give it frames.json, or drop the attribute.`,
            );
          else if (!declared.has(key))
            notes.add(
              `An element has ${attribute}="${key}", but no frame has the key ${key}.`,
            );

        if (
          from !== undefined &&
          until !== undefined &&
          orders.some(
            (order) =>
              order.includes(from) &&
              order.includes(until) &&
              order.indexOf(until) < order.indexOf(from),
          )
        )
          notes.add(
            `An element shows from ${from} until ${until}, but ${until} comes first, so it never shows.`,
          );
      }

      if (mounts.length > 1)
        notes.add(
          `diagram.html has ${mounts.length} elements with data-wb-drawing, but a diagram draws in one: wb draws in the first. Keep one.`,
        );

      for (const selector of strayRules)
        notes.add(
          `diagram.html's styles reach the page alone, so the rule "${selector}" styles nothing: use :scope for the page itself, and wb's options for what it draws.`,
        );
    };

    const showMarkup = (frame: Frame | null, instant: boolean) => {
      const path = pathOf().map((item) => item.key);
      const at = frame ? path.indexOf(frame.key) : -1;
      const root = document.documentElement;

      if (instant) root.classList.add("wb-instant");

      for (const element of document.body.querySelectorAll<HTMLElement>(
        stepped,
      )) {
        const { from, until, only } = keysOf(element);

        const shown =
          !frames.length ||
          ((from === undefined ||
            (path.includes(from) && at >= path.indexOf(from))) &&
            (until === undefined ||
              !path.includes(until) ||
              at <= path.indexOf(until)) &&
            (only === undefined || (!!frame && only.includes(frame.key))));

        element.toggleAttribute("data-wb-hidden", !shown);
        element.inert = !shown;
      }

      // Transitions come back once the jump has been drawn without them.
      if (instant)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => root.classList.remove("wb-instant")),
        );
    };

    const showFrame = async (index: number, instant: boolean) => {
      frameIndex = index;

      if (!ready) return;
      const frame = frames[index] ?? null;

      showMarkup(frame, instant);

      // The moves light a step once, as it comes, and before `wb.onFrame`
      // hears it, so a script's own states win, such as on a step with no
      // moves; showing the same step again keeps them.
      const fresh = heard !== index || !lit;
      lit = true;

      if (heard !== index) {
        heard = index;

        const position = frame
          ? pathOf().findIndex((item) => item.key === frame.key)
          : -1;

        const change = {
          index: position,
          previous: wb.frame,
          previousIndex: wb.frameIndex,
        };

        wb.frame = frame;
        wb.frameIndex = position;

        if (usesMoves() && !manual) light();
        unheard.clear();
        notify(frameListeners, frame, change);
      } else if (fresh && usesMoves() && !manual) light();

      hearFirst();

      await playMoves(frame, instant);

      if (frameIndex === index) send({ type: "settled", index });
    };

    // A new scenario starts clean: trips stop, tokens go, every state resets
    // and the script undoes what it started.
    const reset = () => {
      trip?.abort();

      for (const token of document.querySelectorAll(".wb-token")) {
        uncover(token);
        token.remove();
      }

      for (const cleanup of cleanups)
        try {
          cleanup();
        } catch (error) {
          console.error(error);
        }

      if (usesMoves() && !manual) light();
    };

    const pickSequence = (keys: string[]) => {
      sequence = keys;
      reset();
      wb.scenario = scenarioFor(keys);
      heard = -1;
      notify(scenarioListeners, wb.scenario);
    };

    // A played diagram: the stage owns the playhead, as a clip's does.
    const starts = chapters.reduce<number[]>(
      (list, chapter, index) => [
        ...list,
        index ? list[index - 1]! + chapters[index - 1]!.duration : 0,
      ],
      [],
    );

    let playing = false;
    let tick = 0;
    let lastKey: string | undefined;

    const setTime = (time: number, announce = false) => {
      wb.time = time;
      const moment = momentAt(time);
      notify(timeListeners, time, moment);
      send({ type: "time", at: time, playing });
      const key = moment.chapter?.key;

      if (key && (announce || key !== lastKey)) {
        lastKey = key;
        send({ type: "marker", key });
      }
    };

    const run = (from: number) => {
      const began = performance.now();

      const step = (now: number) => {
        if (!playing) return;
        const time = Math.min(duration, from + now - began);
        setTime(time);

        if (time >= duration) {
          playing = false;
          send({ type: "time", at: time, playing });
          send({ type: "ended" });

          return;
        }

        tick = requestAnimationFrame(step);
      };

      tick = requestAnimationFrame(step);
    };

    const play = () => {
      if (playing || !chapters.length) return;
      playing = true;
      run(wb.time >= duration ? 0 : wb.time);
    };

    const stop = () => {
      playing = false;
      cancelAnimationFrame(tick);
      send({ type: "time", at: wb.time, playing });
    };

    const seek = (key: string) => {
      const index = chapters.findIndex((chapter) => chapter.key === key);

      if (index < 0) return;
      const wasPlaying = playing;
      cancelAnimationFrame(tick);
      setTime(starts[index]!, true);

      if (wasPlaying) run(starts[index]!);
    };

    // The reader dragged the playhead: show that moment, still playing if it
    // was.
    const scrub = (at: number) => {
      if (!chapters.length) return;
      const time = Math.min(Math.max(at, 0), duration);
      const wasPlaying = playing;
      cancelAnimationFrame(tick);
      setTime(time);

      if (wasPlaying && time < duration) run(time);
      else if (wasPlaying) stop();
    };

    // Paint. A diagram from the agent's stream stays unseen until the board
    // reaches it, then fades in.
    if (init.paint) document.documentElement.style.opacity = "0";

    // It reports painted once the fade has ended on screen, not on a timer:
    // a stage scrolled out of view does not advance its fade, and a render
    // that trusted a timer would capture it still faint.
    const paint = () => {
      const root = document.documentElement;

      if (getComputedStyle(root).opacity === "1") {
        send({ type: "painted" });

        return;
      }

      // Transitions inside the stage end too and bubble here, a node's
      // dimming or a step's fade: wait for the root's own.
      const ended = (event: Event) => {
        if (event.target !== root) return;
        root.removeEventListener("transitionend", ended);
        root.removeEventListener("transitioncancel", ended);
        send({ type: "painted" });
      };

      root.addEventListener("transitionend", ended);
      root.addEventListener("transitioncancel", ended);
      root.style.transition = "opacity 300ms ease-out";
      root.style.opacity = "1";
    };

    // Keys. Enter or Space on a linked claim opens its code; the arrows step
    // and Escape leaves full screen wherever focus is in the stage.
    addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? event.target : null;

      if (
        (event.key === "Enter" || event.key === " ") &&
        target?.hasAttribute("data-wb-linked")
      ) {
        event.preventDefault();
        reveal(target);
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        if (chapters.length) return;
        event.preventDefault();
        send({ type: "step", delta: event.key === "ArrowRight" ? 1 : -1 });
      } else if (event.key === "Escape") send({ type: "escape" });
    });

    port.onmessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data;

      switch (message.type) {
        case "frame":
          void showFrame(message.index, message.instant);
          break;
        case "sequence":
          pickSequence(message.keys);
          break;
        case "theme":
          boardTheme = message.theme;
          scheme = message.colorScheme;
          applyTheme();
          notify(themeListeners, scheme, colorsOf(scheme));
          break;
        case "library":
          runLibrary(message.name, message.source);
          break;
        case "paint":
          paint();
          break;
        case "replay":
          // The step's moves again, from the start, without a new frame.
          if (ready) void playMoves(frames[frameIndex] ?? null, false);
          break;
        case "play":
          play();
          break;
        case "pause":
          stop();
          break;
        case "seek":
          seek(message.marker);
          break;
        case "scrub":
          scrub(message.at);
          break;
      }
    };

    Object.assign(globalThis, {
      wb,
      // The script ends by calling this, after any top-level await.
      __wbDone() {
        ready = true;
        checkMoves();
        checkMarkup();
        reportSize();
        reportClaims();
        reportFindings();
        send({ type: "ready" });

        if (chapters.length) {
          send({
            type: "clip",
            duration,
            markers: chapters.map((chapter, index) => ({
              key: chapter.key,
              at: starts[index]!,
            })),
          });
          setTime(0, true);
          hearFirst();
        } else void showFrame(frameIndex, true);
      },
    });

    // The page goes in first, so the script finds its markup and the mount.
    document.body.append(markup);

    // Markup that shows or hides by frame, or that the script changes,
    // resizes the stage. Its top-level elements are watched too: one placed
    // with position: absolute changes size without the wrapper doing so.
    const resized = new ResizeObserver(() => {
      if (ready) reportSize();
    });

    for (const element of new Set([markup, ...markup.children, ...mounts]))
      resized.observe(element);

    // The script runs as a module from a blob, so it may use top-level await
    // and its line numbers match diagram.js.
    const script = document.createElement("script");
    script.type = "module";
    script.src = URL.createObjectURL(
      new Blob([`${diagram.script ?? ""}\n;globalThis.__wbDone();\n`], {
        type: "text/javascript",
      }),
    );
    document.head.append(script);
  }
}
