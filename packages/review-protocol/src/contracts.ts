import { type JsonObject, type JsonValue, isJsonObject } from "@dev.fast/json";
import {
  ReviewAgentTraceEventSchema,
  ReviewAgentTraceSessionSchema,
} from "@dev.fast/trace-protocol";
import { z } from "zod";

import type { BoardIconKind } from "./board-icons.js";
import type { ReviewApiSummary } from "./review-api-client.js";

// Version 3: the desktop serves prebuilt revisions instead of building them.
// (Version 2 added the bundled-CLI discovery fields.)
export const REVIEW_DESKTOP_DISCOVERY_VERSION = 3;

// Version 5: document and software-map bundles are JSON.
export const REVIEW_SCHEMA_VERSION = 5;

// A gateway sets the client header on every call it forwards from another
// machine; the server then leaves local paths out. The host header names the
// machine that answered; absent means this one.
export const REVIEW_CLIENT_HEADER = "x-review-client";

export const REVIEW_CLIENT_REMOTE = "remote";

export const REVIEW_HOST_HEADER = "x-review-host";

export const PULL_REQUEST_STATES = [
  "open",
  "draft",
  "merged",
  "closed",
] as const;

export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

const requiredString = z
  .string({ error: "must be a string" })
  .refine((value) => value.trim().length > 0, "must be a string");

const stringAllowEmpty = z.string({ error: "must be a string" });

const positiveInteger = z
  .number({ error: "must be a positive integer" })
  .int("must be a positive integer")
  .positive("must be a positive integer");

const nonNegativeInteger = z
  .number({ error: "must be a non-negative integer" })
  .int("must be a non-negative integer")
  .nonnegative("must be a non-negative integer");

const reviewDiffSideSchema = z.enum(["base", "head"], {
  error: "must be base or head",
});

export const reviewViewSchema = z.enum([
  "review",
  "commits",
  "diff",
  "map",
  "trace",
]);

export type ReviewView = z.infer<typeof reviewViewSchema>;

const reviewThemeSchema = z.enum(["light", "dark"], {
  error: "must be light or dark",
});

function urlSchema(
  output: "href" | "origin",
  constraint?: (url: URL) => string | null,
) {
  return requiredString.transform((value, context) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "must be an absolute URL",
      });

      return z.NEVER;
    }

    const error = constraint?.(url);

    if (error) {
      context.addIssue({ code: "custom", message: error });

      return z.NEVER;
    }

    return output === "origin" ? url.origin : url.href;
  });
}

const absoluteUrlSchema = urlSchema("href");

const loopbackOriginSchema = urlSchema("origin", (url) =>
  url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port
    ? null
    : "must use http://127.0.0.1:<port>",
);

export const ReviewRuntimeConfigSchema = z.strictObject({
  serverUrl: loopbackOriginSchema,
  reviewId: requiredString,
  token: stringAllowEmpty,
  wasmUrl: absoluteUrlSchema,
  appVersion: requiredString.max(100),
  theme: reviewThemeSchema,
  host: z.literal("desktop"),
});

export type ReviewRuntimeConfig = z.infer<typeof ReviewRuntimeConfigSchema>;

export type ReviewTheme = ReviewRuntimeConfig["theme"];

export type ReviewDiffSide = z.infer<typeof reviewDiffSideSchema>;

/** How embedded diffs lay out: base and head side by side, or one column. */
export const REVIEW_DIFF_LAYOUTS = ["split", "unified"] as const;

export type ReviewDiffLayout = (typeof REVIEW_DIFF_LAYOUTS)[number];

export const REVIEW_DIFF_LAYOUT_SCOPES = ["diff", "peek"] as const;

export type ReviewDiffLayoutScope = (typeof REVIEW_DIFF_LAYOUT_SCOPES)[number];

export interface ReviewDisposable {
  dispose(): void;
}

export type ReviewInlineEditorHeightMode = "capped" | "content";

export interface ReviewInlineEditorRange {
  startLine: number;
  endLine: number;
  side?: ReviewDiffSide;
}

/** The repository and commits a source was read from, when it names them
 * itself instead of using the review's pins. */
export interface ReviewSourcePins {
  readonly repositoryId: string;
  readonly head: string;
  readonly base?: string;
}

/** The commit a quote is read at, as its file header names it: the short
 * ID, and on hover what the commit is. */
export interface ReviewCodeCommit {
  label: string;
  tooltip?: { label: string; detail?: string };
}

export interface ReviewInlineEditorSpec {
  progress?: ReviewDiffProgress;
  onSetViewed?: ReviewDiffViewSpec["onSetViewed"];
  container: HTMLElement;
  path: string;
  title: string;
  description?: string;
  side: ReviewDiffSide;
  /** Read at these pins instead of the review's. */
  pins?: ReviewSourcePins;
  /** The commit to name in the file header: one other than the board's. */
  commit?: ReviewCodeCommit;
  ranges: readonly ReviewInlineEditorRange[];
  /** Original authored selections, before display ranges are merged. */
  countRanges?: readonly ReviewInlineEditorRange[];
  heightMode: ReviewInlineEditorHeightMode;
  active: boolean;
  onDidFocus?: () => void;
  onDidOpen?: () => void;
  onDidShowHover?: () => void;
}

export interface ReviewFindQuery {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  /** Leave out matches in folded files and regions. */
  skipFolded?: boolean;
}

export interface ReviewInlineFindResult {
  matchCount: number;
}

export interface ReviewInlineFindSpec {
  path: string;
  side: ReviewDiffSide;
  pins?: ReviewSourcePins;
  ranges: readonly ReviewInlineEditorRange[];
}

export interface ReviewInlineEditorHandle extends ReviewDisposable {
  setProgress?(progress: ReviewDiffProgress): void;
  /** Updates the commit's name, as when its description loads. */
  setCommit?(commit: ReviewCodeCommit | undefined): void;
  readonly height: number;
  setActive(active: boolean): void;
  setCollapsed(collapsed: boolean): void;
  onDidChangeHeight(listener: (height: number) => void): ReviewDisposable;
  onDidError(listener: (message: string) => void): ReviewDisposable;
  setFindQuery(query: ReviewFindQuery): Promise<ReviewInlineFindResult>;
  revealFindMatch(index: number): void;
  clearActiveFindMatch(): void;
  clearFind(): void;
  setAskMarks?(marks: readonly ReviewAskMark[], mount: ReviewAskPinMount): void;
}

export interface ReviewInlineEditorFactory {
  create(spec: ReviewInlineEditorSpec): ReviewInlineEditorHandle;
  find(
    spec: ReviewInlineFindSpec,
    query: ReviewFindQuery,
  ): Promise<ReviewInlineFindResult>;
}

/** A lens is scoped to one immutable saved review version. */
export interface ReviewDiffLens {
  /** Filter files while retaining ordinary diff context/folding within them. */
  wholeFiles?: boolean;
  id: string;
  title: string;
  reviewId: string;
  version: number;
  ranges: readonly {
    side: "base" | "head";
    file: string;
    fromLine: number;
    toLine: number;
  }[];
}

/** "folded": nothing left to read and nothing marked; diffr folds all of it by default. */
export type ReviewDiffProgressState =
  | "unread"
  | "partial"
  | "viewed"
  | "folded";

/** Reader progress is supplied independently of the immutable comparison. */
export interface ReviewDiffProgressFile {
  path: string;
  state: ReviewDiffProgressState;
  remaining: { additions: number; deletions: number };
  total: { additions: number; deletions: number };
  viewedRanges: ReviewDiffLens["ranges"];
  changedRanges: ReviewDiffLens["ranges"];
  unfoldRanges?: ReviewDiffLens["ranges"];
}

export interface ReviewDiffSection {
  files?: readonly ReviewDiffProgressFile[];
  id: string;
  label: string;
  sources: ReviewDiffLens["ranges"];
  state: ReviewDiffProgressState;
  total: { additions: number; deletions: number };
  remaining: { additions: number; deletions: number };
}

export interface ReviewDiffProgress {
  sections?: readonly ReviewDiffSection[];
  files: readonly ReviewDiffProgressFile[];
  /** Only present while applying a new viewed action, to reset affected fold overrides. */
  changedPaths?: readonly string[];
}

