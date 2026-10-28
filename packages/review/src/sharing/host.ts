import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import { parseShareLink, shareIdSchema } from "@dev.fast/review-share-protocol";
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
import { ShareAuthError, ShareClient } from "./client.js";
import { exportShare, validateShareSources } from "./export.js";
import { importShare, shareKey } from "./import.js";
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
}

interface ImportStatus {
  stage: "downloading" | "fetching" | "validating" | "ready" | "error";
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

  // One import at a time, so two links of one repository clone it once.
  let importing = Promise.resolve();

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
  app.post("/sharing/import", async (context) => {
    const { url } = z
      .strictObject({ url: z.string().max(2048) })
      .parse(await readBoundedRequestJson(context.req.raw));

    const parsed = parseShareLink(url);
    const account = await readStoreAuth();

    if (
      parsed.origin !== DEFAULT_STORE_ORIGIN &&
      parsed.origin !== account?.origin
    )
      throw new ReviewInputError(
        "This share uses an untrusted service. Sign in to that service before opening its links.",
        400,
      );
    const id = shareKey(parsed.origin, parsed.capability);
    const known = imports.get(id)?.stage;

    // A failed import retries, and a deleted copy imports again.
    if (!known || known === "ready" || known === "error") {
      const copy = store.copyOf(id);

      const status: ImportStatus = copy
        ? { stage: "ready", reviewId: copy }
        : { stage: "downloading" };

      imports.set(id, status);

      if (!copy)
        importing = importing
          .then(async () => {
            const { bundle, attribution } = await new ShareClient(
              parsed.origin,
            ).download(parsed.capability);

            status.reviewId = await importShare(
              {
                store,
                data,
                fetchRepository: options.fetchRepository,
                cloneRepository: options.cloneRepository,
                onStage: (stage) => {
                  status.stage = stage;
                },
              },
              id,
              bundle,
              attribution,
            );
            status.stage = "ready";
          })
          .catch((error) => {
            status.stage = "error";
            status.error =
              error instanceof ReviewInputError
                ? error.message
                : "This share is unavailable, revoked, or needs a newer Whiteboard version.";
          });
    }

    const { reviewId: _reviewId, ...status } = imports.get(id)!;

    return context.json({ reviewId: id, ...status }, 202);
  });
}

/** Publishing needs only an authored store, never Desktop or recipient workspaces. */
export function mountSharingPublisher(
  app: Hono,
  store: ReviewStore,
  data: LocalReviewData,
  options: Pick<
    SharingHostOptions,
    "readRepository" | "fetch" | "onPublished" | "onRevoked"
  > = {},
) {
  app.post("/sharing/publish", async (context) => {
    const input = publishSchema.parse(
      await readBoundedRequestJson(context.req.raw),
    );

    const snapshot = store.read(input.reviewId, input.version);

    if (snapshot.target?.kind === "worktree")
      throw new ReviewInputError(
        "Pin this review to commits before sharing it.",
      );

    validateShareSources(snapshot);
    const account = await readSharingAuth();

    if (!account)
      throw new ReviewInputError(
        "Set DEV_REVIEW_SHARE_TOKEN for CI, or run whiteboard login before sharing.",
        409,
      );

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
      reviewId: input.reviewId,
      version: snapshot.version,
    });

    const verified = await repository;

    if (verified) bundle.repository = verified;

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
        version: snapshot.version,
      });

      return context.json({
        ...result,
        url: url.href,
        version: snapshot.version,
      });
    } catch (error) {
      if (error instanceof ReviewInputError) throw error;

      if (error instanceof ShareAuthError) {
        // A CI token lives in the environment; only the saved login can go stale.
        if (process.env.DEV_REVIEW_SHARE_TOKEN === undefined)
          await clearStoreAuth();
        throw new ReviewInputError(
          "Your sign-in has expired. Sign in again to share.",
          401,
        );
      }

      throw new ReviewInputError(
        "Sharing failed. Check your connection and login, then retry.",
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
    await new ShareClient(account.origin, account.token).revoke(shareId);
    options.onRevoked?.({ shareId });

    return context.json({ shareId, revoked: true });
  });
}
