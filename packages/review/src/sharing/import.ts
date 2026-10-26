import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { type JsonObject, type JsonValue } from "@dev.fast/review-protocol";
import {
  MAX_SHARE_BYTES,
  type ShareBundle,
  capabilitySchema,
  shareBundleSchema,
} from "@dev.fast/review-share-protocol";
import { textIncludesQuote } from "@review/evidence.js";
import { lensSchema } from "@review/review-api/diff-lenses.js";
import { ReviewInputError } from "@review/review-api/document.js";
import {
  type FileLineRange,
  type Pins,
  anchorPins,
  checkReferences,
  documentSchema,
  pinsSchema,
  resourceReference,
  resourceReferences,
  sourceReferences,
} from "@review/review-api/document.js";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import { pullRequestUrl } from "@review/review-api/origin.js";
import type { ReviewStore } from "@review/review-api/store.js";
import { traceSchema } from "@review/review-api/trace-schema.js";
import {
  devReviewHome,
  safeStorageSegment,
} from "@review/review-home-paths.js";
import { softwareModelDataSchema } from "@review/software-map-model.js";
import {
  liftFileLenses,
  migrateStoredDocument,
  migrateStoredLenses,
} from "@review/stored-document-migration.js";
import { z } from "zod";

import { referenceCommits, validateShareSources } from "./export.js";
import {
  COMMIT_ID,
  assertCommitIds,
  cloneSharedRepository,
  fetchPinnedRepository,
  fetchSharedCommits,
  forgetSharedCommits,
  repositoryReady,
  sharedGit,
} from "./repository.js";

export const sharedSnapshotSchema = z.strictObject({
  reviewId: z.string().min(1),
  version: z.number().int().nonnegative(),
  /** Empty for a board never named; it reads "Untitled". */
  title: z.string(),
  pins: pinsSchema
    .extend({
      base: z.string().regex(COMMIT_ID),
      head: z.string().regex(COMMIT_ID),
    })
    .optional(),
  document: documentSchema,
  lenses: z.array(lensSchema).optional(),
  createdAt: z.string(),
  origin: z
    .strictObject({
      branch: z.string().optional(),
      baseRef: z.string().optional(),
      baseBranch: z.string().optional(),
      pullRequestNumber: z.number().int().positive().optional(),
      pullRequestUrl: pullRequestUrl.optional(),
      pullRequestTitle: z.string().optional(),
      pullRequestBaseBranch: z.string().optional(),
      revision: z.string().optional(),
    })
    .optional(),
});

const count = z.number().int().nonnegative();

const counts = z.strictObject({ additions: count, deletions: count });