export interface ReviewDiffViewSpec {
  /** Embed the same diff renderer in the review document. */
  document?: {
    heightMode: ReviewInlineEditorHeightMode;
    onDidChangeHeight(height: number): void;
    onDidFocus?: () => void;
    onDidOpen?: () => void;
    onDidShowHover?: () => void;
    /** The commit its code is read at, when not the board's own. */
    commit?: ReviewCodeCommit;
  };
  container: HTMLElement;
  fileTreeContainer?: HTMLElement;
  /** Desktop puts the changed-files tree in its sidebar's Files section
   * instead, while the sidebar shows this board. */
  sidebarFileTree?: boolean;
  progress?: ReviewDiffProgress;
  onToggleViewed?: (path: string, sectionId?: string) => void;
  /** Mark a structural scope using the same persisted line coverage as file marks. */
  onSetViewed?: (
    ranges: ReviewDiffLens["ranges"],
    viewed: boolean,
  ) => void | Promise<void>;
  onToggleSection?: (id: string) => void;
  lens?: ReviewDiffLens;
  scope?: ReviewCommitScope;
  openFile?: boolean;
}

export interface ReviewDiffViewHandle extends ReviewDisposable {
  focus(): void;
  /** Hides the sidebar file tree, e.g. while the lens tree replaces it. */
  setFileTreeHidden?(hidden: boolean): void;
  setProgress?(progress: ReviewDiffProgress): void;
  revealSource?(
    source: ReviewDiffLens["ranges"][number],
    sectionId?: string,
  ): void;
  /** Scroll to a changed file once loaded. Restore requests defer to saved editor position. */
  revealFile?(path: string, options?: { restore?: boolean }): void;
  /** Find across every file in the view; matches are ordered by file, then line. */
  setFindQuery?(query: ReviewFindQuery): Promise<ReviewInlineFindResult>;
  revealFindMatch?(index: number): void;
  clearActiveFindMatch?(): void;
  clearFind?(): void;
  setAskMarks?(marks: readonly ReviewAskMark[], mount: ReviewAskPinMount): void;
  onDidError(listener: (message: string) => void): ReviewDisposable;
}

/** Lines that saved Ask conversations were about. */
export interface ReviewAskMark {
  id: string;
  file: string;
  side: ReviewDiffSide;
  fromLine: number;
  toLine: number;
  /** The lines' text when asked about; a mark whose lines changed is hidden. */
  text?: readonly string[];
}

/** Draws a mark's pin into its gutter node; returns its cleanup. */
export type ReviewAskPinMount = (id: string, node: HTMLElement) => () => void;

/**
 * Mounts the changed-files diff UI — file list and multi-diff widget — into an
 * app-owned container. `create` returns at once and initializes the widget
 * asynchronously; a failed initialization arrives through `onDidError`.
 */
export interface ReviewDiffViewFactory {
  create(spec: ReviewDiffViewSpec): ReviewDiffViewHandle;
  /** Returns the parsed full diff that backs the native diff view. */
  files(scope?: ReviewCommitScope): Promise<readonly ReviewDiffFileWire[]>;
}

export interface ReviewCommitScope {
  commit: string;
}

export interface ReviewCanvasDiagnostic {
  level: "error" | "warning";
  source: string;
  message: string;
  stack?: string;
}

/**
 * `instant` shows the Whiteboard tooltip the moment the pointer lands, for
 * small targets like the viewed box and the diff counts; `quick` shows it
 * after half the delay; `detail` is its fainter second line. Without options
 * the host shows its delayed hover.
 */
export interface ReviewTooltipOptions {
  instant?: boolean;
  quick?: boolean;
  detail?: string;
}

/** A host notification; running an action closes it, and onClose fires however it closes. */
export interface ReviewNotification {
  kind: "success" | "error";
  text: string;
  actions?: readonly { label: string; run(): void }[];
  onClose?(): void;
}

export interface ReviewCanvasBridge {
  readonly appSessionId?: string;
  readonly config: ReviewRuntimeConfig;
  readonly inlineEditors: ReviewInlineEditorFactory;
  readonly diffView: ReviewDiffViewFactory;
  request(url: string, init?: RequestInit): Promise<Response>;
  post(request: ReviewVerbRequest): Promise<ReviewVerbResponse>;
  subscribe(listener: (event: ReviewSurfaceEvent) => void): ReviewDisposable;
  currentTheme(): ReviewTheme;
  onDidChangeTheme(listener: (theme: ReviewTheme) => void): ReviewDisposable;
  // Each layout is app-wide and backed by a user setting, so a choice outlives
  // the session and the app restart.
  currentDiffLayout(scope: ReviewDiffLayoutScope): ReviewDiffLayout;
  setDiffLayout(
    scope: ReviewDiffLayoutScope,
    layout: ReviewDiffLayout,
  ): Promise<void>;
  onDidChangeDiffLayout(
    scope: ReviewDiffLayoutScope,
    listener: (layout: ReviewDiffLayout) => void,
  ): ReviewDisposable;
  notify?(notification: ReviewNotification): ReviewDisposable;
  setupTooltip?(
    target: HTMLElement,
    text: string,
    options?: ReviewTooltipOptions,
  ): ReviewDisposable;
  ready(): void;
  reportDiagnostic?(diagnostic: ReviewCanvasDiagnostic): void;
  /** Reports the document's headings and the current view to Desktop's
   * sidebar. */
  reportSidebar?(state: ReviewSidebarState): void;
  /** What the sidebar's Lenses section lists, from the Diff view. */
  reportSidebarLenses?(lenses: ReviewSidebarLenses): void;
  /** Whether Desktop's sidebar shows this board. If so, the Diff view moves
   * its lenses and file trees there. */
  sidebarShowsBoard?(): boolean;
  onDidChangeSidebarShowsBoard?(listener: () => void): ReviewDisposable;
  /** The sidebar's lens list, where the agent's cursor is drawn. */
  sidebarLensList?(): HTMLElement | undefined;
  /** Desktop's right column; undefined where Ask docks beside the document. */
  askPanelHost?(): HTMLElement | undefined;
  /** Whether the right column is open, and the thread Ask shows. */
  reportAsk?(state: ReviewAskState): void;
  /** Opens the sidebar on its Threads tab. */
  showThreads?(): void;
}

export interface ReviewAskState {
  /** The right column shows something: Ask docked, or a peek. */
  docked: boolean;
  /** The saved threads on screen: the column's and the floating one. */
  threadIds: string[];
}

/** Changed lines over a lens or the whole diff, and how many are left. */
export interface ReviewSidebarCoverage {
  state: "unread" | "partial" | "viewed" | "folded";
  total: { additions: number; deletions: number };
  remaining: { additions: number; deletions: number };
  folded: { additions: number; deletions: number };
}

export interface ReviewSidebarLensRow {
  id: string;
  title: string;
  /** Its counts are still coming. */
  pending?: boolean;
  /** Why it can't filter the diff, when it can't. */
  unavailable?: string;
  /** No changed file to filter to. */
  empty: boolean;
  progress: ReviewSidebarCoverage;
  /** Its draw-queue phase while an agent writes or erases it. */
  phase?: string;
}

/** The Diff view's lenses, as its sidebar lists them. */
export interface ReviewSidebarLenses {
  /** Remaining over the whole diff; absent while counting. */
  remaining?: ReviewSidebarCoverage;
  /** The counts can't be read. */
  unavailable?: boolean;
  viewed?: { percent: number; title: string };
  /** A viewed mark is being saved. */
  busy: boolean;
  /** The lens filtering the diff. */
  active?: string;
  /** How many changed files the active lens covers. */
  activeFiles?: number;
  rows: ReviewSidebarLensRow[];
}

/** A commit in the board's range, as the Diff's commit picker lists it. */
export interface ReviewSidebarCommit {
  commit: string;
  subject: string;
  author: string;
  authoredAt: string;
  additions: number;
  deletions: number;
}

export interface ReviewSidebarState {
  contents: { id: string; text: string; level: "h2" | "h3"; depth?: number }[];
  view: string;
  /** The board's commits, newest first in ancestry order, as git lists
   * them; absent or empty without any. */
  commits?: ReviewSidebarCommit[];
  /** The commit the Diff view is filtered to, picked in its commit picker. */
  commit?: string;
  /** The compared branches, as "main ← feature". */
  compare?: string;
  /** The heading in view, which Contents tints. */
  activeHeading?: string;
  /** The change's counts are still loading: Lenses and Files keep what
   * they show until a report has them. Contents never waits for them. */
  countsPending?: boolean;
  /** For the folded Lenses and Files headers; absent without a change. */
  lenses?: number;
  files?: {
    count: number;
    additions: number;
    deletions: number;
    /** Untracked files left out of the review, noted under the tree. */
    untracked?: number;
  };
}

