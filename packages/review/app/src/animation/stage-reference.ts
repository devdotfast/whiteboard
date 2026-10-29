// Holds instructions/whiteboard.d.ts, the API reference agents read, to the
// runtime's own types: adding, removing or retyping a member of the stage's
// API without updating the reference fails the typecheck here.

// oxlint-disable-next-line no-restricted-imports -- The reference ships beside the instructions, outside the canvas source.
import type * as Reference from "../../../instructions/whiteboard";
import type {
  ArrowOptions,
  FrameChange,
  FrameTimeline,
  Scene,
  SceneCardOptions,
  SceneChange,
  SceneItemOptions,
  SceneLinkOptions,
  SceneOptions,
  SceneSendOptions,
  SceneStore,
  SceneTable,
  TokenOptions,
  WhiteboardShim,
} from "./stage-runtime";

/** True when the runtime's type fits the reference and both name the same
 * members. */
type Matches<Runtime, Documented> = [Runtime] extends [Documented]
  ? [keyof Runtime] extends [keyof Documented]
    ? [keyof Documented] extends [keyof Runtime]
      ? true
      : false
    : false
  : false;

type Check<T extends true> = T;

export type StageReferenceChecks = [
  Check<Matches<WhiteboardShim, Reference.Whiteboard>>,
  Check<Matches<FrameChange, Reference.FrameChange>>,
  Check<Matches<FrameTimeline, Reference.FrameTimeline>>,
  Check<Matches<Scene, Reference.Scene>>,
  Check<Matches<SceneOptions, Reference.SceneOptions>>,
  Check<Matches<SceneCardOptions, Reference.SceneCardOptions>>,
  Check<Matches<SceneItemOptions, Reference.SceneItemOptions>>,
  Check<Matches<SceneChange, Reference.SceneChange>>,
  Check<Matches<SceneLinkOptions, Reference.SceneLinkOptions>>,
  Check<Matches<SceneSendOptions, Reference.SceneSendOptions>>,
  Check<Matches<SceneStore, Reference.SceneStore>>,
  Check<Matches<SceneTable, Reference.SceneTable>>,
  Check<Matches<ArrowOptions, Reference.ArrowOptions>>,
  Check<Matches<TokenOptions, Reference.TokenOptions>>,
];
