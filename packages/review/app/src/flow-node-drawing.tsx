import { space } from "@canvas/scale.stylex";
import type { FlowNodeKind } from "@dev.fast/whiteboard-document";
import * as stylex from "@stylexjs/stylex";

import { flowNodeMarker } from "./markers.stylex";
import { tokens } from "./tokens.stylex";

/**
 * What each flow node kind draws, so a reader tells a database from a
 * service from a third-party API before reading a label. The silhouette
 * leads; the stroke colour only groups the data kinds. The same geometry
 * draws the node at full size and the legend's glyph at a fraction of it.
 *
 * - process: a rounded box (the default)
 * - decision: a box with its corners cut, the diamond's cousin
 * - terminal: a pill
 * - client: a window, with a title bar under its top edge
 * - service: a box with a rule inside each side, the subroutine shape
 * - external: a rounded box drawn dashed (styled by the caller)
 * - database: a cylinder standing up, its lid an ellipse
 * - queue: a box with two more stacked behind it
 * - cache: a cylinder lying down, its lid on the left
 */
export interface FlowNodeDrawing {
  /** The closed outline, filled and traced clockwise from its top left. */
  outline: string;
  /** Open strokes inside the outline: a lid, a title bar, side rules. */
  details: string[];
  /** Outlines drawn behind the node, back to front. */
  echoes: string[];
}

export function flowNodeDrawing(
  kind: FlowNodeKind | undefined,
  width: number,
  height: number,
  scale = 1,
): FlowNodeDrawing {
  // Half a stroke in, as the rect was, so a 1px outline sits on whole pixels.
  const l = 0.5;
  const t = 0.5;
  const r = width - 0.5;
  const b = height - 0.5;
  const corner = 6 * scale;

  const rounded = (radius: number, offset = 0) => {
    const x0 = l + offset;
    const y0 = t + offset;
    const x1 = r + offset;
    const y1 = b + offset;
    const arc = `A${radius},${radius} 0 0 1`;

    return `M${x0 + radius},${y0} H${x1 - radius} ${arc} ${x1},${y0 + radius} V${y1 - radius} ${arc} ${x1 - radius},${y1} H${x0 + radius} ${arc} ${x0},${y1 - radius} V${y0 + radius} ${arc} ${x0 + radius},${y0} Z`;
  };

  switch (kind) {
    case "decision": {
      const cut = 12 * scale;

      return {
        outline: `M${l + cut},${t} H${r - cut} L${r},${t + cut} V${b - cut} L${r - cut},${b} H${l + cut} L${l},${b - cut} V${t + cut} Z`,
        details: [],
        echoes: [],
      };
    }

    case "terminal":
      return { outline: rounded((b - t) / 2), details: [], echoes: [] };

    case "client": {
      const bar = t + 9 * scale;

      return {
        outline: rounded(corner),
        details: [`M${l},${bar} H${r}`],
        echoes: [],
      };
    }

    case "service": {
      const rule = 7 * scale;

      return {
        outline: rounded(corner),
        details: [`M${l + rule},${t} V${b}`, `M${r - rule},${t} V${b}`],
        echoes: [],
      };
    }

    case "database": {
      const rx = (r - l) / 2;
      const ry = DATABASE_LID * scale;

      return {
        outline: `M${l},${t + ry} A${rx},${ry} 0 0 1 ${r},${t + ry} V${b - ry} A${rx},${ry} 0 0 1 ${l},${b - ry} Z`,
        details: [`M${l},${t + ry} A${rx},${ry} 0 0 0 ${r},${t + ry}`],
        echoes: [],
      };
    }

    case "cache": {
      const rx = CACHE_LID * scale;
      const ry = (b - t) / 2;

      return {
        outline: `M${l + rx},${t} H${r - rx} A${rx},${ry} 0 0 1 ${r - rx},${b} H${l + rx} A${rx},${ry} 0 0 1 ${l + rx},${t} Z`,
        details: [`M${l + rx},${t} A${rx},${ry} 0 0 0 ${l + rx},${b}`],
        echoes: [],
      };
    }

    case "queue": {
      const step = QUEUE_STEP * scale;

      return {
        outline: rounded(corner),
        details: [],
        echoes: [rounded(corner, step * 2), rounded(corner, step)],
      };
    }

    case "external":
    case "process":
    case undefined:
      return { outline: rounded(corner), details: [], echoes: [] };
  }
}

/** The database lid's half-height; the node grows by the lid. */
export const DATABASE_LID = 7;

/** The cache lid's half-width; the label starts after it. */
export const CACHE_LID = 8;

/** How far each box behind a queue steps down and right. */
const QUEUE_STEP = 5;

export const FLOW_KIND_LABELS: Record<FlowNodeKind, string> = {
  process: "Process",
  decision: "Decision",
  terminal: "Start / end",
  client: "Client",
  service: "Service",
  external: "External",
  database: "Database",
  queue: "Queue",
  cache: "Cache",
};

/** The kind's drawing at legend size, beside its label. */
export function FlowKindGlyph({ kind }: { kind: FlowNodeKind }) {
  const drawing = flowNodeDrawing(kind, GLYPH.width, GLYPH.height, GLYPH.scale);

  return (
    <svg
      {...stylex.props(glyphStyles.svg)}
      viewBox={`0 0 ${GLYPH.width + GLYPH.slack} ${GLYPH.height + GLYPH.slack}`}
      width={GLYPH.width + GLYPH.slack}
      height={GLYPH.height + GLYPH.slack}
      aria-hidden="true"
    >
      {drawing.echoes.map((d) => (
        <path key={d} {...stylex.props(glyphStyles.stroke)} d={d} />
      ))}
      <path
        {...stylex.props(
          glyphStyles.stroke,
          kindStrokes[kind],
          kind === "external" && glyphStyles.dashed,
        )}
        d={drawing.outline}
      />
      {drawing.details.map((d) => (
        <path
          key={d}
          {...stylex.props(
            glyphStyles.stroke,
            kindStrokes[kind],
            glyphStyles.detail,
          )}
          d={d}
        />
      ))}
    </svg>
  );
}

// A queue's stack reaches 4px past the box; every glyph leaves room for it
// so the labels line up.
const GLYPH = { width: 20, height: 13, scale: 0.4, slack: 4 };

const inFocusedNode = () =>
  stylex.when.ancestor(":focus-visible", flowNodeMarker);

/**
 * Compute kinds keep the default stroke; data kinds (database, queue,
 * cache) take the storage colour the software map gives its stores. Every
 * stroke yields to the node's focus ring, as the change outlines do.
 */
export const kindStrokes = stylex.create({
  process: {},
  decision: {},
  terminal: {},
  client: {},
  service: {},
  external: {},
  database: {
    stroke: {
      default: tokens.mapStorageBorder,
      [inFocusedNode()]: tokens.accent,
    },
  },
  queue: {
    stroke: {
      default: tokens.mapStorageBorder,
      [inFocusedNode()]: tokens.accent,
    },
  },
  cache: {
    stroke: {
      default: tokens.mapStorageBorder,
      [inFocusedNode()]: tokens.accent,
    },
  },
});

const glyphStyles = stylex.create({
  svg: {
    flex: "0 0 auto",
    marginRight: space.s4,
  },
  stroke: {
    fill: tokens.surface,
    stroke: tokens.inkMuted,
    strokeWidth: 1,
  },
  detail: {
    fill: "none",
  },
  dashed: {
    strokeDasharray: "3 2",
  },
});