/** A board a thread started on or edited. */
export interface ReviewThreadBoard {
  reviewId: string;
  /** Absent once the board is deleted. */
  title?: string;
  icon: BoardIconKind;
}

/** A conversation, as the Threads tab lists it. */
export interface ReviewProjectThread {
  id: string;
  /** The project it works in; absent for one on a shared board. */
  projectId?: string;
  /** Where it lives: its board's checkout folder, else its project's name. */
  place?: string;
  agent: string;
  agentName: string;
  /** The first question asked, else the agent's title for it. */
  opening: string;
  /** While its agent runs: "waiting" needs you. Absent once it stopped. */
  status?: "starting" | "running" | "waiting" | "idle" | "failed";
  /** Its agent finished a turn since the reviewer last saw it. */
  unread?: boolean;
  updatedAt: string;
  /** The board it started on, and the block it was about. */
  anchor: { board: ReviewThreadBoard; block?: string };
  /** Asked about an anchored passage. */
  pinned: boolean;
  /** The boards it changed, newest first. */
  edited: ReviewThreadBoard[];
}

/** GET /:id/ask/threads?watch: every project's threads, newest first. */
export interface ReviewProjectThreads {
  board: string;
  /** The board's project. */
  project?: string;
  threads: ReviewProjectThread[];
}

/** Which threads the Threads tab lists: those on this board (started on it,
 * or that edited it), the board's project's, or every project's. */
export type ReviewThreadsFilter = "board" | "project" | "all";

/** Props for a section list that Desktop's sidebar mounts from the canvas
 * bundle. */
export interface ReviewSidebarSectionProps {
  /** "remaining" is the Diff view's Remaining row, above the Lenses
   * header; "commitPicker" picks the commits it shows, under it. */
  section:
    | "whiteboards"
    | "family"
    | "contents"
    | "recent"
    | "threads"
    | "commitPicker"
    | "lenses"
    | "remaining";
  connection: { serverUrl: string; token: string };
  /** The board in the active tab. */
  reviewId: string;
  /** Its document's headings, as its canvas reports them. */
  contents: ReviewSidebarState["contents"];
  onOpenBoard(reviewId: string, active: boolean): void;
  onOpenHeading(headingId: string): void;
  /** The heading in view, tinted in Contents. */
  activeHeading?: string;
  /** Whiteboards: the board's project and its boards, from Desktop's
   * catalog. */
  project?: {
    project: { id: string; name: string } | null;
    boards: ReviewApiSummary[];
  };
  /** Recent: every project's boards, from Desktop's catalog. */
  recent?: ReviewApiSummary[];
  /** Threads: every project's, the board's project, the filter, and the
   * threads open in Ask. */
  threads?: {
    list: readonly ReviewProjectThread[];
    project?: string;
    filter: ReviewThreadsFilter;
    open?: readonly string[];
  };
  onFilterThreads?(filter: ReviewThreadsFilter): void;
  /** The commit picker: the board's commits, and the one the Diff view
   * is filtered to. */
  commits?: {
    list: readonly ReviewSidebarCommit[];
    selected?: string;
    compare?: string;
  };
  /** Filter the Diff view to a commit, or to all of them with null. */
  onPickCommit?(commit: string | null): void;
  /** Whiteboard: start a new whiteboard, as its shortcut does. */
  onNewWhiteboard?(): void;
  newWhiteboardShortcut?: string;
  onOpenThread?(threadId: string): void;
  /** Lenses: the Diff view's, as its canvas reports them. */
  lenses?: ReviewSidebarLenses;
  /** Filter the diff to a lens, or clear the filter with null. */
  onSelectLens?(lensId: string | null): void;
  /** Toggle a lens viewed. */
  onMarkLens?(lensId: string): void;
  /** The workbench's tooltips, for counts and truncated names. */
  setupTooltip?(
    target: HTMLElement,
    text: string,
    options?: ReviewTooltipOptions,
  ): ReviewDisposable;
}

export interface ReviewSidebarSectionHandle {
  update(props: ReviewSidebarSectionProps): void;
  dispose(): void;
}

export interface ReviewCanvasSetupActions {
  load(): Promise<ReviewCanvasInstallContent>;
  installCli(): Promise<void>;
  /** The desktop server, which first run calls directly to connect agents
   * and to run one. */
  connection(): Promise<{ serverUrl: string; token: string }>;
  /** A native folder picker; undefined when the user cancels. */
  pickFolder(): Promise<string | undefined>;
}

/**
 * Install actions the workbench hands to the Home canvas. Every action
 * resolves with the refreshed status so the card can re-render without a full
 * canvas update.
 */
export interface ReviewCanvasInstallActions {
  apply(request: {
    shim?: boolean;
    trace?:
      | true
      | {
          endpoint?: string;
          bucket?: string;
          region?: string;
          key?: string;
          secret?: string;
        };
  }): Promise<ReviewCliInstallStatus>;
  remove(request: {
    shim?: boolean;
    trace?: true;
  }): Promise<ReviewCliInstallStatus>;
  removeLegacySkills(): Promise<ReviewCliInstallStatus>;
  finishUpdate(): Promise<ReviewCliInstallStatus>;
  decline(): Promise<ReviewCliInstallStatus>;
  skip(): Promise<ReviewCliInstallStatus>;
  enablePrompts(): Promise<ReviewCliInstallStatus>;
}

/** Install state with the actions that change it. */
export interface ReviewCanvasInstallContent extends ReviewCanvasInstallActions {
  status: ReviewCliInstallStatus;
}

/** Onboarding progress for the Welcome pane: which steps the user finished. */
export interface ReviewCanvasOnboarding {
  installed: boolean;
  // At least one published review exists. Drafts are not in the review
  // list, so this only counts a real published review.
  published: boolean;
}

// The workbench owns the theme and the keymap; the canvas only names a choice.
// These lists mirror the workbench side (`reviewThemeChoice.ts`, and
// `REVIEW_KEYMAPS`, `REVIEW_DOCUMENT_WIDTH_CHOICES` and `REVIEW_OPEN_FILES_IN_CHOICES`
// in `reviewConfigurationDefaults.ts`).
export const REVIEW_THEME_CHOICES = ["dark", "light", "system"] as const;

export type ReviewThemeChoice = (typeof REVIEW_THEME_CHOICES)[number];

export const REVIEW_KEYMAP_CHOICES = [
  "none",
  "vim",
  "emacs",
  "sublime",
] as const;

export type ReviewKeymapChoice = (typeof REVIEW_KEYMAP_CHOICES)[number];

export type ReviewOpenFilesInChoice =
  | "whiteboard"
  | "vscode"
  | "cursor"
  | "zed"
  | "application";

/**
 * Where Open file sends a file. `application` is one the reader picked with
 * the native picker; `name` is how the page labels it.
 */
export interface ReviewOpenFilesIn {
  choice: ReviewOpenFilesInChoice;
  application: { path: string; name: string } | null;
}

export type ReviewDocumentWidthChoice = "standard" | "wide" | "full";

export type ReviewReadyNotificationChoice =
  | "notificationAndBadge"
  | "notification"
  | "off";

/**
 * Settings state and actions the workbench hands to the Settings canvas. Every
 * setter resolves with the value that actually landed, so a row re-renders from
 * the authoritative result instead of an optimistic one.
 */
/** What diffr's schema says about one summary provider. */
export interface ReviewDiffrProvider {
  id: string;
  title: string;
  model: string;
  endpoint: string;
  keyVariables: string[];
  keylessCustomEndpoint: boolean;
}

export interface ReviewDiffrConfig {
  values: JsonObject;
  credentialSource: "config" | "environment" | "missing";
  providers?: ReviewDiffrProvider[];
  defaultPrompt?: string;
  defaultHiddenTags?: string[];
  changed?: boolean;
  error?: string;
}

export const reviewDiffrSummarizerInputSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().min(1),
  model: z.string().trim().min(1),
  endpoint: z.string().trim(),
  // Blank means diffr's own default; kept as written, not trimmed.
  systemPrompt: z.string(),
  tests: z.boolean(),
  apiKey: z.string().optional(),
});

export type ReviewDiffrSummarizerInput = z.infer<
  typeof reviewDiffrSummarizerInputSchema
