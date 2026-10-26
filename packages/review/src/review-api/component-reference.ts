/** The animation component, shown only while Animations are on. */
const ANIMATION = [
  '- animation {title, html, frames: {key, title, label?, caption?, duration? (ms)}[] (1 to 60), code?: {name: anchor}, height?: "auto" (default) | number (120 to 1200 CSS px), pins?}; declare every possible frame',
  'Use an animation for change over time that a static diagram cannot show: state before and after, a cache filling, data changing as a request crosses layers. It can sit in design beside the diagram, or replace it when the motion is the point. If nothing changes between frames, use a sequence or flow_diagram instead: their steps and nodes link to code. Read session_get_instructions({topic:"animation"}) before writing one.',
];

/** Every component's fields, for session_get_instructions: the edit tool's
 * description must stay short enough that clients don't cut it off. */
export const COMPONENT_REFERENCE = [
  "## Components",
  "",
  "session_edit's content is one component, named by its type. Fields, with ? for optional and anchor for a source anchor string:",
  "",
  "- markdown {markdown, pins?}",
  "- code {text, language?, caption?}",
  "- divider {}",
  "- code_peek {source: anchor, caption?, pins?}",
  "- section {title, children: component[], defaultCollapsed?}",
  "- callout {children: component[], title?, tone?: info|warning|danger|success}",
  "- image {assetId from session_upload, alt, caption?}",
  "- trace_quote {traceId, eventId, text}",
  "- software_map {mapVersionId, focusElementId?}",
  "- sequence {title, actors: {key: label}, steps: step[], pins?}",
  "- step {from, to (actor keys), label, style?: call|return|async, and exactly one of source: anchor or anchor[] (at most 4), explanation, or code: {text, language?}; pins?}",
  "A step's source is the line where its arrow leaves `from` (the call, return or emit). Add an additional range only when that line can't be read without it: the type or schema of what it passes, or the code that builds its argument. Never the callee's body; that is the next step.",
  "- flow_diagram {title, nodes: flow_node[] (1 to 100), edges: flow_edge[], description?, direction?: right|down, pins?}",
  "- flow_node {key, label, description?, kind?: process|decision|terminal, attachments?: {label, sources: anchor[], pins?}[], link?: {from or to, label?, style?}}",
  "- flow_edge {from, to (node keys), label?, style?: solid|dashed}",
  "- call_stack_diff {title, base: frame[], head: frame[], pins?}; either side may be empty",
  "- frame {source: anchor, label?, key?, parentKey? (an earlier frame on that side), callSite?: anchor, contextSources?: anchor[], via?: {kind: call|queue|callback|rpc, reason}, pins?}",
  "- database_lens {title, actors: {key: label}, stores: {key: store}, useCases: useCase[] (1 or more), pins?}",
  "- store {label, storage: relational|document, collections: {key: {label, fields: {key: field}, source?: anchor of its schema declaration}}, dataStoreKind?: database|objectStore|bucket|artifactStore|fileStore}",
  "- field {label, dataType, nullable?, primaryKey?, references?: {store, collection, field}, fields?: {key: field}}",
  "- useCase {label, summary?, operations: operation[] (1 or more)}; operation {kind: read|write, actor, store, collection, label, source: anchor, field?, detail?, pins?}, naming declared keys",
  ...ANIMATION,
  "",
  'Example (replace its path and lines with verified ones): {"type":"sequence","title":"Request","actors":{"a":"Client","b":"Server"},"steps":[{"from":"a","to":"b","label":"Send","source":"head/src/app.ts#L10-L20"}]}',
].join("\n");

/** Keep disabled experimental components out of agent guidance. */
export function componentReference(animationsEnabled: boolean): string {
  return animationsEnabled
    ? COMPONENT_REFERENCE
    : COMPONENT_REFERENCE.split("\n")
        .filter((line) => !ANIMATION.includes(line))
        .join("\n");
}
