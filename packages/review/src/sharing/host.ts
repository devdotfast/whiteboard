import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";

import {
  type SharedMeta,
  parseShareLink,
  shareBundleSchema,
  shareIdSchema,
} from "@dev.fast/review-share-protocol";
import {
  DEFAULT_STORE_ORIGIN,
  clearStoreAuth,
  type openUrlInBrowser,
  readStoreAuth,
  runStoreLogin,
} from "@dev.fast/trace-core";
import { ReviewInputError } from "@dev.fast/whiteboard-document";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import type { ReviewStore } from "@review/review-api/store.js";
import { readBoundedRequestJson } from "@review/server/hono-http.js";
import type { Hono } from "hono";
import { z } from "zod";

import { readSharingAuth } from "./auth.js";
import { ShareAuthError, ShareClient, ShareRequestError } from "./client.js";
import { exportShare, validateShareSources } from "./export.js";
import {
  parseWhiteboardFile,
  whiteboardFileKey,
  whiteboardFileName,
  whiteboardFileText,
} from "./file.js";
import {
  type ShareImport,
  importShare,
  needsRepository,
  planShareCopy,
  receiveShare,
  shareKey,
} from "./import.js";
import {
  type cloneSharedRepository,
  type fetchPinnedRepository,
  readShareRepository,
} from "./repository.js";

interface LoginState {
  pending: boolean;
  url?: string;
  userCode?: string;
  error?: string;
}

const publishSchema = z.strictObject({
  reviewId: z.string().min(1),
  version: z.number().int().nonnegative().optional(),
  requestId: z.uuid().optional(),
});

/** Where the host reports sharing and sign-in outcomes, for telemetry. */
export interface SharingHostEvents {
  onPublished?: (event: { reviewId: string; version: number }) => void;
  onRevoked?: (event: { shareId: string }) => void;
  onLogin?: (
    outcome: "started" | "succeeded" | "failed",
    reason?: "did_not_finish" | "error",
  ) => void;
}

interface SharingHostOptions extends SharingHostEvents {
  readRepository?: typeof readShareRepository;
  fetchRepository?: typeof fetchPinnedRepository;
  cloneRepository?: typeof cloneSharedRepository;
  login?: typeof runStoreLogin;
  openUrl?: typeof openUrlInBrowser;
  fetch?: typeof fetch;
  remoteShare?: RemoteShare;
}

const importSchema = z.union([
  z.strictObject({ url: z.string().max(2048) }),
  z.strictObject({ path: z.string().min(1).max(4096) }),
]);

interface ImportStatus {
  stage:
    | "downloading"
    | "reading"
    | "fetching"
    | "validating"
    | "ready"
    | "error";
  /** The copy, once it is made. */
  reviewId?: string;
  error?: string;
}

