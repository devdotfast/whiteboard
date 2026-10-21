import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readReviewPreferences,
  writeAnimationsEnabled,
  writeScratchpadEnabled,
} from "@review/review-preferences.js";
import { expect, it } from "vitest";

import { type AuthoringTool } from "./agent-client.js";
import { ReviewApiClient } from "./client.js";
import { createReviewApi } from "./http.js";
import { callPublicTool, publicTool } from "./public-tools.js";
import { ReviewStore, SCRATCHPAD_ID } from "./store.js";

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
    () => true,
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
    await store.ensureScratchpad();
    const disabledTools = await catalog();
    expect(JSON.stringify(disabledTools)).not.toContain('"animation"');
    expect(await client.read<string>("/instructions")).not.toContain(
      "- animation ",
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
      sessionId: SCRATCHPAD_ID,
      edit: { type: "insert", content: animation },
    });
    const saved = store.read(SCRATCHPAD_ID);
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
        callPublicTool(client, editTool, { sessionId: SCRATCHPAD_ID, edit }),
      ).rejects.toThrow("Animation authoring is disabled");
      expect(store.read(SCRATCHPAD_ID)).toEqual(saved);
    }

    const read = await app.request(`/${SCRATCHPAD_ID}?full=true`);
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("Pipeline");
    await callPublicTool(client, editTool, {
      sessionId: SCRATCHPAD_ID,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "Still editable" },
      },
    });
    enabled = true;
    await callPublicTool(client, editTool, {
      sessionId: SCRATCHPAD_ID,
      edit: { type: "update", targetId, changes: { html: "<p>Updated</p>" } },
    });
    expect(store.read(SCRATCHPAD_ID).document).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "animation", html: "<p>Updated</p>" }),
      ]),
    );
  } finally {
    store.close();
  }
});

it("defaults animation authoring off and persists it without changing scratchpad preferences", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "animation-preferences-"));

  try {
    expect((await readReviewPreferences(home)).animationsEnabled).toBe(false);
    await writeScratchpadEnabled(true, home);
    await writeAnimationsEnabled(true, home);
    expect(await readReviewPreferences(home)).toMatchObject({
      animationsEnabled: true,
      scratchpadEnabled: true,
    });
    await writeScratchpadEnabled(false, home);
    expect((await readReviewPreferences(home)).animationsEnabled).toBe(true);
    await writeAnimationsEnabled(false, home);
    expect((await readReviewPreferences(home)).animationsEnabled).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