const mapSchema = softwareModelDataSchema.extend({
  commit: z.string().regex(COMMIT_ID),
  side: z.enum(["base", "head"]),
  countsByElementPath: z.record(z.string(), counts),
  unmappedByElementPath: z.record(
    z.string(),
    counts.extend({
      files: z.array(
        counts.extend({
          file: z.string(),
          hunks: z.array(
            z.strictObject({
              startLine: count,
              lines: z.array(
                z.strictObject({
                  kind: z.enum(["add", "remove"]),
                  oldLine: count.nullable(),
                  newLine: count.nullable(),
                  text: z.string(),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});

export const sharePresentationSchema = z.strictObject({
  maps: z.record(z.string(), mapSchema),
});

export interface ShareAttribution {
  login: string;
  sharedAt: number;
}

export function validateShareBundle(input: ShareBundle) {
  const bundle = shareBundleSchema.parse(input);
  // SAFETY: a bundle is parsed from JSON, so its snapshot is a JSON object.
  const stored = bundle.snapshot as JsonObject;

  // Bundles shared before a field was retired still open; only the parsed
  // document drops the retired form. Lenses shared as document blocks read
  // as the snapshot's lenses.
  const snapshot = sharedSnapshotSchema.parse(
    stored.document === undefined
      ? stored
      : liftSharedLenses(stored, migrateStoredDocument(stored.document)),
  );

  if (
    snapshot.reviewId !== bundle.reviewId ||
    snapshot.version !== bundle.version ||
    snapshot.title !== bundle.title
  )
    throw new Error("Shared snapshot does not match its bundle.");
  checkReferences(snapshot.document);
  validateShareSources(snapshot);
  // Every commit it quotes reaches git as an argument.
  assertCommitIds(referenceCommits(snapshot));

  if (
    (snapshot.pins || referenceCommits(snapshot).length) &&
    !bundle.repository
  )
    throw new ReviewInputError(
      "This share can only be viewed in the browser.",
      409,
    );

  const maps = z.record(z.string(), mapSchema).parse(bundle.maps);

  if (!snapshot.pins && Object.keys(maps).length)
    throw new Error("Shared maps require source pins.");

  const traces = new Map<
    string,
    Map<string, z.infer<typeof traceSchema>["events"][number]>
  >();

  for (const block of resourceReferences(snapshot.document)) {
    if (block.type === "trace_quote") {
      let events = traces.get(block.traceId);

      if (!events) {
        if (!Object.hasOwn(bundle.traces, block.traceId))
          throw new Error("Missing shared trace.");
        const trace = traceSchema.parse(bundle.traces[block.traceId]);
        events = new Map(trace.events.map((event) => [event.id, event]));

        if (events.size !== trace.events.length)
          throw new Error("Duplicate shared trace event.");
        traces.set(block.traceId, events);
      }

      const event = events.get(block.eventId);

      if (!event || !textIncludesQuote(event.text, block.text))
        throw new Error("Shared quote does not match its trace.");
    }

    if (block.type === "software_map") {
      const map = Object.hasOwn(maps, block.mapVersionId)
        ? maps[block.mapVersionId]
        : undefined;

      if (!map || map.commit !== snapshot.pins?.[map.side])
        throw new Error("Shared map pins do not match.");
    }
  }

  return { bundle, snapshot, maps };
}

function liftSharedLenses(stored: JsonObject, migrated: JsonValue): JsonObject {
  const { document, lenses } = liftFileLenses(migrated);

  // SAFETY: migration returns the array it was given, rewritten.
  const kept = Array.isArray(stored.lenses)
    ? (migrateStoredLenses(stored.lenses) as JsonValue[])
    : [];

  return {
    ...stored,
    document,
    ...((kept.length || lenses.length) && { lenses: [...kept, ...lenses] }),
  };
}

export function sharedReviewId(origin: string, capability: string) {
  const url = new URL(origin);
  capabilitySchema.parse(capability);

  return `shared-${createHash("sha256")
    .update(JSON.stringify([url.origin, capability]))
    .digest("hex")}`;
}

/** Names a share link: reopening it finds the copy it made. */
export function shareKey(origin: string, capability: string) {
  const url = new URL(origin);
  capabilitySchema.parse(capability);

  return createHash("sha256")
    .update(JSON.stringify([url.origin, capability]))
    .digest("hex");
}

export interface ShareImport {
  store: ReviewStore;
  data: LocalReviewData;
  fetchRepository?: typeof fetchPinnedRepository;
  cloneRepository?: typeof cloneSharedRepository;
  onStage?: (stage: "fetching" | "validating") => void;
}

/** Imports a share as an ordinary board, once per link: the link's copy
 * comes back while it exists, even from Trash. */
export async function importShare(
  input: ShareImport,
  key: string,
  received: ShareBundle,
  attribution?: ShareAttribution,
): Promise<string> {
  const { store, data } = input;
  const existing = store.copyOf(key);

  if (existing) return existing;
  const { bundle, snapshot, maps } = validateShareBundle(received);
  const cloneUrl = bundle.repository?.cloneUrl;

  if (!cloneUrl)
    throw new ReviewInputError(
      "This share can only be viewed in the browser.",
      409,
    );

  input.onStage?.("fetching");

  const repositoryId = await shareRepository(
    input,
    cloneUrl,
    snapshot.pins,
    referenceCommits(snapshot),
    key,
  );

  const pins = snapshot.pins && { ...snapshot.pins, repositoryId };

  input.onStage?.("validating");

  const ranges = Object.values(maps).flatMap((map) =>
    map.elements.flatMap((element) =>
      (element.sourceRanges ?? []).map((range) => ({
        ...range,
        side: map.side,
      })),
    ),
  );

  if (pins && ranges.length) await data.validateSources(pins, ranges);

  // The copy's resources are its own: the sender's ids may be in this store.
  const ids = new Map(
    [...Object.keys(bundle.traces), ...Object.keys(maps)].map((id) => [
      id,
      randomUUID(),
    ]),
  );

  for (const [id, trace] of Object.entries(bundle.traces))
    await data.upload({ kind: "trace", id: ids.get(id), repositoryId, trace });

  for (const [id, { commit, side, elements, relationships }] of Object.entries(
    maps,
  ))
    store.putResource(
      ids.get(id)!,
      repositoryId,
      "map",
      "application/json",
      Buffer.from(JSON.stringify({ commit, side, elements, relationships })),
    );

  let document = JSON.stringify(snapshot.document);

  for (const [id, copy] of ids) document = document.replaceAll(id, copy);

  const { reviewId } = await store.execute(
    {
      operation: {
        type: "create",
        ...(snapshot.title && { title: snapshot.title }),
        target: pins
          ? { kind: "commits", ...pins }
          : { kind: "project", repositoryId },
      },
    },
    {
      document: JSON.parse(document),
      lenses: snapshot.lenses,
      origin: snapshot.origin,
      shared: { ...attribution, cloneUrl, key },
    },
    { kind: "person" },
  );

  return reviewId;
}

/** A checkout of the share's repository with every commit it reads at: the
 * receiver's own when they have one, else one Desktop clones. */
async function shareRepository(
  { store, data, ...git }: ShareImport,
  cloneUrl: string,
  pins: Pick<Pins, "base" | "head"> | undefined,
  commits: string[],
  key: string,
) {
  const root = path.join(devReviewHome(), "shared-repositories");

  await mkdir(root, { recursive: true, mode: 0o700 });

  const name = cloneUrl
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .at(-1);

  const managed = path.join(
    await realpath(root),
    `${safeStorageSegment(name || "repository")}-${createHash("sha256").update(cloneUrl).digest("hex").slice(0, 8)}`,
  );

  const own = store
    .checkoutsOf(cloneUrl)
    .find((id) => store.repositoryPath(id) !== managed);

  const cloned = store
    .repositories()
    .some((repository) => repository.path === managed);

  if (!own && !(cloned && existsSync(path.join(managed, ".git")))) {
    await rm(managed, { recursive: true, force: true });

    try {
      if (pins) {
        await (git.fetchRepository ?? fetchPinnedRepository)(
          managed,
          cloneUrl,
          pins,
          false,
          commits,
        );
        await sharedGit(managed, [
          "checkout",
          "--detach",
          { commit: pins.head },
        ]);
      } else
        await (git.cloneRepository ?? cloneSharedRepository)(managed, cloneUrl);
    } catch (error) {
      await rm(managed, { recursive: true, force: true });
      throw error;
    }
  }

  const repositoryId = own ?? (await data.register(managed)).id;

  await fetchSharedCommits(
    store.repositoryPath(repositoryId),
    [...(pins ? [pins.base, pins.head] : []), ...commits],
    key,
  );

  return repositoryId;
}

/** Separate immutable directory tree; authoring mutation handlers cannot write it. */
export class SharedReviewStore {
  private readonly loaded = new Map<
    string,
    { attribution?: ShareAttribution }
  >();
  private readonly validated = new Map<
    string,
    ReturnType<typeof validateShareBundle>
  >();
  private readonly attention = new Map<
    string,
    { viewedAt: string | null; trashedAt: string | null }
  >();
  private readonly listeners = new Set<() => void>();
  private catalogLoaded = false;
  private readonly purgeTimer: ReturnType<typeof setInterval>;
  private purgePending: Promise<void> | undefined;
  private readonly downloads = new Set<Promise<void>>();

  trackImport(job: Promise<void>) {
    this.downloads.add(job);
    void job.finally(() => this.downloads.delete(job));
  }

  async close() {
    clearInterval(this.purgeTimer);
    await this.purgePending;
    await Promise.allSettled([...this.downloads, ...this.jobs.values()]);
  }

  private local?: { store: ReviewStore; data: LocalReviewData };
  private readonly repositories = new Map<string, string>();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly states = new Map<
    string,
    {
      stage: "downloading" | "fetching" | "validating" | "ready" | "error";
      error?: string;
    }
  >();

  constructor(
    readonly root: string,
    private readonly fetchRepository = fetchPinnedRepository,
    private readonly cloneRepository = cloneSharedRepository,
  ) {
    this.purgeTimer = setInterval(() => {
      void this.purgeExpired().catch((error) =>
        console.error("Could not purge expired shared whiteboards:", error),
      );
    }, 60_000);
    this.purgeTimer.unref();
  }

  private purgeExpired(): Promise<void> {
    if (this.purgePending) return this.purgePending;

    const expired = [...this.attention].filter(
      ([, state]) =>
        state.trashedAt &&
        Date.parse(state.trashedAt) <= Date.now() - 30 * 86400000,
    );

    const pending = (async () => {
      for (const [id] of expired) await this.removeLocal(id);
    })();

    this.purgePending = pending.finally(() => {
      this.purgePending = undefined;
    });

    return this.purgePending;
  }

  connect(store: ReviewStore, data: LocalReviewData) {
    this.local = { store, data };
    store.askHistory.setExternalWriteGuard((id) => this.assertWritable(id));
    data.workspaces.attachExternalReviews({
      has: (id) =>
        this.has(id) || (!this.catalogLoaded && id.startsWith("shared-")),
      subscribe: (listener) => this.subscribe(listener),
    });
  }

  has(id: string) {
    return this.loaded.has(id);
  }

  status(id: string) {
    return (
      this.states.get(id) ?? {
        stage: "error" as const,
        error: "Shared review is not available.",
      }
    );
  }

  setStatus(
    id: string,
    stage: "downloading" | "fetching" | "validating" | "ready" | "error",
    error?: string,
  ) {
    this.states.set(id, { stage, error });

    for (const listener of this.listeners) listener();
  }

  repositoryRoot(id: string) {
    if (!/^shared-[a-f0-9]{64}$/.test(id))
      throw new ReviewInputError("Invalid shared review ID.");

    return path.join(this.root, ".repositories", id);
  }

  async prepare(id: string): Promise<void> {
    const active = this.jobs.get(id);

    if (active) return active;
    const job = this.prepareRepository(id).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);

    return job;
  }

  private async prepareRepository(id: string) {
    const local = this.local;
    const saved = this.validated.get(id);

    if (!saved)
      throw new ReviewInputError("Shared review is not available.", 404);

    if (!saved.snapshot.pins) {
      await this.prepareUnpinned(id, saved.bundle.repository?.cloneUrl);

      return;
    }

    if (!local)
      throw new ReviewInputError("Repository service is unavailable.", 409);
    const root = this.repositoryRoot(id);

    const commits = referenceCommits(saved.snapshot);

    try {
      this.setStatus(id, "fetching");

      if (!(await repositoryReady(root, saved.snapshot.pins, commits))) {
        const prior = this.repositories.get(id);
        await local.data.workspaces.remove(id);

        if (prior) await local.data.forgetRepository(prior);
        await rm(root, { recursive: true, force: true });
        await this.fetchRepository(
          root,
          saved.bundle.repository!.cloneUrl,
          saved.snapshot.pins,
          false,
          commits,
        );
        await sharedGit(root, [
          "checkout",
          "--detach",
          { commit: saved.snapshot.pins.head },
        ]);
      }

      const repository = await local.data.register(root);
      this.repositories.set(id, repository.id);
      await writeFile(
        path.join(this.root, id, "repository.json"),
        JSON.stringify({ repositoryId: repository.id, ready: false }),
        { mode: 0o600 },
      );
      const pins = { ...saved.snapshot.pins, repositoryId: repository.id };
      this.setStatus(id, "validating");
      await local.data.validatePins(pins);

      await this.validateReferences(saved, repository.id, pins);
      await local.data.workspaces.open(id, pins);

      const failed = local.data.workspaces
        .list(id)
        .find((workspace) => !workspace.rootPath);

      if (failed)
        throw new ReviewInputError(
          failed.log ||
            "Could not prepare the pinned checkout. Retry opening the share.",
          409,
        );
      await writeFile(
        path.join(this.root, id, "repository.json"),
        JSON.stringify({ repositoryId: repository.id, ready: true }),
        { mode: 0o600 },
      );
      this.setStatus(id, "ready");
    } catch (error) {
      const message =
        error instanceof ReviewInputError
          ? error.message
          : "Could not prepare the shared repository. Check Git credentials and retry.";

      this.setStatus(id, "error", message);
      throw new ReviewInputError(message, 409);
    }
  }

  /** Reads each of a shared board's references at its own commits, in the
   * checkout of its repository. */
  private async validateReferences(
    saved: ReturnType<typeof validateShareBundle>,
    repositoryId: string,
    pins?: Pins,
  ) {
    const references = new Map<
      string,
      { pins: Pins; ranges: FileLineRange[] }
    >();

    const add = (at: Pins, range: FileLineRange) => {
      const key = JSON.stringify([at.base, at.head]);
      const group = references.get(key) ?? { pins: at, ranges: [] };

      group.ranges.push(range);
      references.set(key, group);
    };

    for (const { source } of sourceReferences(saved.snapshot.document, {
      repositoryId,
    }))
      add({ ...anchorPins(source, pins), repositoryId }, source);

    if (pins)
      for (const map of Object.values(saved.maps))
        for (const element of map.elements)
          for (const range of element.sourceRanges ?? [])
            add(pins, { ...range, side: map.side });

    for (const group of references.values())
      await this.local!.data.validateSources(group.pins, group.ranges);
  }

  /** Files an unpinned board under a local checkout of its repository,
   * else a managed clone. */
  private async prepareUnpinned(id: string, cloneUrl: string | undefined) {
    const local = this.local;
    const saved = this.validated.get(id)!;

    if (!cloneUrl || !local) {
      this.setStatus(id, "ready");

      return;
    }

    const root = this.repositoryRoot(id);

    try {
      this.setStatus(id, "fetching");
      const managed = path.join(await realpath(this.root), ".repositories");

      let repositoryId = local.store
        .checkoutsOf(cloneUrl)
        .find(
          (checkout) =>
            !local.store.repositoryPath(checkout).startsWith(managed),
        );

      if (!repositoryId) {
        if (!existsSync(path.join(root, ".git"))) {
          await rm(root, { recursive: true, force: true });
          await this.cloneRepository(root, cloneUrl);
        }

        repositoryId = (await local.data.register(root)).id;
      }

      // A plan's commit links read at commits the checkout may not have.
      const checkout = local.store.repositoryPath(repositoryId);

      await fetchSharedCommits(
        checkout,
        referenceCommits(saved.snapshot, repositoryId),
        id,
      );
      this.setStatus(id, "validating");
      await this.validateReferences(saved, repositoryId);
      this.repositories.set(id, repositoryId);
      await writeFile(
        path.join(this.root, id, "repository.json"),
        JSON.stringify({ repositoryId, ready: true }),
        { mode: 0o600 },
      );
      this.setStatus(id, "ready");
    } catch (error) {
      const message =
        error instanceof ReviewInputError
          ? error.message
          : "Could not prepare the shared repository. Check Git credentials and retry.";

      this.setStatus(id, "error", message);
      throw new ReviewInputError(message, 409);
    }
  }

  async assertReady(id: string) {
    const saved = this.validated.get(id);

    if (
      !saved ||
      (saved.snapshot.pins &&
        !(await repositoryReady(
          this.repositoryRoot(id),
          saved.snapshot.pins,
          referenceCommits(saved.snapshot),
        )))
    ) {
      this.setStatus(
        id,
        "error",
        "The managed checkout is missing. Reopen the share link to fetch it again.",
      );
      throw new ReviewInputError(this.status(id).error!, 409);
    }

    this.get(id);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async load() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });

    for (const id of await readdir(this.root)) {
      if (!/^shared-[a-f0-9]{64}$/.test(id)) continue;

      // Earlier share formats are not read; reopening the link imports again.
      if (!existsSync(path.join(this.root, id, "bundle.json"))) {
        await rm(path.join(this.root, id), { recursive: true, force: true });
        continue;
      }

      let saved: Awaited<ReturnType<SharedReviewStore["readValidated"]>>;

      try {
        saved = await this.readValidated(id);
      } catch {
        await rename(
          path.join(this.root, id),
          path.join(this.root, `.invalid-${id}-${Date.now()}`),
        );
        console.warn(
          "A cached shared review was corrupt. Reopen its share link to download it again.",
        );
        continue;
      }

      const { attribution, validated } = saved;
      this.loaded.set(id, { attribution });
      this.validated.set(id, validated);

      let prepared = false;

      try {
        const metadata = z
          .strictObject({ repositoryId: z.string(), ready: z.boolean() })
          .parse(
            JSON.parse(
              await readFile(
                path.join(this.root, id, "repository.json"),
                "utf8",
              ),
            ),
          );

        // A board with no pins may use the receiver's own checkout.
        if (
          this.local?.store.repositoryPath(metadata.repositoryId) ===
            path.join(await realpath(this.root), ".repositories", id) ||
          (!validated.snapshot.pins &&
            this.local?.store
              .repositories()
              .some((repository) => repository.id === metadata.repositoryId))
        ) {
          this.repositories.set(id, metadata.repositoryId);
          prepared = metadata.ready;
        }
      } catch {
        /* A first or interrupted import has no local registration yet. */
      }

      if (!validated.snapshot.pins) {
        if (this.repositories.has(id) || !validated.bundle.repository)
          this.setStatus(id, "ready");
        else void this.prepare(id).catch(() => {});
      } else if (
        prepared &&
        this.local &&
        (await repositoryReady(
          this.repositoryRoot(id),
          validated.snapshot.pins,
          referenceCommits(validated.snapshot),
        ))
      ) {
        const repository = await this.local.data.register(
          this.repositoryRoot(id),
        );

        this.repositories.set(id, repository.id);
        this.setStatus(id, "ready");
      } else
        this.setStatus(
          id,
          "error",
          "Reopen the share link to fetch its repository.",
        );

      const attentionPath = path.join(this.root, id, "attention.json");

      if (existsSync(attentionPath)) {
        const raw = JSON.parse(await readFile(attentionPath, "utf8"));

        const migrated =
          Object.hasOwn(raw, "dismissedAt") || Object.hasOwn(raw, "deletedAt");

        const state = z
          .strictObject({
            viewedAt: z.string().nullable(),
            trashedAt: z.string().nullable(),
          })
          .parse(
            migrated
              ? {
                  viewedAt: raw.viewedAt,
                  trashedAt: Object.hasOwn(raw, "deletedAt")
                    ? raw.deletedAt
                    : raw.dismissedAt
                      ? new Date().toISOString()
                      : null,
                }
              : raw,
          );

        this.attention.set(id, state);

        if (migrated)
          await writeFile(attentionPath, JSON.stringify(state), {
            mode: 0o600,
          });
      }
    }

    await this.purgeExpired();

    this.catalogLoaded = true;

    for (const listener of this.listeners) listener();
  }

  assertWritable(id: string) {
    const trashedAt = this.attention.get(id)?.trashedAt;

    if (trashedAt)
      throw new ReviewInputError(
        `This whiteboard was moved to Trash on ${new Date(trashedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Restore it with session_lifecycle({"sessionId":"${id}","state":"active"}) to continue.`,
        409,
      );
  }

  get(id: string) {
    const loaded = this.loaded.get(id);

    if (!loaded)
      throw new ReviewInputError("Shared review is not available.", 404);
    const validated = this.validated.get(id)!;
    const repositoryId = this.repositories.get(id);

    if (
      this.status(id).stage !== "ready" ||
      (validated.snapshot.pins &&
        (!repositoryId ||
          !existsSync(path.join(this.repositoryRoot(id), ".git"))))
    )
      throw new ReviewInputError(
        this.status(id).error ??
          "Fetch the shared repository before opening this review.",
        409,
      );

    return {
      ...validated,
      snapshot: {
        ...validated.snapshot,
        reviewId: id,
        trashedAt: this.attention.get(id)?.trashedAt ?? null,
        pins: validated.snapshot.pins
          ? { ...validated.snapshot.pins, repositoryId: repositoryId! }
          : undefined,
        target: validated.snapshot.pins
          ? {
              kind: "commits" as const,
              ...validated.snapshot.pins,
              repositoryId: repositoryId!,
            }
          : repositoryId
            ? { kind: "project" as const, repositoryId }
            : undefined,
        shared: {
          ...loaded.attribution,
          key: id,
          cloneUrl: validated.bundle.repository?.cloneUrl,
        },
      },
    };
  }

  list() {
    const reviews = this.loaded
      .keys()
      .filter(
        (id) =>
          this.status(id).stage === "ready" &&
          (!this.validated.get(id)?.snapshot.pins ||
            existsSync(path.join(this.repositoryRoot(id), ".git"))),
      )
      .map((id) => {
        const { document: _document, ...snapshot } = this.get(id).snapshot;

        const project = snapshot.target
          ? this.local?.store.checkoutProject(snapshot.target.repositoryId)
          : undefined;

        return {
          ...snapshot,
          firstCreatedAt:
            snapshot.version === 0 ? snapshot.createdAt : undefined,
          repositoryName: "Shared review",
          ...(project && { project }),
          viewedAt: this.attention.get(id)?.viewedAt ?? null,
          trashedAt: this.attention.get(id)?.trashedAt ?? null,
        };
      })
      .toArray();

    return this.local?.store.withDiffStats(reviews) ?? reviews;
  }

  async removeLocal(id: string) {
    await this.jobs.get(id)?.catch(() => {});

    if (!this.loaded.has(id))
      throw new ReviewInputError("Shared review is not available.", 404);
    await this.local?.data.workspaces.remove(id);
    const repositoryId = this.repositories.get(id);

    if (repositoryId) {
      const checkout = this.local?.store.repositoryPath(repositoryId);

      // The commits kept for its links go with it.
      if (checkout)
        await forgetSharedCommits(checkout, id).catch((error) =>
          console.error(`Could not drop the refs kept for share ${id}:`, error),
        );
      await this.local?.data.forgetRepository(repositoryId);
      await this.local?.store.unregisterRepository(repositoryId);
    }

    await rm(this.repositoryRoot(id), { recursive: true, force: true });
    this.repositories.delete(id);
    this.states.delete(id);
    await rm(path.join(this.root, id), { recursive: true, force: true });
    this.local?.store.askHistory.removeReview(id);
    this.loaded.delete(id);
    this.validated.delete(id);
    this.attention.delete(id);

    for (const listener of this.listeners) listener();
  }

  async setAttention(id: string) {
    await this.updateAttention(id, "view");
  }

  async setLifecycle(id: string, state: "active" | "trash") {
    await this.updateAttention(id, state);
  }

  private async updateAttention(
    id: string,
    action: "view" | "active" | "trash",
  ) {
    this.get(id);

    const trashedAt = this.attention.get(id)?.trashedAt;

    if (trashedAt && Date.parse(trashedAt) <= Date.now() - 30 * 86400000) {
      await this.removeLocal(id);
      throw new ReviewInputError(
        "The 30-day recovery period has ended. This whiteboard was permanently deleted.",
        404,
      );
    }

    if (action === "view") this.assertWritable(id);

    const state = this.attention.get(id) ?? {
      viewedAt: null,
      trashedAt: null,
    };

    if (action === "view") state.viewedAt = new Date().toISOString();
    else
      state.trashedAt =
        action === "trash"
          ? (state.trashedAt ?? new Date().toISOString())
          : null;
    await writeFile(
      path.join(this.root, id, "attention.json"),
      JSON.stringify(state),
      { mode: 0o600 },
    );
    this.attention.set(id, state);

    for (const listener of this.listeners) listener();
  }

  async import(
    origin: string,
    capability: string,
    bundle: ShareBundle,
    attribution?: ShareAttribution,
  ) {
    const validated = validateShareBundle(bundle);
    const id = sharedReviewId(origin, capability);
    this.assertWritable(id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(path.join(this.root, ".import-"));

    try {
      await writeFile(
        path.join(staging, "bundle.json"),
        JSON.stringify(validated.bundle),
        { mode: 0o600 },
      );

      if (attribution)
        await writeFile(
          path.join(staging, "attribution.json"),
          JSON.stringify(attribution),
          { mode: 0o600 },
        );

      try {
        await rename(staging, path.join(this.root, id));
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            ["ENOTEMPTY", "EEXIST"].includes(String(error.code))
          )
        )
          throw error;
        const existing = await this.read(id);

        if (JSON.stringify(existing) !== JSON.stringify(validated.bundle))
          throw new Error("An immutable share changed its bundle.");
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }

    this.loaded.set(id, { attribution });
    this.validated.set(id, validated);

    for (const listener of this.listeners) listener();

    await this.prepare(id);

    return id;
  }

  async read(id: string): Promise<ShareBundle> {
    return (await this.readValidated(id)).validated.bundle;
  }

  private async readValidated(id: string) {
    if (!/^shared-[a-f0-9]{64}$/.test(id))
      throw new Error("Invalid shared review ID.");
    const dir = path.join(this.root, id);
    const file = path.join(dir, "bundle.json");

    if ((await stat(file)).size > MAX_SHARE_BYTES)
      throw new Error("Shared bundle is too large.");

    let attribution: ShareAttribution | undefined;

    try {
      attribution = z
        .strictObject({ login: z.string(), sharedAt: z.number() })
        .parse(
          JSON.parse(
            await readFile(path.join(dir, "attribution.json"), "utf8"),
          ),
        );
    } catch {
      /* Local-only fixtures have no hosted sender. */
    }

    return {
      attribution,
      validated: validateShareBundle(JSON.parse(await readFile(file, "utf8"))),
    };
  }
}
