import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

import { type JsonValue, isJsonObject } from "@dev.fast/json";
import { runVcs } from "@dev.fast/local-vcs";
import {
  type BoardIconKind,
  type ReviewApiSummary,
  boardIconKind,
  boardTitle,
} from "@dev.fast/review-protocol";
import type { GitHubPullRequest } from "@review/github-pr-graph.js";
import { sourceAnchors } from "@review/lens-selection.js";
import {
  migrateStoredLenses,
  readStoredDocument,
} from "@review/stored-document-migration.js";
import {
  type Coverage,
  coverageSchema,
  emptyCoverage,
  updateCoverage,
} from "@review/viewed-coverage.js";
import { z } from "zod";

import { type ActivitySurface, ReviewActivity } from "./activity.js";
import { AskHistory } from "./ask-history.js";
import {
  type SiblingFacts,
  dependencyCycle,
  orderSiblings,
} from "./board-order.js";
import { CheckoutGroups, remoteGroup } from "./checkout-groups.js";
import {
  type Lens,
  applyLensEdit,
  lensEditSchema,
  lensSelections,
} from "./diff-lenses.js";
import {
  type Applied,
  type Block,
  type BoardLinkRef,
  type EditSummary,
  type Element,
  type FileLineRange,
  type Pins,
  ReviewInputError,
  type ReviewTarget,
  type SourcePins,
  type WrittenComponent,
  adoptFlowUnits,
  anchorPins,
  applyEdit,
  assignFreshIds,
  assignMissingIds,
  boardLinks,
  boardRepositoryId,
  checkReferences,
  commitLinkCommits,
  documentAdvice,
  documentSchema,
  editSchema,
  elements,
  explicitPins,
  pinDocumentReferences,
  pinnedRepositoryIds,
  resourceReferences,
  respellCommitLinks,
  respellDocumentLinks,
  respellEditLinks,
  reviewTargetSchema,
  sourceReferences,
  summarizeEdit,
} from "./document.js";
import { type BoardLinkPreview, boardLinkPreview } from "./link-preview.js";
import {
  pullRequestKey,
  pullRequestUrl,
  setPullRequest,
  sourceBranchName,
} from "./origin.js";
import { upgradeStore } from "./store-migrations.js";
import {
  BOARD_REPOSITORY_ID_SQL,
  initializeReviewStoreSchema,
} from "./store-schema.js";

const reviewId = z.string().min(1);

/** The key older hosts read and write. */
const statsKey = (pins: Pins) => JSON.stringify([pins, "structural"]);

/** How long a board stays in Trash before it is deleted. */
const TRASH_DAYS = 30;

const activityId = z
  .string()
  .min(1)
  .optional()
  .describe(
    "The activityId from review_activity_begin: your courier draws this edit. Never rejects a write.",
  );

const parentId = reviewId.describe(
  "The reviewId of a top-level review in the same project to nest this one under.",
);

const dependsOn = z
  .array(reviewId)
  .describe(
    "The reviewIds of reviews in the same project this one builds on. Siblings list after what they depend on.",
  );

export const commandSchema = z.strictObject({
  operation: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("delete"), reviewId }),
    z.strictObject({
      type: z.literal("lifecycle"),
      reviewId,
      state: z.enum(["active", "trash"]),
    }),
    z.strictObject({
      type: z.literal("attention"),
      reviewId,
      action: z.literal("view"),
    }),
    z.strictObject({
      type: z.literal("create"),
      /** Required unless pullRequestUrl alone names the source; then the PR
       * title. A person's new board may start with none; it reads
       * "Untitled" until they name it. */
      title: z.string().trim().optional(),
      target: reviewTargetSchema.optional(),
      pullRequestUrl: pullRequestUrl.optional(),
      /** With pullRequestUrl and no target: the checkout to fetch the PR into. */
      repositoryId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Only with pullRequestUrl and no target: the registered checkout to fetch the PR into.",
        ),
      /** Return the existing review for pullRequestUrl instead of creating one. */
      reuseExisting: z
        .boolean()
        .optional()
        .describe(
          "Default true: return the existing review for pullRequestUrl. false creates a separate review.",
        ),
      projectId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The project to file the whiteboard in: a project.id from session_list. Defaults to its checkout's.",
        ),
      parentId: parentId.optional(),
      dependsOn: dependsOn.optional(),
    }),
    z.strictObject({
      type: z.literal("set_parent"),
      reviewId,
      parentId: parentId.nullable(),
    }),
    z.strictObject({
      type: z.literal("set_dependencies"),
      reviewId,
      dependsOn,
    }),
    z.strictObject({
      type: z.literal("set_target"),
      reviewId,
      target: reviewTargetSchema.optional(),
      repositoryId: z.string().min(1).optional(),
      pullRequestUrl: pullRequestUrl.nullable().optional(),
    }),
    z.strictObject({
      type: z.literal("edit"),
      reviewId,
      edit: editSchema,
      activityId,
    }),
    z.strictObject({
      type: z.literal("lens_edit"),
      reviewId,
      edit: lensEditSchema,
      activityId,
    }),
    z.strictObject({
      type: z.literal("rename"),
      reviewId,
      title: z.string().trim().min(1),
    }),
    z.strictObject({
      type: z.literal("restore"),
      reviewId,
      version: z.number().int().nonnegative(),
    }),
  ]),
});

/** A person's save of a whole board from the canvas. A block they added
 * has no id and may carry a clientKey, which the response maps to its id. */
export const personEditSchema = z.strictObject({
  baseVersion: z.number().int().nonnegative(),
  /** Empty until the person names the board; it reads "Untitled". */
  title: z.string().trim(),
  document: z.array(z.json()),
});

/** The block a person's canvas has focus in; null clears it. */
export const focusLeaseSchema = z.strictObject({
  clientId: z.string().min(1),
  blockId: z.string().min(1).nullable(),
  /** false when the canvas closes the board. */
  open: z.boolean().optional(),
});

/** A focus lease lasts this long unless renewed. The canvas renews it every
 * few seconds, so a closed or crashed app releases its block on its own. */
export const FOCUS_LEASE_TTL_MS = 15_000;

/** How often a discard looks again for a canvas letting go of the board. */
const DISCARD_POLL_MS = 100;

/** What a person's save wrote: the version, and the id each new block got
 * by its clientKey. */
export interface PersonEditResult {
  reviewId: string;
  version: number;
  ids: Record<string, string>;
}

/** One row of a board's history. */
export interface HistoryEntry {
  version: number;
  title: string;
  createdAt: string;
  /** "you" for a version a person saved from the canvas; absent for one
   * saved before Whiteboard recorded who wrote it. */
  author?: "you" | "agent";
  /** The Ask thread whose edit made this version, if any. */
  threadId?: string;
}

/** Source identity displayed in the review header and Home, alongside immutable pins. */
export interface SnapshotOrigin {
  branch?: string;
  baseRef?: string;
  /** The base the review's target names, such as the branch below it. */
  baseBranch?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  /** As the forge reported it when the PR was attached. */
  pullRequestTitle?: string;
  /** The branch the PR merges into, which can differ from baseBranch. */
  pullRequestBaseBranch?: string;
  /** The legacy review revision this version was imported from. */
  revision?: string;
}

/**
 * The project of a registered checkout, made on first use. Checkouts of one
 * repository (worktrees, or clones of one GitHub repository) share it. A
 * deleted checkout joins the project of the existing one it belonged to
 * (see `CheckoutGroups.ownerOf`), else gets its own.
 */
export function projectOfCheckout(
  db: DatabaseSync,
  repositoryId: string,
  groups = new CheckoutGroups(db),
): string {
  const {
    path: root,
    name,
    project_id: projectOf,
  } = db
    .prepare("SELECT path, name, project_id FROM repositories WHERE id=?")
    .get(repositoryId)!;

  if (projectOf) return String(projectOf);

  const join = (projectId: string) => {
    db.prepare("UPDATE repositories SET project_id=? WHERE id=?").run(
      projectId,
      repositoryId,
    );

    return projectId;
  };

  if (!existsSync(String(root))) {
    const owner = groups.ownerOf(repositoryId);

    if (owner) return join(projectOfCheckout(db, owner, groups));
  }

  const group = groups.group(String(root));

  const sibling =
    group &&
    db
      .prepare(
        "SELECT project_id, path FROM repositories WHERE project_id IS NOT NULL",
      )
      .all()
      .find(
        ({ path: checkout }) =>
          groups.group(String(checkout))?.key === group.key,
      );

  if (sibling) return join(String(sibling.project_id));

  const projectId = randomUUID();

  db.prepare("INSERT INTO projects(id,name) VALUES(?,?)").run(
    projectId,
    group?.label ?? String(name),
  );

  return join(projectId);
}

export interface Snapshot {
  /** Current lifecycle state, projected onto every version when read. */
  trashedAt?: string | null;
  shared?: { login?: string; sharedAt?: number; cloneUrl?: string };
  reviewId: string;
  version: number;
  title: string;
  /** The default pins for references that name none. A document whose
   * references all carry their own pins has neither pins nor target. */
  pins?: Pins;
  target?: ReviewTarget;
  staleSources?: string[];
  sourceUnavailable?: boolean;
  document: Block[];
  /** The Diff view's lenses, beside the document and versioned with it.
   * Absent on a version with none. */
  lenses?: Lens[];
  createdAt: string;
  origin?: SnapshotOrigin;
  /** The edit that produced this version, when one did; absent for a
   * rename, set_target, restore or import, which the canvas does not draw. */
  lastEdit?: EditSummary;
  /** The Ask thread that caused this version when it made no edit to
   * name it on: a create, rename, retarget or restore. */
  threadId?: string;
  /** A person saved this version from the canvas: the blocks they added,
   * removed or changed. Absent on every other version. */
  personEdit?: { changed: string[]; ids?: Record<string, string> };
}

/** The Ask thread a version names, on its edit or on itself; stored in
 * `versions.thread_id` so a thread's boards are one index away. */
const versionThread = (snapshot: Snapshot) =>
  snapshot.lastEdit?.threadId ?? snapshot.threadId ?? null;

/** Who is writing: the rules a write keeps depend on it. */
export type Author =
  /** An agent, through the API; a thread's agent stamps its versions
   * with the thread. */
  | { kind: "agent"; threadId?: string }
  /** A person, from Desktop or the canvas. */
  | { kind: "person" };

export interface Result {
  /** Create only: false when an existing review for the same PR came back. */
  created?: boolean;
  /** Why an existing review came back, and what to do next, in words. */
  note?: string;
  reviewId: string;
  version: number;
  /** The existing review's stored target; the requested one is not applied. */
  target?: ReviewTarget;
  /** The requested head differs from the existing review's. */
  headMoved?: boolean;
  /** An agent is working on the existing review. */
  working?: boolean;
  /** Older reviews that also name the PR, newest first. */
  otherReviewIds?: string[];
  /** The component an edit landed on, its type, and — for an insert or
   * replace — its first-level children with their fresh IDs. */
  targetId?: string;
  type?: Element["type"] | "lens";
  children?: WrittenComponent[];
  attention?: true;
  lifecycle?: true;
  deleted?: true;
  /** After set_parent or set_dependencies: the board's relations. */
  relations?: BoardRelations;
  warnings?: string[];
}

export interface StoreChange extends Result {
  titleChanged?: true;
  /** Project, repository or kind (icon) changed. */
  placeChanged?: true;
  threadId?: string;
  /** Saved by another process; changes unknown. */
  external?: true;
}

type ShownChange = Omit<StoreChange, keyof Result>;

/** A board as its place in a project shows it. */
export interface PlacedBoard {
  reviewId: string;
  title: string;
  target?: ReviewTarget;
  origin?: SnapshotOrigin;
}

/** Where a board sits among its project's boards. Kept outside its versions. */
export interface BoardRelations {
  parentId: string | null;
  /** In sibling order. */
  children: string[];
  dependsOn: string[];
}

/** A PR's current comparison: GitHub's head and diff base, fetched locally. */
export interface ResolvedPullRequest {
  target: ReviewTarget;
  pins: Pins;
  /** Empty when the PR has none. */
  title: string;
  branch?: string;
  baseBranch: string;
}

/** A command with its network context resolved, ready for the write queue. */
interface PreparedCommand {
  op: z.infer<typeof commandSchema>["operation"];
  requestedTarget: ReviewTarget | undefined;
  fromPullRequest: ResolvedPullRequest | undefined;
  resolvedTarget: { target: ReviewTarget; pins?: Pins } | undefined;
  resolvedBranch: string | undefined;
  discoveredPullRequest: GitHubPullRequest | undefined;
  resolvedTitle: string | undefined;
}

export interface ReviewProviders {
  findPullRequest?(
    pins: Pins,
    branch: string,
  ): Promise<GitHubPullRequest | undefined>;
  headBranch?(pins: Pins, headRef?: string): Promise<string | undefined>;
  projectSource?(snapshot: Snapshot, pins: Pins): Promise<Snapshot>;
  /** Fetch a PR into the registered checkout the caller names. */
  resolvePullRequest?(
    url: string,
    repository: { id: string },
  ): Promise<ResolvedPullRequest>;
  /** Undefined when the forge can't be read. */
  pullRequestTitle?(url: string): Promise<string | undefined>;
  resolveTarget?(
    target: ReviewTarget,
    pinned?: Pins,
  ): Promise<{ target: ReviewTarget; pins: Pins }>;
  /** Rejects with a 404 ReviewInputError when the snapshot's checkout is gone.
   * Resolves undefined for a document without default pins. */
  sourcePins?(snapshot: Snapshot): Promise<Pins | undefined>;
  /** Ids of references whose own pins no longer name a usable checkout. */
  unavailableAnchors?(snapshot: Snapshot): Promise<string[]>;
  validatePins(pins: Pins): Promise<void>;
  /** The full commit a commit ID or its prefix names, if any. */
  resolveCommit?(
    repositoryId: string,
    commit: string,
  ): Promise<string | undefined>;
  /** The files each side's commit changed from one set of pins to another,
   * or undefined when they can't be diffed commit to commit. */
  filesChangedBetween?(
    from: Pins,
    to: Pins,
  ): Promise<{ base: Set<string>; head: Set<string> } | undefined>;
  validateSource(
    pins: Pins,
    source: FileLineRange,
    options: { peek: boolean },
  ): Promise<void>;
  validateResource(pins: Pins | undefined, block: Block): Promise<void>;
  /** A PR's base branch, as last read from GitHub; undefined until read. */
  pullRequestBaseBranch?(url: string): string | undefined;
}