>;

const reviewDiffrConfigSchema = z.object({
  values: z.custom<JsonObject>(isJsonObject),
  credentialSource: z.enum(["config", "environment", "missing"]),
  providers: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        model: z.string(),
        endpoint: z.string(),
        keyVariables: z.array(z.string()),
        keylessCustomEndpoint: z.boolean(),
      }),
    )
    .optional(),
  defaultPrompt: z.string().optional(),
  defaultHiddenTags: z.array(z.string()).optional(),
  changed: z.boolean().optional(),
  error: z.string().optional(),
});

export function parseReviewDiffrConfig(value: JsonValue): ReviewDiffrConfig {
  const result = reviewDiffrConfigSchema.safeParse(value);

  if (!result.success)
    throw new Error("diffr configuration response is malformed.");

  return result.data;
}

export interface ReviewDiffrConfigActions {
  read(): Promise<ReviewDiffrConfig>;
  set(key: string, value: JsonValue): Promise<ReviewDiffrConfig>;
  saveSummarizer(input: ReviewDiffrSummarizerInput): Promise<ReviewDiffrConfig>;
  testSummarizer(input: ReviewDiffrSummarizerInput): Promise<string>;
}

export interface ReviewCanvasSettingsContent {
  // Backed by the `review.telemetry.enabled` workbench setting, which the
  // review server and the CLI both read.
  telemetryEnabled: boolean;
  setTelemetryEnabled(enabled: boolean): Promise<boolean>;
  theme: ReviewThemeChoice;
  setTheme(choice: ReviewThemeChoice): Promise<ReviewThemeChoice>;
  keymap: ReviewKeymapChoice;
  // A keymap only takes effect after the extension host restarts, so the
  // workbench offers the window reload. The page never forces one.
  setKeymap(choice: ReviewKeymapChoice): Promise<ReviewKeymapChoice>;
  openFilesIn: ReviewOpenFilesIn;
  setOpenFilesIn(choice: ReviewOpenFilesInChoice): Promise<ReviewOpenFilesIn>;
  // Shows the native application picker; a cancelled pick changes nothing.
  chooseOpenFilesInApplication(): Promise<ReviewOpenFilesIn>;
  documentWidth: ReviewDocumentWidthChoice;
  setDocumentWidth(
    choice: ReviewDocumentWidthChoice,
  ): Promise<ReviewDocumentWidthChoice>;
  // `editor.fontSize`, which every diff, peek and source editor reads.
  codeFontSize: number;
  setCodeFontSize(size: number): Promise<number>;
  readyNotification: ReviewReadyNotificationChoice;
  setReadyNotification(
    choice: ReviewReadyNotificationChoice,
  ): Promise<ReviewReadyNotificationChoice>;
  softwareMapEnabled: boolean;
  setSoftwareMapEnabled(enabled: boolean): Promise<boolean>;
  // Shared CLI configuration, read when its disclosure opens.
  diffrConfig: ReviewDiffrConfigActions;
  reloadWindow(): Promise<void>;
  manageExtensions(): void;
  importVsCodeSettings(): void;
  uninstallApp(): void;
  // Agent installs are managed here too, so they stay reachable once Home
  // has reviews and no longer shows the Welcome rail. Absent when the
  // install status endpoint is unavailable.
  install?: ReviewCanvasInstallContent;
  remoteHosts: ReviewRemoteHostsSettings;
}

/** What a review or Home can do about the host a review lives on. */
export interface ReviewRemoteHostActions {
  states(): Promise<ReviewGatewayHostState[]>;
  retry(alias: string): Promise<void>;
  install(alias: string): Promise<void>;
  openSettings(): Promise<void>;
}

export interface ReviewRemoteHostsSettings {
  configured: string[];
  suggestions(): Promise<string[]>;
  states(): Promise<ReviewGatewayHostState[]>;
  set(aliases: string[]): Promise<string[]>;
  retry(alias: string): Promise<void>;
  install(alias: string): Promise<void>;
  agents(alias: string, refresh?: boolean): Promise<ReviewRemoteAgent[] | null>;
  connectAgents(
    alias: string,
    agents: ReviewRemoteAgentId[],
  ): Promise<ReviewRemoteAgentResult[]>;
  uninstall(alias: string): Promise<void>;
}

export const REVIEW_REMOTE_WRAPPER_MARK =
  "# Written by Whiteboard Desktop, which replaces it with each install.";

export const REVIEW_REMOTE_ATTACH_BEGIN = "WHITEBOARD-REMOTE-BEGIN";

export const REVIEW_REMOTE_ATTACH_END = "WHITEBOARD-REMOTE-END";

export const REVIEW_REMOTE_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export const REVIEW_REMOTE_INSTALL_LOCK = "install.lock";

export const REVIEW_REMOTE_LOCK_STALE_SECONDS = 15 * 60;

// Cursor needs its app, so a remote host cannot connect it.
export const REVIEW_REMOTE_AGENT_IDS = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "omp",
  "copilot",
] as const satisfies readonly ReviewCliInstallTarget[];

export type ReviewRemoteAgentId = (typeof REVIEW_REMOTE_AGENT_IDS)[number];

export interface ReviewRemoteAgent {
  id: ReviewRemoteAgentId;
  connected: boolean;
}

export interface ReviewRemoteAgentResult {
  id: ReviewRemoteAgentId;
  connected: boolean;
  output: string;
}

/** Workspace attachment identity is independent of the displayed source generation. */
export interface ReviewLanguageEnvironment {
  /** Absent for a caller on another machine. */
  readonly rootPath?: string | null;
  readonly identity: string;
  /** Present only when the language checkout is unavailable, not while preparing. */
  readonly issue?: string;
}

export interface ReviewRemoteLanguageEnvironment {
  readonly remoteRootPath: string | null;
  readonly identity: string;
  readonly serverId: string;
  readonly issue?: string;
}

/** Authored version selection is independent of whether source is live or fixed. */
export type ReviewSourceSelection =
  | { readonly reviewId: string; readonly kind: "current" }
  | {
      readonly reviewId: string;
      readonly kind: "version";
      readonly version: number;
    };

export interface ReviewSourceView {
  readonly reviewId: string;
  readonly version: number;
  /** Cache invalidation for live files; does not select historical source. */
  readonly generation?: string;
  readonly commit?: string;
  /** Pins a reference names itself; the server reads there instead of the
   * review's pins, and `commit` does not apply. */
  readonly pins?: ReviewSourcePins;
}

export function resolveReviewSourceView(snapshot: {
  reviewId: string;
  version: number;
  pins?: { worktreeRevision?: string };
}): ReviewSourceView {
  return Object.freeze({
    reviewId: snapshot.reviewId,
    version: snapshot.version,
    generation: snapshot.pins?.worktreeRevision,
  });
}

export function reviewSourceComparison(
  view: ReviewSourceView,
  commit?: string,
): ReviewSourceView {
  return commit
    ? Object.freeze({
        ...view,
        commit,
      })
    : view;
}

/** The view of one reference's own pins: the review's version, no commit
 * narrowing, and no live-file generation since the pins are commits. */
export function reviewSourceAnchor(
  view: ReviewSourceView,
  pins: ReviewSourcePins | undefined,
): ReviewSourceView {
  return pins
    ? Object.freeze({ reviewId: view.reviewId, version: view.version, pins })
    : view;
}

/** Existing HTTP parameters are an adapter, not the internal view model. */
export function reviewSourceQuery(view: ReviewSourceView) {
  return {
    version: view.version,
    commit: view.commit,
    repositoryId: view.pins?.repositoryId,
    base: view.pins?.base,
    head: view.pins?.head,
  };
}

/** Decode the pins of `reviewSourceQuery` from string parameters. */
export function reviewSourcePinsFromQuery(
  read: (key: string) => string | null | undefined,
): ReviewSourcePins | undefined {
  const repositoryId = read("repositoryId");
  const head = read("head");
  const base = read("base");

  if (!repositoryId || !head) return undefined;

  return Object.freeze(
    base ? { repositoryId, head, base } : { repositoryId, head },
  );
}

export interface ReviewApiSourceLocation {
  readonly view: ReviewSourceView;
  readonly file: string;
  readonly side: ReviewDiffSide;
}

