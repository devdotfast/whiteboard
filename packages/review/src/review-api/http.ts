import { createHash } from "node:crypto";

import {
  type JsonObject,
  type JsonValue,
  isJsonObject,
  isStringValue,
} from "@dev.fast/json";
import { defaultBranch, resolveRepoContext } from "@dev.fast/local-vcs";
import {
  REVIEW_CLIENT_HEADER,
  REVIEW_CLIENT_REMOTE,
  type ReviewApiSummary,
  type ReviewBoardPlace,
  type ReviewProjectThreads,
  type ReviewRemoteLanguageEnvironment,
  type ReviewRemoteNavigatorAnswer,
  type ReviewStreamLine,
  type ReviewStructuralDiffEvent,
  type ReviewThreadBoard,
  boardIconKind,
  boardTitle,
} from "@dev.fast/review-protocol";
import { errorMessage } from "@dev.fast/trace-core";
import {
  type AgentSelection,
  AgentSelectionSchema,
  selectionMarkdown,
} from "@review/agent-selection.js";
import {
  type AskAgentStatus,
  askAgents,
  defaultAskPermissions,
} from "@review/ask/agents.js";
import { checkoutFiles, mentionableFiles } from "@review/ask/checkout-files.js";
import { parseFileRef, resolveFileRefs } from "@review/ask/file-refs.js";
import {
  type AskAgentId,
  type AskThreadState,
  askAgentIds,
  askChoiceKinds,
  askPermissionsSchema,
  askPicksSchema,
  askQuestionSchema,
} from "@review/ask/thread-state.js";
import type { AskThreadHooks } from "@review/ask/thread.js";
import type { AskThreads } from "@review/ask/threads.js";
import { watchAskThreads } from "@review/ask/watch.js";
import { fuzzyRank } from "@review/fuzzy-match.js";
import { resolveReviewStackLayers } from "@review/review-stack.js";
import { readBoundedRequestJson } from "@review/server/hono-http.js";
import { HttpJsonError } from "@review/server/http-json.js";
import {
  type SharingHostEvents,
  mountSharingHost,
} from "@review/sharing/host.js";
import { forgetSharedCommits } from "@review/sharing/repository.js";
import type { ReviewSessionAgent } from "@review/ui-telemetry-events.js";
import { scopedCoverage } from "@review/viewed-coverage.js";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { anchorQuotes } from "./anchor-quotes.js";
import type { AskRecord } from "./ask-history.js";
import { authoringTools } from "./authoring-tools.js";
import { documentText } from "./document-text.js";
import {
  ReviewInputError,
  type ReviewTarget,
  boardRepositoryId,
  elements,
} from "./document.js";
import { instructionsQuerySchema, renderInstructions } from "./instructions.js";
import type { LocalReviewData } from "./local-data.js";
import { registerOnboardingRoutes } from "./onboarding.js";
import {
  inspectQuerySchema,
  queryAnchor,
  readQuerySchemas,
} from "./read-schemas.js";
import {
  REVIEW_PERSON_HEADER,
  REVIEW_THREAD_HEADER,
  type ReviewRequestVia,
  reviewRequestOrigin,
} from "./request-origin.js";
import {
  type UncategorizedReport,
  legacyModeSchema,
  lensReport,
  progressUpdateSchema,
  reviewProgress,
  uncategorizedReport,
} from "./review-progress.js";
import {
  type Author,
  type PlacedBoard,
  type ReviewStore,
  type Snapshot,
  commandSchema,
  inspectSnapshot,
} from "./store.js";
import { listPinnedTraces, readStoredTrace } from "./traces.js";

export interface AskHost {
  threads: AskThreads;
  agents: () => Promise<AskAgentStatus[]>;
}

const askStartSchema = z.strictObject({
  agent: z.enum(askAgentIds),
  question: askQuestionSchema,
  selection: AgentSelectionSchema,
  picks: askPicksSchema.optional(),
  permissions: askPermissionsSchema.optional(),
});

const askPermitSchema = z.strictObject({ permissions: askPermissionsSchema });

/** The threads one watch follows: those of a review's open Asks. A body,
 * not the query, so there can be as many as are open. */
const askWatchSchema = z.strictObject({ threads: z.array(z.string().min(1)) });

const askOpenSchema = z.strictObject({ picks: askPicksSchema.optional() });

const askChoiceSchema = z.strictObject({
  kind: z.enum(askChoiceKinds),
  value: z.string().min(1).max(200),
});

const askFilesSchema = z.strictObject({
  paths: z.array(z.string().min(1).max(400)).max(100),
});

const askFollowUpSchema = z.strictObject({ question: askQuestionSchema });

/** A question with its images: four of up to 5 MB each, base64. */
const ASK_REQUEST_MAX_BYTES = 30 * 1024 * 1024;

const askMentionsSchema = z.object({
  query: z.string().max(400).default(""),
  /** A conversation's checkout, which can be an earlier version's. */
  thread: z.string().optional(),
});

const askOfferQuerySchema = z.object({
  /** The model picked for a question not yet asked. */
  model: askPicksSchema.shape.model,
});

/** How many files a mention picker shows. */
const MENTION_LIMIT = 20;

const askDecisionSchema = z.strictObject({
  permissionId: z.string().min(1),
  optionId: z.string().min(1),
});

export interface AuthoringCapabilities {
  desktopAvailable: boolean;
  softwareMapEnabled: boolean;
}

/**
 * What the host reports about reviews, for telemetry. `onReviewCreated` fires
 * again for a replayed create command; consumers dedupe by review id.
 */
export interface ReviewApiHooks {
  onReviewCreated?: (event: {
    reviewId: string;
    blocks: number;
    via: ReviewRequestVia;
    agentKind?: ReviewSessionAgent;
  }) => void;
  sharing?: SharingHostEvents;
}

/** A person's save carries the whole board, which edits one at a time can
 * grow past the size of a single command. */
const PERSON_EDIT_MAX_BYTES = 16 * 1024 * 1024;

/** A request the gateway forwarded from another machine. */
const remoteCaller = (context: Context) =>
  context.req.header(REVIEW_CLIENT_HEADER) === REVIEW_CLIENT_REMOTE;