/** One instance owned by the desktop server. All writers go through execute().
 * The queue includes async validation; SQLite transactions contain only writes.
 * This prototype uses a new, explicitly supplied database, never an existing profile.
 */
export class ReviewStore {
  readonly activity: ReviewActivity;
  readonly askHistory: AskHistory;
  private readonly db: DatabaseSync;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly preparing = new Set<Promise<unknown>>();
  private closing = false;
  private readonly liveSources = new Map<string, Snapshot>();
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshSubscribers = 0;
  private readonly purgeTimer: ReturnType<typeof setInterval>;

  watchWorktrees(): () => void {
    this.refreshSubscribers++;
    this.refreshTimer ??= setInterval(() => {
      void this.refreshWorktrees();
    }, 1000);
    this.refreshTimer.unref();

    return () => {
      if (--this.refreshSubscribers === 0) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = undefined;
      }
    };
  }

  private async projectLiveSource(
    snapshot: Snapshot,
    current = snapshot,
  ): Promise<Snapshot> {
    if (snapshot.target?.kind !== "worktree") {
      await this.providers.sourcePins?.(snapshot);

      // References with their own pins go unavailable one at a time.
      const unavailable =
        (await this.providers.unavailableAnchors?.(snapshot)) ?? [];

      const stale = [
        ...new Set([...(snapshot.staleSources ?? []), ...unavailable]),
      ];

      const staleChanged =
        JSON.stringify(stale) !== JSON.stringify(current.staleSources ?? []);

      if (!current.sourceUnavailable && !staleChanged) return current;
      const projected = { ...current, sourceUnavailable: undefined };

      if (stale.length) projected.staleSources = stale;
      else delete projected.staleSources;

      return projected;
    }

    const { pins } = await this.providers.resolveTarget!(
      snapshot.target,
      current.pins,
    );

    if (
      JSON.stringify(current.pins) === JSON.stringify(pins) &&
      !current.sourceUnavailable
    )
      return current;

    return this.providers.projectSource
      ? this.providers.projectSource(snapshot, pins)
      : { ...snapshot, pins, sourceUnavailable: undefined };
  }

  private refreshPending: Promise<void> | undefined;

  /** What the last refresh saw of each review. A live worktree's snapshot is
   * kept, since every pass projects it again. */
  private readonly refreshed = new Map<
    string,
    {
      state: string;
      repositories: Set<string>;
      live?: Snapshot;
    }
  >();
  private availableRepositories?: Set<string>;

  /** Reviews whose source may have moved since the last pass: every live
   * worktree, and any other review that is new, edited, restored from trash or
   * reads from a repository that appeared or went away. */
  private *reviewsToRefresh(): Generator<Snapshot> {
    const available = new Set(
      this.repositories()
        .filter((repository) => existsSync(repository.path))
        .map((repository) => repository.id),
    );

    const previous = this.availableRepositories;
    this.availableRepositories = available;

    const flipped = (id: string) =>
      !previous || previous.has(id) !== available.has(id);

    const rows = this.db
      .prepare(
        "SELECT reviews.id, reviews.version, review_attention.deleted_at FROM reviews LEFT JOIN review_attention ON review_attention.review_id=reviews.id",
      )
      .all();

    const present = new Set<string>();

    for (const row of rows) {
      const reviewId = String(row.id);
      const version = Number(row.version);
      const state = `${version}\0${row.deleted_at ?? ""}`;
      present.add(reviewId);

      let seen = this.refreshed.get(reviewId);

      if (seen?.state === state) {
        if (seen.live) yield seen.live;
        else if ([...seen.repositories].some(flipped))
          yield this.read(reviewId, version);
        continue;
      }

      const snapshot = row.deleted_at
        ? undefined
        : this.read(reviewId, version);

      // Trash stays as it was stored.
      if (!snapshot) {
        this.refreshed.set(reviewId, { state, repositories: new Set() });
        continue;
      }

      const live = snapshot.target?.kind === "worktree";

      seen = {
        state,
        repositories: live
          ? new Set()
          : new Set([
              ...(snapshot.pins ? [snapshot.pins.repositoryId] : []),
              ...pinnedRepositoryIds(snapshot.document),
            ]),
        live: live ? snapshot : undefined,
      };
      this.refreshed.set(reviewId, seen);
      yield snapshot;
    }

    for (const reviewId of this.refreshed.keys())
      if (!present.has(reviewId)) this.refreshed.delete(reviewId);
  }

  /** Refresh source state without writing authored document versions. Serialized with edits. */
  refreshWorktrees(): Promise<void> {
    if (this.closing || !this.providers.resolveTarget) return Promise.resolve();

    if (this.refreshPending) return this.refreshPending;

    const run = this.pending.then(async () => {
      let slice = performance.now();

      for (const snapshot of this.reviewsToRefresh()) {
        // The first pass reads every review; let requests in between.
        if (performance.now() - slice > 16) {
          await new Promise((resolve) => setImmediate(resolve));
          slice = performance.now();
        }

        try {
          const live = this.liveSources.get(snapshot.reviewId);
          const last = live?.version === snapshot.version ? live : snapshot;
          const previous = last.pins;
          const projected = await this.projectLiveSource(snapshot, last);

          if (projected === last) continue;
          this.liveSources.set(snapshot.reviewId, projected);

          if (
            JSON.stringify(previous) !== JSON.stringify(projected.pins) ||
            JSON.stringify(last.staleSources ?? []) !==
              JSON.stringify(projected.staleSources ?? []) ||
            last.sourceUnavailable
          )
            this.notify({
              reviewId: snapshot.reviewId,
              version: snapshot.version,
            });
        } catch (error) {
          if (error instanceof ReviewInputError && error.status === 404) {
            const last = this.read(snapshot.reviewId);

            if (!last.sourceUnavailable) {
              this.liveSources.set(snapshot.reviewId, {
                ...last,
                sourceUnavailable: true,
              });
              this.notify({
                reviewId: snapshot.reviewId,
                version: snapshot.version,
              });
            }
          }
        }
      }
    });

    this.pending = run.catch(() => {});

    this.refreshPending = run.finally(() => {
      this.refreshPending = undefined;
    });

    return this.refreshPending;
  }
  private readonly listeners = new Set<(change: StoreChange) => void>();
  private readonly catalogListeners = new Set<() => void>();
  private readonly externalChanges: ReturnType<typeof setInterval>;
  private observedDataVersion: number;
  private observedVersions = new Map<string, number>();
  private observedDeletions = new Map<string, string>();
  subscribeCatalog(listener: () => void) {
    this.catalogListeners.add(listener);

    return () => {
      this.catalogListeners.delete(listener);
    };
  }
  subscribe(listener: (change: StoreChange) => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
  constructor(
    databasePath: string,
    private readonly providers: ReviewProviders,
    /** How the checkouts group, if `groupCheckoutsAhead` worked it out. */
    private readonly checkoutOwners?: ReadonlyMap<string, string>,
  ) {
    // WAL plus a busy timeout: another host on the same home waits instead of failing.
    this.db = new DatabaseSync(databasePath, { timeout: 5000 });
    initializeReviewStoreSchema(this.db);
    // Each upgrade reads a quoted file once, before its write lock and in it.
    const files = new Map<string, string | undefined>();

    upgradeStore({
      db: this.db,
      prepareCheckouts: () => this.checkouts.prepare(),
      repositories: () => this.repositories(),
      repositoryPath: (repositoryId) => this.repositoryPath(repositoryId),
      repositoryName: (repositoryId) => this.repositoryName(repositoryId),
      fileAtCommit: (repositoryId, commit, file) => {
        const key = JSON.stringify([repositoryId, commit, file]);

        if (!files.has(key))
          files.set(key, this.fileAtCommit(repositoryId, commit, file));

        return files.get(key);
      },
      projectOfRepository: (repositoryId) =>
        this.projectOfRepository(repositoryId),
      fallbackProject: () => this.fallbackProject(),
      rewriteVersion: (reviewId, version, snapshot) =>
        this.rewriteVersion(reviewId, version, snapshot),
      firstRepositoryProject: () => {
        const [first] = this.repositories();

        return first
          ? this.projectOfRepository(first.id)
          : this.fallbackProject();
      },
    });
    this.activity = new ReviewActivity(this.db, (id) =>
      this.assertWritable(id),
    );
    this.askHistory = new AskHistory(this.db, (id) =>
      this.assertOutOfTrash(id),
    );

    this.purgeExpired();
    this.purgeTimer = setInterval(() => this.purgeExpired(), 60_000);
    this.purgeTimer.unref();

    this.observedDataVersion = this.dataVersion();
    this.observedVersions = this.currentVersions();
    this.observedDeletions = this.currentDeletions();
    this.externalChanges = setInterval(
      () => this.refreshExternalChanges(),
      250,
    );
    this.externalChanges.unref();
  }

  /** Saves a version over what it was; the current one re-indexes its
   * board's links, as every written version does. */
  private rewriteVersion(
    reviewId: string,
    version: number,
    snapshot: JsonValue,
  ) {
    this.db
      .prepare("UPDATE versions SET snapshot=? WHERE review_id=? AND version=?")
      .run(JSON.stringify(snapshot), reviewId, version);

    if (version !== this.currentVersion(reviewId)) return;

    try {
      this.indexBoardLinks(reviewId, this.read(reviewId).document);
    } catch {
      // A version that no longer reads indexes nothing.
    }
  }

  /** The project of a registered checkout, made on first use. Checkouts of
   * one repository (worktrees, or clones with one origin) share it. */
  projectOfRepository(repositoryId: string): string {
    const row = this.db
      .prepare("SELECT project_id FROM repositories WHERE id=?")
      .get(repositoryId);

    if (!row) return this.fallbackProject();

    if (row.project_id) return String(row.project_id);

    return projectOfCheckout(this.db, repositoryId, this.checkouts);
  }

  private fallbackProject(): string {
    const found = this.db
      .prepare(
        "SELECT id FROM projects WHERE name='Whiteboards' AND id NOT IN (SELECT project_id FROM repositories WHERE project_id IS NOT NULL) ORDER BY rowid LIMIT 1",
      )
      .get();

    if (found) return String(found.id);

    const projectId = randomUUID();

    this.db
      .prepare("INSERT INTO projects(id,name) VALUES(?,?)")
      .run(projectId, "Whiteboards");

    return projectId;
  }

  /** A checkout's project, as the catalog lists it; undefined once the
   * checkout is unregistered. */
  checkoutProject(
    repositoryId: string,
  ): ReviewApiSummary["project"] | undefined {
    if (!this.repositories().some(({ id }) => id === repositoryId))
      return undefined;

    const id = this.projectOfRepository(repositoryId);

    const { name } = this.db
      .prepare("SELECT name FROM projects WHERE id=?")
      .get(id)!;

    return { id, name: String(name) };
  }

  /** Undefined when the file can't be read. */
  private fileAtCommit(
    repositoryId: string,
    commit: string,
    file: string,
  ): string | undefined {
    try {
      return this.checkouts.fileAt(
        this.repositoryPath(repositoryId),
        commit,
        file,
      );
    } catch {
      return undefined;
    }
  }

  /** A checkout's name as its project labels it, else its folder. */
  private repositoryName(repositoryId: string): string {
    try {
      const root = this.repositoryPath(repositoryId);

      return (
        this.repositoryGroup(root)?.label.split("/").at(-1) ??
        path.basename(root)
      );
    } catch {
      return "another repository";
    }
  }

  /** A board's project. */
  projectOf(id: string): string {
    const row = this.db
      .prepare("SELECT project_id FROM reviews WHERE id=?")
      .get(id);

    if (!row) this.assertExists(id);

    return String(row!.project_id);
  }

  private dataVersion() {
    return Number(this.db.prepare("PRAGMA data_version").get()!.data_version);
  }

  private currentVersions() {
    return new Map(
      this.db
        .prepare("SELECT id,version FROM reviews")
        .all()
        .map((row) => [String(row.id), Number(row.version)]),
    );
  }

  private currentDeletions() {
    return new Map(
      this.db
        .prepare(
          "SELECT review_id,deleted_at FROM review_attention WHERE deleted_at IS NOT NULL",
        )
        .all()
        .map((row) => [String(row.review_id), String(row.deleted_at)]),
    );
  }
  private refreshExternalChanges() {
    const version = this.dataVersion();

    if (version === this.observedDataVersion) return;
    this.observedDataVersion = version;
    const current = this.currentVersions();
    const previous = this.observedVersions;
    const deletions = this.currentDeletions();
    const previousDeletions = this.observedDeletions;
    this.observedDeletions = deletions;
    this.observedVersions = current;

    for (const [reviewId, savedVersion] of current) {
      if (previous.get(reviewId) !== savedVersion)
        this.notify({ reviewId, version: savedVersion, external: true });
      else if (previousDeletions.get(reviewId) !== deletions.get(reviewId))
        this.notify({
          reviewId,
          version: savedVersion,
          lifecycle: true,
          attention: true,
        });
    }

    for (const [reviewId, savedVersion] of previous)
      if (!current.has(reviewId)) {
        this.activity.deleted(reviewId);
        this.notify({ reviewId, version: savedVersion, deleted: true });
      }

    this.activity.refresh();

    // Attention and repository/resource changes need catalog invalidation too.
    for (const listener of this.catalogListeners) {
      try {
        listener();
      } catch {
        /* Disconnected readers do not stop polling. */
      }
    }
  }
  /** Reader progress never creates a document version or authoring event. */
  viewedCoverage(
    reviewId: string,
  ): Map<string, { fingerprint: string; coverage: Coverage }> {
    this.assertExists(reviewId);

    return new Map(
      this.db
        .prepare(
          "SELECT file,fingerprint,coverage FROM review_coverage WHERE review_id=?",
        )
        .all(reviewId)
        .map((row) => [
          String(row.file),
          {
            fingerprint: String(row.fingerprint),
            coverage: coverageSchema.parse(JSON.parse(String(row.coverage))),
          },
        ]),
    );
  }
  updateViewedCoverage(
    reviewId: string,
    files: { path: string; fingerprint: string; scope: Coverage }[],
    viewed: boolean,
  ): void {
    this.assertWritable(reviewId);
    this.db.exec("BEGIN IMMEDIATE");

    try {
      this.assertWritable(reviewId);
      const current = this.viewedCoverage(reviewId);

      for (const file of files) {
        const previous = current.get(file.path);

        const coverage = updateCoverage(
          previous?.fingerprint === file.fingerprint
            ? previous.coverage
            : emptyCoverage(),
          file.scope,
          viewed,
        );

        this.db
          .prepare(
            "INSERT OR REPLACE INTO review_coverage(review_id,file,fingerprint,coverage) VALUES(?,?,?,?)",
          )
          .run(reviewId, file.path, file.fingerprint, JSON.stringify(coverage));
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private checkoutGroups: CheckoutGroups | undefined;

  /** How the store's checkouts group into projects, kept for the open. */
  private get checkouts() {
    return (this.checkoutGroups ??= new CheckoutGroups(
      this.db,
      undefined,
      this.checkoutOwners,
    ));
  }

  private repositoryGroup(root: string) {
    return this.checkouts.group(root);
  }

  private sameRepository(left: string, right: string): boolean {
    if (left === right) return true;
    const group = this.repositoryGroup(this.repositoryPath(left));

    return (
      group !== undefined &&
      group.key === this.repositoryGroup(this.repositoryPath(right))?.key
    );
  }

  registerRepository(root: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO repositories(id,path,name) VALUES(?,?,?)")
      .run(randomUUID(), root, root.split(/[\\/]/).at(-1)!);

    const row = this.db
      .prepare("SELECT id,name FROM repositories WHERE path=?")
      .get(root)!;

    this.projectOfRepository(String(row.id));

    return { id: String(row.id), name: String(row.name) };
  }
  /** Forgets a checkout no board uses, after every write queued before it,
   * so a board being made with it keeps it. */
  unregisterRepository(id: string): Promise<void> {
    if (this.preparing.size)
      return Promise.allSettled([...this.preparing]).then(() =>
        this.unregisterRepository(id),
      );

    const run = this.pending.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");

      try {
        const used = this.db
          // Document pins and per-reference pins both spell the id in the snapshot.
          .prepare(`SELECT EXISTS (SELECT 1 FROM versions WHERE instr(snapshot, ?) > 0)
          OR EXISTS (SELECT 1 FROM resources WHERE repository_id=?) AS used`)
          .get(`"repositoryId":${JSON.stringify(id)}`, id)!.used;

        // Its project stays, with any boards in it.
        if (!used)
          this.db.prepare("DELETE FROM repositories WHERE id=?").run(id);

        this.db.exec("COMMIT");
      } catch (error) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
        throw error;
      }
    });

    this.pending = run.catch(() => {});

    return run;
  }
  /** Checkouts whose remote is cloneUrl, most recently used first. */
  checkoutsOf(cloneUrl: string): string[] {
    const key = remoteGroup(cloneUrl)?.key;

    if (!key) return [];

    const used = (repositoryId: string) =>
      String(
        this.db
          .prepare(
            `SELECT MAX(json_extract(versions.snapshot,'$.createdAt')) AS at
            FROM reviews JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
            WHERE json_extract(versions.snapshot,'$.target.repositoryId')=?`,
          )
          .get(repositoryId)?.at ?? "",
      );

    return this.repositories()
      .filter((repository) => {
        try {
          return this.repositoryGroup(repository.path)?.key === key;
        } catch {
          return false;
        }
      })
      .map((repository) => ({ id: repository.id, at: used(repository.id) }))
      .sort((left, right) => right.at.localeCompare(left.at))
      .map((repository) => repository.id);
  }

  /** Registered checkouts, oldest registration first. */
  repositories() {
    return this.db
      .prepare("SELECT id,path FROM repositories ORDER BY rowid")
      .all()
      .map((row) => ({ id: String(row.id), path: String(row.path) }));
  }
  repositoryPath(id: string) {
    const row = this.db
      .prepare("SELECT path FROM repositories WHERE id=?")
      .get(id);

    if (!row) throw new ReviewInputError("Repository is not registered.", 404);

    return String(row.path);
  }
  putResource(
    id: string,
    repositoryId: string,
    kind: string,
    mimeType: string,
    data: Uint8Array,
  ) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO resources(id,repository_id,kind,mime_type,data) VALUES(?,?,?,?,?)",
      )
      .run(id, repositoryId, kind, mimeType, data);
    const saved = this.resource(id);

    if (
      saved.repositoryId !== repositoryId ||
      saved.kind !== kind ||
      saved.mimeType !== mimeType ||
      !Buffer.from(saved.data).equals(data)
    )
      throw new ReviewInputError(
        "Resource ID was already used for different content.",
        409,
      );

    return { id, kind, mimeType };
  }
  resource(id: string) {
    const row = this.db.prepare("SELECT * FROM resources WHERE id=?").get(id);

    if (!row) throw new ReviewInputError("Resource not found.", 404);

    return {
      id,
      repositoryId: String(row.repository_id),
      kind: String(row.kind),
      mimeType: String(row.mime_type),
      // SAFETY: resources.data is a BLOB written by putResource; node:sqlite returns Uint8Array.
      data: row.data as Uint8Array,
    };
  }
  async close() {
    this.closing = true;
    clearInterval(this.externalChanges);
    clearInterval(this.refreshTimer);
    clearInterval(this.purgeTimer);
    await Promise.allSettled([...this.preparing]);
    await this.pending;
    this.listeners.clear();
    this.catalogListeners.clear();
    this.activity.close();
    this.db.close();
  }
  /** Stable across restarts; the first host on a new store chooses it. */
  serverId(): string {
    const read = () =>
      this.db.prepare("SELECT id FROM server_identity").get()?.id;

    let id = read();

    if (id === undefined) {
      // Another host may insert first; its id wins.
      this.db
        .prepare("INSERT OR IGNORE INTO server_identity(one,id) VALUES(1,?)")
        .run(randomUUID());
      id = read();
    }

    return String(id);
  }
  resetServerId(): string {
    const id = randomUUID();
    this.db
      .prepare("INSERT OR REPLACE INTO server_identity(one,id) VALUES(1,?)")
      .run(id);

    return id;
  }
  /** The 404 check alone, without loading a snapshot. */
  assertExists(id: string) {
    if (!this.db.prepare("SELECT 1 FROM reviews WHERE id=?").get(id))
      throw new ReviewInputError(
        "Review not found. If this is an old Whiteboard review, ask your agent to migrate your old Whiteboard reviews.",
        404,
      );
  }
  /** A board that exists and isn't in Trash: the one rule every write
   * about a board keeps. */
  assertWritable(id: string) {
    this.assertExists(id);
    this.assertOutOfTrash(id);
  }
  /** Refuses a board in Trash, which is read-only until it is restored. */
  assertOutOfTrash(id: string) {
    const trashedAt = this.trashTime(id);

    if (trashedAt)
      throw new ReviewInputError(
        `This whiteboard was moved to Trash on ${new Date(trashedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Restore it with session_lifecycle({"sessionId":"${id}","state":"active"}) to continue.`,
        409,
      );
  }
  private trashTime(id: string): string | null {
    const row = this.db
      .prepare("SELECT deleted_at FROM review_attention WHERE review_id=?")
      .get(id);

    return row?.deleted_at ? String(row.deleted_at) : null;
  }
  /** Removes a board for good, from Delete… or Trash's purge. Links into
   * it stay, and show it as deleted. */
  private removePermanently(id: string) {
    const { title } = this.read(id);

    for (const table of [
      "authoring_presences",
      "review_coverage",
      "review_attention",
      "versions",
    ])
      this.db.prepare(`DELETE FROM ${table} WHERE review_id=?`).run(id);
    this.askHistory.removeReview(id);
    // Its children move up to top level, its dependencies and the links
    // on it go, by the schema's foreign keys. Links into it stay, and the
    // tombstone shows it as deleted, in the project it was in.
    this.db
      .prepare(
        "INSERT OR REPLACE INTO deleted_boards(id,title,deleted_at,project_id) VALUES(?,?,?,(SELECT project_id FROM reviews WHERE id=?))",
      )
      .run(id, title, new Date().toISOString(), id);
    this.db.prepare("DELETE FROM reviews WHERE id=?").run(id);
    this.liveSources.delete(id);
  }
  /** Deletes the boards 30 days in Trash, each as Delete… would. */
  private purgeExpired() {
    const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();

    const expired = () =>
      this.db
        .prepare(
          "SELECT review_id FROM review_attention JOIN reviews ON reviews.id=review_id WHERE deleted_at <= ?",
        )
        .all(cutoff)
        .map((row) => String(row.review_id));

    for (const reviewId of expired())
      // Restored meanwhile, by another host on this home: it stays.
      // Trash's own deadline, which no hold or thread stops.
      this.deleteBoard(
        this.read(reviewId),
        { kind: "person" },
        {
          guard: () => {
            if (!expired().includes(reviewId))
              throw new ReviewInputError("Restored from Trash.", 409);
          },
        },
      );
  }

  read(id: string, version?: number): Snapshot {
    const row =
      version === undefined
        ? this.db
            .prepare(
              "SELECT snapshot FROM versions JOIN reviews ON reviews.id=review_id AND reviews.version=versions.version WHERE reviews.id=?",
            )
            .get(id)
        : this.db
            .prepare(
              "SELECT snapshot FROM versions WHERE review_id=? AND version=?",
            )
            .get(id, version);

    if (!row) {
      this.assertExists(id);
      throw new ReviewInputError("Review version not found.", 404);
    }

    // SAFETY: versions contains only snapshots validated by execute before committing.
    const snapshot = JSON.parse(String(row.snapshot)) as Snapshot;

    // SAFETY: stored blocks were validated on write; migration only replaces
    // retired attachment representations with their canonical equivalent and
    // drops retired fields.
    // Lenses saved as document blocks read as the snapshot's own.
    const { document, lenses } = readStoredDocument(snapshot.document);

    // SAFETY: stored blocks were validated on write; migration only replaces
    // retired representations and lifts retired lens blocks out.
    snapshot.document = document as Block[];

    if (snapshot.lenses)
      // SAFETY: as above, migration only rewrites retired range forms.
      snapshot.lenses = migrateStoredLenses(snapshot.lenses) as Lens[];

    if (lenses.length)
      snapshot.lenses = [...(snapshot.lenses ?? []), ...lenses];

    if (snapshot.pins)
      snapshot.target ??= {
        kind: "commits",
        repositoryId: snapshot.pins.repositoryId,
        base: snapshot.pins.base,
        head: snapshot.pins.head,
      };
    const live = version === undefined ? this.liveSources.get(id) : undefined;

    if (live?.version === snapshot.version)
      return { ...structuredClone(live), trashedAt: this.trashTime(id) };

    snapshot.trashedAt = this.trashTime(id);

    return snapshot;
  }
  setDiffStats(pins: Pins, stats: NonNullable<ReviewApiSummary["diffStats"]>) {
    if (this.closing) return;
    this.db
      .prepare(
        "INSERT OR REPLACE INTO comparison_stats(identity, stats) VALUES (?, ?)",
      )
      .run(statsKey(pins), JSON.stringify(stats));

    for (const listener of this.catalogListeners) {
      try {
        listener();
      } catch {
        /* A disconnected viewer must not block other catalog subscribers. */
      }
    }
  }

  list(): ReviewApiSummary[] {
    return this.summaries();
  }
  listProject(projectId: string): ReviewApiSummary[] {
    return this.summaries("reviews.project_id=?", projectId);
  }
  /** One review's catalog entry, as review_list shows it. */
  summary(id: string): ReviewApiSummary | undefined {
    return this.summaries("reviews.id=?", id)[0];
  }
  private summaries(where = "1", ...params: string[]): ReviewApiSummary[] {
    // One query, and the document never leaves SQLite: every catalog watcher
    // re-lists on every command.

    const reviews = this.db
      .prepare(
        `SELECT json_remove(versions.snapshot,'$.document') AS summary,
          (SELECT json_extract(first.snapshot,'$.createdAt') FROM versions AS first WHERE first.review_id=reviews.id ORDER BY first.version LIMIT 1) AS first_created_at,
          review_attention.viewed_at, review_attention.deleted_at, repositories.name AS repository_name, repositories.path AS repository_path,
          projects.id AS project_id, projects.name AS project_name
        FROM reviews
        JOIN projects ON projects.id=reviews.project_id
        JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
        LEFT JOIN review_attention ON review_attention.review_id=reviews.id
        LEFT JOIN repositories ON repositories.id=${BOARD_REPOSITORY_ID_SQL}
        WHERE ${where}
        ORDER BY reviews.rowid`,
      )
      .all(...params)
      .map((row) => {
        // SAFETY: versions contains only snapshots validated by execute before committing.
        const summary = JSON.parse(String(row.summary)) as Omit<
          Snapshot,
          "document"
        >;

        if (summary.pins)
          summary.target ??= {
            kind: "commits",
            repositoryId: summary.pins.repositoryId,
            base: summary.pins.base,
            head: summary.pins.head,
          };

        const live = this.liveSources.get(summary.reviewId);

        if (
          live?.version === summary.version &&
          summary.target?.kind === "worktree"
        )
          summary.pins = live.pins;

        const listed: ReviewApiSummary = {
          ...summary,
          firstCreatedAt: row.first_created_at
            ? String(row.first_created_at)
            : undefined,
          repositoryPath: row.repository_path
            ? String(row.repository_path)
            : undefined,
          project: {
            id: String(row.project_id),
            name: String(row.project_name),
          },
          repositoryName: row.repository_name
            ? String(row.repository_name)
            : "(unknown repository)",
          viewedAt: row.viewed_at ? String(row.viewed_at) : null,
          trashedAt: row.deleted_at ? String(row.deleted_at) : null,
          // Any unseen version counts, whoever saved it.
          changed: !row.viewed_at || summary.createdAt > String(row.viewed_at),
          working: this.activity.isWorking(summary.reviewId),
        };

        return listed;
      });

    const graph = this.relationGraph();

    for (const listed of reviews) {
      const parentId = graph.parents.get(listed.reviewId);
      const children = graph.children.get(listed.reviewId);
      const dependsOn = graph.dependsOn.get(listed.reviewId);

      if (parentId) listed.parentId = parentId;

      if (children) listed.children = this.orderChildren(children, graph);

      if (dependsOn) listed.dependsOn = dependsOn;
    }

    return this.withDiffStats(reviews);
  }

  /** Local and imported summaries use the same persisted counts. */
  withDiffStats<T extends ReviewApiSummary>(reviews: T[]): T[] {
    const stats = new Map(
      this.db
        .prepare("SELECT identity, stats FROM comparison_stats")
        .all()
        .map((row) => [
          String(row.identity),
          // SAFETY: comparison_stats is written only from the validated diff-stats contract.
          JSON.parse(String(row.stats)) as NonNullable<
            ReviewApiSummary["diffStats"]
          >,
        ]),
    );

    return reviews.map((review) => ({
      ...review,
      diffStats: review.pins
        ? (stats.get(statsKey(review.pins)) ?? null)
        : null,
    }));
  }

  /** Two saved board/day pairs in the last fourteen days. */
  feedbackEligible(now = Date.now()): boolean {
    const row = this.db
      .prepare(`SELECT count(*) AS pairs FROM (
        SELECT DISTINCT review_id, date(json_extract(snapshot, '$.createdAt')) AS utc_date
        FROM versions
        WHERE (version = 0 OR json_type(snapshot, '$.lastEdit') = 'object')
          AND julianday(json_extract(snapshot, '$.createdAt')) BETWEEN julianday(?) AND julianday(?)
        LIMIT 2
      )`)
      .get(
        new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(now).toISOString(),
      );

    return Number(row?.pairs) >= 2;
  }

  history(id: string): HistoryEntry[] {
    return this.db
      .prepare(
        `SELECT version,
          CASE WHEN json_valid(snapshot) THEN json_extract(snapshot,'$.title') END AS title,
          CASE WHEN json_valid(snapshot) THEN json_extract(snapshot,'$.createdAt') END AS created_at,
          author_kind,
          thread_id
        FROM versions WHERE review_id=? ORDER BY version`,
      )
      .all(id)
      .map((row) => {
        const entry: HistoryEntry = {
          version: Number(row.version),
          // A version that won't parse still has its place in history.
          title: String(row.title ?? ""),
          createdAt: String(row.created_at ?? ""),
        };

        if (row.author_kind !== null)
          entry.author = row.author_kind === "person" ? "you" : "agent";

        if (row.author_kind !== "person" && row.thread_id !== null)
          entry.threadId = String(row.thread_id);

        return entry;
      });
  }
  inspect(id: string, targetId?: string, version?: number) {
    const snapshot = this.read(id, version);

    return inspectSnapshot(snapshot, targetId);
  }
  /** The host can seed a document; transport callers only supply a command. */
  execute(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Command boundary: commandSchema.parse below rejects malformed input before mutation.
    input: unknown,
    initial?: { document: Block[]; origin: SnapshotOrigin },
    author: Author = { kind: "agent" },
  ): Promise<Result> {
    if (this.closing)
      return Promise.reject(new Error("Review store is closing."));
    const command = commandSchema.parse(input);

    if (initial && command.operation.type !== "create")
      throw new ReviewInputError("Initial content requires a create command.");

    // Network and fetch time stay out of the write queue.
    const pullRequest = this.startPullRequest(command);

    pullRequest?.catch(() => {});

    const pullRequestTitle = pullRequest
      ? pullRequest.then(
          ({ title }) => title || undefined,
          () => undefined,
        )
      : this.startPullRequestTitle(command);

    const prepared = this.prepareCommand(
      command,
      pullRequest,
      pullRequestTitle,
      author,
    ).then((source) => this.applyPreparedCommand(source, initial, author));

    this.preparing.add(prepared);
    void prepared
      .finally(() => this.preparing.delete(prepared))
      .catch(() => {});

    return prepared;
  }

  /** Resolve optional network context before entering the write queue. */
  private async prepareCommand(
    command: z.infer<typeof commandSchema>,
    pullRequest: Promise<ResolvedPullRequest> | undefined,
    pullRequestTitle: Promise<string | undefined>,
    author: Author,
  ): Promise<PreparedCommand> {
    const op = command.operation;

    if (op.type === "create") {
      if (!op.target && !op.pullRequestUrl)
        throw new ReviewInputError("Supply a target or a pullRequestUrl.");

      if (op.repositoryId && op.target)
        throw new ReviewInputError(
          "A checkout for the PR applies only to a create from pullRequestUrl alone; name it in the target instead.",
        );

      if (!op.title && op.target && author.kind !== "person")
        throw new ReviewInputError("Supply a title.");
    }

    if (op.type === "set_target" && !op.target && !op.pullRequestUrl)
      throw new ReviewInputError("Supply a target or a pullRequestUrl.");

    const requestedTarget =
      op.type === "create" || op.type === "set_target" ? op.target : undefined;

    const fromPullRequest = await pullRequest;

    // No commits to resolve; repositoryPath throws if it is unregistered.
    const resolvedTarget: { target: ReviewTarget; pins?: Pins } | undefined =
      requestedTarget?.kind === "project"
        ? (this.repositoryPath(requestedTarget.repositoryId),
          { target: requestedTarget })
        : requestedTarget
          ? await (this.providers.resolveTarget?.(requestedTarget) ??
              namedCommits(requestedTarget))
          : fromPullRequest;

    if (requestedTarget && !resolvedTarget)
      throw new ReviewInputError("Review targets are unavailable.");

    const resolvedBranch = fromPullRequest
      ? fromPullRequest.branch
      : resolvedTarget?.pins && this.providers.headBranch
        ? await this.providers.headBranch(
            resolvedTarget.pins,
            requestedTarget?.kind === "commits"
              ? requestedTarget.head
              : undefined,
          )
        : undefined;

    const discoveredPullRequest =
      resolvedTarget?.pins &&
      resolvedBranch &&
      (op.type === "create" || op.type === "set_target") &&
      op.pullRequestUrl === undefined
        ? await this.providers
            .findPullRequest?.(resolvedTarget.pins, resolvedBranch)
            .catch(() => undefined)
        : undefined;

    const resolvedTitle = await pullRequestTitle;

    return {
      op,
      requestedTarget,
      fromPullRequest,
      resolvedTarget,
      resolvedBranch,
      discoveredPullRequest,
      resolvedTitle,
    };
  }

  private applyPreparedCommand(
    prepared: PreparedCommand,
    initial: { document: Block[]; origin: SnapshotOrigin } | undefined,
    author: Author,
  ) {
    const {
      op,
      requestedTarget,
      fromPullRequest,
      resolvedTarget,
      resolvedBranch,
      discoveredPullRequest,
      resolvedTitle,
    } = prepared;

    return this.enqueue(async () => {
      if (
        op.type === "create" &&
        (op.pullRequestUrl
          ? op.reuseExisting !== false
          : op.reuseExisting && resolvedTarget?.pins)
      ) {
        const known = op.pullRequestUrl
          ? this.reviewsForPullRequest(op.pullRequestUrl)
          : [];

        const branch = fromPullRequest?.branch ?? resolvedBranch;
        const repository = resolvedTarget?.target.repositoryId;
        const project = repository && this.projectOfRepository(repository);

        const matching =
          !known.length && branch && project
            ? this.list()
                .filter(
                  (review) =>
                    review.project?.id === project &&
                    sourceBranchName(review.origin?.branch) ===
                      sourceBranchName(branch) &&
                    (op.pullRequestUrl
                      ? !review.origin?.pullRequestUrl
                      : !review.trashedAt) &&
                    review.pins !== undefined &&
                    repository !== undefined &&
                    this.sameRepository(review.pins.repositoryId, repository),
                )
                .reverse()
                .map((review) => review.reviewId)
            : [];

        const [found, ...others] = [...known, ...matching];

        if (found) {
          const result = this.existingReview(
            found,
            others,
            // Both resolve to commits, so pins are set.
            resolvedTarget!.pins!,
          );

          if (op.parentId || op.dependsOn)
            result.note += ` Its parent and dependencies were not changed either: set them with session_set_parent and session_set_dependencies.`;

          return result;
        }
      }

      // What a board is outside its versions.
      if (op.type === "set_parent")
        return this.commitBoardFacts(op.reviewId, author, {
          parentId: op.parentId,
        });

      if (op.type === "set_dependencies")
        return this.commitBoardFacts(op.reviewId, author, {
          dependsOn: op.dependsOn,
        });

      if (op.type === "lifecycle")
        return this.commitBoardFacts(op.reviewId, author, { state: op.state });

      if (op.type === "attention")
        return this.commitBoardFacts(op.reviewId, author, { viewed: true });

      if (op.type === "delete")
        return this.deleteBoard(this.read(op.reviewId), author, {
          fromTrash: true,
        });

      const id = op.type === "create" ? randomUUID() : op.reviewId;

      const previous = op.type === "create" ? undefined : this.read(id);

      let snapshot: Snapshot =
        op.type === "create"
          ? createdSnapshot(
              id,
              op,
              resolvedTarget!,
              fromPullRequest &&
                (fromPullRequest.title ||
                  `PR #${op.pullRequestUrl!.split("/").at(-1)}`),
              author.kind === "person",
            )
          : structuredClone(previous!);

      delete snapshot.trashedAt;

      // Overlay state: a degraded read must not persist unavailability.
      delete snapshot.sourceUnavailable;
      // Each version describes only its own edit.
      delete snapshot.lastEdit;

      let nextId = previous
        ? Number(
            this.db.prepare("SELECT next_id FROM reviews WHERE id=?").get(id)!
              .next_id,
          )
        : 0;

      let applied: Applied | undefined;
      let lensTarget: { targetId: string; type: "lens" } | undefined;
      /** The head a worktree board read at, when it becomes a plan. */
      let unpinnedWorktree: string | undefined;

      if (
        (op.type === "create" || op.type === "set_target") &&
        resolvedTarget?.pins &&
        (this.providers.headBranch || fromPullRequest)
      )
        snapshot.origin = { ...snapshot.origin, branch: resolvedBranch };

      if (!requestedTarget && fromPullRequest)
        snapshot.origin = {
          ...snapshot.origin,
          branch: fromPullRequest.branch ?? snapshot.origin?.branch,
          baseBranch: fromPullRequest.baseBranch,
        };

      // A base named rather than given as a commit, whole or abbreviated;
      // a stacked review names the branch below it. A plan compares nothing.
      if (requestedTarget && requestedTarget.kind !== "project") {
        const named = requestedTarget.base;
        const base = resolvedTarget?.pins?.base;

        snapshot.origin = {
          ...snapshot.origin,
          baseBranch:
            named && !base?.startsWith(named.toLowerCase()) ? named : undefined,
        };
      }

      switch (op.type) {
        case "create":
          if (initial) {
            snapshot.document = await this.resolveCommitLinks(
              documentSchema.parse(initial.document),
              snapshot,
            );
            snapshot.origin = {
              ...snapshot.origin,
              ...structuredClone(initial.origin),
            };

            for (const block of snapshot.document)
              assignFreshIds(block, (prefix) => `${prefix}-${++nextId}`);
          }

          setPullRequest(snapshot, op.pullRequestUrl, resolvedTitle);
          break;
        case "rename":
          snapshot.title = op.title;
          break;
        case "set_target":
          setPullRequest(
            snapshot,
            op.pullRequestUrl ??
              (op.pullRequestUrl === null ||
              snapshot.target?.repositoryId !==
                resolvedTarget!.target.repositoryId
                ? null
                : undefined),
            resolvedTitle,
          );
          snapshot.staleSources = [];

          // A board that loses its pins keeps each reference pointing where it
          // did.
          if (snapshot.pins && !resolvedTarget!.pins) {
            const pinned = pinDocumentReferences(
              snapshot.document,
              snapshot.pins,
            );

            // A worktree quotes uncommitted lines its head commit lacks.
            if (
              snapshot.target?.kind === "worktree" &&
              JSON.stringify(pinned) !== JSON.stringify(snapshot.document)
            )
              unpinnedWorktree = snapshot.pins.head;
            snapshot.document = pinned;
          }

          snapshot.target = resolvedTarget!.target;

          if (resolvedTarget!.pins) snapshot.pins = resolvedTarget!.pins;
          else delete snapshot.pins;
          break;
        case "restore":
          snapshot = this.read(id, op.version);
          delete snapshot.lastEdit;
          break;
        case "lens_edit": {
          const lenses = snapshot.lenses ?? [];
          const lens = applyLensEdit(lenses, op.edit, () => `lens-${++nextId}`);

          if (lenses.length) snapshot.lenses = lenses;
          else delete snapshot.lenses;
          lensTarget = { targetId: lens.id, type: "lens" };
          snapshot.lastEdit = {
            type: op.edit.type,
            targetId: lens.id,
            blockId: lens.id,
            kind: "lens",
            ...(op.edit.type === "update" && {
              fields: Object.keys(op.edit).filter(
                (key) => key !== "type" && key !== "targetId",
              ),
            }),
          };
          break;
        }

        case "edit": {
          const edit = respellEditLinks(op.edit);

          applied = applyEdit(
            snapshot.document,
            edit,
            (prefix) => `${prefix}-${++nextId}`,
          );

          snapshot.lastEdit = summarizeEdit(
            edit,
            applied,
            previous!.document,
            snapshot.document,
          );

          // commitVersion normalizes it, as it does every version.
          break;
        }
      }

      if ((op.type === "create" || op.type === "set_target") && snapshot.pins) {
        const branch = sourceBranchName(snapshot.origin?.branch);

        const sameBranch =
          previous?.pins?.repositoryId === snapshot.pins.repositoryId &&
          sourceBranchName(previous.origin?.branch) === branch;

        // Explicit PR input is resolved once for create and retarget alike.
        if (op.pullRequestUrl === null) setPullRequest(snapshot, null);
        else if (op.pullRequestUrl)
          setPullRequest(
            snapshot,
            op.pullRequestUrl,
            fromPullRequest?.title,
            fromPullRequest?.baseBranch,
          );
        else if (branch && discoveredPullRequest)
          setPullRequest(
            snapshot,
            discoveredPullRequest.url,
            discoveredPullRequest.title,
            discoveredPullRequest.baseBranch,
          );
        // An explicit binding survives an unavailable optional lookup.
        else if (previous && !sameBranch) setPullRequest(snapshot, null);
      }

      const warnings = unpinnedWorktree
        ? [
            `Its references now read at ${unpinnedWorktree.slice(0, 7)}, the checkout's last commit, which lacks any uncommitted lines they quoted. Check them.`,
          ]
        : [];

      return this.commitVersion({
        snapshot,
        previous,
        nextId,
        author,
        warnings,
        restore: op.type === "restore",
        repin: op.type === "set_target",
        projectLive: op.type !== "restore" && !resolvedTarget,
        result: {
          ...(op.type === "create" && { created: true }),
          targetId: applied?.targetId ?? lensTarget?.targetId,
          ...(applied && { type: applied.type }),
          ...(lensTarget && { type: lensTarget.type }),
          ...(applied?.children && { children: applied.children }),
        },
        ...(op.type === "create" && {
          projectId: op.projectId,
          relations: { parentId: op.parentId, dependsOn: op.dependsOn },
        }),
        ...((op.type === "edit" || op.type === "lens_edit") && {
          courier: {
            surface: op.type === "edit" ? "document" : "lenses",
            activityId: op.activityId,
          },
        }),
      });
    });
  }
  /**
   * Commits a board's next version: the one place a version is written.
   * Whoever writes it, it keeps the same rules:
   *  - an agent may not change a block a person holds;
   *  - the version names its author: a thread's names the thread, a
   *    person's is theirs and never inherits a thread;
   *  - only a change of repository moves a board to another project, and an
   *    existing board never takes the project of the board opened last;
   *  - only links the change adds are checked;
   *  - the version, its link index, the board's project and its relations
   *    are written together, and only if the board is still at the version
   *    read and the rules still hold.
   * Runs inside the write queue.
   */
  private async commitVersion(change: {
    snapshot: Snapshot;
    previous: Snapshot | undefined;
    nextId: number;
    author: Author;
    warnings?: string[];
    restore?: boolean;
    repin?: boolean;
    projectLive: boolean;
    /** The ids a person's save gave new blocks, by client key. */
    personIds?: Record<string, string>;
    /** Base version a person's save was made against. */
    baseVersion?: number;
    /** A save that, normalized, changes nothing saves no version. */
    unchangedSavesNothing?: boolean;
    result?: Omit<Result, "reviewId" | "version">;
    projectId?: string;
    relations?: { parentId?: string | null; dependsOn?: readonly string[] };
    courier?: { surface: ActivitySurface; activityId?: string };
  }): Promise<Result> {
    const { previous, author } = change;
    const id = change.snapshot.reviewId;
    let snapshot = change.snapshot;

    // Attribution: stripped, then stamped for this author alone.
    delete snapshot.threadId;
    delete snapshot.personEdit;

    if (snapshot.lastEdit) delete snapshot.lastEdit.threadId;

    if (previous && !change.restore)
      await this.normalizeDocument(snapshot, previous);

    if (
      change.unchangedSavesNothing &&
      previous &&
      snapshot.title === previous.title &&
      isDeepStrictEqual(snapshot.document, previous.document)
    )
      return { reviewId: id, version: previous.version };

    const touched = previous
      ? changedBlocks(previous.document, snapshot.document)
      : [];

    // Refused before any slow check, and again as it commits.
    const holds = () => {
      if (author.kind !== "person") this.assertUnleased(id, touched);
    };

    holds();

    if (author.kind === "person")
      snapshot.personEdit = {
        changed: touched,
        ...(change.personIds && { ids: change.personIds }),
      };
    else if (author.threadId) {
      if (snapshot.lastEdit) snapshot.lastEdit.threadId = author.threadId;
      else snapshot.threadId = author.threadId;
    }

    let warnings: string[];

    ({ snapshot, warnings } = await this.prepareVersion(snapshot, previous, {
      restore: change.restore,
      repin: change.repin,
      projectLive: change.projectLive,
      person: author.kind === "person",
    }));
    warnings = [...(change.warnings ?? []), ...warnings];

    const result: Result = {
      ...change.result,
      reviewId: id,
      version: snapshot.version,
    };

    if (warnings.length) result.warnings = warnings;

    const projectId = this.projectFor(snapshot, previous, change.projectId);

    const previousProject = previous ? this.projectOf(id) : undefined;
    const threadId = versionThread(snapshot);

    const shown: ShownChange = {
      ...(previous &&
        snapshot.title !== previous.title && { titleChanged: true }),
      ...(previous &&
        (projectId !== previousProject ||
          boardRepositoryId(snapshot) !== boardRepositoryId(previous) ||
          boardIconKind(snapshot.target) !==
            boardIconKind(previous.target)) && {
          placeChanged: true,
        }),
      ...(threadId && { threadId }),
    };

    this.commitCommand(
      result,
      () => {
        this.saveVersion(snapshot, change.nextId, projectId, change.author);

        if (change.relations?.parentId)
          this.setParent(id, change.relations.parentId);

        if (change.relations?.dependsOn)
          this.setDependencies(id, change.relations.dependsOn);

        // Relations stay inside a project: a retarget out of it drops them.
        if (
          previous &&
          projectId !== previousProject &&
          this.dropRelationsOutside(id, projectId)
        )
          result.warnings = [
            ...(result.warnings ?? []),
            "Its parent, children and dependencies were in its old project, so they were dropped: whiteboards relate only within a project.",
          ];
      },
      previous
        ? () => {
            // A board in Trash is read-only, whoever writes.
            this.assertWritable(id);

            if (change.baseVersion !== undefined)
              assertBaseVersion(change.baseVersion, this.currentVersion(id));
            else this.assertMutation(id, previous.version);
            holds();
          }
        : undefined,
      change.courier && {
        ...change.courier,
        // The version names the agent whose courier draws it.
        owned: (owner) => {
          if (snapshot.lastEdit) snapshot.lastEdit.activityId = owner;
        },
      },
      shown,
    );

    return result;
  }
  /** A create's named project, else its repository's; an edit keeps its
   * project unless it moves repository. */
  private projectFor(
    snapshot: Snapshot,
    previous: Snapshot | undefined,
    named?: string,
  ) {
    if (named !== undefined) {
      if (!this.db.prepare("SELECT 1 FROM projects WHERE id=?").get(named))
        throw new ReviewInputError(
          `Unknown project ${named}; use a project.id from session_list.`,
        );

      return named;
    }

    const repository = snapshot.target?.repositoryId;

    if (
      previous &&
      (!repository ||
        repository === previous.target?.repositoryId ||
        !this.db
          .prepare("SELECT 1 FROM repositories WHERE id=?")
          .get(repository))
    )
      return this.projectOf(snapshot.reviewId);

    return repository
      ? this.projectOfRepository(repository)
      : this.fallbackProject();
  }
  private currentVersion(reviewId: string) {
    return Number(
      this.db.prepare("SELECT version FROM reviews WHERE id=?").get(reviewId)!
        .version,
    );
  }
  /** Runs an accepted write after every write queued before it. Admission
   * checks belong at entry points: preparations accepted before close still
   * need to enqueue their writes while close waits for them. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.pending.then(work);

    this.pending = run.catch(() => {});

    return run;
  }
  /** Respells a document's links and resolves its commit links, as every
   * save does. A changed reference is no longer stale. */
  private async normalizeDocument(snapshot: Snapshot, previous: Snapshot) {
    snapshot.document = await this.resolveCommitLinks(
      respellDocumentLinks(snapshot.document),
      snapshot,
      previous.document,
    );

    if (snapshot.staleSources?.length) {
      const oldSources = new Map(
        sourceReferences(previous.document, {
          repositoryId: boardRepositoryId(previous),
        }).map((item) => [item.id, JSON.stringify(item.source)]),
      );

      const newSources = new Map(
        sourceReferences(snapshot.document, {
          repositoryId: boardRepositoryId(snapshot),
        }).map((item) => [item.id, JSON.stringify(item.source)]),
      );

      snapshot.staleSources = snapshot.staleSources.filter(
        (id) => oldSources.get(id) === newSources.get(id) && newSources.has(id),
      );
    }
  }
  /** Checks a candidate version and numbers it. A worktree board's version
   * may come back with its live source projected. */
  private async prepareVersion(
    candidate: Snapshot,
    previous: Snapshot | undefined,
    options: {
      restore?: boolean;
      repin?: boolean;
      projectLive: boolean;
      /** A person's save: links may name boards deleted since. */
      person?: boolean;
    },
  ): Promise<{ snapshot: Snapshot; warnings: string[] }> {
    const snapshot =
      candidate.target?.kind === "worktree" && options.projectLive
        ? await this.projectLiveSource(candidate)
        : candidate;

    // Component shapes were checked at entry (or when merging a field patch).
    // Check cross-references here; do not reparse the whole stored document.
    checkReferences(snapshot.document);

    // A restore may bring back links to deleted boards, so skip the check.
    if (!options.restore)
      this.checkBoardLinks(snapshot, previous, options.person);

    if (
      snapshot.pins &&
      (!previous ||
        JSON.stringify(previous.pins) !== JSON.stringify(snapshot.pins))
    )
      await this.providers.validatePins(snapshot.pins);

    // Advice is about what this command wrote; earlier advice stays said.
    const advised = new Set(documentAdvice(previous?.document ?? []));

    const warnings = [
      ...documentAdvice(snapshot.document).filter(
        (advice) => !advised.has(advice),
      ),
      ...(await this.validateExternal(snapshot, previous, options.repin)),
    ];

    snapshot.version = previous ? previous.version + 1 : 0;
    snapshot.createdAt = new Date().toISOString();

    return { snapshot, warnings };
  }
  /** Writes a version; call inside commitCommand. */
  private saveVersion(
    snapshot: Snapshot,
    nextId: number,
    projectId: string,
    author: Author,
  ) {
    const id = snapshot.reviewId;

    this.db
      .prepare(
        "INSERT INTO reviews(id,version,next_id,project_id) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,next_id=excluded.next_id,project_id=excluded.project_id",
      )
      .run(id, snapshot.version, nextId, projectId);
    this.db
      .prepare(
        "INSERT INTO versions(review_id,version,snapshot,thread_id,author_kind) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        snapshot.version,
        JSON.stringify(snapshot),
        versionThread(snapshot),
        author.kind,
      );
    this.indexBoardLinks(id, snapshot.document);
  }
  /** Deletes a board and its history, if it is still at the version read
   * and passes `guard`: Delete… from Trash, Trash's purge and a discarded
   * empty board all end here. An agent can't delete a board while a person
   * holds a block in it. */
  private deleteBoard(
    { reviewId, version }: Snapshot,
    author: Author,
    {
      guard,
      fromTrash = false,
    }: {
      guard?: () => void;
      /** Delete…, which is only for a board in Trash. */
      fromTrash?: boolean;
    } = {},
  ): Result {
    const result: Result = { reviewId, version, deleted: true };

    const rules = () => {
      guard?.();

      if (fromTrash && !this.trashTime(reviewId))
        throw new ReviewInputError(
          "Move this whiteboard to Trash before deleting it.",
          409,
        );
      this.assertMutation(reviewId, version);

      if (author.kind !== "person") this.assertUnheld(reviewId);
    };

    rules();

    this.commitCommand(result, () => this.removePermanently(reviewId), rules);
    this.leases.delete(reviewId);

    return result;
  }
  /** Writes what a board is outside its versions: its parent or what it
   * depends on, Trash or back, or that it was viewed. No version is saved,
   * but the rules are a version's: a board in Trash takes nothing but a
   * restore, and an agent can't put a board a person is in to Trash. */
  private commitBoardFacts(
    reviewId: string,
    author: Author,
    fact:
      | { parentId: string | null }
      | { dependsOn: readonly string[] }
      | { state: "active" | "trash" }
      | { viewed: true },
  ): Result {
    const lifecycle = "state" in fact;

    const rules = () => {
      this.assertExists(reviewId);

      if (!lifecycle) this.assertOutOfTrash(reviewId);
      else if (fact.state === "trash" && author.kind !== "person")
        this.assertUnheld(reviewId);
    };

    rules();

    const result: Result = { reviewId, version: this.read(reviewId).version };

    if (lifecycle || "viewed" in fact) result.attention = true;

    if (lifecycle) result.lifecycle = true;

    this.commitCommand(
      result,
      () => {
        if ("parentId" in fact) this.setParent(reviewId, fact.parentId);
        else if ("dependsOn" in fact)
          this.setDependencies(reviewId, fact.dependsOn);
        else {
          this.db
            .prepare(
              "INSERT OR IGNORE INTO review_attention(review_id) VALUES(?)",
            )
            .run(reviewId);

          if ("viewed" in fact)
            this.db
              .prepare(
                "UPDATE review_attention SET viewed_at=? WHERE review_id=?",
              )
              .run(new Date().toISOString(), reviewId);
          else {
            // A second move to Trash keeps the first deadline.
            const timestamp =
              fact.state === "trash" ? new Date().toISOString() : null;

            this.db
              .prepare(
                "UPDATE review_attention SET deleted_at=CASE WHEN ? IS NULL THEN NULL ELSE COALESCE(deleted_at, ?) END WHERE review_id=?",
              )
              .run(timestamp, timestamp, reviewId);
          }
        }

        if ("parentId" in fact || "dependsOn" in fact)
          result.relations = this.relations(reviewId);
      },
      rules,
    );

    return result;
  }
  /** Deletes a board the person made and left as it was: with no title
   * (it reads "Untitled"), no blocks and no child boards. A title typed as
   * "Untitled" is a title. A board still open on a canvas, or
   * one an agent is working on, is kept. A closing canvas saves, then lets
   * go of the board, so the discard waits for that first. */
  async discard(reviewId: string): Promise<{ deleted: boolean }> {
    const deadline = Date.now() + FOCUS_LEASE_TTL_MS;

    while (this.leased(reviewId) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, DISCARD_POLL_MS));

    if (this.closing) throw new Error("Review store is closing.");

    return this.enqueue(async () => {
      if (!this.has(reviewId)) return { deleted: false };
      const snapshot = this.read(reviewId);

      if (
        this.leased(reviewId) ||
        this.activity.isWorking(reviewId) ||
        snapshot.title !== "" ||
        snapshot.document.length ||
        this.relationGraph(true).children.get(reviewId)?.length
      )
        return { deleted: false };

      this.deleteBoard(snapshot, { kind: "person" });

      return { deleted: true };
    });
  }
  /** Each board's canvas leases by client: the board is open there, and
   * `blockId` is the block the person is in, if any. In memory: a lease
   * outlives neither its renewals nor the host. */
  private readonly leases = new Map<
    string,
    Map<string, { blockId: string | null; expiresAt: number }>
  >();

  /** Whether a canvas still holds the board open. */
  private leased(reviewId: string) {
    const now = Date.now();

    return [...(this.leases.get(reviewId)?.values() ?? [])].some(
      (lease) => lease.expiresAt > now,
    );
  }

  /** Records the block a person's canvas has focus in (null for none), or
   * with `open: false` that the canvas closed the board. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Lease boundary: focusLeaseSchema.parse below validates incoming JSON.
  focus(reviewId: string, input: unknown) {
    const { clientId, blockId, open } = focusLeaseSchema.parse(input);

    this.assertExists(reviewId);
    const leases = this.leases.get(reviewId) ?? new Map();

    if (open === false) leases.delete(clientId);
    else
      leases.set(clientId, {
        blockId,
        expiresAt: Date.now() + FOCUS_LEASE_TTL_MS,
      });

    if (leases.size) this.leases.set(reviewId, leases);
    else this.leases.delete(reviewId);

    return { ok: true as const };
  }
  /** Refuses an agent's change to a board while a person holds any block
   * in it. */
  private assertUnheld(reviewId: string) {
    const now = Date.now();

    for (const lease of this.leases.get(reviewId)?.values() ?? [])
      if (lease.expiresAt > now && lease.blockId)
        throw new ReviewInputError(
          `The user is editing this block (${lease.blockId}). Edit another block, or try again after they move on.`,
          409,
        );
  }

  /** Refuses an agent's edit to a block a person is editing. */
  private assertUnleased(reviewId: string, changed: readonly string[]) {
    const leases = this.leases.get(reviewId);

    if (!leases || !changed.length) return;
    const now = Date.now();

    for (const [clientId, lease] of leases)
      if (lease.expiresAt <= now) leases.delete(clientId);
      else if (lease.blockId && changed.includes(lease.blockId))
        throw new ReviewInputError(
          `The user is editing this block (${lease.blockId}). Edit another block, or try again after they move on.`,
          409,
        );
  }
  /** Saves a person's whole board as their own version, against the version
   * they started from. Blocks without ids get fresh ones. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Save boundary: personEditSchema and documentSchema parse below validate incoming JSON.
  personEdit(reviewId: string, input: unknown): Promise<PersonEditResult> {
    const body = personEditSchema.parse(input);

    if (this.closing)
      return Promise.reject(new Error("Review store is closing."));

    return this.enqueue(async () => {
      const previous = this.read(reviewId);

      assertBaseVersion(body.baseVersion, previous.version);

      const { document, nextId, ids } = personDocument(
        body.document,
        Number(
          this.db
            .prepare("SELECT next_id FROM reviews WHERE id=?")
            .get(reviewId)!.next_id,
        ),
      );

      const snapshot = structuredClone(previous);

      delete snapshot.sourceUnavailable;
      delete snapshot.lastEdit;
      snapshot.title = body.title;
      snapshot.document = document;

      // `ids` lets the canvas recognise its own save on the stream, even
      // when the save's response was lost.
      const { version } = await this.commitVersion({
        snapshot,
        previous,
        nextId,
        author: { kind: "person" },
        projectLive: true,
        personIds: ids,
        baseVersion: body.baseVersion,
        unchangedSavesNothing: true,
      });

      return { reviewId, version, ids };
    });
  }
  /** Where a board sits: its parent, and the parent's children in order,
   * each with what its header shows. */
  place(id: string) {
    const graph = this.relationGraph(true);
    const parentId = graph.parents.get(id);

    const placed = (reviewId: string): PlacedBoard => {
      const row = this.db
        .prepare(
          `SELECT json_extract(versions.snapshot,'$.title') AS title,
            json_extract(versions.snapshot,'$.target') AS target,
            json_extract(versions.snapshot,'$.origin') AS origin
          FROM reviews JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
          WHERE reviews.id=?`,
        )
        .get(reviewId)!;

      return {
        reviewId,
        title: String(row.title),
        ...(row.target && {
          // SAFETY: the target was validated when the version was saved.
          target: JSON.parse(String(row.target)) as ReviewTarget,
        }),
        ...(row.origin && {
          // SAFETY: the origin was validated when the version was saved.
          origin: JSON.parse(String(row.origin)) as SnapshotOrigin,
        }),
      };
    };

    return {
      board: placed(id),
      ...(parentId && { parent: placed(parentId) }),
      siblings: parentId
        ? this.orderChildren(
            this.listedSiblings(graph.children.get(parentId)!, id),
            graph,
          ).map(placed)
        : [],
      // A top-level board's own, in the order the sidebar lists them.
      ...(!parentId && {
        children: this.orderChildren(
          this.listedSiblings(graph.children.get(id) ?? [], id),
          graph,
        ).map(placed),
      }),
    };
  }
  /** The siblings Home and the sidebar list, which a board's place counts
   * among: all but those in Trash, and the board itself. */
  private listedSiblings(ids: readonly string[], self: string) {
    const trashed = new Set(this.trashedIds());

    return ids.filter((id) => id === self || !trashed.has(id));
  }
  /** A board's parent, its children in sibling order, and what it depends on. */
  relations(id: string): BoardRelations {
    const graph = this.relationGraph();

    return {
      parentId: graph.parents.get(id) ?? null,
      children: this.orderChildren(graph.children.get(id) ?? [], graph),
      dependsOn: graph.dependsOn.get(id) ?? [],
    };
  }
  /** Parents, children and dependencies. A board in Trash is out of them
   * until it is restored, its rows kept; only its own place sees it. */
  private relationGraph(withTrash = false) {
    const parents = new Map<string, string>();
    const children = new Map<string, string[]>();
    const dependsOn = new Map<string, string[]>();
    const trashed = new Set(withTrash ? [] : this.trashedIds());

    for (const row of this.db
      .prepare(
        "SELECT id, parent_id FROM reviews WHERE parent_id IS NOT NULL ORDER BY rowid",
      )
      .all()) {
      const board = String(row.id);
      const parent = String(row.parent_id);

      if (trashed.has(board) || trashed.has(parent)) continue;

      parents.set(board, parent);
      children.set(parent, [...(children.get(parent) ?? []), board]);
    }

    for (const row of this.db
      .prepare(
        "SELECT review_id, depends_on FROM board_dependencies ORDER BY rowid",
      )
      .all()) {
      const board = String(row.review_id);
      const dependency = String(row.depends_on);

      if (trashed.has(board) || trashed.has(dependency)) continue;

      dependsOn.set(board, [...(dependsOn.get(board) ?? []), dependency]);
    }

    return { parents, children, dependsOn };
  }
  /** Drops a board's parent, children and dependencies in other projects,
   * after it moved to `projectId`. Whether it dropped any. */
  private dropRelationsOutside(id: string, projectId: string): boolean {
    const outside = "SELECT id FROM reviews WHERE project_id!=?";

    const parents = this.db
      .prepare(
        `UPDATE reviews SET parent_id=NULL WHERE (id=? AND parent_id IN (${outside})) OR (parent_id=? AND project_id!=?)`,
      )
      .run(id, projectId, id, projectId).changes;

    const dependencies = this.db
      .prepare(
        `DELETE FROM board_dependencies WHERE (review_id=? AND depends_on IN (${outside})) OR (depends_on=? AND review_id IN (${outside}))`,
      )
      .run(id, projectId, id, projectId).changes;

    return Number(parents) + Number(dependencies) > 0;
  }
  private orderChildren(
    children: readonly string[],
    graph: ReturnType<ReviewStore["relationGraph"]>,
  ): string[] {
    if (children.length < 2) return [...children];

    return orderSiblings(
      this.siblingFacts(children),
      (id) => graph.dependsOn.get(id) ?? [],
      (repositoryId, ancestor, of) =>
        this.isAncestor(repositoryId, ancestor, of),
    );
  }
  private siblingFacts(ids: readonly string[]): SiblingFacts[] {
    return this.db
      .prepare(
        `SELECT reviews.id,
          (SELECT json_extract(first.snapshot,'$.createdAt') FROM versions AS first
            WHERE first.review_id=reviews.id ORDER BY first.version LIMIT 1) AS created_at,
          json_extract(versions.snapshot,'$.pins') AS pins,
          json_extract(versions.snapshot,'$.origin.branch') AS branch,
          json_extract(versions.snapshot,'$.origin.pullRequestUrl') AS url
        FROM reviews JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
        WHERE reviews.id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(...ids)
      .map((row) => {
        const id = String(row.id);

        // SAFETY: pins were validated when the version was saved.
        const saved = row.pins
          ? (JSON.parse(String(row.pins)) as Pins)
          : undefined;

        // A worktree's pins follow its checkout.
        const pins = this.liveSources.get(id)?.pins ?? saved;
        const url = row.url ? String(row.url) : undefined;
        const baseBranch = url && this.providers.pullRequestBaseBranch?.(url);

        return {
          id,
          createdAt: String(row.created_at),
          ...(pins && {
            repositoryId: pins.repositoryId,
            base: pins.base,
            head: pins.head,
          }),
          ...(url && row.branch && { headBranch: String(row.branch) }),
          ...(baseBranch && { baseBranch }),
        };
      });
  }
  /** Commits never change, so a definite answer is kept. */
  private readonly ancestry = new Map<string, boolean>();

  /** When git was last asked, for questions with no answer yet. */
  private readonly ancestryAsked = new Map<string, number>();

  /** Whether `ancestor` is an ancestor of `of`, as far as is known. git is
   * asked in the background, never on the server thread: until it answers,
   * or when it fails, the answer is no, and a yes re-sorts the catalog. */
  private isAncestor(repositoryId: string, ancestor: string, of: string) {
    const key = `${repositoryId}:${ancestor}:${of}`;
    const known = this.ancestry.get(key);

    if (known !== undefined) return known;

    const asked = this.ancestryAsked.get(key);

    // A commit not fetched yet may arrive: ask again, but not on every read.
    if (asked !== undefined && Date.now() - asked < 60_000) return false;

    this.ancestryAsked.set(key, Date.now());
    let root: string;

    try {
      root = this.repositoryPath(repositoryId);
    } catch {
      return false;
    }

    // At most a few at once: a parent with many children asks many pairs.
    this.ancestryQueue.push(() =>
      runVcs(
        "git",
        [
          "-C",
          root,
          "merge-base",
          "--is-ancestor",
          { rev: ancestor },
          { rev: of },
        ],
        { timeout: 10_000 },
      ).then(
        () => this.knowAncestry(key, true),
        (error: { code?: unknown }) => {
          // Exit 1 means no; anything else (a missing commit, a timeout, a
          // refused operand) is no answer.
          if (error.code === 1) this.knowAncestry(key, false);
        },
      ),
    );
    this.askNextAncestry();

    return false;
  }
  private readonly ancestryQueue: (() => Promise<void>)[] = [];
  private ancestryRunning = 0;
  private askNextAncestry() {
    while (
      this.ancestryRunning < ANCESTRY_CONCURRENCY &&
      this.ancestryQueue.length
    ) {
      this.ancestryRunning++;
      void this.ancestryQueue.shift()!().finally(() => {
        this.ancestryRunning--;
        this.askNextAncestry();
      });
    }
  }
  private knowAncestry(key: string, ancestor: boolean) {
    this.ancestry.set(key, ancestor);
    this.ancestryAsked.delete(key);

    if (ancestor && !this.closing) this.catalogChanged();
  }
  private catalogChanged() {
    for (const listener of this.catalogListeners)
      try {
        listener();
      } catch {
        // A disconnected viewer must not block other catalog subscribers.
      }
  }
  private boardName(id: string) {
    return `"${boardTitle(this.read(id).title)}" (${id})`;
  }
  /** Exists, out of Trash, same project. */
  private checkRelated(id: string, other: string) {
    if (!this.has(other))
      throw new ReviewInputError(
        `Whiteboard ${other} does not exist. Name a whiteboard by its sessionId from session_list.`,
      );
    this.assertOutOfTrash(other);

    if (this.projectOf(id) !== this.projectOf(other))
      throw new ReviewInputError(
        `${this.boardName(other)} is in another project than ${this.boardName(id)}. A whiteboard's parent and dependencies are in its own project.`,
      );
  }
  /** One parent, one level: a parent is top-level and a child has no
   * children, Trash included. Null makes the board top-level. */
  private setParent(id: string, parentId: string | null) {
    if (parentId !== null) {
      if (parentId === id)
        throw new ReviewInputError("A whiteboard can't be its own parent.");
      this.checkRelated(id, parentId);
      const { parents, children } = this.relationGraph(true);
      const grandparent = parents.get(parentId);

      if (grandparent)
        throw new ReviewInputError(
          `${this.boardName(parentId)} is a child of ${this.boardName(grandparent)}, and whiteboards nest one level deep. Use ${grandparent} as the parent instead.`,
        );
      const own = children.get(id) ?? [];

      if (own.length)
        throw new ReviewInputError(
          `${this.boardName(id)} has children (${own.map((child) => this.boardName(child)).join(", ")}), and whiteboards nest one level deep, so it can't become a child. Move its children first with session_set_parent.`,
        );
    }

    this.db
      .prepare("UPDATE reviews SET parent_id=? WHERE id=?")
      .run(parentId, id);
  }
  private setDependencies(id: string, dependsOn: readonly string[]) {
    const unique = [...new Set(dependsOn)];
    const graph = this.relationGraph(true);

    for (const dependency of unique) {
      if (dependency === id)
        throw new ReviewInputError("A whiteboard can't depend on itself.");

      const cycle = dependencyCycle(
        id,
        dependency,
        (board) => graph.dependsOn.get(board) ?? [],
      );

      if (cycle)
        throw new ReviewInputError(
          `Depending on ${this.boardName(dependency)} would close a cycle: ${cycle.map((board) => this.boardName(board)).join(" → ")}. Drop one of those dependencies first.`,
        );
      this.checkRelated(id, dependency);
    }

    this.db.prepare("DELETE FROM board_dependencies WHERE review_id=?").run(id);

    const insert = this.db.prepare(
      "INSERT INTO board_dependencies(review_id,depends_on) VALUES(?,?)",
    );

    for (const dependency of unique) insert.run(id, dependency);
  }
  /** New links must point at a board and block that exist. Saved links are
   * not rechecked, since their target may have been deleted. */
  private checkBoardLinks(
    snapshot: Snapshot,
    previous?: Snapshot,
    /** ⌘Z can bring back a link to a board or block deleted since; it
     * shows as deleted, like any link whose target went away. */
    person = false,
  ) {
    const key = ({ to }: BoardLinkRef) => `${to.board}#${to.block ?? ""}`;

    const kept = new Set(
      boardLinks(snapshot.reviewId, previous?.document ?? []).map(key),
    );

    for (const link of boardLinks(snapshot.reviewId, snapshot.document)) {
      if (kept.has(key(link))) continue;
      const { from, to } = link;

      const document =
        to.board === snapshot.reviewId
          ? snapshot.document
          : this.has(to.board)
            ? this.read(to.board).document
            : undefined;

      if (!document && person && this.wasDeleted(to.board)) continue;

      if (!document)
        throw new ReviewInputError(
          `Block ${from.block} links to board ${to.board}, which does not exist. Link a board by its sessionId from session_list.`,
        );

      if (
        !person &&
        to.block !== undefined &&
        !elements(document).some((element) => element.id === to.block)
      )
        throw new ReviewInputError(
          `Block ${from.block} links to block ${to.block}, which is not on board ${to.board}. Read the board with session_get for its block ids.`,
        );
    }
  }
  private wasDeleted(id: string) {
    return (
      this.db.prepare("SELECT 1 FROM deleted_boards WHERE id=?").get(id) !==
      undefined
    );
  }
  /** The boards that link to a board or its blocks. */
  linkingBoards(id: string): string[] {
    return this.db
      .prepare("SELECT DISTINCT from_review FROM board_links WHERE to_review=?")
      .all(id)
      .map((row) => String(row.from_review));
  }
  /** Rebuilds the board_links rows for one board. */
  private indexBoardLinks(id: string, document: Block[]) {
    this.db.prepare("DELETE FROM board_links WHERE from_review=?").run(id);

    const insert = this.db.prepare(
      "INSERT INTO board_links(from_review,from_block,to_review,to_block) VALUES(?,?,?,?)",
    );

    for (const { from, to } of boardLinks(id, document))
      insert.run(from.board, from.block, to.board, to.block ?? null);
  }
  /** Link previews by board, version and block; a version never changes. */
  private readonly linkPreviews = new Map<string, BoardLinkPreview>();

  private linkPreview(target: Snapshot, block?: string): BoardLinkPreview {
    const key = `${target.reviewId}@${target.version}#${block ?? ""}`;
    let preview = this.linkPreviews.get(key);

    if (!preview) {
      preview = boardLinkPreview(target.document, block);

      if (this.linkPreviews.size >= 500)
        this.linkPreviews.delete(this.linkPreviews.keys().next().value!);

      this.linkPreviews.set(key, preview);
    }

    return preview;
  }

  /** What a link's hover card shows of the board or block it links to,
   * read when the card opens rather than with every link. Only for a link
   * the version has. */
  linkPeek(
    id: string,
    to: { board: string; block?: string },
    version?: number,
  ): BoardLinkPreview {
    const linked = boardLinks(id, this.read(id, version).document).some(
      (link) => link.to.board === to.board && link.to.block === to.block,
    );

    if (!linked || !this.has(to.board))
      throw new ReviewInputError("The board has no such link.", 404);

    return this.linkPreview(this.read(to.board), to.block);
  }

  /** "owner / repo" for a board whose origin names one, else its folder. */
  private repositoryLabel(board: Snapshot): string | undefined {
    const repositoryId = board.target?.repositoryId;

    if (!repositoryId) return undefined;

    try {
      return this.repositoryGroup(this.repositoryPath(repositoryId))
        ?.label.split("/")
        .join(" / ");
    } catch {
      return undefined;
    }
  }

  /** A version's outgoing links and the board's current backlinks. Links to a
   * deleted board or block are marked missing. */
  links(id: string, version?: number) {
    const titles = new Map<string, Snapshot | undefined>();

    const board = (reviewId: string) => {
      if (!titles.has(reviewId))
        titles.set(
          reviewId,
          this.has(reviewId) ? this.read(reviewId) : undefined,
        );

      return titles.get(reviewId);
    };

    const outgoing = boardLinks(id, this.read(id, version).document).map(
      ({ from, to }) => {
        const target = board(to.board);

        const missing =
          !target ||
          (to.block !== undefined &&
            !elements(target.document).some(
              (element) => element.id === to.block,
            ));

        const deleted = target
          ? undefined
          : this.db
              .prepare("SELECT title,deleted_at FROM deleted_boards WHERE id=?")
              .get(to.board);

        return {
          from,
          to,
          ...(target && {
            title: target.title,
            icon: boardIconKind(target.target),
            ...(this.repositoryLabel(target) && {
              repository: this.repositoryLabel(target),
            }),
            ...(target.origin?.pullRequestNumber && {
              pullRequestNumber: target.origin.pullRequestNumber,
              pullRequestUrl: target.origin.pullRequestUrl,
            }),
            updatedAt: target.createdAt,
          }),
          missing,
          ...(deleted && {
            title: String(deleted.title),
            deletedAt: String(deleted.deleted_at),
          }),
        };
      },
    );

    const backlinks = this.db
      .prepare(
        "SELECT DISTINCT from_review,from_block,to_block FROM board_links WHERE to_review=? AND from_review<>? ORDER BY from_review",
      )
      .all(id, id)
      .map((row) => {
        const from = board(String(row.from_review));

        return {
          from: {
            board: String(row.from_review),
            block: String(row.from_block),
          },
          to:
            row.to_block === null
              ? { board: id }
              : { board: id, block: String(row.to_block) },
          title: from?.title ?? "",
          ...(from && { icon: boardIconKind(from.target) }),
          ...(from?.origin?.pullRequestNumber && {
            pullRequestNumber: from.origin.pullRequestNumber,
            pullRequestUrl: from.origin.pullRequestUrl,
          }),
        };
      });

    return { outgoing, backlinks };
  }
  /** Boards edited by an Ask thread, most recent first. */
  boardsChangedBy(threadId: string): {
    reviewId: string;
    title: string;
    icon: BoardIconKind;
    blockId?: string;
  }[] {
    return this.db
      .prepare(
        `SELECT edits.review_id, MAX(edits.version) AS last
        FROM versions edits
        JOIN reviews ON reviews.id=edits.review_id
        WHERE edits.thread_id=?
        GROUP BY edits.review_id ORDER BY MAX(json_extract(edits.snapshot,'$.createdAt')) DESC`,
      )
      .all(threadId)
      .map((row) => {
        const board = this.read(String(row.review_id));

        // The block its last edit there touched, if the board still has it.
        const blockId = this.read(board.reviewId, Number(row.last)).lastEdit
          ?.blockId;

        return {
          reviewId: board.reviewId,
          title: board.title,
          icon: boardIconKind(board.target),
          ...(blockId &&
            elements(board.document).some(
              (element) => element.id === blockId,
            ) && { blockId }),
        };
      });
  }
  /** The boards each thread changed, newest first, for many threads in one
   * query. */
  /** A board's title and icon, read without its document. */
  /** Where a board lives, as Recent names it: its checkout's folder, else
   * its project's name. */
  boardPlace(reviewId: string): string {
    const row = this.db
      .prepare(
        `SELECT repositories.path, projects.name FROM reviews
        JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
        LEFT JOIN repositories ON repositories.id=${BOARD_REPOSITORY_ID_SQL}
        LEFT JOIN projects ON projects.id=reviews.project_id
        WHERE reviews.id=?`,
      )
      .get(reviewId);

    return (
      (row?.path && path.basename(String(row.path))) ||
      (row?.name ? String(row.name) : "")
    );
  }
  boardFace(reviewId: string) {
    const row = this.db
      .prepare(
        `SELECT json_extract(versions.snapshot,'$.title') AS title, json_extract(versions.snapshot,'$.target') AS target
        FROM reviews JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
        WHERE reviews.id=?`,
      )
      .get(reviewId)!;

    return {
      reviewId,
      title: String(row.title),
      icon: boardIconKind(
        // SAFETY: the target was validated when the version was saved.
        row.target
          ? (JSON.parse(String(row.target)) as ReviewTarget)
          : undefined,
      ),
    };
  }
  boardsChangedByThreads(
    threadIds: readonly string[],
  ): Map<string, { reviewId: string; title: string; icon: BoardIconKind }[]> {
    const changed = new Map<
      string,
      { reviewId: string; title: string; icon: BoardIconKind }[]
    >();

    if (!threadIds.length) return changed;

    const rows = this.db
      .prepare(
        // The thread_id index finds the rows; rowid orders them by when
        // they were saved without parsing them.
        `SELECT thread_id AS thread, review_id
        FROM versions
        WHERE thread_id IN (${threadIds.map(() => "?").join(",")})
        GROUP BY thread, review_id ORDER BY MAX(rowid) DESC`,
      )
      .all(...threadIds);

    const boards = new Map<
      string,
      { reviewId: string; title: string; icon: BoardIconKind } | undefined
    >();

    for (const row of rows) {
      const reviewId = String(row.review_id);

      if (!boards.has(reviewId))
        boards.set(
          reviewId,
          this.has(reviewId) ? this.boardFace(reviewId) : undefined,
        );
      const board = boards.get(reviewId);

      if (!board) continue;
      const thread = String(row.thread);

      changed.set(thread, [...(changed.get(thread) ?? []), board]);
    }

    return changed;
  }
  /** Resolve a target-less PR create before it queues, when it will need it. */
  private startPullRequest(
    command: z.infer<typeof commandSchema>,
  ): Promise<ResolvedPullRequest> | undefined {
    const op = command.operation;

    if (
      (op.type !== "create" && op.type !== "set_target") ||
      op.target ||
      !op.pullRequestUrl
    )
      return undefined;

    if (!this.providers.resolvePullRequest)
      return Promise.reject(
        new ReviewInputError("Pull request targets are unavailable."),
      );

    if (!op.repositoryId)
      return Promise.reject(
        new ReviewInputError(
          'Name the checkout to fetch the PR into: target {kind:"pullRequest", repositoryPath, pullRequest}.',
        ),
      );

    // A PR whose review is in Trash is refused before it is fetched.
    const [existing] =
      op.type !== "create" || op.reuseExisting === false
        ? []
        : this.reviewsForPullRequest(op.pullRequestUrl);

    if (existing) {
      try {
        this.assertReusableReview(existing);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return this.providers.resolvePullRequest(op.pullRequestUrl, {
      id: op.repositoryId,
    });
  }
  private startPullRequestTitle(
    command: z.infer<typeof commandSchema>,
  ): Promise<string | undefined> {
    const op = command.operation;

    if (
      (op.type !== "create" && op.type !== "set_target") ||
      !op.pullRequestUrl
    )
      return Promise.resolve(undefined);

    return (
      this.providers.pullRequestTitle?.(op.pullRequestUrl) ??
      Promise.resolve(undefined)
    );
  }
  /** Reviews whose PR is this one, newest version first. Summaries only. */
  private reviewsForPullRequest(url: string): string[] {
    return this.db
      .prepare(
        `SELECT reviews.id FROM reviews
        JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
        WHERE lower(json_extract(versions.snapshot,'$.origin.pullRequestUrl'))=?
        ORDER BY json_extract(versions.snapshot,'$.createdAt') DESC, reviews.rowid DESC`,
      )
      .all(pullRequestKey(url))
      .map((row) => String(row.id));
  }
  private assertReusableReview(reviewId: string) {
    if (this.trashTime(reviewId))
      throw new ReviewInputError(
        `This PR's whiteboard is in Trash. Restore it to continue:\n\nsession_lifecycle({"sessionId":"${reviewId}","state":"active"})`,
        409,
      );
  }
  /** The answer to a create that found its PR's review. Its target stays:
   * moving it would silently point existing links at different code. */
  private existingReview(
    reviewId: string,
    others: string[],
    requested: Pins,
  ): Result {
    const snapshot = this.read(reviewId);

    this.assertReusableReview(reviewId);

    // Worktrees share commits, so comparing heads is enough.
    const headMoved = snapshot.pins?.head !== requested.head;

    const working = this.activity.read(reviewId).activities ?? [];

    const note = [
      "Returned the existing review for this PR instead of creating one; the requested title and target were not applied. Update it in place (read it with session_get first), or pass reuseExisting:false to create a separate review.",
      headMoved &&
        "The PR head moved since this review's target was set, and the target was NOT changed: call review_set_target to move it, then repair the source references it reports.",
      working.length > 0 &&
        `Another agent is working on it${working[0]!.focus ? `: ${working[0]!.focus.description}` : ""}.`,
      others.length > 0 &&
        "Older reviews also name this PR; see otherReviewIds.",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      created: false,
      note,
      reviewId,
      version: snapshot.version,
      target: snapshot.target,
      headMoved,
      ...(working.length > 0 && { working: true }),
      ...(others.length > 0 && { otherReviewIds: others }),
    };
  }
  private commitCommand(
    result: Result,
    apply: () => void,
    guard?: () => void,
    /** An edit credits the agent it came from, renewing its presence. */
    attribution?: {
      surface: ActivitySurface;
      activityId?: string;
      owned(activityId: string): void;
    },
    shown?: ShownChange,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    let owner: string | undefined;

    try {
      guard?.();

      if (attribution) {
        owner = this.activity.attribute(
          result.reviewId,
          attribution.surface,
          attribution.activityId,
        );

        if (owner) attribution.owned(owner);
        else if (attribution.activityId)
          result.warnings = [
            ...(result.warnings ?? []),
            "Your activity has ended or expired, so readers no longer see you working. The edit was saved; call session_activity_begin and pass the new activityId.",
          ];
      }

      apply();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    if (result.deleted) this.activity.deleted(result.reviewId);
    else if (owner) this.activity.extended(result.reviewId);
    this.notify({ ...result, ...shown });
  }
  private assertMutation(reviewId: string, version: number | undefined) {
    const current = this.db
      .prepare("SELECT version FROM reviews WHERE id=?")
      .get(reviewId);

    if ((current ? Number(current.version) : undefined) !== version)
      throw new ReviewInputError(
        "Review changed during validation. Reread it and retry the edit.",
        409,
      );
  }

  private notify(result: StoreChange) {
    if (result.deleted) this.observedVersions.delete(result.reviewId);
    else if (!result.attention)
      this.observedVersions.set(result.reviewId, result.version);

    if ((!result.attention || result.lifecycle) && !result.relations)
      for (const listener of this.listeners)
        try {
          listener(result);
        } catch {
          // A subscriber failure must not reject the committed command.
        }

    for (const listener of this.catalogListeners)
      try {
        listener();
      } catch {
        // The saved command must remain successful if a viewer disconnects.
      }
  }
  /** Viewing a review in Trash does not restore it. */
  trashedIds(): string[] {
    return this.db
      .prepare(
        "SELECT review_id FROM review_attention WHERE deleted_at IS NOT NULL",
      )
      .all()
      .map((row) => String(row.review_id));
  }
  has(reviewId: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM reviews WHERE id=?").get(reviewId) !==
      undefined
    );
  }
  /** Saves each new commit link's commit in full, resolved in the board's
   * repository; one it does not have rejects the edit, as pins do. A link the
   * board already had stays as it was saved, even if its commit is gone. */
  private async resolveCommitLinks(
    document: Block[],
    board: Pick<Snapshot, "target" | "pins">,
    previous?: Block[],
  ): Promise<Block[]> {
    const saved = new Set(previous ? commitLinkCommits(previous) : []);

    const commits = commitLinkCommits(document).filter(
      (commit) => !saved.has(commit),
    );

    const repositoryId = boardRepositoryId(board);

    // Without a repository the links are rejected as references.
    if (!commits.length || !repositoryId || !this.providers.resolveCommit)
      return document;

    const resolved = new Map<string, string>();

    await Promise.all(
      commits.map(async (commit) => {
        const full = await this.providers.resolveCommit!(repositoryId, commit);

        if (!full)
          throw new ReviewInputError(
            `Commit ${commit} is not in the board's repository. Fetch it first, or link a commit the repository has.`,
          );
        resolved.set(commit, full);
      }),
    );

    return respellCommitLinks(document, resolved);
  }
  private async validateExternal(
    snapshot: Snapshot,
    previous?: Snapshot,
    repin = false,
  ) {
    const warnings: string[] = [];

    const references = (
      board: Pick<Snapshot, "document" | "target" | "pins" | "lenses">,
      tolerant = false,
    ) => {
      const { document, lenses = [] } = board;

      const sources = new Map<
        string,
        { source: FileLineRange; peek: boolean }
      >();

      const resources = new Map<string, Block>();

      const add = (source: FileLineRange, peek: boolean) => {
        const key = JSON.stringify(source);
        const kept = sources.get(key);
        sources.set(key, { source, peek: peek || (kept?.peek ?? false) });
      };

      for (const { source, peek } of sourceReferences(document, {
        tolerant,
        repositoryId: boardRepositoryId(board),
      }))
        add(source, peek === true);

      // A lens range is a prose-like link: it must exist, not read as a peek.
      for (const { source } of lensSelections(lenses))
        for (const anchor of sourceAnchors(source)) add(anchor, false);

      for (const block of resourceReferences(document))
        resources.set(JSON.stringify(block), block);

      return { sources, resources };
    };

    const current = references(snapshot, repin);

    // Stored content is not re-validated: an edit may fix a link that the
    // current rules reject.
    const pinsChanged =
      previous &&
      JSON.stringify(previous.pins) !== JSON.stringify(snapshot.pins);

    const worktreeMoved = pinsChanged && snapshot.target?.kind === "worktree";

    const changed =
      repin && pinsChanged && previous.pins && snapshot.pins
        ? await this.providers
            .filesChangedBetween?.(previous.pins, snapshot.pins)
            .catch(() => undefined)
        : undefined;

    const retained = references(previous ?? { document: [] }, true);

    // Independent reads of immutable commits: run them concurrently.
    const checks: Promise<void>[] = [];

    // Pins a reference names itself must be resolved commits of a registered
    // repository, like document pins. Check each distinct new set once.
    const retainedPins = new Set(
      explicitPins([...retained.sources.values()]).map((pins) =>
        JSON.stringify(pins),
      ),
    );

    for (const pins of explicitPins([...current.sources.values()]))
      if (!retainedPins.has(JSON.stringify(pins)))
        checks.push(this.providers.validatePins(pins));

    for (const [key, { source, peek }] of current.sources) {
      const kept = retained.sources.get(key);

      // A range validated earlier as a prose link still needs the peek check
      // the first time a code peek points at it. A reference with its own
      // pins is unaffected by the document's pins changing.
      if ((pinsChanged && !source.pins) || !kept || (peek && !kept.peek))
        checks.push(
          this.providers
            .validateSource(anchorPins(source, snapshot.pins), source, {
              peek,
            })
            .then(
              () => {
                if (
                  repin &&
                  !readsWhereItDid(source, previous?.pins) &&
                  (!changed || changed[source.side].has(source.file))
                )
                  warnings.push(
                    `${source.side}/${source.file}#L${source.fromLine}-L${source.toLine}: source pins changed; verify that this range still supports the document.`,
                  );
              },
              (error) => {
                if (
                  (!repin && !(worktreeMoved && kept)) ||
                  !(error instanceof ReviewInputError)
                )
                  throw error;
                warnings.push(
                  `${source.side}/${source.file}#L${source.fromLine}-L${source.toLine}: ${error.message}`,
                );
              },
            ),
        );
    }

    for (const [key, block] of current.resources)
      if (pinsChanged || !retained.resources.has(key))
        checks.push(
          this.providers
            .validateResource(snapshot.pins, block)
            .catch((error) => {
              if (
                (!repin && !(worktreeMoved && retained.resources.has(key))) ||
                !(error instanceof ReviewInputError)
              )
                throw error;
              warnings.push(`${block.id} (${block.type}): ${error.message}`);
            }),
        );

    await Promise.all(checks);

    return warnings.sort();
  }
}

/** The highest number in a document's `prefix-N` ids, units included. */
function highestIdNumber(document: Block[]): number {
  let highest = 0;

  for (const [, number] of JSON.stringify(document).matchAll(
    /"id":"[^"]*?-(\d+)"/g,
  ))
    highest = Math.max(highest, Number(number));

  return highest;
}