export type ReviewCanvasContent =
  | { kind: "loading" }
  | {
      kind: "api";
      softwareMapEnabled?: boolean;
      documentWidth?: ReviewDocumentWidthChoice;
      reviewId: string;
      /** The board's project: its boards share the threads on screen. */
      projectId?: string;
      version?: number;
      host?: string;
      hostState?: ReviewApiSummary["hostState"];
      available?: ReviewApiSummary["available"];
      remoteHosts?: ReviewRemoteHostActions;
      bridge: ReviewCanvasBridge;
      setTitle?(title: string): void;
      setSourceView?(
        selection: ReviewSourceSelection,
        view: ReviewSourceView,
      ): void;
      openSource?(
        source: ReviewApiSourceLocation,
        range: ReviewInlineEditorRange,
      ): Promise<void>;
    }
  | {
      kind: "error";
      message: string;
    }
  // The Source tab: an empty state beside the read-only file tree. Static —
  // the tree and the file tabs it opens are native surfaces. `error` is set
  // when the worktree cannot be browsed (deleted checkout, unavailable
  // session) and carries the human-readable reason.
  | { kind: "source"; error?: string }
  | { kind: "home"; data: ReviewCanvasHomeData; host: ReviewCanvasHomeHost }
  | {
      kind: "welcome";
      data: ReviewCanvasWelcomeData;
      host: ReviewCanvasWelcomeHost;
    }
  | {
      kind: "settings";
      settings: ReviewCanvasSettingsContent;
    };

/** What Home shows; a new snapshot on every change. */
export interface ReviewCanvasHomeData {
  view?: "active" | "trash";
  reviews: readonly ReviewApiSummary[];
  // Setup status is available for small catalogs so Home can show progress.
  // Absent when the install status endpoint is unavailable.
  installStatus?: ReviewCliInstallStatus;
  onboarding?: ReviewCanvasOnboarding;
}

/**
 * What Home can do. The workbench makes it once per pane and passes the same
 * object with every update, so the canvas can depend on its members.
 */
export interface ReviewCanvasHomeHost {
  navigate?(view: "active" | "trash"): void;
  openSettings?(): void;
  openSetup?(): void;
  openReview(uuid: string): void;
  // Moves the review to Trash and closes its canvas. Absent when the host does
  // not support deletion.
  trashReview?(uuid: string): Promise<void>;
  markReviewRead?(uuid: string): Promise<void>;
  // Boards in Trash can be restored for 30 days or deleted.
  deleteReview?(uuid: string): Promise<void>;
  restoreReview?(uuid: string): Promise<void>;
  remoteHosts?: ReviewRemoteHostActions;
  // Opens the review and pins its read-only source tree open. Absent when
  // the host cannot show the tree.
  openSourceTree?(uuid: string): void;
  install?: ReviewCanvasInstallActions;
  setupActions?: ReviewCanvasSetupActions;
}

/** What the Welcome tab shows; a new snapshot on every change. */
export interface ReviewCanvasWelcomeData {
  // Absent when the install status endpoint is unavailable.
  installStatus?: ReviewCliInstallStatus;
  // Drives the step rail. Absent when the install status is unavailable.
  onboarding?: ReviewCanvasOnboarding;
}

/** What the Welcome tab can do; stable like `ReviewCanvasHomeHost`. */
export interface ReviewCanvasWelcomeHost {
  install?: ReviewCanvasInstallActions;
  setupActions?: ReviewCanvasSetupActions;
  // Closes the Welcome tab ("Skip for now" on first run).
  close?(): void;
}

export interface ReviewCanvasRange {
  sourceUnavailable?: string;
  baseRef: string;
  headRef: string;
  baseCommit: string;
  headCommit: string;
  /** Set for a live worktree comparison, whose working files can differ
   * from the head commit; it changes on every save. */
  worktreeRevision?: string;
}

export interface ReviewCanvasHandle extends ReviewDisposable {
  update(content: ReviewCanvasContent): void;
  focus(): void;
  showFind(seed?: string): boolean;
  /** Undefined when the canvas shows no review. */
  diffFiles(): Promise<readonly ReviewDiffFileWire[]> | undefined;
  revealDiffFile(path: string): void;
  /** Opens New whiteboard; false when the canvas is not on a Home that can
   * draw one (Trash, first run, another tab). */
  newWhiteboard(): boolean;
}

export const REVIEW_CANVAS_RESUME_EVENT = "dev-fast-review-canvas-resume";

export interface ReviewMenuItem {
  id: string;
  label: string;
  checked?: boolean;
  enabled?: boolean;
}

export interface ReviewMenuRequest {
  anchor: HTMLElement;
  items: readonly ReviewMenuItem[];
  onSelect(id: string): void | Promise<void>;
  onHide(): void;
}

export interface ReviewCanvasUi {
  setupTooltip?: ReviewCanvasBridge["setupTooltip"];
  /** Asks before deleting the boards with these titles. reviewIds let the
   * host name the whiteboards that link to them and the children that move
   * up. With trash, they move to Trash, and the host asks only when other
   * boards need them. */
  confirmDelete?(
    titles: readonly string[],
    options?: { reviewIds?: readonly string[]; trash?: boolean },
  ): Promise<boolean>;
  notify?: ReviewCanvasBridge["notify"];
  showMenu(request: ReviewMenuRequest): ReviewDisposable;
}

export interface ReviewCanvasModule {
  mountReviewCanvas(
    container: HTMLElement,
    content: ReviewCanvasContent,
    ui?: ReviewCanvasUi,
  ): ReviewCanvasHandle;
  mountReviewSidebarSection(
    container: HTMLElement,
    props: ReviewSidebarSectionProps,
  ): ReviewSidebarSectionHandle;
}

// Tolerant of unknown keys so future additive fields never force a version
// bump; readers must ignore fields they do not understand.
export const ReviewDesktopDiscoverySchema = z.object({
  version: z.literal(REVIEW_DESKTOP_DISCOVERY_VERSION, {
    error: "Unsupported Whiteboard Desktop discovery version",
  }),
  instanceId: requiredString,
  url: loopbackOriginSchema,
  appPid: positiveInteger,
  serverPid: positiveInteger,
  token: requiredString,
  startedAt: positiveInteger,
  cliPath: requiredString.optional(),
  cliVersion: requiredString.optional(),
  // An executable that behaves as Node.js when ELECTRON_RUN_AS_NODE=1 is set
  // (the app's Electron binary). Consumers run cliPath with it so the CLI
  // uses the exact runtime the app ships instead of whatever `node` is on
  // PATH.
  cliRuntimePath: requiredString.optional(),
  // Instance identity. Desktops that predate instance selection omit these
  // and wrote the shared review-desktop/server.json instead.
  key: requiredString.optional(),
  channel: z.enum(["stable", "preview", "dev"]).optional(),
  checkout: requiredString.optional(),
  appPath: requiredString.optional(),
  appVersion: requiredString.optional(),
});

export type ReviewDesktopDiscovery = z.infer<
  typeof ReviewDesktopDiscoverySchema
>;

/** `GET /health` on every review server. No token needed. */
export interface ReviewServerHealth {
  ok: true;
  instanceId: string; // new on every start
  desktopAttached: boolean;
  version: string; // package version; equals the Desktop version in release builds
}

/** `GET /health` with the server's token: what identifies the machine and build. */
export interface ReviewServerHealthWithToken extends ReviewServerHealth {
  serverId: string; // stable, one per review store
  serverPid: number;
  commit: string | null;
}

export const REVIEW_REMOTE_INSTALL_STEPS = [
  "preparing",
  "waiting-for-lock",
  "package",
  "done",
] as const;

export const ReviewGatewayHostSchema = z.strictObject({
  alias: requiredString,
  endpoint: z
    .strictObject({ url: requiredString, token: requiredString })
    .optional(),
  problem: z
    .strictObject({
      state: z.enum([
        "unreachable",
        "not-installed",
        "auth-failed",
        "unsupported",
        "incompatible",
      ]),
      detail: stringAllowEmpty,
    })
    .optional(),
  declined: z.literal(true).optional(),
  asking: requiredString.optional(),
  installFailure: stringAllowEmpty.optional(),
  installing: z
    .strictObject({
      step: z.enum(REVIEW_REMOTE_INSTALL_STEPS),
    })
    .optional(),
  languageFeatures: z.boolean().optional(),
  languageFeaturesDetail: stringAllowEmpty.optional(),
  languageFeaturesPending: z.literal(true).optional(),
  languageGroups: z
    .array(
      z.strictObject({
        group: requiredString,
        installed: z.boolean(),
        detail: stringAllowEmpty.optional(),
      }),
    )
    .optional(),
});

