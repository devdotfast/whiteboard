import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  type JsonValue,
  REVIEW_CLIENT_HEADER,
  REVIEW_CLIENT_REMOTE,
  parseReviewDesktopVerbFrame,
} from "@dev.fast/review-protocol";
import { runReviewCli } from "@review/cli-runner.js";
import {
  connectReviewApi,
  connectReviewInstance,
} from "@review/review-api/agent-client.js";
import { ReviewApiClient } from "@review/review-api/client.js";
import type { Pins } from "@review/review-api/document.js";
import { createReviewApi } from "@review/review-api/http.js";
import { serveReviewMcp } from "@review/review-api/mcp.js";
import { openReviewProfile } from "@review/review-api/profile.js";
import type { Result, Snapshot } from "@review/review-api/store.js";
import { writeScratchpadEnabled } from "@review/review-preferences.js";
import { ReviewTelemetry } from "@review/review-telemetry.js";
import {
  type ReviewServerDiscovery,
  readReviewServerDiscovery,
  reviewServerDiscoveryPath,
  reviewServerIsHealthy,
} from "@review/server-discovery.js";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { createGlobalReviewServer } from "./desktop-server.js";
import { runHeadlessServer } from "./headless-host.js";

let root: string;

const stops: (() => Promise<void>)[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "review-headless-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
});

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function start(
  stateDir = path.join(root, "server"),
  softwareMapEnabled = false,
) {
  const controller = new AbortController();
  const ready = Promise.withResolvers<ReviewServerDiscovery>();

  const running = runHeadlessServer({
    stateDir,
    softwareMapEnabled,
    signal: controller.signal,
    onReady: ready.resolve,
  });

  const stop = async () => {
    controller.abort();
    await running;
  };

  stops.push(stop);

  const discovery = await Promise.race([
    ready.promise,
    running.then(() => {
      throw new Error("Server exited before readiness");
    }),
  ]);

  const env = { ...process.env, DEV_REVIEW_SERVER_DIR: stateDir };
  const client = await connectReviewApi(env);

  return { client, discovery, env, stateDir, stop };
}

async function repository() {
  const directory = path.join(root, "repo");
  await mkdir(directory);

  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
    }).trim();

  git("init", "-q");
  git("config", "user.name", "Review Test");
  git("config", "user.email", "review-test@example.invalid");
  await writeFile(
    path.join(directory, "example.ts"),
    "export const value = 1;\n",
  );
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  await writeFile(
    path.join(directory, "example.ts"),
    "export const value = 2;\n",
  );
  git("commit", "-qam", "head");

  return { directory, base, head: git("rev-parse", "HEAD") };
}

async function cli(argv: string[], env: NodeJS.ProcessEnv) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let output = "",
    errors = "";

  stdout.on("data", (chunk) => {
    output += chunk;
  });
  stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const exitCode = await runReviewCli({ argv, env, stdout, stderr });

  return { exitCode, output, errors };
}