/** The title of a board a person made and has not named. */

/** A person's save must start from the board's current version. */
function assertBaseVersion(base: number, current: number) {
  if (base !== current)
    throw new ReviewInputError(
      `The board changed since version ${base}; it is now at version ${current}. Merge the latest version and save again.`,
      409,
    );
}

/**
 * A person's whole document as the store saves it: each new block's
 * clientKey taken, the blocks parsed, a flow's units adopted and every block
 * without an id given the next one after `nextId`. Every save then respells
 * its links (respellDocumentLinks) and resolves commit links it has not
 * saved before. Mutates `input`.
 */
export function personDocument(input: JsonValue[], nextId: number) {
  const keys = takeClientKeys(input);
  const document = documentSchema.parse(input);
  const allocate = (prefix: string) => `${prefix}-${++nextId}`;

  adoptFlowUnits(document, allocate);

  for (const block of document) assignMissingIds(block, allocate);
  assertUniqueIds(document);

  return {
    document,
    // An id ⌘Z brought back stays; the counter moves past it, so an
    // agent's next insert can't be given it again.
    nextId: Math.max(nextId, highestIdNumber(document)),
    ids: Object.fromEntries(
      [...keys.byPath].map(([path, key]) => [key, blockAt(document, path).id!]),
    ),
  };
}