/** Mounted behind local host authentication. Account credentials never enter the renderer. */
export function mountSharingHost(
  app: Hono,
  store: ReviewStore,
  data: LocalReviewData,
  options: SharingHostOptions = {},
) {
  const startLogin = options.login ?? runStoreLogin;

  let login: LoginState = {
    pending: false,
  };

  let warmedAt = 0;

  const readAccount = async () => {
    const account = await readStoreAuth();

    // An open review may be shared next; keep its upload off a cold start.
    if (account && Date.now() - warmedAt > 60_000) {
      warmedAt = Date.now();
      void new ShareClient(account.origin, account.token, options.fetch)
        .warm()
        .catch(() => {});
    }

    return {
      account: account
        ? {
            login: account.login,
            origin: account.origin,
            email: account.email,
            githubLogin: account.githubLogin,
          }
        : null,
      ...login,
    };
  };

  app.get("/sharing/account", async (context) =>
    context.json(await readAccount()),
  );
  app.post("/sharing/logout", async (context) => {
    await clearStoreAuth();

    return context.json(await readAccount());
  });
  app.post("/sharing/login", async (context) => {
    if (!login.pending) {
      login = { pending: true };
      options.onLogin?.("started");

      const discard = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });

      void startLogin({
        traces: false,
        stdout: discard,
        stderr: discard,
        openUrl: options.openUrl,
        onDeviceCode: (device) => {
          Object.assign(login, device);
        },
      })
        .then((code) => {
          login = { pending: false };

          if (code) login.error = "Sign-in did not finish. Try again.";
          options.onLogin?.(
            code ? "failed" : "succeeded",
            code ? "did_not_finish" : undefined,
          );
        })
        .catch(() => {
          login = { pending: false, error: "Sign-in failed. Try again." };
          options.onLogin?.("failed", "error");
        });
    }

    return context.json(login);
  });
  mountSharingPublisher(app, store, data, options);

  const imports = new Map<string, ImportStatus>();

  // One download at a time, so two links of one repository clone it once.
  let importing = Promise.resolve();

  const serially = (task: () => Promise<string>) => {
    const run = importing.then(task);

    importing = run.then(
      () => {},
      () => {},
    );

    return run;
  };

  app.get("/sharing/import/:id", (context) => {
    const id = context.req.param("id");

    const { reviewId = id, ...status } = imports.get(id) ?? {
      stage: "error" as const,
      error: "Shared review is not available.",
    };

    return context.json({
      reviewId,
      ...status,
      ...(status.stage === "ready" && { title: store.read(reviewId).title }),
    });
  });

  const shareInput = (onStage: ShareImport["onStage"]): ShareImport => ({
    store,
    data,
    fetchRepository: options.fetchRepository,
    cloneRepository: options.cloneRepository,
    onStage,
  });

  const startImport = (
    id: string,
    initial: "downloading" | "reading",
    receive: (onStage: ShareImport["onStage"]) => Promise<string>,
  ) => {
    const known = imports.get(id)?.stage;

    // A finished import asks again: its link may serve a newer revision.
    if (!known || known === "ready" || known === "error") {
      const status: ImportStatus = { stage: initial };

      imports.set(id, status);
      receive((stage) => {
        status.stage = stage;
      })
        .then((reviewId) => {
          status.reviewId = reviewId;
          status.stage = "ready";
        })
        .catch((error) => {
          status.stage = "error";
          status.error =
            error instanceof ReviewInputError ||
            error instanceof ShareRequestError
              ? error.message
              : "This share is unavailable, revoked, or could not be read.";
        });
    }

    const { reviewId: _reviewId, ...status } = imports.get(id)!;

    return { reviewId: id, ...status };
  };

  app.post("/sharing/import", async (context) => {
    const input = importSchema.parse(
      await readBoundedRequestJson(context.req.raw),
    );

    if ("path" in input) {
      if (!path.isAbsolute(input.path))
        throw new ReviewInputError("Use an absolute file path.", 400);

      const text = await readFile(input.path, "utf8").catch(() => {
        throw new ReviewInputError(
          `Could not read ${path.basename(input.path)}. Check that the file still exists and Whiteboard can open it.`,
          400,
        );
      });

      const key = whiteboardFileKey(text);
      const copy = () => store.copiesOf(key)[0]?.reviewId;

      return context.json(
        startImport(
          key,
          "reading",
          async (onStage) =>
            copy() ??
            serially(
              async () =>
                copy() ??
                importShare(
                  shareInput(onStage),
                  key,
                  parseWhiteboardFile(text),
                ),
            ),
        ),
        202,
      );
    }

    const parsed = parseShareLink(input.url);
    const account = await readStoreAuth();

    if (
      parsed.origin !== DEFAULT_STORE_ORIGIN &&
      parsed.origin !== account?.origin
    )
      throw new ReviewInputError(
        "This share uses an untrusted service. Sign in to that service before opening its links.",
        400,
      );

    const { origin, capability, revision } = parsed;
    const key = shareKey(origin, capability);
    const client = new ShareClient(origin, undefined, options.fetch);

    return context.json(
      startImport(
        revision ? `${key}-${revision}` : key,
        "downloading",
        async (onStage) => {
          let meta: SharedMeta;

          try {
            meta = await client.shared(capability, revision);
          } catch (error) {
            // Offline, the copy the link prefers still opens.
            const copies = store.copiesOf(key);

            const copy =
              copies.find(({ shared }) =>
                revision ? shared.revisionId === revision : !shared.pinned,
              ) ?? copies[0];

            if (!copy) throw error;

            return copy.reviewId;
          }

          const pinned = revision !== undefined;
          const plan = planShareCopy(store.copiesOf(key), meta, pinned);

          // receiveShare plans again: the queue may have made a copy since.
          return plan.kind === "open"
            ? plan.reviewId
            : serially(() =>
                receiveShare(
                  shareInput(onStage),
                  key,
                  meta,
                  () => client.download(capability, meta.revision.id),
                  pinned,
                ),
              );
        },
      ),
      202,
    );
  });
}

const preparedShareSchema = z.strictObject({
  title: z.string(),
  version: z.number().int().nonnegative(),
  bundle: shareBundleSchema,
  needsRepository: z.boolean(),
});

type PreparedShare = z.infer<typeof preparedShareSchema>;

/** `undefined` for a board on this machine. */
export type RemoteShare = (
  input: z.infer<typeof publishSchema>,
) => Promise<PreparedShare> | undefined;

export function remoteShare(
  isRemote: (reviewId: string) => boolean,
  fetch: (request: Request) => Response | Promise<Response>,
): RemoteShare {
  return ({ reviewId, version }) =>
    isRemote(reviewId)
      ? (async () => {
          const response = await fetch(
            new Request(
              `http://whiteboard/reviews-api/${encodeURIComponent(reviewId)}/share-bundle`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ version }),
              },
            ),
          );

          const body: unknown = await response.json().catch(() => undefined);

          if (!response.ok)
            throw new ReviewInputError(
              z.object({ error: z.string() }).safeParse(body).data?.error ??
                "Could not read the board from its host.",
              response.status === 400 ? 400 : 409,
            );

          return preparedShareSchema.parse(body);
        })()
      : undefined;
}