it("shares review identity, resources, sessions and live changes with Desktop in one profile", async () => {
  const repo = await repository();
  const server = await start(root);
  const local = await openReviewProfile(root, { manageWorkspaces: true });
  const opened: string[] = [];

  const app = createReviewApi(local.store, local.data, async ({ reviewId }) => {
    opened.push(reviewId);

    return { softwareMapEnabled: false };
  });

  const desktop = new ReviewApiClient(
    { serverUrl: "http://desktop.test", token: "test" },
    async (url, init) => app.request(url.replace("/reviews-api", ""), init),
  );

  const abort = new AbortController();
  const catalog = desktop.watch(null, abort.signal);
  let reviewStream: ReturnType<ReviewApiClient["watch"]> | undefined;

  try {
    // The scratchpad is off by default, so there is nothing to list yet.
    expect((await catalog.next()).value).toEqual([]);

    const registered = await server.client.post<{ id: string }>(
      "/repositories",
      { path: repo.directory },
    );

    const pins = {
      repositoryId: registered.id,
      base: repo.base,
      head: repo.head,
    };

    const created = await server.client.post<Result>("/commands", {
      commandId: randomUUID(),
      operation: { type: "create", title: "Shared review", pins },
    });

    // Catalog refreshes can also report repository registration before creation.
    for await (const value of catalog) {
      if (
        Array.isArray(value) &&
        value.some((item) => item.reviewId === created.reviewId)
      )
        break;
    }

    reviewStream = desktop.watch(created.reviewId, abort.signal);
    expect((await reviewStream.next()).value).toMatchObject({
      reviewId: created.reviewId,
      version: 0,
    });
    const leaseId = randomUUID();
    await server.client.post(`/${created.reviewId}/activity/begin`, {
      leaseId,
    });

    for (;;) {
      const value = (await reviewStream.next()).value;

      if (
        value &&
        !Array.isArray(value) &&
        "activity" in value &&
        value.activity?.workingCount === 1
      )
        break;
    }

    await expect(
      desktop.post("/commands", {
        commandId: randomUUID(),
        operation: {
          type: "rename",
          reviewId: created.reviewId,
          title: "Competing author",
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const traceId = randomUUID();
    await server.client.post("/resources", {
      id: traceId,
      repositoryId: registered.id,
      kind: "trace",
      trace: {
        label: "Evidence",
        events: [{ id: "answer", role: "assistant", text: "Shared bytes" }],
      },
    });
    expect(
      await desktop.read(`/${created.reviewId}/resources/${traceId}`),
    ).toMatchObject({
      label: "Evidence",
    });
    await server.client.post("/commands", {
      commandId: randomUUID(),
      leaseId,
      operation: {
        type: "edit",
        reviewId: created.reviewId,
        edit: {
          type: "insert",
          content: {
            type: "trace_quote",
            traceId,
            eventId: "answer",
            text: "Shared bytes",
          },
        },
      },
    });

    for (;;) {
      const value = (await reviewStream.next()).value;

      if (
        value &&
        !Array.isArray(value) &&
        "version" in value &&
        value.version === 1
      )
        break;
    }

    await desktop.post(`/${created.reviewId}/open`, {});
    expect(opened).toEqual([created.reviewId]);
    expect(
      (await desktop.read<Snapshot[]>(""))
        .map((item) => item.reviewId)
        .filter((id) => id !== "scratchpad"),
    ).toEqual([created.reviewId]);
    await server.client.post(`/${created.reviewId}/activity/end`, {
      leaseId,
    });
    await desktop.post("/commands", {
      commandId: randomUUID(),
      operation: {
        type: "rename",
        reviewId: created.reviewId,
        title: "Changed in Desktop",
      },
    });
    expect(
      await server.client.read(`/${created.reviewId}?full=true`),
    ).toMatchObject({ title: "Changed in Desktop", version: 2 });
    await server.client.post("/commands", {
      commandId: randomUUID(),
      operation: { type: "delete", reviewId: created.reviewId },
    });
    await expect(async () => {
      for await (const _value of reviewStream!) {
      }
    }).rejects.toThrow(/not found/i);
  } finally {
    abort.abort();
    await local.data.close();
    await local.store.close();
  }
});

it("authors through CLI and MCP without Desktop and retains source, unfinished sections and resources across restart", async () => {
  const repo = await repository();
  const server = await start();
  const client = server.client;

  const registered = await client.post<{ id: string }>("/repositories", {
    path: repo.directory,
  });

  const pins = await client.post<Pins>("/pins", {
    repositoryId: registered.id,
    base: repo.base,
    head: repo.head,
  });

  const created = await cli(
    [
      "--state-dir",
      server.stateDir,
      "api",
      "session_create",
      JSON.stringify({
        commandId: randomUUID(),
        title: "CI review",
        pins,
      }),
    ],
    process.env,
  );

  expect(created).toMatchObject({ exitCode: 0, errors: "" });

  const { sessionId: reviewId } = z
    .object({ sessionId: z.string() })
    .parse(JSON.parse(created.output));

  await client.post("/commands", {
    commandId: randomUUID(),
    operation: {
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: {
          type: "section",
          title: "Work in progress",
          children: [],
        },
      },
    },
  });
  const imageId = randomUUID();

  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();

  await client.post("/resources", {
    id: imageId,
    repositoryId: registered.id,
    kind: "image",
    base64: image.toString("base64"),
  });
  await client.post("/commands", {
    commandId: randomUUID(),
    operation: {
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: {
          type: "image",
          assetId: imageId,
          alt: "Retained image",
        },
      },
    },
  });
  const traceId = randomUUID();
  await client.post("/resources", {
    id: traceId,
    repositoryId: registered.id,
    kind: "trace",
    trace: {
      label: "CI author",
      events: [{ id: "one", role: "assistant", text: "Checked the source" }],
    },
  });
  // Existing maps can be uploaded even with generation disabled.
  const mapId = randomUUID();
  await client.post("/resources", {
    id: mapId,
    repositoryId: registered.id,
    kind: "map",
    pins,
    side: "head",
    model: {
      systems: {
        app: {
          containers: {
            api: {
              components: {
                value: {
                  codeElements: {
                    value: {
                      sourceRanges: [
                        { file: "example.ts", fromLine: 1, toLine: 1 },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  await expect(
    client.post("/commands", {
      commandId: randomUUID(),
      operation: {
        type: "edit",
        reviewId,
        edit: {
          type: "insert",
          content: {
            type: "code_peek",
            source: {
              file: "missing.ts",
              start: { side: "head", line: 1 },
              end: { side: "head", line: 1 },
            },
          },
        },
      },
    }),
  ).rejects.toThrow(/unavailable at the pinned commit/i);
  expect(await client.read<Snapshot>(`/${reviewId}?full=true`)).toMatchObject({
    version: 2,
  });
  await server.stop();
  expect(await readReviewServerDiscovery(server.stateDir)).toBeNull();

  const restarted = await start(server.stateDir);
  expect(
    await restarted.client.read<Snapshot>(`/${reviewId}?full=true`),
  ).toMatchObject({
    reviewId,
    pins,
    document: [{ title: "Work in progress" }, { assetId: imageId }],
  });

  const retained = await restarted.client.response(
    `/${reviewId}/resources/${imageId}`,
  );

  expect(Buffer.from(await retained.arrayBuffer())).toEqual(image);
  expect(
    (await restarted.client.response(`/${reviewId}/resources/${traceId}`))
      .status,
  ).toBe(200);
  expect(
    (await restarted.client.response(`/${reviewId}/resources/${mapId}`)).status,
  ).toBe(200);

  const file = await restarted.client.read<{ text: string }>(
    `/${reviewId}/file?side=head&file=example.ts`,
  );

  expect(file.text).toBe("export const value = 2;\n");

  const stdin = new PassThrough(),
    stdout = new PassThrough();

  const mcp = await serveReviewMcp(
    () => connectReviewInstance(restarted.env),
    stdin,
    stdout,
  );

  const replies: {
    id: number;
    result: { content?: { text: string }[]; isError?: boolean };
  }[] = [];

  let buffer = "";
  stdout.on("data", (chunk) => {
    buffer += chunk;
    let end: number;

    while ((end = buffer.indexOf("\n")) >= 0) {
      replies.push(JSON.parse(buffer.slice(0, end)));
      buffer = buffer.slice(end + 1);
    }
  });

  try {
    stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "CI", version: "1" },
        },
      }) + "\n",
    );
    await expect.poll(() => replies.some((reply) => reply.id === 1)).toBe(true);
    stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "session_get",
          arguments: { sessionId: reviewId, full: true, format: "json" },
        },
      }) + "\n",
    );
    await expect
      .poll(() => replies.find((reply) => reply.id === 2))
      .toBeTruthy();
    const result = replies.find((reply) => reply.id === 2)!.result;
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content![0].text)).toMatchObject({
      sessionId: reviewId,
      version: 2,
    });
  } finally {
    await mcp.close();
  }
});

it("authenticates clients, reports capabilities and readiness without exposing the token, and diagnoses unavailable commits", async () => {
  const server = await start(undefined, true);
  expect(await reviewServerIsHealthy(server.discovery)).toBe(true);
  expect((await fetch(`${server.discovery.url}/reviews-api`)).status).toBe(401);
  expect(await server.client.read("/capabilities")).toMatchObject({
    desktopAvailable: false,
    softwareMapEnabled: true,
  });

  const status = await cli(
    ["--state-dir", server.stateDir, "server", "status", "--json"],
    process.env,
  );

  expect(status).toMatchObject({ exitCode: 0, errors: "" });
  expect(JSON.parse(status.output)).toMatchObject({
    event: "server.status",
    ready: true,
    version: expect.any(String),
    serverId: (await (await fetch(`${server.discovery.url}/health`)).json())
      .serverId,
  });
  expect(status.output).not.toContain(server.discovery.token);
  const repo = await repository();

  const registered = await server.client.post<{ id: string }>("/repositories", {
    path: repo.directory,
  });

  await expect(
    server.client.post("/pins", {
      repositoryId: registered.id,
      base: "unavailable",
      head: repo.head,
    }),
  ).rejects.toThrow(/Fetch the requested commits/);

  const result = await server.client.post<Result>("/commands", {
    commandId: randomUUID(),
    operation: {
      type: "create",
      title: "No UI",
      pins: { repositoryId: registered.id, base: repo.base, head: repo.head },
    },
  });

  await expect(
    server.client.post(`/${result.reviewId}/open`, {}),
  ).rejects.toThrow(/No Whiteboard Desktop is attached/);
  await server.stop();
  const stopped = await cli(["server", "status", "--json"], server.env);
  expect(stopped.exitCode).toBe(1);
  expect(JSON.parse(stopped.output)).toMatchObject({ event: "error" });
  await expect(connectReviewApi(server.env)).rejects.toThrow(
    /whiteboard server start/g,
  );
});

/** A stand-in Desktop on `/control` that answers every verb relayed to it. */
async function attachDesktop(
  discovery: Pick<ReviewServerDiscovery, "url" | "token">,
) {
  const abort = new AbortController();
  const opened: JsonValue[] = [];
  const verbs: string[] = [];

  const control = await fetch(`${discovery.url}/control`, {
    headers: { "x-review-token": discovery.token },
    signal: abort.signal,
  });

  expect(control.status).toBe(200);

  void (async () => {
    let buffered = "";

    for await (const chunk of control.body!.pipeThrough(
      new TextDecoderStream(),
    )) {
      buffered += chunk;
      let end: number;

      while ((end = buffered.indexOf("\n\n")) >= 0) {
        const frame = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);

        if (!frame.startsWith("data: ")) continue;

        const { id, request } = parseReviewDesktopVerbFrame(
          JSON.parse(frame.slice("data: ".length)),
        );

        verbs.push(request.name);

        if (request.name === "openApiReview") opened.push(request.args);
        await fetch(`${discovery.url}/control/result`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-review-token": discovery.token,
          },
          body: JSON.stringify({
            id,
            response: { ok: true, result: { softwareMapEnabled: true } },
          }),
        });
      }
    }
  })().catch(() => {});

  return { opened, verbs, detach: () => abort.abort() };
}