const clientKeySchema = z.string().min(1).optional();

/** Removes each block's clientKey from a person's raw document, keeping it
 * by the block's path when the block has no id. Counts the bare blocks. */
function takeClientKeys(document: JsonValue[]) {
  const byPath = new Map<string, string>();
  const seen = new Set<string>();
  let bare = 0;

  const visit = (list: JsonValue[], prefix: string) =>
    list.forEach((block, index) => {
      if (!isJsonObject(block)) return;
      const path = `${prefix}${index}`;
      const clientKey = clientKeySchema.parse(block.clientKey);

      delete block.clientKey;

      if (block.id === undefined) {
        bare++;

        if (clientKey !== undefined) {
          if (seen.has(clientKey))
            throw new ReviewInputError(
              `clientKey ${clientKey} names more than one block. Give each new block its own clientKey.`,
            );
          seen.add(clientKey);
          byPath.set(path, clientKey);
        }
      }

      if (Array.isArray(block.children)) visit(block.children, `${path}/`);
    });

  visit(document, "");

  return { byPath, bare };
}

/** The block at a path takeClientKeys recorded. */
function blockAt(document: Block[], path: string): Block {
  const [first, ...rest] = path.split("/").map(Number);
  let block = document[first!]!;

  for (const index of rest)
    if ("children" in block) block = block.children[index]!;

  return block;
}

