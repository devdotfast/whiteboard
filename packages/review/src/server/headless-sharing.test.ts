import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { createShareSchema } from "@dev.fast/review-share-protocol";
import { runReviewCli } from "@review/cli-runner.js";
import { ReviewApiClient } from "@review/review-api/client.js";
import type { ReviewServerDiscovery } from "@review/server-discovery.js";
import { parseWhiteboardFile } from "@review/sharing/file.js";
import * as repository from "@review/sharing/repository.js";
import { afterEach, expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { runHeadlessServer } from "./headless-host.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("commits and uploads through a real headless server and CLI without Desktop, disk auth or model credentials", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-headless-sharing-"));
  const fixture = await createShareFixture(root);
  const stateDir = path.join(root, "server");
  const pins = fixture.store.read(fixture.reviewId).pins;

  vi.spyOn(repository, "readShareRepository").mockResolvedValue(
    fixture.repository,
  );

  vi.stubEnv("DEV_REVIEW_SHARE_TOKEN", "ci-publish-token");
  vi.stubEnv("DEV_REVIEW_SHARE_ORIGIN", "https://sharing.test");
  vi.stubEnv("DEV_REVIEW_HOME", stateDir);
  vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
  vi.stubEnv("SHELL", "");
  const realFetch = globalThis.fetch;
  const requests: { url: string; headers: Headers; body?: string }[] = [];
  const shareId = randomUUID();
  const link = `https://sharing.test/s/${"x".repeat(43)}`;
  vi.stubGlobal(
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));

      if (url.hostname !== "sharing.test") return realFetch(input, init);

      if (url.pathname === "/api/auth/token")
        return new Response(null, { status: 404 });
      requests.push({
        url: url.href,
        headers: new Headers(init?.headers),
        body: init?.body ? String(init.body) : undefined,
      });

      return Response.json({ shareId, url: link });
    },
  );
  const abort = new AbortController();
  const ready = Promise.withResolvers<ReviewServerDiscovery>();

  const running = runHeadlessServer({
    stateDir,
    signal: abort.signal,
    onReady: ready.resolve,
  });

  try {
    const discovery = await Promise.race([
      ready.promise,
      running.then(() => {
        throw new Error("Server exited before readiness");
      }),
    ]);

    const client = new ReviewApiClient({
      serverUrl: discovery.url,
      token: discovery.token,
    });

    const registered = await client.post<{ id: string }>("/repositories", {
      path: fixture.repo,
    });

    const d = await client.post<{ reviewId: string }>("/commands", {
      operation: {
        type: "create",
        title: "CI review",
        target: {
          kind: "commits",
          repositoryPath: fixture.repo,
          base: pins!.base,
          head: pins!.head,
        },
      },
    });

    const traceId = randomUUID();
    await client.post("/resources", {
      id: traceId,
      repositoryId: registered.id,
      kind: "trace",
      trace: {
        label: "Evidence",
        events: [{ id: "one", role: "user", text: "Explain the answer" }],
      },
    });
    await client.post("/commands", {
      operation: {
        type: "edit",
        reviewId: d.reviewId,
        edit: {
          type: "insert",
          content: {
            type: "section",
            title: "Summary",
            children: [
              {
                type: "code_peek",
                source: `head/${fixture.sourceFile}#L1`,
              },
              {
                type: "trace_quote",
                traceId,
                eventId: "one",
                text: "Explain the answer",
              },
            ],
          },
        },
      },
    });
    const requestId = randomUUID();

    for (let attempt = 0; attempt < 2; attempt++) {
      const stdout = new PassThrough(),
        stderr = new PassThrough();

      let output = "";
      stdout.on("data", (chunk) => {
        output += chunk;
      });

      const code = await runReviewCli({
        argv: [
          "--state-dir",
          stateDir,
          "share",
          "--review",
          d.reviewId,
          "--version",
          "1",
          "--request-id",
          requestId,
          "--json",
        ],
        env: {
          ...process.env,
          DEV_REVIEW_SERVER_DIR: path.join(root, "wrong-server"),
        },
        stdout,
        stderr,
      });

      expect(code).toBe(0);
      expect(JSON.parse(output)).toEqual({ shareId, url: link, version: 1 });
      expect(output).not.toContain("ci-publish-token");
    }

    const posted = requests.map((r) =>
      createShareSchema.parse(JSON.parse(r.body!)),
    );

    expect(posted.map((r) => r.requestId)).toEqual([requestId, requestId]);
    expect(posted[0]!.bundle).toMatchObject({
      title: "CI review",
      repository: fixture.repository,
    });

    for (const request of requests) {
      expect(request.url).toBe("https://sharing.test/api/v2/shares");
      expect(request.headers.get("authorization")).toBe(
        "Bearer ci-publish-token",
      );
    }

    await expect(
      readFile(path.join(stateDir, "auth.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const file = path.join(root, "exported", "ci.whiteboard");
    const stdout = new PassThrough();
    let exported = "";
    stdout.on("data", (chunk) => {
      exported += chunk;
    });

    expect(
      await runReviewCli({
        argv: [
          "--state-dir",
          stateDir,
          "export",
          "--review",
          d.reviewId,
          "--out",
          file,
          "--json",
        ],
        env: process.env,
        stdout,
        stderr: new PassThrough(),
      }),
    ).toBe(0);
    expect(JSON.parse(exported)).toEqual({ path: file });
    expect(parseWhiteboardFile(await readFile(file, "utf8"))).toMatchObject({
      reviewId: d.reviewId,
      title: "CI review",
      repository: fixture.repository,
    });
  } finally {
    abort.abort();
    await running;
    await fixture.data.close();
    await fixture.store.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const json of [false, true]) {
  it(`reports share failures on stderr while preserving JSON output (json=${json})`, async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "review-share-error-"));
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let output = "";
    let diagnostic = "";
    stdout.on("data", (chunk) => {
      output += chunk;
    });
    stderr.on("data", (chunk) => {
      diagnostic += chunk;
    });

    try {
      const code = await runReviewCli({
        argv: [
          "--state-dir",
          stateDir,
          "share",
          "--review",
          randomUUID(),
          ...(json ? ["--json"] : []),
        ],
        env: process.env,
        stdout,
        stderr,
      });

      expect(code).toBe(1);
      expect(diagnostic).toContain("Whiteboard server is not ready");
      expect(diagnostic).toContain("whiteboard server start");
      expect(json ? JSON.parse(output) : output).toEqual(
        json
          ? { error: { code: "share_failed", message: diagnostic.trim() } }
          : "",
      );
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
}