it("reports attached Desktops and sends each the reviews to open", async () => {
  const server = await start();

  const desktops = [
    await attachDesktop(server.discovery),
    await attachDesktop(server.discovery),
  ];

  try {
    expect(await server.client.read("/capabilities")).toMatchObject({
      desktopAvailable: true,
      softwareMapEnabled: true,
    });

    const repo = await repository();

    const registered = await server.client.post<{ id: string }>(
      "/repositories",
      { path: repo.directory },
    );

    const created = await server.client.post<Result>("/commands", {
      commandId: randomUUID(),
      operation: {
        type: "create",
        title: "Opened remotely",
        pins: { repositoryId: registered.id, base: repo.base, head: repo.head },
        open: false,
      },
    });

    await server.client.post(`/${created.reviewId}/open`, {});

    // The first answer resolves the open; the other's may still be on its way.
    for (const desktop of desktops)
      await expect
        .poll(() => desktop.opened)
        .toEqual([{ reviewId: created.reviewId, title: "Opened remotely" }]);
  } finally {
    for (const desktop of desktops) desktop.detach();
  }

  await expect
    .poll(() => server.client.read("/capabilities"))
    .toMatchObject({ desktopAvailable: false });
});

it.each([false, true])(
  "never makes, lists or offers the scratchpad, with a Desktop attached: %s",
  async (attached) => {
    await writeScratchpadEnabled(true);
    const server = await start();
    const desktop = attached ? await attachDesktop(server.discovery) : null;

    try {
      expect(await server.client.read("/capabilities")).toMatchObject({
        desktopAvailable: attached,
        scratchpadEnabled: false,
      });
      expect(await server.client.read("")).toEqual([]);
      // The offer is a pointer to the scratchpad topic.
      const offer = 'topic:"scratchpad"';

      expect(
        (await server.client.read<{ description: string }[]>("/authoring"))
          .map((tool) => tool.description)
          .join("\n"),
      ).not.toContain(offer);
      expect(await server.client.read("/instructions")).not.toContain(offer);
      expect(
        await server.client.read("/instructions?topic=scratchpad"),
      ).toMatch(/turned off/);
    } finally {
      desktop?.detach();
    }

    await server.stop();

    const local = await openReviewProfile(server.stateDir, {
      manageWorkspaces: false,
    });

    try {
      expect(local.store.list()).toEqual([]);
    } finally {
      await local.data.close();
      await local.store.close();
    }
  },
);