/** Ids name one component each across the whole document. */
function assertUniqueIds(document: Block[]) {
  const seen = new Set<string>();

  for (const { id } of elements(document)) {
    if (id === undefined) continue;

    if (seen.has(id))
      throw new ReviewInputError(
        `Id ${id} names more than one component. Give each block its own id, or leave a new block's id out.`,
      );
    seen.add(id);
  }
}

/** Each block's own content by id, nested blocks included. A section or
 * callout is kept without its children, so a change to a child is only the
 * child's. */
function ownBlocks(document: Block[], into = new Map<string, unknown>()) {
  for (const block of document) {
    if ("children" in block) {
      const { children, ...own } = block;

      if (block.id !== undefined) into.set(block.id, own);
      ownBlocks(children, into);
    } else if (block.id !== undefined) into.set(block.id, block);
  }

  return into;
}

/** The blocks added, removed or changed from one document to the next. A
 * block moved with its content unchanged did not change. */
function changedBlocks(before: Block[], after: Block[]): string[] {
  const old = ownBlocks(before);
  const now = ownBlocks(after);

  return [...new Set([...old.keys(), ...now.keys()])].filter(
    (id) => !isDeepStrictEqual(old.get(id), now.get(id)),
  );
}

/** Whether a reference's own pins read the commit the board's previous
 * pins did. */