export type ReviewGatewayHost = z.infer<typeof ReviewGatewayHostSchema>;

export interface ReviewGatewayHostState {
  alias: string;
  serverId?: string;
  state:
    | "connecting"
    | "online"
    | "offline"
    | "incompatible"
    | "duplicate"
    | "unreachable"
    | "not-installed"
    | "auth-failed"
    | "unsupported"
    | "installing";
  detail?: string;
  installCommand?: string;
  languageFeatures?: boolean;
  languageFeaturesDetail?: string;
  languageFeaturesPending?: true;
  languageGroups?: ReviewGatewayHost["languageGroups"];
  declined?: true;
}

/** `emptySide`: the diff side has no file; open one locally. */
export interface ReviewRemoteNavigatorAnswer {
  workspacePath: string;
  filePath?: string;
  serverId: string;
  emptySide?: true;
}

export const ReviewRepositoryIdentitySchema = z.strictObject({
  kind: z.enum(["git", "jj", "none"], {
    error: "must be git, jj, or none",
  }),
  repositoryId: requiredString,
  repositoryPath: requiredString,
  worktreeRoot: requiredString,
});

export type ReviewRepositoryIdentity = z.infer<
  typeof ReviewRepositoryIdentitySchema
>;

export const ReviewStatusSchema = z.enum([
  "draft",
  "awaiting-review",
  "awaiting-agent-updates",
  "accepted",
  "rejected",
]);

export const ReviewSourceIdentitySchema = z.strictObject({
  kind: z.enum(["git-branch", "git-commit", "jj-bookmark", "jj-change"]),
  name: requiredString,
});

export type ReviewSourceIdentity = z.infer<typeof ReviewSourceIdentitySchema>;

export const ReviewAgentSessionRoleSchema = z.enum([
  "author",
  "map-worker",
  "publisher",
  "updater",
  "question",
]);

export const ReviewAgentSessionAttributionSchema = z.strictObject({
  roles: z.array(ReviewAgentSessionRoleSchema),
  firstSeenAt: requiredString,
  lastSeenAt: requiredString,
});

export const ReviewCommitSummarySchema = z.strictObject({
  commit: z
    .string({ error: "must be a 40-hex revision" })
    .regex(/^[0-9a-f]{40}$/i, "must be a 40-hex revision"),
  parentCommit: z
    .string({ error: "must be a 40-hex revision" })
    .regex(/^[0-9a-f]{40}$/i, "must be a 40-hex revision"),
  subject: stringAllowEmpty,
  author: stringAllowEmpty,
  authoredAt: requiredString,
  fileCount: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export type ReviewCommitSummary = z.infer<typeof ReviewCommitSummarySchema>;

/** The native agent session that authored the review. */
export const AuthoringAgentSessionSchema = z.strictObject({
  harness: z.enum(["claude-code", "codex", "opencode", "pi"]),
  sessionId: requiredString,
});

export const ReviewErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: requiredString,
  code: requiredString.optional(),
  retryable: z.boolean().optional(),
});

export const ReviewStackLayerSchema = z.strictObject({
  branch: requiredString,
  pullRequestNumber: positiveInteger.nullable(),
  pullRequestUrl: absoluteUrlSchema.nullable(),
  /** Where a new review of an unreviewed local branch starts. */
  base: requiredString.nullable(),
  /** A local branch's oldest commit subject. */
  subject: requiredString.nullable(),
  reviewUuid: z.uuid({ error: "must be a UUID" }).nullable(),
  reviewTitle: stringAllowEmpty.nullable(),
  relation: z.enum(["earlier", "current", "later"]),
  /** The layer's PR state, as last read from GitHub. */
  pullRequestState: z.enum(PULL_REQUEST_STATES).optional(),
});

export type ReviewStackLayer = z.infer<typeof ReviewStackLayerSchema>;

export const ReviewStackResponseSchema = z.strictObject({
  /** Bottom first. */
  layers: z.array(ReviewStackLayerSchema),
  /** The branch the stack sits on, as `main`. */
  base: requiredString.optional(),
});

export type ReviewStackResponse = z.infer<typeof ReviewStackResponseSchema>;

const ReviewPlaceBoardSchema = z.strictObject({
  reviewId: requiredString,
  title: stringAllowEmpty,
  icon: z.enum(["board", "code"]),
});

const ReviewPlaceSiblingSchema = ReviewPlaceBoardSchema.extend({
  pullRequestNumber: positiveInteger.optional(),
  pullRequestState: z.enum(PULL_REQUEST_STATES).optional(),
});

/** Where a board sits, for its header: its parent and the parent's
 * children in order, or a top-level board's own children, and its PR's
 * facts the summary lacks. */
export const ReviewBoardPlaceSchema = z.strictObject({
  /** The board's PR state and branches, as last read from GitHub. */
  pullRequestState: z.enum(PULL_REQUEST_STATES).optional(),
  baseBranch: requiredString.optional(),
  headBranch: requiredString.optional(),
  /** The board itself. */
  board: ReviewPlaceBoardSchema.optional(),
  parent: ReviewPlaceBoardSchema.optional(),
  /** Empty for a top-level board. */
  siblings: z.array(ReviewPlaceSiblingSchema),
  /** A top-level board's children in sibling order; absent for a child. */
  children: z.array(ReviewPlaceSiblingSchema).optional(),
});

export type ReviewBoardPlace = z.infer<typeof ReviewBoardPlaceSchema>;

export const ReviewCliInstallTargetSchema = z.enum(
  ["claude", "codex", "cursor", "opencode", "pi", "omp", "copilot"],
  { error: "must be claude, codex, cursor, opencode, pi, omp, or copilot" },
);

export type ReviewCliInstallTarget = z.infer<
  typeof ReviewCliInstallTargetSchema
>;

export const REVIEW_CLI_INSTALL_TARGET_LABELS: Record<
  ReviewCliInstallTarget,
  string
> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "oh-my-pi",
  copilot: "Copilot CLI",
};

export const ReviewCliInstallStampSchema = z.object({
  consent: z.enum(["granted", "declined", "skipped"], {
    error: "must be granted, declined, or skipped",
  }),
  fingerprint: requiredString.optional(),
  shimPath: requiredString.optional(),
  /** The user removed the review command; the shim resync must not reinstall it. */
  commandDisabled: z.literal(true).optional(),
  traceManaged: z.boolean().optional(),
  /** Windows: the directory the install put on the saved user PATH. A running
   * process keeps its startup PATH, so this is what says new terminals will
   * find the command. */
  userPath: requiredString.optional(),
  updatedAt: requiredString,
});
// z.object (not strictObject) so stamps from earlier versions parse; their
// extra fields (targets, fffRegistrations, mcpRegistrations) are dropped.

export type ReviewCliInstallStamp = z.infer<typeof ReviewCliInstallStampSchema>;

export const ReviewCliInstallStatusSchema = z.strictObject({
  fingerprint: requiredString,
  stamp: ReviewCliInstallStampSchema.nullable(),
  /** The stamp fingerprint differs from the running package: rewrite the shim. */
  stale: z.boolean(),
  /** A granted stamp without this build's update marker: show the update screen. */
  updateNeeded: z.boolean(),
  error: requiredString.optional(),
  shim: z.strictObject({
    path: requiredString,
    installed: z.boolean(),
    profileConfigured: z.boolean(),
    onPath: z.boolean(),
    /** The Windows installer put this command on PATH; uninstalling Whiteboard removes it. */
    installer: z.literal(true).optional(),
  }),
  trace: z.strictObject({
    enabled: z.boolean(),
    configured: z.boolean(),
    autoActivateRepositories: z.boolean(),
    envPath: requiredString,
    settingsPath: requiredString,
    endpoint: requiredString.optional(),
    bucket: requiredString.optional(),
    region: requiredString.optional(),
    accessKeyIdPrefix: requiredString.optional(),
    verifiedAt: requiredString.optional(),
    error: requiredString.optional(),
    // Trace storage selection (version-2 config); absent from older CLIs.
    configPath: requiredString.optional(),
    storageMode: z.enum(["s3", "hosted", "none"]).optional(),
    credentialsSource: z
      .enum(["profile", "legacy-file", "process-env", "none"])
      .optional(),
    captureSource: z.enum(["profile", "settings"]).optional(),
  }),
  // Null when the serving package has no built CLI (a source-run dev server).
  cli: z
    .strictObject({ path: requiredString, version: requiredString })
    .nullable(),
  connect: z.strictObject({
    // "sh", or "whiteboard" when Desktop has no built CLI.
    command: requiredString,
    // ["-c", "exec \"$HOME/.local/bin/whiteboard\" mcp"], or ["mcp"].
    args: z.array(z.string()),
    prompts: z.record(ReviewCliInstallTargetSchema, requiredString),
    // The published plugin per harness: an install command, or Cursor's link.
    plugins: z.record(
      ReviewCliInstallTargetSchema,
      z.strictObject({
        label: requiredString,
        command: requiredString.optional(),
        url: requiredString.optional(),
      }),
    ),
  }),
  legacySkills: z.array(z.strictObject({ path: requiredString })),
});