/** Both hosts mount this behind their token authentication. */
export function createReviewApi(
  store: ReviewStore,
  data?: LocalReviewData,
  open?: (review: {
    reviewId: string;
    title: string;
  }) => Promise<{ softwareMapEnabled: boolean }>,
  /** Desktop's: share sign-in and imports. */
  sharing = false,
  capabilities: () =>
    | AuthoringCapabilities
    | Promise<AuthoringCapabilities> = () => ({
    desktopAvailable: Boolean(open),
    softwareMapEnabled: false,
  }),
  // Read per request: capture can change from outside this server.
  traceEnabled: () => Promise<boolean> = async () => false,
  /** Which server this is, for whiteboard_status. */
  status: () => JsonObject = () => ({}),
  hooks: ReviewApiHooks = {},
  /** Desktop's Ask: local agents answering questions about a selection. */
  ask?: AskHost,
  animationsEnabled: () => boolean = () => false,
) {
  const app = new Hono();
  app.onError((error, context) => {
    if (error instanceof HttpJsonError)
      return context.json({ error: error.message }, error.statusCode);

    if (error instanceof ReviewInputError)
      return context.json({ error: error.message }, error.status);

    // A readable message for agents and the canvas; issues stay for programs.
    if (error instanceof z.ZodError)
      return context.json(
        { error: z.prettifyError(error), issues: error.issues },
        400,
      );

    // Provider failures may contain local paths/subprocess output: the server
    // log gets the cause, the response only its kind. Desktop routes this
    // process's stderr to its main log.
    console.error(
      `[Review API] ${context.req.method} ${context.req.path} failed:`,
      error,
    );

    return context.json(
      {
        error: `Whiteboard operation failed (${failureKind(error)}). The server logged the cause; Whiteboard Desktop writes it to main.log in its logs folder.`,
      },
      500,
    );
  });

  if (data)
    app.use("*", async (context, next) => {
      if (context.req.method === "GET" && !context.req.query("version"))
        await store.refreshWorktrees();
      await next();
    });

  const writable: MiddlewareHandler = async (context, next) => {
    store.assertWritable(context.req.param("id")!);
    await next();
  };

  if (sharing && data) mountSharingHost(app, store, data, hooks.sharing);

  const readReview = (id: string, version?: number): Snapshot =>
    store.read(id, version);

  /** Adds a PR board's state, as this host last read it from GitHub. */
  const withPullRequestState = <
    Board extends {
      pullRequestUrl?: string;
      origin?: { pullRequestUrl?: string };
    },
  >(
    board: Board,
  ) => {
    const state = data?.pullRequestState(
      board.origin?.pullRequestUrl ?? board.pullRequestUrl,
    );

    return state ? { ...board, pullRequestState: state } : board;
  };

  const catalog = () => store.list().map(withPullRequestState);

  /** Where a board sits among its project's, and its PR's facts, for the
   * board's header. */
  const placeOf = (id: string): ReviewBoardPlace => {
    if (!store.has(id)) return { siblings: [] };

    const { board, repository, parent, siblings, children } = store.place(id);
    const url = board.origin?.pullRequestUrl;
    const state = data?.pullRequestState(url);
    const baseBranch = url && data?.pullRequestBaseBranch(url);
    const headBranch = url && data?.pullRequestHeadBranch(url);

    const place = ({ reviewId, title, target }: PlacedBoard) => ({
      reviewId,
      title,
      icon: boardIconKind(target),
    });

    const listed = (child: PlacedBoard) => {
      const childState = data?.pullRequestState(child.origin?.pullRequestUrl);

      return {
        ...place(child),
        ...(child.origin?.pullRequestNumber && {
          pullRequestNumber: child.origin.pullRequestNumber,
        }),
        ...(childState && { pullRequestState: childState }),
      };
    };

    return {
      ...(state && { pullRequestState: state }),
      ...(baseBranch && { baseBranch }),
      ...(headBranch && { headBranch }),
      ...(repository && { repository }),
      board: place(board),
      ...(parent && { parent: place(parent) }),
      siblings: siblings.map(listed),
      ...(children?.length && { children: children.map(listed) }),
    };
  };

  app.get("/", (context) => context.json(catalog()));

  app.get("/feedback-eligibility", (context) =>
    context.json({ eligible: store.feedbackEligible() }),
  );

  // Server-owned state only: asking the Desktop canvas would let a stalled
  // renderer block tool listing and the first instructions call.
  const instructionContext = async () => ({
    traceEnabled: await traceEnabled(),
    animationsEnabled: animationsEnabled(),
  });

  app.get("/authoring", async (context) => {
    const instructions = await instructionContext();

    return context.json(
      authoringTools(instructions.traceEnabled, instructions.animationsEnabled),
    );
  });
  app.get("/instructions", async (context) => {
    const { topic } = instructionsQuerySchema.parse(context.req.query());

    return context.json(
      await renderInstructions(topic, await instructionContext()),
    );
  });
  app.get("/:id/progress", async (context) => {
    if (!data) throw new ReviewInputError("Source data is unavailable.", 409);

    const query = readQuerySchemas.get
      .pick({ version: true })
      .extend({
        mode: legacyModeSchema,
        wait: z.enum(["false", "true"]).default("true"),
      })
      .parse(context.req.query());

    const snapshot = readReview(context.req.param("id"), query.version);

    const documentPins =
      query.wait === "false" && snapshot.pins
        ? (await data.resolveSource(snapshot)).pins
        : undefined;

    if (documentPins) {
      const state = data.coverageSnapshot(snapshot.reviewId, documentPins);

      if (state.pending)
        return context.json(
          await reviewProgress(
            store,
            data,
            snapshot,
            context.req.raw.signal,
            state.comparison,
          ),
          202,
        );
    }

    return context.json(
      await reviewProgress(store, data, snapshot, context.req.raw.signal),
    );
  });
  app.post("/:id/progress", writable, async (context) => {
    if (!data) throw new ReviewInputError("Source data is unavailable.", 409);

    const input = progressUpdateSchema.parse(
      await readBoundedRequestJson(context.req.raw),
    );

    const id = context.req.param("id");

    const snapshot = store.read(id);

    const pins = snapshot.pins
      ? (await data.resolveSource(snapshot)).pins
      : undefined;

    const coverage = pins && data.coverageSnapshot(id, pins);

    const partial =
      coverage && coverage.pending ? coverage.comparison : undefined;

    const progress = await reviewProgress(
      store,
      data,
      snapshot,
      context.req.raw.signal,
      partial,
    );

    const files = input.files.map((update) => {
      const file = progress.files.find((file) => file.path === update.path);

      if (!file || file.fingerprint !== update.fingerprint)
        throw new ReviewInputError(
          "This file changed. Reload before marking it viewed.",
          409,
        );

      return {
        path: file.path,
        fingerprint: file.fingerprint,
        scope: scopedCoverage(file, update.sources),
      };
    });

    if (store.read(id).version !== snapshot.version)
      throw new ReviewInputError(
        "Review changed during this update. Try again.",
        409,
      );
    store.updateViewedCoverage(id, files, input.viewed);

    return context.json(
      await reviewProgress(
        store,
        data,
        store.read(id, input.version),
        context.req.raw.signal,
        partial,
      ),
    );
  });
  // A lens author's cheap read: the lenses as authored, what each resolves
  // to, and the changed lines no lens selects yet.
  app.get("/:id/lenses", async (context) => {
    if (!data) throw new ReviewInputError("Source data is unavailable.", 409);

    const snapshot = readReview(context.req.param("id"));

    return context.json({
      version: snapshot.version,
      ...lensReport(
        snapshot.lenses ?? [],
        await reviewProgress(store, data, snapshot, context.req.raw.signal),
      ),
    });
  });
  app.get("/status", async (context) =>
    context.json({
      ...status(),
      desktopAvailable: (await capabilities()).desktopAvailable,
    }),
  );

  app.get("/capabilities", async (context) =>
    context.json({
      ...(await capabilities()),
      animationsEnabled: animationsEnabled(),
    }),
  );

  app.get("/:id/activity", (context) => {
    const id = context.req.param("id");
    readReview(id);

    return context.json(store.activity.read(id));
  });

  // One route per agent tool; the path names the action.
  for (const action of ["begin", "update", "end"] as const)
    app.post(`/:id/activity/${action}`, writable, async (context) => {
      const input = await readBoundedRequestJson(context.req.raw);
      const id = context.req.param("id");
      store.assertExists(id);

      return context.json(
        store.activity.update(
          id,
          isJsonObject(input) ? { ...input, action } : input,
        ),
      );
    });
  // The person's canvas, never an agent tool: a save of the whole board,
  // the block in focus, and discarding a board left untouched.
  app.post("/:id/person-edit", async (context) =>
    context.json(
      await store.personEdit(
        context.req.param("id"),
        await readBoundedRequestJson(context.req.raw, PERSON_EDIT_MAX_BYTES),
      ),
    ),
  );
  app.post("/:id/focus", async (context) =>
    context.json(
      store.focus(
        context.req.param("id"),
        await readBoundedRequestJson(context.req.raw),
      ),
    ),
  );
  app.post("/:id/discard", async (context) =>
    context.json(await store.discard(context.req.param("id"))),
  );
  app.get("/watch", (context) => {
    let input: unknown;

    try {
      input = JSON.parse(context.req.query("subscriptions") ?? "");
    } catch {
      throw new ReviewInputError("Invalid subscriptions.");
    }

    const subscriptions = z
      .array(
        z.strictObject({
          reviewId: z.string().min(1).nullable(),
          mode: legacyModeSchema,
        }),
      )
      .parse(input);

    const lists = subscriptions.some((item) => item.reviewId === null);

    const reviewIds = new Set(
      subscriptions.flatMap((item) => item.reviewId ?? []),
    );

    let dirtyList = lists;
    const dirtyReviews = new Set(reviewIds);
    let sentList: string | undefined;
    // Bumped when a board a review links to changes, so its links reload.
    const linksRevision = new Map<string, number>();

    // The PR states its links show: only a change to one of them sends the
    // review again. GitHub answers for every PR on launch, a few at a time.
    const linksKey = (id: string) => {
      if (!data || !store.has(id)) return "";
      const { outgoing, backlinks } = store.links(id);

      return JSON.stringify(
        [...outgoing, ...backlinks].map(
          (link) =>
            link.pullRequestUrl &&
            data.pullRequestState(link.pullRequestUrl, { seen: false }),
        ),
      );
    };

    const linksKeys = new Map(
      [...reviewIds].map((reviewId) => [reviewId, linksKey(reviewId)] as const),
    );

    // A digest of a review's place and its project's branches, so a later
    // stream's matches unless its header or stack moved.
    const placeKey = (id: string) => {
      const project = store.summary(id)?.project;

      const branches = project
        ? store
            .listProject(project.id)
            .filter(({ origin }) => origin?.branch)
            .map(({ reviewId, origin, trashedAt }) => [
              reviewId,
              origin,
              trashedAt,
            ])
        : [];

      return createHash("sha1")
        .update(JSON.stringify([placeOf(id), branches]))
        .digest()
        .readUInt32BE(0);
    };

    const placeKeys = new Map(
      [...reviewIds].map((reviewId) => [reviewId, placeKey(reviewId)] as const),
    );

    const readReviewLine = (reviewId: string): ReviewStreamLine<Snapshot> => {
      try {
        return {
          kind: "review",
          reviewId,
          value: {
            ...readReview(reviewId),
            activity: store.activity.read(reviewId),
            coverageRevision: data?.coverageRevision(reviewId) ?? 0,
            linksRevision: linksRevision.get(reviewId) ?? 0,
            placeRevision: placeKeys.get(reviewId)!,
          },
        };
      } catch (error) {
        return {
          kind: "review",
          reviewId,
          error:
            error instanceof ReviewInputError
              ? error.message
              : "Could not read review.",
        };
      }
    };

    const lines = () => {
      const pending: string[] = [];

      if (dirtyList) {
        const line = JSON.stringify({
          kind: "list",
          mode: "structural",
          reviews: catalog(),
        } satisfies ReviewStreamLine);

        if (sentList !== line) pending.push(line);
        sentList = line;
      }

      for (const reviewId of dirtyReviews)
        pending.push(JSON.stringify(readReviewLine(reviewId)));

      dirtyList = false;
      dirtyReviews.clear();

      return pending;
    };

    const markReview = (reviewId: string) => {
      if (!reviewIds.has(reviewId)) return false;
      dirtyReviews.add(reviewId);

      return true;
    };

    /** Bumps the place of each board whose place changed. */
    const refreshPlaces = () => {
      let marked = false;

      for (const [id, key] of placeKeys) {
        const next = placeKey(id);

        if (next === key) continue;
        placeKeys.set(id, next);
        marked = markReview(id) || marked;
      }

      return marked;
    };

    const markLists = () => {
      dirtyList ||= lists;

      return lists;
    };

    return watch(lines, (notify) => {
      const stops = [
        store.watchWorktrees(),
        data?.subscribeCoverage((changed) => {
          let marked = false;

          for (const id of changed) marked = markReview(id) || marked;

          if (marked) notify();
        }) ?? (() => {}),
        store.subscribe((result) => {
          let marked = markReview(result.reviewId);

          for (const from of store.linkingBoards(result.reviewId)) {
            linksRevision.set(from, (linksRevision.get(from) ?? 0) + 1);
            marked = markReview(from) || marked;
          }

          if (marked) notify();
        }),
        store.activity.subscribe((id) => {
          if (markReview(id)) notify();
        }),
        store.activity.subscribeWorking(() => {
          if (markLists()) notify();
        }),
        // A PR's state shows on its board in the list, on links to it, and
        // with its branches in its board's header.
        data?.subscribePullRequestStates(() => {
          let marked = markLists();

          marked = refreshPlaces() || marked;

          for (const reviewId of reviewIds) {
            const next = linksKey(reviewId);

            if (next === linksKeys.get(reviewId)) continue;
            linksKeys.set(reviewId, next);
            linksRevision.set(reviewId, (linksRevision.get(reviewId) ?? 0) + 1);
            marked = markReview(reviewId) || marked;
          }

          if (marked) notify();
        }) ?? (() => {}),
        store.subscribeCatalog(() => {
          const marked = refreshPlaces();

          if (markLists() || marked) notify();
        }),
      ];

      return () => stops.forEach((stop) => stop());
    });
  });

  /** Show a review in Desktop and start preparing its pinned checkouts. */
  const openReview = async (review: Snapshot) => {
    if (!open) throw new ReviewInputError("The desktop is not connected.", 409);

    const settings = await open({
      reviewId: review.reviewId,
      title: review.title,
    });

    let environmentIssues: { message: string }[] | undefined;

    try {
      if (review.target?.kind === "commits" && review.pins)
        void data?.workspaces
          .source(review.reviewId, review.pins)
          .catch(() => {});
      environmentIssues = data?.currentEnvironmentIssues(review);
    } catch (error) {
      environmentIssues = [
        {
          message: `Could not check language checkouts: ${errorMessage(error)}. Recheck with review_environment.`,
        },
      ];
    }

    return {
      ...settings,
      environmentIssues: environmentIssues?.length
        ? environmentIssues
        : undefined,
    };
  };

  /**
   * A created or returned review is shown where Desktop can, unless the author asked
   * not to. The review is already saved, so a failed open is reported, not thrown.
   */
  const openCreated = async (reviewId: string) => {
    try {
      if (!open || !(await capabilities()).desktopAvailable)
        return { opened: false };

      return { opened: true, ...(await openReview(store.read(reviewId))) };
    } catch (error) {
      return {
        opened: false,
        openError: `${errorMessage(error)} Retry with review_open.`,
      };
    }
  };

  app.post("/:id/open", writable, async (context) => {
    return context.json({
      ok: true,
      ...(await openReview(readReview(context.req.param("id")))),
    });
  });

  if (data) {
    const traceQuery = readQuerySchemas.maps.extend({
      storage: z.enum(["s3", "hosted"]).optional(),
      trace: z.string().min(1).optional(),
    });

    // Traces are stored beside the review's own repository.
    const tracePins = async (id: string, version?: number) => {
      const snapshot = readReview(id, version);

      return snapshot.pins ?? (await data.documentPins(snapshot));
    };

    app.get("/:id/agent-traces", async (context) => {
      const query = traceQuery.parse(context.req.query());
      const pins = await tracePins(context.req.param("id"), query.version);

      return context.json(
        await listPinnedTraces(
          store.repositoryPath(pins.repositoryId),
          pins,
          query.storage,
        ),
      );
    });
    app.get("/:id/agent-traces/:sessionId", async (context) => {
      const query = traceQuery.parse(context.req.query());
      const pins = await tracePins(context.req.param("id"), query.version);

      const result = await readStoredTrace(
        store.repositoryPath(pins.repositoryId),
        context.req.param("sessionId"),
        query.trace,
        query.storage,
      );

      if (!result.ok)
        return context.json({ ok: false, error: result.error }, result.status);

      return context.json(result);
    });
    app.post("/:id/navigator", writable, async (context) => {
      const input = readQuerySchemas.file
        .omit({ side: true })
        .extend({
          file: z.string().min(1).optional(),
          empty: z.literal("true").optional(),
        })
        .parse(context.req.query());

      const answer = await data.navigatorWorkspace(
        readReview(context.req.param("id"), input.version),
        {
          ...input,
          empty: input.empty === "true",
          anchor: queryAnchor(input),
        },
      );

      if (context.req.header(REVIEW_CLIENT_HEADER) !== REVIEW_CLIENT_REMOTE)
        return context.json(answer);

      return context.json({
        ...(input.empty === "true"
          ? { workspacePath: answer.workspacePath, emptySide: true }
          : answer),
        serverId: store.serverId(),
      } satisfies ReviewRemoteNavigatorAnswer);
    });
    app.get("/:id/tree", async (context) => {
      const input = readQuerySchemas.tree.parse(context.req.query());

      const { pins } = await data.resolveSource(
        readReview(context.req.param("id"), input.version),
        input.commit,
        queryAnchor(input),
      );

      return context.json(await data!.tree(pins, input.side, input.path));
    });
    app.get("/:id/maps/:resourceId", async (context) => {
      const query = readQuerySchemas.maps.parse(context.req.query());
      const id = context.req.param("id");

      return context.json(
        await data.map(
          await data.sourcePins(readReview(id, query.version)),
          z.string().parse(context.req.param("resourceId")),
        ),
      );
    });
    app.post("/repositories", async (context) => {
      const input = z
        .strictObject({ path: z.string().min(1) })
        .parse(await readBoundedRequestJson(context.req.raw));

      return context.json(await data!.register(input.path));
    });
    app.post("/resources", async (context) => {
      const body = await readBoundedRequestJson(
        context.req.raw,
        8 * 1024 * 1024,
      );

      // Agents send a checkout path; swap it for a repository id.
      const named = z
        .looseObject({ repositoryPath: z.string().min(1) })
        .safeParse(body);

      if (!named.success) return context.json(await data!.upload(body));
      const { repositoryPath, ...upload } = named.data;

      return context.json(
        await data!.upload({
          ...upload,
          repositoryId: (await data!.register(repositoryPath)).id,
        }),
      );
    });
    app.get("/:id/resources/:resourceId", async (context) => {
      const id = context.req.param("id");
      const snapshot = readReview(id);

      const resource = store.resource(
        z.string().parse(context.req.param("resourceId")),
      );

      // A document with pins serves only its repository's resources.
      if (snapshot.pins && resource.repositoryId !== snapshot.pins.repositoryId)
        throw new ReviewInputError("Resource is outside this repository.", 404);

      return new Response(Buffer.from(resource.data), {
        headers: {
          "content-type": resource.mimeType,
          "x-content-type-options": "nosniff",
        },
      });
    });
    app.get("/:id/language-context", async (context) => {
      const input = readQuerySchemas.maps
        .extend({
          commit: z.string().optional(),
          repositoryId: z.string().optional(),
          head: z.string().optional(),
          base: z.string().optional(),
        })
        .parse(context.req.query());

      const snapshot = readReview(context.req.param("id"), input.version);

      const environment = await data.languageEnvironment(
        snapshot,
        input.commit,
        false,
        queryAnchor(input),
      );

      if (context.req.header(REVIEW_CLIENT_HEADER) !== REVIEW_CLIENT_REMOTE)
        return context.json(environment);

      // The laptop opens a remote root on this server, so it needs the server id.
      const { rootPath, ...rest } = environment;

      return context.json({
        ...rest,
        remoteRootPath: rootPath ?? null,
        serverId: store.serverId(),
      } satisfies ReviewRemoteLanguageEnvironment);
    });
    app.post("/:id/environment", writable, async (context) => {
      const input = z
        .strictObject({ retry: z.boolean().optional() })
        .parse(await readBoundedRequestJson(context.req.raw));

      return context.json({
        issues: await data.environmentIssues(
          readReview(context.req.param("id")),
          input.retry,
        ),
      });
    });
    app.post("/workspace-cleanup", async (context) => {
      const input = z
        .strictObject({ workspaceId: z.string().min(1).optional() })
        .parse(await readBoundedRequestJson(context.req.raw));

      if (input.workspaceId)
        await data.workspaces.retryCleanup(input.workspaceId);

      return context.json({ failures: data.workspaces.failures() });
    });
    app.get("/:id/workspaces", (context) => {
      readReview(context.req.param("id"));

      return context.json(data.workspaces.list(context.req.param("id")));
    });
    app.post(
      "/:id/workspaces/:workspaceId/retry",
      writable,
      async (context) => {
        return context.json(
          await data.workspaces.retry(
            context.req.param("id"),
            context.req.param("workspaceId"),
          ),
        );
      },
    );
    app.get("/:id/file", async (context) => {
      // Browsing can describe binaries; authoring reads still require text.
      const input = readQuerySchemas.file
        .extend({ binary: z.literal("describe").optional() })
        .parse(context.req.query());

      const id = context.req.param("id");

      const anchor = queryAnchor(input);

      const { snapshot, pins } = await data.resolveSource(
        readReview(id, input.version),
        input.commit,
        anchor,
      );

      const file = await data.file(
        pins,
        input.side,
        input.file,
        input.binary === "describe",
      );

      if (file.text.includes("\0")) {
        return context.json({
          binary: true,
          file: file.file,
          side: file.side,
          commit: file.commit,
        });
      }

      const local =
        !input.commit &&
        !anchor &&
        input.side === "head" &&
        snapshot.target?.kind === "worktree"
          ? await data.liveFile(pins.repositoryId, input.file, file.text)
          : undefined;

      return context.json({ ...file, ...local });
    });
    app.get("/:id/structural-diff", async (context) => {
      const input = readQuerySchemas.structuralDiff.parse(context.req.query());
      const id = context.req.param("id");

      const { pins } = await data.resolveSource(
        readReview(id, input.version),
        input.commit,
        queryAnchor(input),
      );

      const abort = new AbortController();
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: ReviewStructuralDiffEvent) => {
            if (!abort.signal.aborted)
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          };

          try {
            for await (const event of data.structuralChanges({
              reviewId: id,
              pins,
              signal: AbortSignal.any([context.req.raw.signal, abort.signal]),
              file: input.file,
            }))
              send(event);
          } catch (error) {
            send({
              type: "error",
              message: errorMessage(error),
            });
          } finally {
            if (!abort.signal.aborted) controller.close();
          }
        },
        cancel() {
          abort.abort();
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson",
          "cache-control": "no-store",
        },
      });
    });
    app.get("/:id/diff", async (context) => {
      const input = readQuerySchemas.diff.parse(context.req.query());

      const { pins } = await data.resolveSource(
        readReview(context.req.param("id"), input.version),
        input.commit,
        queryAnchor(input),
      );

      return context.json(await data.changes(pins));
    });
    // A commit a quote is read at, in the board's repository.
    app.get("/:id/commit/:commit", async (context) => {
      const repositoryId = boardRepositoryId(
        readReview(context.req.param("id")),
      );

      if (!repositoryId)
        throw new ReviewInputError("This board has no repository.", 404);

      return context.json(
        await data.commitInfo(repositoryId, context.req.param("commit")),
      );
    });

    app.get("/:id/commits", async (context) => {
      const input = readQuerySchemas.commits.parse(context.req.query());

      return context.json(
        await data.commits(
          (
            await data.resolveSource(
              readReview(context.req.param("id"), input.version),
            )
          ).pins,
        ),
      );
    });
  }

  app.post("/:id/copy-context", async (context) => {
    const query = readQuerySchemas.get
      .pick({ version: true })
      .extend({ mode: legacyModeSchema })
      .parse(context.req.query());

    const selection = AgentSelectionSchema.parse(
      await readBoundedRequestJson(context.req.raw),
    );

    return context.json({
      text: await selectionContext(
        context.req.param("id"),
        selection,
        query.version,
      ),
    });
  });

  /** The Markdown an agent gets for a selection, copied or asked about. */
  async function selectionContext(
    reviewId: string,
    selection: AgentSelection,
    version?: number,
  ) {
    if (selection.apiSource && selection.apiSource.reviewId !== reviewId)
      throw new ReviewInputError("Selection belongs to another review.");

    const snapshot = readReview(
      reviewId,
      selection.apiSource?.version ?? version,
    );

    const target = selection.target;
    let excerpt = "";

    if (target.kind === "code" && !selection.selectedDiff) {
      if (!data) throw new ReviewInputError("Source data is unavailable.", 409);

      const source = await data.quote(
        (
          await data.resolveSource(
            snapshot,
            selection.apiSource?.commit,
            selection.apiSource?.pins,
          )
        ).pins,
        {
          side: target.side,
          file: target.path,
          fromLine: target.startLine,
          toLine: target.endLine,
        },
      );

      excerpt =
        `## ${target.side}: ${target.path}:${target.startLine}-${target.endLine} (${source.commit})\n` +
        source.text
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n");
    }

    if (target.kind === "block")
      excerpt = documentText(snapshot, target.blockId, true);

    const diff = selection.selectedDiff;

    const text = selectionMarkdown(
      selection,
      excerpt,
      diff
        ? { base: `a/${diff.oldPath}`, head: `b/${diff.newPath}` }
        : undefined,
    );

    return [
      `Whiteboard: ${boardTitle(snapshot.title)}`,
      `Session ID: ${snapshot.reviewId}`,
      `Version: ${snapshot.version}`,
      ...(selection.apiSource?.commit
        ? [`Selected commit: ${selection.apiSource.commit}`]
        : []),
      ...(selection.apiSource?.pins
        ? [
            ...(selection.apiSource.pins.base
              ? [`Selected base: ${selection.apiSource.pins.base}`]
              : []),
            `Selected head: ${selection.apiSource.pins.head}`,
          ]
        : []),
      ...(snapshot.pins
        ? [
            `Session base: ${snapshot.pins.base}`,
            `Session head: ${snapshot.pins.head}`,
          ]
        : []),
      `Read this version with session_get({"sessionId":"${snapshot.reviewId}","version":${snapshot.version},"full":true}).`,
      "",
      text,
      "",
      "",
    ].join("\n");
  }

  if (ask && data) {
    const projectOf = (reviewId: string) =>
      store.has(reviewId) ? store.projectOf(reviewId) : undefined;

    const readThread = (reviewId: string, threadId: string) => {
      const thread = ask.threads.get(threadId);

      if (!thread)
        throw new ReviewInputError("This conversation has ended.", 404);

      return thread;
    };

    /** Where a thread in a review saves itself: its Ask history, recorded
     * once the agent has a session to reopen. */
    const historyHooks = (
      record: Omit<AskRecord, "sessionId">,
    ): AskThreadHooks => ({
      onSession: (sessionId) =>
        store.askHistory.get(record.id)
          ? store.askHistory.updateSession(record.id, sessionId)
          : store.askHistory.save({ ...record, sessionId }),
      onTurn: () => store.askHistory.touch(record.id),
      onSave: (entries) => store.askHistory.saveEntries(record.id, entries),
      onPermissions: (permissions) =>
        store.askHistory.setPermissions(record.id, permissions),
      onOffer: (offer) => store.askHistory.saveOffer(record.agent, offer),
      onTitle: (title) => store.askHistory.rename(record.id, title),
    });

    /** Threads started for a review before its canvas opened, for it to
     * show once it does. */
    const handedOff = new Map<string, string[]>();

    const handOff = (reviewId: string, threadId: string) =>
      handedOff.set(reviewId, [...(handedOff.get(reviewId) ?? []), threadId]);

    // The conversations started for this review since its canvas last asked,
    // to open in its Ask panel.
    app.post("/:id/ask/handoff", (context) => {
      const reviewId = context.req.param("id");
      const ids = handedOff.get(reviewId) ?? [];

      handedOff.delete(reviewId);

      return context.json({
        threads: ids.flatMap((id) => {
          const record = store.askHistory.get(id);

          if (record)
            return [{ id, agent: record.agent, selection: record.selection }];

          // Its agent has no session to save yet, but the thread is live.
          const live = ask.threads.get(id);

          if (live?.reviewId !== reviewId) return [];
          const state = live.read();

          return [
            {
              id,
              agent: state.agent,
              selection: {
                target: { kind: "review" as const },
                title: state.selection.title,
              },
            },
          ];
        }),
      });
    });

    /** What an agent reads before a session's first question: the review,
     * the checkout, and the selection. */
    const askContext = async (
      threadId: string,
      agent: AskAgentId,
      snapshot: Snapshot,
      checkout: { head: string; live: boolean },
      selection: AgentSelection,
      version: number | undefined,
    ) => {
      const reach = await ask.threads.reach(agent, threadId);
      const { reviewId } = snapshot;

      return [
        `A reviewer is reading "${boardTitle(snapshot.title)}" in Whiteboard and has a question about ${selection.target.kind === "review" ? "it" : "a selection"}.`,
        checkout.live
          ? "Your working directory is the repository the review describes."
          : `Your working directory is a checkout of the review's head commit, ${checkout.head}. Answer from this code, not from other branches.`,
        "Answer the question for a staff engineer: lead with the answer and keep it short. Explain at the level of components and data flow before functions, and check each claim about the code against code you have read.",
        "Name files by their path from the checkout root, with a line where it helps, as in `src/app.ts:42`; the reviewer can open them from your answer.",
        ...(reach?.kind === "mcp"
          ? [
              `The whiteboard MCP tools read and change this review: its sessionId is "${reviewId}". Read it with session_get. If the reviewer asks you to change the review, first read session_get_instructions({}) for its guidelines and each component's fields (the review exists, so skip creating one), then edit it with session_edit; do not write files to do it.`,
            ]
          : reach?.kind === "cli"
            ? [
                `Whiteboard's CLI reads and changes this review from your shell: its sessionId is "${reviewId}". Read it with \`${reach.command} api session_get '{"sessionId":"${reviewId}"}'\`. If the reviewer asks you to change the review, first read \`${reach.command} api session_get_instructions '{}'\` for its guidelines and each component's fields (the review exists, so skip creating one), then edit it with \`${reach.command} api session_edit '<json>'\`; do not write files to do it. \`${reach.command} api tools\` lists each tool's input.`,
              ]
            : []),
        "",
        await selectionContext(reviewId, selection, version),
      ].join("\n");
    };

    // What an agent offers: what it said last, else what a session started
    // in `cwd` says. With another model it offers, what it said last with
    // that model, else what such a session says once it has the model: the
    // efforts on offer depend on it.
    const askOffer = async (
      agent: AskAgentId,
      model: string | undefined,
      cwd: () => Promise<string>,
    ) => {
      const stored = store.askHistory.offer(agent);

      // An offer of nothing to choose was saved before the agent's
      // settings were known; the agent says again.
      const last =
        stored && Object.keys(stored.choices).length ? stored : undefined;

      const models = last?.choices.model;

      const another =
        model !== undefined &&
        model !== models?.current &&
        (!models || models.options.some((option) => option.value === model));

      const known = another ? store.askHistory.offer(agent, model) : last;

      if (known) return known;

      const offer = await ask.threads.offered(
        agent,
        await cwd(),
        another ? model : undefined,
      );

      if (last) store.askHistory.saveModelOffer(agent, offer);
      else store.askHistory.saveOffer(agent, offer);

      return offer;
    };

    registerOnboardingRoutes(app, store, ask, {
      register: (root) => data.register(root),
      historyHooks,
      handOff,
      open: openCreated,
      offer: askOffer,
    });

    // The agents answering in any review, which quitting the app would stop.
    app.get("/ask/working", (context) =>
      context.json({ agents: ask.threads.working() }),
    );

    // Each agent with the models and efforts it offered last; none until
    // it has run.
    app.get("/:id/ask/agents", async (context) =>
      context.json({ agents: await ask.agents() }),
    );

    // What an agent offers, from a session in the review's checkout.
    app.get("/:id/ask/agents/:agent/offer", async (context) => {
      const agent = z.enum(askAgentIds).parse(context.req.param("agent"));
      const { model } = askOfferQuerySchema.parse(context.req.query());

      const offer = await askOffer(
        agent,
        model,
        async () =>
          (await data.agentCheckout(readReview(context.req.param("id"))))
            .rootPath,
      );

      return context.json({ offer });
    });

    // The checkout's files a mention could mean, best first.
    app.get("/:id/ask/mentions", async (context) => {
      const reviewId = context.req.param("id");

      const { query, thread } = askMentionsSchema.parse(context.req.query());

      const cwd = thread
        ? readThread(reviewId, thread).read().cwd
        : (await data.agentCheckout(readReview(reviewId))).rootPath;

      const files = fuzzyRank(query, await mentionableFiles(cwd), (file) => [
        file,
        file.slice(file.lastIndexOf("/") + 1),
      ]);

      return context.json({ paths: files.slice(0, MENTION_LIMIT) });
    });

    app.post("/:id/ask", writable, async (context) => {
      const reviewId = context.req.param("id");

      const { version } = readQuerySchemas.get
        .pick({ version: true })
        .parse(context.req.query());

      const input = askStartSchema.parse(
        await readBoundedRequestJson(context.req.raw, ASK_REQUEST_MAX_BYTES),
      );

      const snapshot = readReview(reviewId, version);
      const checkout = await data.agentCheckout(snapshot);
      const target = input.selection.target;
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      const permissions =
        input.permissions ?? defaultAskPermissions(input.agent);

      const initialContext = await askContext(
        id,
        input.agent,
        snapshot,
        checkout,
        input.selection,
        version,
      );

      store.assertWritable(reviewId);

      // Asked on screen: seen from the start.
      store.askHistory.markViewed(id, createdAt);

      const thread = ask.threads.open({
        id,
        reviewId,
        agent: input.agent,
        // Saved once the agent has a session to reopen; a later one
        // replaces a session the agent could not reopen.
        ...historyHooks({
          id,
          anchor:
            target.kind === "text" && target.anchor
              ? { board: reviewId, block: target.anchor.blockId }
              : { board: reviewId },
          agent: input.agent,
          version: snapshot.version,
          head: checkout.head,
          cwd: checkout.rootPath,
          selection: input.selection,
          title: input.question.text.slice(0, 200),
          createdAt,
          updatedAt: createdAt,
          permissions,
        }),
        picks: input.picks,
        permissions,
        cwd: checkout.rootPath,
        head: checkout.head,
        selection: {
          title: input.selection.title,
          quote: target.kind === "text" ? target.quote : undefined,
        },
        context: initialContext,
        question: input.question,
      });

      return context.json({ threadId: thread.id });
    });

    /** Every project's threads for the sidebar: who runs them, where they
     * started and live, and which boards they changed. */
    const projectThreads = (reviewId: string): ReviewProjectThreads => {
      const entries = store.askHistory.listAll();

      const ids = entries.map((entry) => entry.id);
      const edited = store.boardsChangedByThreads(ids);

      const boards = new Map<string, ReviewThreadBoard>();

      const board = (id: string) => {
        let found = boards.get(id);

        if (!found) {
          found = store.has(id)
            ? store.boardFace(id)
            : { reviewId: id, icon: boardIconKind(undefined) };
          boards.set(id, found);
        }

        return found;
      };

      const project = projectOf(reviewId);

      return {
        board: reviewId,
        ...(project && { project }),
        threads: entries.map((entry) => {
          const anchor = entry.anchor ?? { board: reviewId };
          const status = ask.threads.get(entry.id)?.status;
          const { viewedAt } = entry;

          // A turn finished since the reviewer last saw the thread.
          const unread =
            status !== "starting" &&
            status !== "running" &&
            status !== "waiting" &&
            viewedAt !== undefined &&
            entry.updatedAt > viewedAt;

          return {
            id: entry.id,
            ...(entry.projectId && { projectId: entry.projectId }),
            ...(store.has(anchor.board) && {
              place: store.boardPlace(anchor.board),
            }),
            agent: entry.agent,
            agentName: askAgents[entry.agent].name,
            opening: entry.question ?? entry.title,
            pinned:
              entry.selection.target.kind === "text" &&
              entry.selection.target.anchor !== undefined,
            ...(status && { status }),
            ...(unread && { unread }),
            updatedAt: entry.updatedAt,
            anchor: {
              board: board(anchor.board),
              ...(anchor.block && { block: anchor.block }),
            },
            edited: edited.get(entry.id) ?? [],
          };
        }),
      };
    };

    app.get("/:id/ask/threads", (context) => {
      const reviewId = context.req.param("id");

      readReview(reviewId);

      if (context.req.query("watch") !== undefined) {
        // Sent again only when it reads differently.
        let sent = "";

        return watch(
          () => {
            const line = JSON.stringify(projectThreads(reviewId));

            if (line === sent) return [];
            sent = line;

            return [line];
          },
          (notify) => {
            let timer: ReturnType<typeof setTimeout> | undefined;

            const later = () => {
              timer ??= setTimeout(() => {
                timer = undefined;
                notify();
              }, 100);
            };

            const stops = [
              store.askHistory.subscribe(later),
              ask.threads.subscribeStatus(later),
              // Another process's version may have changed any of these.
              store.subscribe((change) => {
                if (
                  change.deleted ||
                  change.lifecycle ||
                  change.titleChanged ||
                  change.placeChanged ||
                  change.threadId ||
                  change.external
                )
                  later();
              }),
            ];

            return () => {
              clearTimeout(timer);
              stops.forEach((stop) => stop());
            };
          },
        );
      }

      return context.json({
        threads: store.askHistory.list(reviewId, projectOf(reviewId)),
        board: reviewId,
      });
    });

    // The threads of every open Ask in a review, over one connection. Before
    // the route for one thread, which would read `watch` as its id.
    app.post("/:id/ask/watch", async (context) => {
      const reviewId = context.req.param("id");

      readReview(reviewId);

      const { threads } = askWatchSchema.parse(
        await readBoundedRequestJson(context.req.raw),
      );

      return watchAskThreads(
        new Map(
          threads.map((threadId) => {
            const thread = ask.threads.get(threadId);

            return [threadId, thread];
          }),
        ),
      );
    });

    // The boards a thread changed: titles from any project, so only for a
    // local caller.
    app.get("/:id/ask/:threadId/boards", (context) => {
      const threadId = context.req.param("threadId");
      const record = store.askHistory.get(threadId);

      const anchor =
        record?.anchor.board ?? ask.threads.get(threadId)?.reviewId;

      if (remoteCaller(context) || !anchor)
        throw new ReviewInputError("This conversation was not found.", 404);

      return context.json({ boards: store.boardsChangedBy(threadId) });
    });

    // A saved conversation, without starting its agent.
    app.get("/:id/ask/:threadId", (context) => {
      const record = store.askHistory.get(context.req.param("threadId"));

      if (!record)
        throw new ReviewInputError("This conversation was not found.", 404);
      const target = record.selection.target;

      return context.json({
        id: record.id,
        agent: record.agent,
        agentName: askAgents[record.agent].name,
        status: "idle",
        readOnly: true,
        permissions: record.permissions ?? "read-only",
        head: record.head,
        cwd: record.cwd,
        title: record.title,
        selection: {
          title: record.selection.title,
          quote: target.kind === "text" ? target.quote : undefined,
        },
        entries: record.entries ?? [],
      } satisfies AskThreadState);
    });

    // A saved conversation: attach to it if it is still running, else start
    // the agent and load it, at the commit it was asked about.
    app.post("/:id/ask/:threadId/open", writable, async (context) => {
      const reviewId = context.req.param("id");
      const threadId = context.req.param("threadId");
      const live = ask.threads.get(threadId);

      if (live) return context.json({ threadId });
      const record = store.askHistory.get(threadId);

      const { picks } = askOpenSchema.parse(
        await readBoundedRequestJson(context.req.raw, undefined, {}),
      );

      if (!record)
        throw new ReviewInputError("This conversation was not found.", 404);

      // The thread runs in the checkout of the board it started on.
      const anchor = record.anchor.board;
      const snapshot = readReview(anchor, record.version);
      const checkout = await data.agentCheckout(snapshot);
      const target = record.selection.target;

      const initialContext = await askContext(
        record.id,
        record.agent,
        snapshot,
        checkout,
        record.selection,
        record.version,
      );

      store.assertWritable(reviewId);
      ask.threads.open({
        id: record.id,
        reviewId: anchor,
        agent: record.agent,
        cwd: checkout.rootPath,
        head: checkout.head,
        selection: {
          title: record.selection.title,
          quote: target.kind === "text" ? target.quote : undefined,
        },
        resume: { sessionId: record.sessionId, entries: record.entries },
        // For a new session, should the agent no longer have this one.
        context: initialContext,
        ...historyHooks(record),
        picks,
        permissions: record.permissions,
      });

      return context.json({ threadId: record.id });
    });

    app.post("/:id/ask/:threadId/prompt", writable, async (context) => {
      const thread = readThread(
        context.req.param("id"),
        context.req.param("threadId"),
      );

      const { question } = askFollowUpSchema.parse(
        await readBoundedRequestJson(context.req.raw, ASK_REQUEST_MAX_BYTES),
      );

      const refusal = thread.askRefusal();

      if (refusal) throw new ReviewInputError(refusal, 409);

      void thread.ask(question);

      return context.json({ ok: true });
    });

    app.post("/:id/ask/:threadId/permission", writable, async (context) => {
      const thread = readThread(
        context.req.param("id"),
        context.req.param("threadId"),
      );

      const decision = askDecisionSchema.parse(
        await readBoundedRequestJson(context.req.raw),
      );

      if (!thread.decide(decision.permissionId, decision.optionId))
        throw new ReviewInputError("This request was already answered.", 409);

      return context.json({ ok: true });
    });

    // The files an answer names, as the checkout's own paths, so the panel
    // can open them.
    app.post("/:id/ask/:threadId/files", writable, async (context) => {
      const thread = readThread(
        context.req.param("id"),
        context.req.param("threadId"),
      );

      const { paths } = askFilesSchema.parse(
        await readBoundedRequestJson(context.req.raw),
      );

      const { cwd, entries } = thread.read();

      const touched = entries.flatMap((entry) =>
        entry.kind === "tool"
          ? `${entry.title} ${entry.input ?? ""}`
              .split(/\s+/)
              .flatMap((token) => parseFileRef(token)?.path ?? [])
          : [],
      );

      const files = resolveFileRefs(
        cwd,
        await checkoutFiles(cwd),
        paths,
        touched,
      );

      return context.json({
        files: [...files].map(([path, file]) => ({ path, file })),
      });
    });

    // Another model or effort for the next answer.
    app.post("/:id/ask/:threadId/choice", writable, async (context) => {
      const thread = readThread(
        context.req.param("id"),
        context.req.param("threadId"),
      );

      const { kind, value } = askChoiceSchema.parse(
        await readBoundedRequestJson(context.req.raw),
      );

      if (thread.read().status !== "idle")
        throw new ReviewInputError(
          "Settings can change once the agent finishes answering.",
          409,
        );

      try {
        await thread.choose(kind, value);
      } catch (error) {
        throw new ReviewInputError(errorMessage(error), 409);
      }

      return context.json({ ok: true });
    });

    // Changes what the agent may do from the next answer.
    app.post("/:id/ask/:threadId/permissions", writable, async (context) => {
      const thread = readThread(
        context.req.param("id"),
        context.req.param("threadId"),
      );

      const { permissions } = askPermitSchema.parse(
        await readBoundedRequestJson(context.req.raw),
      );

      if (thread.read().status !== "idle")
        throw new ReviewInputError(
          "Settings can change once the agent finishes answering.",
          409,
        );

      try {
        await thread.permit(permissions);
      } catch (error) {
        throw new ReviewInputError(errorMessage(error), 409);
      }

      return context.json({ ok: true });
    });

    // Starts a failed agent again, as after signing it back in, and asks
    // again what it did not answer. The state reports how that goes.
    app.post("/:id/ask/:threadId/retry", writable, (context) => {
      const thread = readThread(
        context.req.param("id"),
        context.req.param("threadId"),
      );

      if (thread.read().status !== "failed")
        throw new ReviewInputError(
          "Only a conversation that failed can try again.",
          409,
        );
      void thread.retry();

      return context.json({ ok: true });
    });

    app.post("/:id/ask/:threadId/cancel", async (context) => {
      await readThread(
        context.req.param("id"),
        context.req.param("threadId"),
      ).cancel();

      return context.json({ ok: true });
    });

    app.post("/:id/ask/:threadId/viewed", (context) => {
      const threadId = context.req.param("threadId");

      if (!ask.threads.get(threadId) && !store.askHistory.get(threadId))
        throw new ReviewInputError("This conversation was not found.", 404);
      store.askHistory.markViewed(threadId);

      return context.json({ ok: true });
    });

    // Closing an Ask ends its agent; the conversation stays saved. A tab
    // switched away from or a reload leaves it running, to come back to.
    app.post("/:id/ask/:threadId/close", (context) => {
      readThread(context.req.param("id"), context.req.param("threadId"));
      ask.threads.close(
        context.req.param("threadId"),
        !readReview(context.req.param("id")).trashedAt,
      );

      return context.json({ ok: true });
    });

    // Forgets a saved conversation. The agent keeps its own transcript.
    app.delete("/:id/ask/:threadId", writable, (context) => {
      const reviewId = context.req.param("id");
      const threadId = context.req.param("threadId");

      const record = store.askHistory.get(threadId);

      if (!record)
        throw new ReviewInputError("This conversation was not found.", 404);

      if (ask.threads.get(threadId)) ask.threads.close(threadId);
      store.askHistory.delete(threadId);

      return context.json({ ok: true });
    });
  }

  app.get("/:id/place", (context) => {
    const id = context.req.param("id");

    store.assertExists(id);

    return context.json(placeOf(id));
  });

  // The board's branch stack: its GitHub stack, else the reviews chained
  // through the bases they name, bottom first. Apart from its place among
  // boards.
  app.get("/:id/stack", async (context) => {
    const query = readQuerySchemas.get.parse(context.req.query());
    const id = context.req.param("id");
    let snapshot = readReview(id, query.version);

    if (!snapshot.pins) return context.json({ layers: [] });

    if (data) snapshot = await data.discoverPullRequest(snapshot);

    const repositoryPath = store
      .repositories()
      .find(
        (repository) => repository.id === snapshot.pins!.repositoryId,
      )?.path;

    // A GitHub stack's boards may sit in any project.
    const layers = await resolveReviewStackLayers(snapshot, store.list(), {
      repositoryPath,
    });

    // The branch the stack sits on: the repository's default branch.
    const trunk =
      layers.length > 1 && repositoryPath
        ? await defaultBranch(repositoryPath).catch(() => null)
        : null;

    return context.json({
      layers: layers.map((layer) => {
        const state = data?.pullRequestState(layer.pullRequestUrl ?? undefined);

        return state ? { ...layer, pullRequestState: state } : layer;
      }),
      ...(trunk && { base: trunk.ref.replace(/^origin\//, "") }),
    });
  });

  // The board's project and its whiteboards, for the board's sidebar.
  app.get("/:id/project", (context) => {
    const id = context.req.param("id");

    const project = store.summary(id)?.project ?? null;

    return context.json({
      project,
      boards: project
        ? store
            .listProject(project.id)
            .filter((board) => !board.trashedAt)
            .map(withPullRequestState)
        : [],
    });
  });
  app.get("/:id/links", (context) => {
    const id = context.req.param("id");

    const { version } = readQuerySchemas.get
      .pick({ version: true })
      .parse({ version: context.req.query("version") });

    const { outgoing, backlinks } = store.links(id, version);

    return context.json({
      outgoing: outgoing.map(withPullRequestState),
      backlinks: backlinks.map(withPullRequestState),
    });
  });
  // A link's hover card, read when it opens.
  app.get("/:id/links/peek", (context) => {
    const id = context.req.param("id");

    const { version } = readQuerySchemas.get
      .pick({ version: true })
      .parse({ version: context.req.query("version") });

    const board = context.req.query("board");
    const block = context.req.query("block");

    if (!board) throw new ReviewInputError("Name the linked board.", 400);

    return context.json(
      store.linkPeek(id, { board, ...(block && { block }) }, version),
    );
  });

  app.get("/:id/history", (context) => {
    return context.json(store.history(context.req.param("id")));
  });

  /** A board's relations as session_list reports them: only those it has. */
  const listedRelations = ({
    parentId,
    children,
    dependsOn,
  }: ReturnType<typeof store.relations>) => {
    const listed: Partial<ReturnType<typeof store.relations>> = {};

    if (parentId) listed.parentId = parentId;

    if (children.length) listed.children = children;

    if (dependsOn.length) listed.dependsOn = dependsOn;

    return listed;
  };

  /** A board's relations, each board named by its title. */
  const relatedBoards = (id: string) => {
    const { parentId, children, dependsOn } = store.relations(id);

    const named = (board: string) => ({
      id: board,
      title: store.read(board).title,
    });

    return {
      ...(parentId && { parent: named(parentId) }),
      children: children.map(named),
      dependsOn: dependsOn.map(named),
    };
  };

  app.get("/:id/inspect", (context) => {
    const query = inspectQuerySchema.parse(context.req.query());
    const id = context.req.param("id");
    const snapshot = readReview(id, query.version);

    return context.json(
      query.format === "text"
        ? documentText(
            snapshot,
            query.targetId,
            Boolean(query.full),
            relatedBoards(id),
          )
        : query.targetId !== undefined
          ? inspectSnapshot(snapshot, query.targetId)
          : {
              ...(query.full ? snapshot : inspectSnapshot(snapshot)),
              // Its place among the project's boards, as session_list has it.
              ...listedRelations(store.relations(id)),
            },
    );
  });
  app.get("/:id", async (context) => {
    const query = readQuerySchemas.get.parse(context.req.query());

    let snapshot = { ...readReview(context.req.param("id"), query.version) };

    if (data && query.full && query.version === undefined)
      snapshot = await data.discoverPullRequest(snapshot);

    if (data && query.full) {
      try {
        const pins = await data.sourcePins(snapshot);

        if (pins) snapshot.pins = pins;
      } catch (error) {
        if (!(error instanceof ReviewInputError) || error.status !== 404)
          throw error;
        snapshot.sourceUnavailable = true;
      }
    }

    return context.json(
      query.full ? snapshot : inspectSnapshot(snapshot, query.targetId),
    );
  });

  /** After a lens write: the changed lines still uncategorized at that
   * version, so the author can fill the gaps. A comparison that cannot be
   * read leaves a warning instead of failing the saved write. */
  const lensGaps = async (
    reviewId: string,
    version: number,
    request: Request,
  ): Promise<{ uncategorized?: UncategorizedReport; warnings?: string[] }> => {
    if (!data) return {};

    try {
      return {
        uncategorized: uncategorizedReport(
          await reviewProgress(
            store,
            data,
            store.read(reviewId, version),
            request.signal,
          ),
        ),
      };
    } catch (error) {
      return {
        warnings: [
          `Uncategorized changes are unavailable: ${errorMessage(error)}`,
        ],
      };
    }
  };

  app.post("/commands", async (context) => {
    const { command: body, open: requestedOpen } = takeCreateOpen(
      await readBoundedRequestJson(context.req.raw),
    );

    // Without local data (a bare store), a path is recorded as it is.
    const register = async (path: string) =>
      data ? data.register(path) : store.registerRepository(path);

    const request = withBoardRepository(
      await locateRepositories(
        await pullRequestTargets(body, register, (id) => store.read(id)),
        register,
      ),
      (id) => (store.has(id) ? store.read(id) : undefined),
    );

    const input = commandSchema.parse(request);

    if (!animationsEnabled() && input.operation.type === "edit") {
      const { edit, reviewId } = input.operation;
      const incoming = "content" in edit ? elements([edit.content]) : [];

      const target =
        "targetId" in edit
          ? elements(readReview(reviewId).document).find(
              (element) => element.id === edit.targetId,
            )
          : undefined;

      if (
        incoming.some((element) => element.type === "animation") ||
        target?.type === "animation"
      )
        throw new ReviewInputError(
          "Animation authoring is disabled. Enable Animations in Settings under Experimental Features to edit animations. Existing animations can still be viewed.",
          409,
        );
    }

    // Who is writing, trusted only from local callers: a person from
    // Desktop or the canvas, or an agent, perhaps a thread's. The store
    // keeps each author's rules.
    const threadId = remoteCaller(context)
      ? undefined
      : context.req.header(REVIEW_THREAD_HEADER)?.trim() || undefined;

    const author: Author =
      !remoteCaller(context) &&
      context.req.header(REVIEW_PERSON_HEADER) !== undefined
        ? { kind: "person" }
        : {
            kind: "agent",
            ...(threadId && { threadId }),
          };

    // A copy's kept commits go when it is deleted for good.
    const copy =
      input.operation.type === "delete" && store.has(input.operation.reviewId)
        ? store.read(input.operation.reviewId)
        : undefined;

    const result = await store.execute(input, undefined, author);
    const key = copy?.shared?.key;
    const kept = copy && boardRepositoryId(copy);

    if (result.deleted && key && kept)
      await Promise.resolve()
        .then(() => forgetSharedCommits(store.repositoryPath(kept), key))
        .catch((error) =>
          console.error("Could not drop a copy's kept commits:", error),
        );

    if (input.operation.type === "edit" && data && !result.deleted) {
      const { quotes, unquoted } = await anchorQuotes(
        result.version > 0
          ? store.read(result.reviewId, result.version - 1)
          : undefined,
        store.read(result.reviewId, result.version),
        async (pins, side, file) => (await data.file(pins, side, file)).text,
      );

      return context.json({
        ...result,
        ...(quotes.length && { quotes }),
        ...(unquoted && { unquotedAnchors: unquoted }),
      });
    }

    if (input.operation.type === "lens_edit") {
      const gaps = await lensGaps(
        result.reviewId,
        result.version,
        context.req.raw,
      );

      return context.json({
        ...result,
        ...gaps,
        ...(gaps.warnings && {
          warnings: [...(result.warnings ?? []), ...gaps.warnings],
        }),
      });
    }

    if (input.operation.type !== "create") return context.json(result);

    // False when an existing review for the same PR came back.
    if (result.created !== false)
      hooks.onReviewCreated?.({
        reviewId: result.reviewId,
        blocks: store.read(result.reviewId).document.length,
        ...reviewRequestOrigin(context.req.raw.headers),
      });

    return context.json({
      ...result,
      review: store.summary(result.reviewId),
      ...(requestedOpen === false
        ? { opened: false }
        : await openCreated(result.reviewId)),
    });
  });

  return app;
}

const systemErrorSchema = z.object({ code: z.string().regex(/^[A-Z0-9_]+$/) });

/** A system error code such as EACCES, else the error's class; never its message. */
function failureKind(error: Error): string {
  const system = systemErrorSchema.safeParse(error);

  return system.success ? system.data.code : error.name;
}

/**
 * `open` steers presentation, not the saved review, so it stays out of the
 * command. Anything else, including `open` off create, is left for
 * commandSchema to reject.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Request body boundary: commandSchema parses the result.
function takeCreateOpen(body: unknown) {
  const create = z
    .looseObject({
      operation: z.looseObject({
        type: z.literal("create"),
        open: z.boolean().optional(),
      }),
    })
    .safeParse(body);

  if (!create.success) return { command: body };
  const { open, ...operation } = create.data.operation;

  return { command: { ...create.data, operation }, open };
}

/**
 * Agents name a checkout by its path (pathTargetSchema, and repositoryPath on
 * a create from a PR); the store keeps the id it registers as. A command that
 * already names ids is left as it is.
 */
async function locateRepositories(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Request body boundary: commandSchema parses the result.
  body: unknown,
  register: (path: string) => Promise<{ id: string }>,
) {
  const located = z
    .looseObject({
      operation: z.looseObject({
        type: z.enum(["create", "set_target"]),
        target: z.looseObject({ repositoryPath: z.string() }).optional(),
        repositoryPath: z.string().optional(),
      }),
    })
    .safeParse(body);

  if (!located.success) return body;
  const { target, repositoryPath, ...operation } = located.data.operation;

  const byId = async <Named extends { repositoryPath: string }>({
    repositoryPath: path,
    ...rest
  }: Named) => ({ ...rest, repositoryId: (await register(path)).id });

  return {
    ...located.data,
    operation: {
      ...operation,
      ...(target && { target: await byId(target) }),
      ...(repositoryPath && (await byId({ repositoryPath }))),
    },
  };
}

/** Turns an agent's pullRequest target into what the store takes: a create
 * from pullRequestUrl, or for set_target the PR's resolved commits. */
async function pullRequestTargets(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Request body boundary: commandSchema parses the result.
  body: unknown,
  register: (path: string) => Promise<{ id: string }>,
  board: (id: string) => void,
) {
  const target = z.strictObject({
    kind: z.literal("pullRequest"),
    repositoryPath: z.string().min(1),
    pullRequest: z.union([z.string().min(1), z.number().int().positive()]),
  });

  // A set_target is checked whole before anything is registered or fetched.
  const located = z
    .looseObject({
      operation: z.discriminatedUnion("type", [
        z.looseObject({ type: z.literal("create"), target }),
        z.strictObject({
          type: z.literal("set_target"),
          reviewId: z.string().min(1),
          target,
        }),
      ]),
    })
    .safeParse(body);

  if (!located.success) return body;
  const { target: pullRequest, ...operation } = located.data.operation;

  if (operation.type === "set_target") board(operation.reviewId);
  const { id: repositoryId } = await register(pullRequest.repositoryPath);

  const url = await pullRequestAt(
    pullRequest.repositoryPath,
    pullRequest.pullRequest,
  );

  if (operation.type === "create")
    return {
      ...located.data,
      operation: { ...operation, pullRequestUrl: url, repositoryId },
    };

  return {
    ...located.data,
    operation: {
      ...operation,
      repositoryId,
      pullRequestUrl: url,
    },
  };
}

/** A PR's URL: as given, or its number on the checkout's GitHub repository. */
async function pullRequestAt(
  repositoryPath: string,
  pullRequest: string | number,
) {
  if (isStringValue(pullRequest) && !/^\d+$/.test(pullRequest))
    return pullRequest;

  const slug = (await resolveRepoContext(repositoryPath))?.githubSlug;

  if (!slug)
    throw new ReviewInputError(
      "This checkout has no GitHub remote to find the PR number in; pass the PR's URL.",
    );

  return `https://github.com/${slug}/pull/${pullRequest}`;
}

/** A pins object as an edit spells it: commits, with no other fields. A
 * diagram may key its own data `pins`, and that is left alone. */
/** Pins as an agent writes them: the board's repository is the host's to
 * add. */
const agentPinsSchema = z.strictObject({
  head: z.string().min(1),
  base: z.string().min(1).optional(),
});

/** An object an agent meant as pins: one naming a head, base or repository.
 * Content may have a field called `pins` that is nothing of the kind. */
const meantAsPins = (value: JsonValue): value is JsonObject =>
  isJsonObject(value) &&
  ["head", "base", "repositoryId"].some((key) => key in value);

/** Sets every pins object in an edit to the board's own repository. */
function withBoardRepository(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Request body boundary: commandSchema parses the result.
  body: unknown,
  board: (id: string) => Snapshot | undefined,
) {
  const located = z
    .looseObject({
      operation: z.looseObject({
        type: z.enum(["edit", "lens_edit"]),
        reviewId: z.string(),
        edit: z.json(),
      }),
    })
    .safeParse(body);

  if (!located.success) return body;
  const snapshot = board(located.data.operation.reviewId);

  const repositoryId = snapshot ? boardRepositoryId(snapshot) : undefined;

  const edit = JSON.parse(
    JSON.stringify(located.data.operation.edit),
    (key, value: JsonValue) => {
      if (key !== "pins" || !meantAsPins(value)) return value;

      // Checked as the agent wrote them, so a mistake names head or base,
      // never the repository the host adds.
      const { repositoryId: _ignored, ...written } = value;
      const pins = agentPinsSchema.safeParse(written);

      if (!pins.success)
        throw new ReviewInputError(
          `Write pins as {head, base?}, each a commit: ${pins.error.issues
            .map((issue) => `pins.${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}.`,
        );

      if (!repositoryId)
        throw new ReviewInputError(
          "This whiteboard has no repository for its pins to name commits of.",
        );

      return { ...pins.data, repositoryId };
    },
  );

  return {
    ...located.data,
    operation: { ...located.data.operation, edit },
  };
}

function watch(
  lines: () => string[],
  subscribe: (notify: () => void) => () => void,
) {
  let stop = () => {};

  let missed = false;

  const encoder = new TextEncoder();

  const send = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    missed = controller.desiredSize === null || controller.desiredSize <= 0;

    if (missed) return;

    try {
      const pending = lines();

      if (pending.length)
        controller.enqueue(encoder.encode(pending.join("\n") + "\n"));
    } catch (error) {
      stop();
      controller.error(error);
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let scheduled = false;

      stop = subscribe(() => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          send(controller);
        });
      });
      send(controller);
    },
    pull(controller) {
      if (missed) send(controller);
    },
    cancel() {
      stop();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
