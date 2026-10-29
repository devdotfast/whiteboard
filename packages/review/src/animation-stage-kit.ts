// The animation stage's style kit: the CSS every stage loads, and the
// variables the canvas sets on it. The canvas hands the kit to each stage;
// the CLI writes it out as whiteboard.css for agents to read.

/** The canvas properties a stage reads as --wb-<name>. */
export const STAGE_THEME = {
  ink: "--ink",
  "ink-muted": "--ink-muted",
  "ink-faint": "--ink-faint",
  accent: "--accent",
  "accent-soft": "--accent-soft",
  "on-accent": "--on-accent",
  surface: "--surface",
  "surface-raised": "--surface-raised",
  well: "--well",
  rule: "--rule",
  "rule-soft": "--rule-soft",
  added: "--change-added",
  removed: "--change-removed",
  modified: "--change-modified",
  "added-bg": "--diff-added-bg",
  "removed-bg": "--diff-removed-bg",
  "modified-bg": "--diff-modified-bg",
  // Each face by its role: the chrome's for labels, mono for what a
  // terminal would print, the reading face for prose, and the code font.
  "font-sans": "--chrome-font",
  "font-mono": "--font-mono",
  "font-serif": "--font-serif",
  "font-code": "--font-code",
} as const;

/** Every --wb-<name> the stage sets, by group, with what it is for. The
 * canvas's scale steps are checked against these names. */
export const STAGE_VARIABLES: [note: string, names: string[]][] = [
  [
    "Colors, from the reader's light or dark theme",
    [
      "ink",
      "ink-muted",
      "ink-faint",
      "accent",
      "accent-soft",
      "on-accent",
      "surface",
      "surface-raised",
      "well",
      "rule",
      "rule-soft",
      "added",
      "removed",
      "modified",
      "added-bg",
      "removed-bg",
      "modified-bg",
    ],
  ],
  [
    "Faces, by role: sans for labels and controls, mono for ids, paths and values, serif for prose, code for source text. Name no font yourself",
    ["font-sans", "font-mono", "font-serif", "font-code"],
  ],
  [
    "Spacing: a 2px grid to 20, coarser above",
    [
      2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 72, 96,
      120, 160,
    ].map((step) => `space-${step}`),
  ],
  [
    "Type sizes: micro is 10px, body 12px",
    [
      "micro",
      "small",
      "body",
      "ui",
      "title",
      "reading",
      "heading",
      "display",
    ].map((step) => `text-${step}`),
  ],
  [
    "Line heights: unitless steps scale with the font; px steps set a fixed line box",
    [
      "none",
      "tight",
      "normal",
      "relaxed",
      "prose",
      "px14",
      "px16",
      "px18",
      "px20",
      "px22",
      "px24",
      "px26",
      "px28",
      "px32",
    ].map((step) => `leading-${step}`),
  ],
  [
    "Weights",
    ["regular", "medium", "semibold", "bold"].map((step) => `weight-${step}`),
  ],
  [
    "Letter spacing: caps and chrome for uppercase labels",
    ["shortcut", "caps", "chrome", "tight"].map((step) => `tracking-${step}`),
  ],
  [
    "Radii",
    ["hairline", "small", "control", "surface", "pill", "round"].map(
      (step) => `radius-${step}`,
    ),
  ],
  [
    "Motion: durations, then easings. duration (450ms) is the default fade",
    [
      "instant",
      "fast",
      "medium",
      "slow",
      "pulse",
      "spin",
      "ease",
      "enter",
      "settle",
    ]
      .map((step) => `motion-${step}`)
      .concat("duration"),
  ],
];

/** What each kit class is for. */
const CLASSES: [selector: string, use: string][] = [
  [
    ".wb-row, .wb-stack",
    "A centered row or column of parts, with the scene's spacing.",
  ],
  [
    ".wb-grid",
    'A grid of equal columns; set style="--wb-columns: 4" (default 3).',
  ],
  [
    ".wb-layers",
    "Children stacked in one place, for states that replace each other.",
  ],
  [
    ".wb-lane",
    "A position: relative track with a dashed center line, for a static token snapshot.",
  ],
  [
    ".wb-card",
    "A box with a title and note: put .wb-card-title and .wb-card-note inside. The scene's cards are these.",
  ],
  [
    ".wb-node",
    "A centered box for a hand-made layout; a <small> inside is its second line.",
  ],
  [
    ".wb-well",
    "An inset area that groups parts, such as a process or a machine boundary.",
  ],
  [".wb-rule", 'A divider (<hr class="wb-rule">).'],
  [".wb-badge", "A pill for a status or version, e.g. etag e1."],
  [
    ".wb-chip",
    "A chip in a list, such as a queued job or a cached key; .wb-items lays a list of them out.",
  ],
  [".wb-table", "A compact table of rows, such as a schema or a result set."],
  [".wb-title", "A heading inside the stage."],
  [".wb-caps", "An uppercase micro label, like the step strip's."],
  [".wb-prose", "A sentence of explanation, in the board's reading face."],
  [
    ".wb-mono, .wb-code",
    "Ids, paths and values in the mono face; .wb-code is inline code on a well.",
  ],
  [".wb-muted, .wb-faint", "Text that recedes."],
  [
    ".wb-shape, .wb-shape-text",
    "An SVG shape drawn like a card, and the text inside it.",
  ],
];

/** The CSS every stage loads before its own markup. */
export const STAGE_KIT_CSS = `:root { --wb-duration: 450ms; color-scheme: light dark; }
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
.wb-scene-fold { grid-template-columns: repeat(var(--wb-fold), minmax(0, 1fr)) !important; }
.wb-scene-fold > * { grid-column: auto !important; grid-row: auto !important; }
.wb-scene-fold > [data-wb-wide] { grid-column: 1 / -1 !important; }
.wb-scene > [data-wb-state="before"], .wb-scene > [data-wb-state="after"],
.wb-items > [data-wb-state="before"], .wb-items > [data-wb-state="after"],
.wb-table tr[data-wb-state="before"], .wb-table tr[data-wb-state="after"] { display: none; }
.wb-scene-top { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--wb-space-8); margin-bottom: var(--wb-space-4); }
:root[data-wb-instant] *, :root[data-wb-instant] *::before, :root[data-wb-instant] *::after {
  transition: none !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
}`;

/** whiteboard.css: the kit with a guide to its classes and variables, for an
 * agent to read before writing an animation. */
export function stageStyleReference(): string {
  const variables = STAGE_VARIABLES.map(
    ([note, names]) =>
      ` * ${note}:\n *   ${names.map((name) => `--wb-${name}`).join(", ")}`,
  ).join("\n *\n");

  const classes = CLASSES.map(
    ([selector, use]) => ` *   ${selector.padEnd(26)} ${use}`,
  ).join("\n");

  return `/* Whiteboard animations: the CSS every animation loads.
 *
 * Read-only reference. Whiteboard rewrites this file; editing it changes
 * nothing. Build an animation from these classes and variables. Add a <style> in
 * animation.html only for what they do not cover, written with the variables:
 * no literal colors, sizes or font names. data-tone="accent|added|removed|
 * modified|muted" colors any card, node, chip, badge, shape or table row;
 * data-highlight="frameKey ..." rings a card, node or shape in those frames.
 *
 * Classes:
${classes}
 *
 * Variables, set on :root. Colors and faces follow the reader's theme, so
 * this file gives no values for them; use the variable.
 *
${variables}
 */

${STAGE_KIT_CSS}
`;
}