export type ReviewCliInstallStatus = z.infer<
  typeof ReviewCliInstallStatusSchema
>;

// The command and trace configuration are per-machine. Silent app updates
// omit `trace`, so they do not contact R2.
export const ReviewCliInstallApplyRequestSchema = z.strictObject({
  shim: z.boolean().optional(),
  autoUpdate: z.boolean().optional(),
  trace: z
    .union([
      z.literal(true),
      z.strictObject({
        endpoint: requiredString.optional(),
        bucket: requiredString.optional(),
        key: requiredString.optional(),
        secret: requiredString.optional(),
        region: requiredString.optional(),
      }),
    ])
    .optional(),
});

export type ReviewCliInstallApplyRequest = z.infer<
  typeof ReviewCliInstallApplyRequestSchema
>;

export const ReviewCliInstallApplyResponseSchema = z.strictObject({
  ok: z.boolean(),
  output: stringAllowEmpty,
  shimPath: requiredString.optional(),
});

export type ReviewCliInstallApplyResponse = z.infer<
  typeof ReviewCliInstallApplyResponseSchema
>;

/** An agent harness Whiteboard can connect to, and whether this machine has it. */
export const ReviewConnectAgentSchema = z.strictObject({
  target: ReviewCliInstallTargetSchema,
  name: requiredString,
  found: z.boolean(),
  /** Whether it already has Whiteboard's plugin or MCP server. */
  connected: z.boolean(),
});

export type ReviewConnectAgent = z.infer<typeof ReviewConnectAgentSchema>;

export const ReviewConnectAgentsResponseSchema = z.strictObject({
  agents: z.array(ReviewConnectAgentSchema),
});

export const ReviewConnectRequestSchema = z.strictObject({
  target: ReviewCliInstallTargetSchema,
});

/** `approve`: the harness asks the user to confirm the server itself (Cursor's
 * install link), so Whiteboard opened it and cannot tell when it is done. */
export const ReviewConnectResultSchema = z.strictObject({
  target: ReviewCliInstallTargetSchema,
  state: z.enum(["connected", "approve", "failed"]),
  output: stringAllowEmpty,
});

export type ReviewConnectResult = z.infer<typeof ReviewConnectResultSchema>;

/** A repository the first-run Run step can draw from. */
export const ReviewOnboardingProjectSchema = z.strictObject({
  path: requiredString,
  name: requiredString,
});

export type ReviewOnboardingProject = z.infer<
  typeof ReviewOnboardingProjectSchema
>;

/** Something in a repository to draw: the checkout's branch, another
 * worktree, or an open pull request. */
export const ReviewOnboardingTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("branch"),
    path: requiredString,
    branch: requiredString,
  }),
  z.strictObject({
    kind: z.literal("worktree"),
    path: requiredString,
    branch: requiredString,
  }),
  z.strictObject({
    kind: z.literal("pr"),
    number: z.number().int().positive(),
    title: requiredString,
    url: requiredString,
    author: stringAllowEmpty,
    branch: stringAllowEmpty,
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  }),
]);

export type ReviewOnboardingTarget = z.infer<
  typeof ReviewOnboardingTargetSchema
>;

export const ReviewOnboardingTargetsResponseSchema = z.strictObject({
  project: ReviewOnboardingProjectSchema,
  base: stringAllowEmpty,
  targets: z.array(ReviewOnboardingTargetSchema),
});

export type ReviewOnboardingTargetsResponse = z.infer<
  typeof ReviewOnboardingTargetsResponseSchema
>;

/** Make a whiteboard of `target`, open it, and start `agent` drawing it. */
export const ReviewOnboardingRunRequestSchema = z.strictObject({
  /** The repository the target came from. */
  projectPath: requiredString,
  /** What a branch is compared to, when it has no pull request. */
  base: stringAllowEmpty,
  target: ReviewOnboardingTargetSchema,
  agent: requiredString,
  prompt: z.string().trim().min(1).max(8000),
});

export const ReviewDiffFileSchema = z.strictObject({
  path: requiredString,
  previousPath: requiredString.optional(),
  status: z.enum(["added", "modified", "deleted", "renamed", "unchanged"]),
  additions: nonNegativeInteger,
  deletions: nonNegativeInteger,
  /** Git reports no line counts: the file's contents are binary. */
  binary: z.literal(true).optional(),
  patch: requiredString.optional(),
});

export type ReviewDiffFileWire = z.infer<typeof ReviewDiffFileSchema>;

export interface ReviewDiffStats {
  readonly fileCount: number;
  readonly additions: number;
  readonly deletions: number;
}

export function summarizeReviewDiffFiles(
  files: readonly {
    readonly additions?: number;
    readonly deletions?: number;
  }[],
): ReviewDiffStats {
  return files.reduce<ReviewDiffStats>(
    (total, file) => ({
      fileCount: total.fileCount + 1,
      additions: total.additions + (file.additions ?? 0),
      deletions: total.deletions + (file.deletions ?? 0),
    }),
    { fileCount: 0, additions: 0, deletions: 0 },
  );
}

/** Diagram evidence may provide context outside the comparison's changed-file list. */
export function lensDiffFiles(
  files: readonly ReviewDiffFileWire[],
  lens: ReviewDiffLens,
): readonly ReviewDiffFileWire[] {
  const known = new Set(
    files.flatMap((file) => [
      file.path,
      ...(file.previousPath ? [file.previousPath] : []),
    ]),
  );

  const context: ReviewDiffFileWire[] = [];

  if (!lens.wholeFiles)
    for (const range of lens.ranges) {
      if (known.has(range.file)) continue;
      known.add(range.file);
      context.push({
        path: range.file,
        status: "unchanged",
        additions: 0,
        deletions: 0,
      });
    }

  return [...files, ...context].filter((file) =>
    lens.ranges.some(
      (range) =>
        range.file ===
        (range.side === "base" ? (file.previousPath ?? file.path) : file.path),
    ),
  );
}

export const ReviewDiffFilesRequestSchema = z.strictObject({
  includePatch: z.boolean().optional(),
  paths: z.array(z.string()).optional(),
  commit: z
    .string({ error: "must be a 40-hex revision" })
    .regex(/^[0-9a-f]{40}$/i, "must be a 40-hex revision")
    .optional(),
});

export const ReviewDiffFilesResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    baseRef: requiredString.optional(),
    headRef: requiredString.optional(),
    files: z.array(ReviewDiffFileSchema),
  }),
  ReviewErrorResponseSchema,
]);

export type ReviewDiffFilesResponse = z.infer<
  typeof ReviewDiffFilesResponseSchema
>;

export const ReviewFileContentRequestSchema = z.strictObject({
  path: requiredString,
  side: reviewDiffSideSchema,
  commit: z
    .string({ error: "must be a 40-hex revision" })
    .regex(/^[0-9a-f]{40}$/i, "must be a 40-hex revision")
    .optional(),
});

export type ReviewFileContentRequest = z.infer<
  typeof ReviewFileContentRequestSchema
>;

export const ReviewFileContentResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    content: stringAllowEmpty,
    truncated: z.boolean().optional(),
  }),
  z.strictObject({ ok: z.literal(true), absent: z.literal(true) }),
  z.strictObject({ ok: z.literal(true), binary: z.literal(true) }),
  ReviewErrorResponseSchema,
]);

export type ReviewFileContentResponse = z.infer<
  typeof ReviewFileContentResponseSchema
>;

export const ReviewRangeSchema = z
  .strictObject({
    fromLine: positiveInteger,
    toLine: positiveInteger,
  })
  .superRefine((range, context) => {
    if (range.toLine < range.fromLine) {
      context.addIssue({
        code: "custom",
        message: "must be >= fromLine",
        path: ["toLine"],
      });
    }
  });