/** Publishing needs only an authored store, never Desktop or recipient workspaces. */
export function mountSharingPublisher(
  app: Hono,
  store: ReviewStore,
  data: LocalReviewData,
  options: Pick<
    SharingHostOptions,
    "readRepository" | "fetch" | "onPublished" | "onRevoked" | "remoteShare"
  > = {},
) {
  const prepareLocal = async (
    input: z.infer<typeof publishSchema>,
  ): Promise<PreparedShare> => {
    const snapshot = store.read(input.reviewId, input.version);

    if (snapshot.target?.kind === "worktree")
      throw new ReviewInputError(
        "Pin this review to commits before sharing it.",
      );

    validateShareSources(snapshot);

    const repositoryId =
      snapshot.pins?.repositoryId ?? snapshot.target?.repositoryId;

    const root = repositoryId ? store.repositoryPath(repositoryId) : undefined;

    // Recipients learn about unpushed commits when they fetch them.
    const repository = root
      ? (options.readRepository ?? readShareRepository)(root).catch(
          () => undefined,
        )
      : undefined;

    const bundle = await exportShare({
      store,
      data,
      reviewId: snapshot.reviewId,
      version: snapshot.version,
    });

    const verified = await repository;

    if (verified) bundle.repository = verified;

    return {
      title: snapshot.title,
      version: snapshot.version,
      bundle,
      needsRepository: needsRepository(bundle, snapshot),
    };
  };

  const prepare = (input: z.infer<typeof publishSchema>) =>
    options.remoteShare?.(input) ?? prepareLocal(input);

  // Desktop uploads it with its own login.
  app.post("/:id/share-bundle", async (context) => {
    const { version } = publishSchema
      .pick({ version: true })
      .parse(await readBoundedRequestJson(context.req.raw));

    return context.json(
      await prepareLocal({ reviewId: context.req.param("id"), version }),
    );
  });
  app.post("/sharing/export", async (context) => {
    const { title, bundle, needsRepository } = await prepare(
      publishSchema.parse(await readBoundedRequestJson(context.req.raw)),
    );

    // A link falls back to the browser viewer; a file has no such reader.
    if (!bundle.repository && needsRepository)
      throw new ReviewInputError(
        "Exporting pinned code needs a GitHub remote the file's reader can fetch from.",
      );

    return context.json({
      filename: whiteboardFileName(title),
      text: whiteboardFileText(bundle),
    });
  });
  app.post("/sharing/publish", async (context) => {
    const input = publishSchema.parse(
      await readBoundedRequestJson(context.req.raw),
    );

    const account = await readSharingAuth();

    if (!account)
      throw new ReviewInputError(
        "Set DEV_REVIEW_SHARE_TOKEN for CI, or run whiteboard login before sharing.",
        409,
      );

    const { bundle, version } = await prepare(input);

    try {
      const result = await new ShareClient(
        account.origin,
        account.token,
        options.fetch,
      ).create(bundle, input.requestId ?? randomUUID());

      const url = new URL(result.url);

      if (
        process.env.DEV_FAST_REVIEW_APP_URL_PROTOCOL ===
        "dev-fast-review-preview"
      )
        url.searchParams.set("app", "preview");

      options.onPublished?.({
        reviewId: input.reviewId,
        version,
      });

      return context.json({
        ...result,
        url: url.href,
        version,
      });
    } catch (error) {
      if (error instanceof ReviewInputError) throw error;

      if (error instanceof ShareRequestError)
        throw new ReviewInputError(error.message, 409);

      if (error instanceof ShareAuthError) {
        // A CI token lives in the environment; only the saved login can go stale.
        if (process.env.DEV_REVIEW_SHARE_TOKEN === undefined)
          await clearStoreAuth();
        throw new ReviewInputError(
          "Your sign-in has expired. Sign in again to share.",
          401,
        );
      }

      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      )
        throw new ReviewInputError(
          "The sharing request timed out. Please retry.",
          409,
        );

      throw new ReviewInputError(
        error instanceof TypeError
          ? "Could not reach the sharing service. Check your connection, then retry."
          : "The sharing service returned an unexpected response. Update Whiteboard or report this issue.",
        409,
      );
    }
  });
  app.post("/sharing/revoke", async (context) => {
    const { shareId } = z
      .strictObject({ shareId: shareIdSchema })
      .parse(await readBoundedRequestJson(context.req.raw));

    const account = await readSharingAuth();

    if (!account)
      throw new ReviewInputError(
        "Set DEV_REVIEW_SHARE_TOKEN for CI, or run whiteboard login first.",
        409,
      );
    await new ShareClient(account.origin, account.token, options.fetch).revoke(
      shareId,
    );
    options.onRevoked?.({ shareId });

    return context.json({ shareId, revoked: true });
  });
}