it("gives a remote caller no local paths and no source window", async () => {
  const server = await start();
  const desktop = await attachDesktop(server.discovery);

  try {
    const repo = await repository();
    await writeFile(
      path.join(repo.directory, "example.ts"),
      "export const value = 3;\n",
    );

    const { id: repositoryId } = await server.client.post<{ id: string }>(
      "/repositories",
      { path: repo.directory },
    );

    const create = async (target: JsonValue) =>
      (
        await server.client.post<Result>("/commands", {
          commandId: randomUUID(),
          operation: { type: "create", title: "Remote", target, open: false },
        })
      ).reviewId;

    const worktree = await create({
      kind: "worktree",
      repositoryId,
      base: repo.base,
    });

    const commits = await create({
      kind: "commits",
      repositoryId,
      base: repo.base,
      head: repo.head,
    });

    const call = (
      reviewId: string,
      route: string,
      remote: boolean,
      method = "GET",
    ) =>
      fetch(`${server.discovery.url}/reviews-api/${reviewId}${route}`, {
        method,
        headers: {
          "x-review-token": server.discovery.token,
          ...(remote && { [REVIEW_CLIENT_HEADER]: REVIEW_CLIENT_REMOTE }),
        },
      });

    const read = async (reviewId: string, route: string, remote: boolean) => {
      const response = await call(reviewId, route, remote);
      expect(response.status).toBe(200);

      return response.json();
    };

    const file = "/file?side=head&file=example.ts";
    const context = "/language-context?side=head";
    const home = await realpath(root);

    expect(await read(worktree, file, false)).toHaveProperty("localPath");
    expect(await read(worktree, context, false)).toHaveProperty("rootPath");

    // A headless server prepares no commit checkouts, so only the worktree
    // review has a language context here.
    const remoteContext = await read(worktree, context, true);
    expect(remoteContext).toMatchObject({ identity: expect.any(String) });
    expect(remoteContext).not.toHaveProperty("rootPath");
    expect(JSON.stringify(remoteContext)).not.toContain(home);

    for (const reviewId of [worktree, commits]) {
      const remoteFile = await read(reviewId, file, true);
      expect(remoteFile).toMatchObject({ text: expect.any(String) });
      expect(JSON.stringify(remoteFile)).not.toContain(home);

      const navigator = await call(reviewId, "/navigator", true, "POST");
      expect(navigator.status).toBe(409);
      expect(await navigator.json()).toEqual({
        error:
          "Source windows are not available for a review on another machine.",
      });
    }

    const workspaces = (await readdir(root, { recursive: true })).filter(
      (entry) => entry.endsWith(".code-workspace"),
    );

    expect(workspaces).toEqual([]);
    expect(desktop.verbs).toEqual([]);
    expect((await call(worktree, "/navigator", false, "POST")).status).toBe(
      200,
    );
  } finally {
    desktop.detach();
  }
});

