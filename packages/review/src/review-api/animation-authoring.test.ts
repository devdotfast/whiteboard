import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readAnimationsEnabled,
  writeAnimationsEnabled,
} from "@review/review-preferences.js";
import { expect, it } from "vitest";

import { type AuthoringTool } from "./agent-client.js";
import { ReviewApiClient } from "./client.js";
import { createReviewApi } from "./http.js";
import { callPublicTool, publicTool } from "./public-tools.js";
import { ReviewStore } from "./store.js";

it("gates animation authoring live, including stale MCP tools, while keeping saved animations readable", async () => {
  let enabled = false;

  const store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  const app = createReviewApi(
    store,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => enabled,
  );

  const client = new ReviewApiClient(
    { serverUrl: "http://review.test", token: "test" },
    async (url, init) => app.request(url.replace("/reviews-api", ""), init),
  );

  const animation = {
    type: "animation",
    title: "Pipeline",
    html: "<p>Render</p>",
    frames: [{ key: "render", title: "Render" }],
  };

  const catalog = async () =>
    (await client.read<AuthoringTool[]>("/authoring")).map(publicTool);

  try {
    const { reviewId } = await store.execute({
      operation: {
        type: "create",
        title: "Animations",
        target: {
          kind: "commits",
          repositoryId: "repo",
          base: "base",
          head: "head",
        },
      },
    });

    const disabledTools = await catalog();
    expect(JSON.stringify(disabledTools)).not.toContain('"animation"');
    expect(await client.read<string>("/instructions")).not.toMatch(
      /animation/i,
    );
    expect((await app.request("/instructions?topic=animation")).status).toBe(
      409,
    );

    enabled = true;
    const tools = await catalog();
    const editTool = tools.find((tool) => tool.name === "session_edit")!;
    expect(await client.read<string>("/instructions")).toContain(
      "- animation ",
    );
    expect((await app.request("/instructions?topic=animation")).status).toBe(
      200,
    );
    await callPublicTool(client, editTool, {
      sessionId: reviewId,
      edit: { type: "insert", content: animation },
    });
    const saved = store.read(reviewId);
    const targetId = saved.document[0]!.id;

    enabled = false;
    expect(await client.read("/capabilities")).toMatchObject({
      animationsEnabled: false,
    });

    for (const edit of [
      { type: "insert", content: animation },
      {
        type: "insert",
        content: { type: "section", title: "Nested", children: [animation] },
      },
      { type: "replace", targetId, content: animation },
      { type: "update", targetId, changes: { html: "changed" } },
      { type: "remove", targetId },
    ]) {
      await expect(
        callPublicTool(client, editTool, { sessionId: reviewId, edit }),
      ).rejects.toThrow("Animation authoring is disabled");
      expect(store.read(reviewId)).toEqual(saved);
    }

    const read = await app.request(`/${reviewId}?full=true`);
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("Pipeline");
    await callPublicTool(client, editTool, {
      sessionId: reviewId,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "Still editable" },
      },
    });
    enabled = true;
    await callPublicTool(client, editTool, {
      sessionId: reviewId,
      edit: { type: "update", targetId, changes: { html: "<p>Updated</p>" } },
    });
    expect(store.read(reviewId).document).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "animation", html: "<p>Updated</p>" }),
      ]),
    );
  } finally {
    store.close();
  }
});

it("defaults animation authoring off and persists it", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "animation-preferences-"));

  try {
    expect(await readAnimationsEnabled(home)).toBe(false);
    await writeAnimationsEnabled(true, home);
    expect(await readAnimationsEnabled(home)).toBe(true);
    await writeAnimationsEnabled(false, home);
    expect(await readAnimationsEnabled(home)).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
