export {
  type ActivityFocus,
  type ActivityPresence,
  type ActivitySnapshot,
  type ActivitySurface,
  activityBeginSchema,
  activityEndSchema,
  activityUpdateSchema,
  focusSchema,
} from "./activity.js";

export {
  type CallStackDiffBlock,
  call_stack_diff,
} from "./blocks/call_stack_diff.js";

export { animationCode } from "./blocks/animation.js";

export { label } from "./blocks/definition.js";

export type { Definitions } from "./blocks/index.js";

export {
  type FlowDiagramBlock,
  type FlowDiagramNode,
  flowDiagramSchema,
  nodeSources,
} from "./blocks/flow_diagram.js";

export {
  type DiffLens,
  type Lens,
  UNCATEGORIZED_LENS_ID,
  applyLensEdit,
  lensEditSchema,
  lensSchema,
  lensSelections,
  lensTargetsSchema,
} from "./diff-lenses.js";

export {
  type Applied,
  type Block,
  type BlockType,
  type BoardLinkRef,
  type BoardRef,
  type DatabaseActor,
  type DatabaseField,
  type DatabaseLensBlock,
  type DatabaseOperation,
  type DatabaseStore,
  type Edit,
  type EditSummary,
  type Element,
  type Frame,
  type Pins,
  type ReviewTarget,
  type SequenceBlock,
  type Step,
  type Unit,
  type WrittenComponent,
  adoptFlowUnits,
  anchorPins,
  animationCodeId,
  applyEdit,
  assignFreshIds,
  assignMissingIds,
  blockSchema,
  blocks,
  boardLink,
  boardLinks,
  boardRepositoryId,
  canonicalLink,
  checkReferences,
  commitLinkCommits,
  componentReference,
  contentSchema,
  documentAdvice,
  documentSchema,
  editSchema,
  elements,
  explicitPins,
  isUnit,
  pathTargetSchema,
  pinDocumentReferences,
  pinnedRepositoryIds,
  pinsSchema,
  publishedEdits,
  readsAtBoardPins,
  resourceReference,
  resourceReferences,
  respellCommitLinks,
  respellDocumentLinks,
  respellEditLinks,
  respellLinks,
  reviewTargetSchema,
  selectionReferences,
  sourceReferences,
  stepSources,
  summarizeEdit,
  traceQuoteLink,
  writableBlockTypes,
} from "./document.js";

export { ReviewInputError } from "./input-error.js";

export { type LineInterval, unionIntervals } from "./intervals.js";

export {
  type AlignmentRow,
  type DiffSelection,
  type LensSource,
  SELECTION_UNAVAILABLE_REASONS,
  SelectionUnavailableError,
  type SelectionUnavailableReason,
  alignmentRanges,
  anchorSchema,
  anchorSelection,
  comparisonKey,
  formatAnchor,
  parseAnchor,
  rangeAnchor,
  resolveDiffSelection,
  selectAlignmentRows,
  selectSource,
  selectionKey,
  selectionProblem,
  sourceAnchor,
  sourceAnchors,
} from "./lens-selection.js";

export {
  type MarkdownNode,
  markdownNodes,
  markdownText,
  parseMarkdown,
} from "./markdown.js";

export {
  type FileLineRange,
  type SourcePins,
  SourceRangeError,
  checkSourcePath,
  codePeekSource,
  fileLineRangeSchema,
  requireVisibleSource,
  sliceSourceRange,
} from "./source.js";