it("rejects a second owner and keeps separate CI job stores independent", async () => {
  const first = await start();
  await expect(
    runHeadlessServer({
      stateDir: first.stateDir,
      signal: new AbortController().signal,
      onReady: () => {},
    }),
  ).rejects.toThrow(/already owns/);
  const second = await start(path.join(root, "second"));
  expect(second.discovery.url).not.toBe(first.discovery.url);
  expect(await second.client.read("/capabilities")).toMatchObject({
    softwareMapEnabled: false,
  });
  const repo = await repository();

  const registered = await first.client.post<{ id: string }>("/repositories", {
    path: repo.directory,
  });

  await first.client.post("/commands", {
    commandId: randomUUID(),
    operation: {
      type: "create",
      title: "First job only",
      pins: { repositoryId: registered.id, base: repo.base, head: repo.head },
    },
  });
  expect(await first.client.read("")).toMatchObject([
    { title: "First job only" },
  ]);
  expect(await second.client.read("")).toEqual([]);
  await first.stop();
  expect(await reviewServerIsHealthy(second.discovery)).toBe(true);
});

it("releases ownership after a port bind failure so startup can be retried", async () => {
  const first = await start();
  const stateDir = path.join(root, "retry");
  await expect(
    runHeadlessServer({
      stateDir,
      port: Number(new URL(first.discovery.url).port),
      signal: new AbortController().signal,
      onReady: () => {},
    }),
  ).rejects.toThrow(/EADDRINUSE/);
  const retried = await start(stateDir);
  expect(await reviewServerIsHealthy(retried.discovery)).toBe(true);
});