function readsWhereItDid(
  source: { side: "base" | "head"; pins?: SourcePins },
  previous: Pins | undefined,
): boolean {
  if (!source.pins || !previous) return false;

  const commit =
    source.side === "base"
      ? (source.pins.base ?? source.pins.head)
      : source.pins.head;

  return (
    source.pins.repositoryId === previous.repositoryId &&
    (commit === previous.head || commit === previous.base)
  );
}

/** Without a resolver, a commits target that names both commits pins them as
 * given; validatePins still checks they exist. */
function namedCommits(target: ReviewTarget) {
  if (target.kind !== "commits" || target.base === undefined) return undefined;

  const { repositoryId, base, head } = target;

  return { target, pins: { repositoryId, base, head } };
}

/** A new document's first version, before its initial content. Field order
 * is kept so stored JSON reads as it always has. */
function createdSnapshot(
  id: string,
  op: { title?: string },
  resolved: { target: ReviewTarget; pins?: Pins },
  defaultTitle?: string,
  /** A person's new board may start untitled. */
  untitled = false,
): Snapshot {
  const title = op.title || defaultTitle || (untitled ? "" : undefined);

  if (title === undefined) throw new ReviewInputError("Supply a title.");

  const snapshot: Snapshot = {
    reviewId: id,
    version: 0,
    title,
    target: resolved.target,
    document: [],
    createdAt: "",
  };

  if (resolved.pins) snapshot.pins = resolved.pins;

  return snapshot;
}

export function inspectSnapshot(snapshot: Snapshot, targetId?: string) {
  if (targetId !== undefined) {
    const target = elements(snapshot.document).find(
      (element) => element.id === targetId,
    );

    if (!target)
      throw new ReviewInputError("Target not found in this version.", 404);

    return target;
  }

  return elements(snapshot.document).map((element) => ({
    id: element.id,
    type: element.type,
    label:
      "title" in element
        ? element.title
        : "label" in element
          ? element.label
          : element.type === "markdown"
            ? element.markdown.slice(0, 120)
            : undefined,
  }));
}

/** How many ancestry questions git answers at once. */
const ANCESTRY_CONCURRENCY = 8;