export type ReviewRangeWire = z.infer<typeof ReviewRangeSchema>;

export const ReviewOpenEditorSchema = z.strictObject({
  path: requiredString,
  scheme: requiredString,
});

export const ReviewEditorSelectionSchema = z.strictObject({
  path: requiredString,
  startLine: positiveInteger,
  startColumn: positiveInteger,
  endLine: positiveInteger,
  endColumn: positiveInteger,
});

export const ReviewDesktopStateSchema = z.strictObject({
  openEditors: z.array(ReviewOpenEditorSchema),
  activeEditor: ReviewOpenEditorSchema.nullable(),
  selection: ReviewEditorSelectionSchema.nullable(),
});

const revealArgsSchema = z
  .strictObject({
    path: requiredString,
    startLine: positiveInteger,
    endLine: positiveInteger,
    side: reviewDiffSideSchema.optional(),
    pins: z
      .strictObject({
        repositoryId: requiredString,
        head: requiredString,
        base: requiredString.optional(),
      })
      .optional(),
    highlight: z.boolean().optional(),
    preserveFocus: z.boolean().optional(),
  })
  .superRefine((args, context) => {
    if (args.endLine < args.startLine) {
      context.addIssue({
        code: "custom",
        message: "must be >= args.startLine",
        path: ["endLine"],
      });
    }
  });

export const REVIEW_DISCORD_URL = "https://discord.gg/wYvd2cpMQg";

const apiReviewIdSchema = z.union([
  z.uuid(),
  z.string().regex(/^shared-[a-f0-9]{64}$/),
]);

export const ReviewVerbRequestSchema = z.discriminatedUnion("name", [
  z.strictObject({
    name: z.literal("authoringCapabilities"),
    args: z.strictObject({}),
  }),
  z.strictObject({ name: z.literal("joinDiscord"), args: z.strictObject({}) }),
  z.strictObject({
    name: z.literal("showReviewView"),
    args: z.strictObject({ view: reviewViewSchema }),
  }),
  z.strictObject({
    name: z.literal("openSourceTree"),
    args: z.strictObject({}),
  }),
  z.strictObject({
    name: z.literal("openDiff"),
    args: z.strictObject({
      path: requiredString,
      previousPath: requiredString.optional(),
    }),
  }),
  z.strictObject({ name: z.literal("reveal"), args: revealArgsSchema }),
  z.strictObject({ name: z.literal("focusWindow"), args: z.strictObject({}) }),
  z.strictObject({
    name: z.literal("captureScreenshot"),
    args: z.strictObject({}),
  }),
  z.strictObject({
    name: z.literal("openReviewRevision"),
    args: z.strictObject({
      revision: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .optional(),
      sealedAt: positiveInteger.optional(),
    }),
  }),
  z.strictObject({
    name: z.literal("openReview"),
    args: z.strictObject({
      reviewUuid: apiReviewIdSchema,
      active: z.boolean(),
      /** Block to scroll to after opening. */
      blockId: requiredString.optional(),
    }),
  }),
  z.strictObject({
    name: z.literal("openApiReview"),
    args: z.strictObject({
      reviewId: apiReviewIdSchema,
      title: requiredString,
    }),
  }),
]);

export type ReviewVerbRequest = z.infer<typeof ReviewVerbRequestSchema>;

export const ReviewVerbResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), result: z.unknown().optional() }),
  ReviewErrorResponseSchema,
]);

export type ReviewVerbResponse = z.infer<typeof ReviewVerbResponseSchema>;

export const ReviewDesktopVerbFrameSchema = z.strictObject({
  event: z.literal("desktop-verb"),
  id: requiredString,
  request: ReviewVerbRequestSchema,
});

export type ReviewDesktopVerbFrame = z.infer<
  typeof ReviewDesktopVerbFrameSchema
>;

export const ReviewDesktopVerbResultSchema = z.strictObject({
  id: requiredString,
  response: ReviewVerbResponseSchema,
});

export type ReviewDesktopVerbResult = z.infer<
  typeof ReviewDesktopVerbResultSchema
>;

export const ReviewSelectedDiffSchema = z.strictObject({
  oldPath: z.string(),
  newPath: z.string(),
  oldStart: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  rows: z.array(
    z.strictObject({
      kind: z.enum(["unchanged", "added", "deleted"]),
      text: z.string(),
    }),
  ),
});

export const ReviewApiSelectionSourceSchema = z.strictObject({
  reviewId: requiredString,
  version: z.number().int().nonnegative(),
  commit: requiredString.optional(),
  pins: z
    .strictObject({
      repositoryId: requiredString,
      head: requiredString,
      base: requiredString.optional(),
    })
    .optional(),
});

export const ReviewSurfaceEventSchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("editorSelectionChanged"),
    reviewId: requiredString,
    apiSource: ReviewApiSelectionSourceSchema.optional(),
    anchor: z
      .object({ x: z.number(), y: z.number(), right: z.number().optional() })
      .optional(),
    path: requiredString,
    range: ReviewRangeSchema,
    sideContext: reviewDiffSideSchema,
    isEmpty: z.boolean(),
    selectedDiff: ReviewSelectedDiffSchema.optional(),
  }),
  z.strictObject({
    event: z.literal("themeChanged"),
    theme: reviewThemeSchema,
  }),
  z.strictObject({
    event: z.literal("showReviewView"),
    view: reviewViewSchema,
    /** The board to switch, from its sidebar; else the one asking. */
    reviewId: requiredString.optional(),
  }),
  /** Scroll to a heading of the board on screen, from its sidebar's
   * Contents. */
  z.strictObject({
    event: z.literal("revealHeading"),
    reviewId: requiredString,
    headingId: requiredString,
  }),
  /** Show one block of a board, once that board is on screen. */
  z.strictObject({
    event: z.literal("revealBlock"),
    reviewId: requiredString,
    blockId: requiredString,
  }),
  /** Filter the board's diff to a lens, or clear it with null, from its
   * sidebar's Lenses. */
  z.strictObject({
    event: z.literal("selectLens"),
    reviewId: requiredString,
    lensId: requiredString.nullable(),
  }),
  /** Toggle a lens viewed, from the sidebar's Lenses. */
  z.strictObject({
    event: z.literal("markLens"),
    reviewId: requiredString,
    lensId: requiredString,
  }),
  /** Filter the board's Diff view to one commit, or to all of them with
   * null, from its sidebar's Commits. */
  z.strictObject({
    event: z.literal("pickCommit"),
    reviewId: requiredString,
    commit: requiredString.nullable(),
  }),
  /** Open a saved thread in Ask, from the sidebar's Threads. */
  z.strictObject({
    event: z.literal("openAskThread"),
    reviewId: requiredString,
    threadId: requiredString,
  }),
  /** Put the right column away, or bring back what it held. */
  z.strictObject({
    event: z.literal("toggleAskColumn"),
    reviewId: requiredString,
  }),
]);

export type ReviewSurfaceEvent = z.infer<typeof ReviewSurfaceEventSchema>;

// --- Agent trace view & trace quotes ----------------------------------------

export const ReviewAgentTraceListResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    configured: z.boolean().default(true),
    storage: z.enum(["s3", "hosted", "none"]).optional(),
    sources: z.array(z.enum(["s3", "hosted"])).optional(),
    storageError: requiredString.optional(),
    sessions: z.array(ReviewAgentTraceSessionSchema),
  }),
  ReviewErrorResponseSchema,
]);

export type ReviewAgentTraceListResponse = z.infer<
  typeof ReviewAgentTraceListResponseSchema
>;

export const ReviewAgentTraceResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    parserVersion: requiredString,
    session: ReviewAgentTraceSessionSchema,
    trace: stringAllowEmpty.nullable().optional(),
    // Whether the store confirmed this copy; absent from older CLIs.
    cacheStatus: z.enum(["current", "offline", "stale"]).optional(),
    subagents: z.array(requiredString).default([]),
    title: z.string().nullable(),
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    activeMs: z.number().nullable(),
    userTurns: z.number(),
    toolCalls: z.number(),
    events: z.array(ReviewAgentTraceEventSchema),
  }),
  ReviewErrorResponseSchema,
]);

export type ReviewAgentTraceResponse = z.infer<
  typeof ReviewAgentTraceResponseSchema
>;