it("does not connect to another instance through stale discovery", async () => {
  const server = await start();
  const discoveryPath = reviewServerDiscoveryPath(server.stateDir);
  const original = JSON.parse(await readFile(discoveryPath, "utf8"));
  await writeFile(
    discoveryPath,
    JSON.stringify({ ...original, instanceId: randomUUID() }),
  );
  await expect(connectReviewApi(server.env)).rejects.toThrow(/not ready/);
});

it("resets the server id only while no server holds the store", async () => {
  const server = await start();

  const serverId = async (url: string) =>
    (await (await fetch(`${url}/health`)).json()).serverId;

  const before = await serverId(server.discovery.url);

  const reset = [
    "--state-dir",
    server.stateDir,
    "server",
    "reset-id",
    "--json",
  ];

  const refused = await cli(reset, process.env);

  expect(refused.exitCode).toBe(1);
  expect(JSON.parse(refused.output).error.message).toMatch(/Stop it first/);
  expect(await serverId(server.discovery.url)).toBe(before);

  await server.stop();

  // An unrelated instance selection must not get in the way.
  const done = await cli(reset, {
    ...process.env,
    DEV_REVIEW_INSTANCE: "Not A Key!",
  });

  expect(done).toMatchObject({ exitCode: 0, errors: "" });
  const { event, serverId: after } = JSON.parse(done.output);
  expect(event).toBe("server.reset-id");
  expect(after).not.toBe(before);

  const restarted = await start(server.stateDir);
  expect(await serverId(restarted.discovery.url)).toBe(after);
});

it.each(["attached", "not yet attached"])(
  "refuses to reset the id of a store a Desktop holds, window %s",
  async (window) => {
    const local = await openReviewProfile(root, { manageWorkspaces: false });

    const desktop = createGlobalReviewServer({
      reviewStore: local.store,
      reviewData: local.data,
      appPid: process.pid,
      packageRoot: root,
      toolingRoot: root,
      port: 0,
      telemetry: ReviewTelemetry.fromEnv(process.env),
    });

    stops.push(async () => {
      await desktop.close();
      await local.data.close();
      await local.store.close();
    });
    await desktop.listen();
    const before = local.store.serverId();

    const attached =
      window === "attached" ? await attachDesktop(desktop.discovery) : null;

    try {
      const refused = await cli(
        ["--state-dir", root, "server", "reset-id", "--json"],
        process.env,
      );

      expect(refused.exitCode).toBe(1);
      expect(JSON.parse(refused.output).error.message).toMatch(/Stop it first/);
      expect(local.store.serverId()).toBe(before);
      expect(
        (await (await fetch(`${desktop.discovery.url}/health`)).json())
          .serverId,
      ).toBe(before);
    } finally {
      attached?.detach();
    }
  },
);

it("refuses to reset the id while a Desktop record cannot be read", async () => {
  const local = await openReviewProfile(root, { manageWorkspaces: false });
  const before = local.store.serverId();
  await local.data.close();
  await local.store.close();
  const instances = path.join(root, "review-desktop", "instances");
  await mkdir(instances, { recursive: true });
  await writeFile(path.join(instances, "stable.json"), "not json");

  const refused = await cli(
    ["--state-dir", root, "server", "reset-id", "--json"],
    process.env,
  );

  expect(refused.exitCode).toBe(1);

  const reopened = await openReviewProfile(root, { manageWorkspaces: false });
  stops.push(async () => {
    await reopened.data.close();
    await reopened.store.close();
  });
  expect(reopened.store.serverId()).toBe(before);
});

it("refuses to reset the id where there is no store, and creates none", async () => {
  const typo = path.join(root, "no-such-state");

  const refused = await cli(
    ["--state-dir", typo, "server", "reset-id", "--json"],
    process.env,
  );

  expect(refused.exitCode).toBe(1);
  expect(JSON.parse(refused.output).error.message).toContain(typo);
  await expect(access(typo)).rejects.toThrow(/ENOENT/);
});

it("refuses the removed batch authoring mode instead of ignoring it", async () => {
  const result = await cli(
    [
      "--state-dir",
      path.join(root, "refused"),
      "server",
      "start",
      "--authoring-mode",
      "batch",
    ],
    process.env,
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.errors).toContain("--authoring-mode was removed");
});
