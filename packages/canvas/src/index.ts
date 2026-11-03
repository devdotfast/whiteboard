import type { ReactElement, ReactNode } from "react";

declare const data: unique symbol;

declare const host: unique symbol;

declare const map: unique symbol;

export interface WhiteboardData {
  readonly [data]: true;
}

export interface WhiteboardHost {
  readonly [host]: true;
}

export interface WhiteboardSettings {
  softwareMapEnabled?: boolean;
  documentWidth?: "standard" | "wide" | "full";
}

/** Render it inside an element with the `review-canvas-root` class.
 * With `activity`, a new `version`'s `lastEdit` animates and the courier moves. */
export declare function WhiteboardProvider(props: {
  data: WhiteboardData;
  host: WhiteboardHost;
  settings: WhiteboardSettings;
  children?: ReactNode;
}): ReactElement;

export declare function Whiteboard(): ReactElement;

export declare function ReviewTopBar(): ReactElement;

export interface ShareView {
  title: string;
  /** Present when Desktop can import the share, unless it is frozen. */
  repository?: { cloneUrl: string };
  /** Quotes uncommitted changes, so Desktop cannot open it. */
  frozen?: true;
  data: WhiteboardData;
  host: WhiteboardHost;
  dispose(): void;
}

/** Opens a review-share/2 bundle, as parsed JSON, and validates it; a
 * server can render the board and the client hydrate it. `theme` defaults
 * to "system", the viewer's preference, and holds for the view's life.
 * `wasmUrl` defaults to the routing wasm shipped beside this module.
 * Images are not shared yet. */
export declare function openShare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Share boundary: openShare parses the bundle.
  bundle: unknown,
  options?: { theme?: "light" | "dark" | "system"; wasmUrl?: string },
): Promise<ShareView>;

/** The edit that produced a version, as Whiteboard's store records it. */
export interface BoardEdit {
  type: string;
  targetId: string;
  /** The block the target belongs to: itself, or a unit's diagram. */
  blockId: string;
  kind: string;
  unit?: string;
  linkId?: string;
  fields?: string[];
  units?: string[];
  activityId?: string;
  threadId?: string;
}

/** The agents working on a board. */
export interface BoardActivity {
  workingCount: number;
  expiresAt: number | null;
  activities?: {
    activityId: string;
    slot: number;
    focus?: { description: string; targetId?: string };
    surface?: "document" | "lenses";
    /** Blocks reserved for it, ringed in its color. */
    hold?: string[];
  }[];
}

/** One saved version of a board. */
export interface BoardSnapshot {
  reviewId: string;
  version: number;
  title: string;
  /** Validated as a Whiteboard document. */
  document: readonly unknown[];
  createdAt: string;
  lastEdit?: BoardEdit;
  /** Present for a live board; "unknown" once its stream is lost. */
  activity?: BoardActivity | "unknown";
}

export interface BoardTrace {
  label: string;
  events: { id: string; role: string; text: string }[];
}

/** A saved software map, as a share bundle carries it. */
export interface BoardMap {
  readonly [map]: true;
}

export interface BoardViewOptions {
  /** By asset id; read from blob URLs the caller revokes. */
  images?: Record<string, { bytes: Uint8Array<ArrayBuffer>; type: string }>;
  /** By trace id. */
  traces?: Record<string, BoardTrace>;
  /** By map version id. */
  maps?: Record<string, BoardMap>;
  commits?: readonly object[];
  /** The board's resolved selections, for a host that cannot read them. */
  progress?: object;
}

/** Reads one version into board data; throws on an invalid document.
 * Pass each version in turn so its `lastEdit` animates. */
export declare function boardView(
  snapshot: BoardSnapshot,
  options?: BoardViewOptions,
): WhiteboardData;

export interface Disposable {
  dispose(): void;
}

export type SourceSide = "base" | "head";

export interface SourcePins {
  repositoryId: string;
  head: string;
  base?: string;
}

/** 1-based, inclusive; `side` defaults to the peek's. */
export interface SourceRange {
  startLine: number;
  endLine: number;
  side?: SourceSide;
}

/** What the reader chose in Diff settings; a peek re-renders on change. */
export interface PeekSettings {
  currentDiffLayout(scope: "diff" | "peek"): "split" | "unified";
  onDidChangeDiffLayout(
    scope: "diff" | "peek",
    listener: (layout: "split" | "unified") => void,
  ): Disposable;
  currentInlineLineNumbers(): boolean;
  onDidChangeInlineLineNumbers(listener: (show: boolean) => void): Disposable;
}

/** One source peek: the lines of `path` to show at `pins`. */
export interface PeekSpec {
  path: string;
  title: string;
  side: SourceSide;
  /** The peek's own pins, else the board's. */
  pins?: SourcePins;
  ranges: readonly SourceRange[];
  /** "capped" scrolls past an editor's height; "content" grows to fit. */
  heightMode: "capped" | "content";
  active: boolean;
  onDidFocus?: () => void;
}

export interface FindQuery {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
}

/** A mounted peek; the canvas lays out around `height`. */
export interface PeekHandle extends Disposable {
  readonly height: number;
  setActive(active: boolean): void;
  setCollapsed(collapsed: boolean): void;
  onDidChangeHeight(listener: (height: number) => void): Disposable;
  onDidError(listener: (message: string) => void): Disposable;
  setFindQuery(query: FindQuery): Promise<{ matchCount: number }>;
  revealFindMatch(index: number): void;
  clearActiveFindMatch(): void;
  clearFind(): void;
}

/** Draws source peeks: any code or diff viewer that can show a line range. */
export interface PeekViewer {
  /** Mounts a peek into `container`, replacing any server render. */
  create(spec: PeekSpec & { container: HTMLElement }): PeekHandle;
  /** Escaped HTML for a server render; `create` replaces it on hydration. */
  renderStatic?(spec: Omit<PeekSpec, "active" | "onDidFocus">): string;
  find(
    spec: Pick<PeekSpec, "path" | "side" | "pins" | "ranges">,
    query: FindQuery,
  ): Promise<{ matchCount: number }>;
}

/** A host that reads and edits nothing. `theme` defaults to "system" and
 * `wasmUrl` to the shipped routing wasm. Without `peeks`, source peeks show
 * no lines. */
export declare function readOnlyHost(options?: {
  theme?: "light" | "dark" | "system";
  wasmUrl?: string;
  peeks?: (settings: PeekSettings) => PeekViewer;
}): WhiteboardHost & Disposable;

/** Lines of one file at one commit; `fromLine` is 1-based. */
export interface SourceExcerpt {
  kind: "excerpt";
  file: string;
  commit: string;
  fromLine: number;
  lines: string[];
}

/** Row pairs of base and head line numbers, 1-based; null where a side has no line. */
export interface SourceAlignment {
  file: string;
  previousFile?: string;
  head: string;
  base?: string;
  rows: [number | null, number | null][];
}

/** The code a board's source peeks quote, pinned at `pins`. */
export interface BoardSources {
  sources: readonly SourceExcerpt[];
  pins?: SourcePins;
  alignments?: readonly SourceAlignment[];
}

/** The share viewer's peeks over `code`, for `readOnlyHost`; pass the
 * board's resolved selections to `boardView` as `progress.resolvedSelections`. */
export declare function excerptPeeks(
  code: BoardSources,
): Promise<(settings: PeekSettings) => PeekViewer>;
