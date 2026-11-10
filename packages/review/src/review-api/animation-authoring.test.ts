import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonObject } from "@dev.fast/json";
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
    expect(JSON.stringify(disabledTools)).not.toContain("fromFiles");
    expect(disabledTools.map((tool) => tool.name)).not.toContain(
      "session_checkout",
    );
    expect(await client.read<string>("/instructions")).not.toMatch(
      /animation/i,
    );
    expect((await app.request("/instructions?topic=animation")).status).toBe(
      409,
    );

    enabled = true;
    const tools = await catalog();
    const editTool = tools.find((tool) => tool.name === "session_edit")!;
    expect(tools.map((tool) => tool.name)).toContain("session_checkout");
    // Agents are pointed at diagrams; the animation topic stays for the
    // animations boards already hold.
    const guide = await client.read<string>("/instructions");
    expect(guide).toContain("- diagram ");
    expect(guide).not.toContain("- animation ");
    expect((await app.request("/instructions?topic=animation")).status).toBe(
      200,
    );
    expect((await app.request("/instructions?topic=diagram")).status).toBe(200);
    await expect(
      callPublicTool(client, editTool, {
        sessionId: reviewId,
        edit: { type: "insert", content: animation },
      }),
    ).rejects.toThrow("New animation components are retired");

    // A person still adds one.
    await store.execute(
      {
        operation: {
          type: "edit",
          reviewId,
          edit: { type: "insert", content: animation },
        },
      },
      undefined,
      { kind: "person" },
    );
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

it("gates clips with animations", async () => {
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

  const clip = {
    type: "clip",
    title: "Race",
    html: "<p>Race</p>",
    markers: [{ key: "go", title: "Go" }],
  };

  const editTool = async () =>
    (await client.read<AuthoringTool[]>("/authoring"))
      .map(publicTool)
      .find((tool) => tool.name === "session_edit")!;

  try {
    const { reviewId } = await store.execute({
      operation: {
        type: "create",
        title: "Clips",
        target: {
          kind: "commits",
          repositoryId: "repo",
          base: "base",
          head: "head",
        },
      },
    });

    expect(await client.read<string>("/instructions")).not.toContain("- clip ");
    await expect(
      callPublicTool(client, await editTool(), {
        sessionId: reviewId,
        edit: { type: "insert", content: clip },
      }),
    ).rejects.toThrow("Animation authoring is disabled");
    expect(store.read(reviewId).document).toEqual([]);

    enabled = true;
    expect(await client.read<string>("/instructions")).not.toContain("- clip ");
    await expect(
      callPublicTool(client, await editTool(), {
        sessionId: reviewId,
        edit: { type: "insert", content: clip },
      }),
    ).rejects.toThrow("New clip components are retired");
    await store.execute(
      {
        operation: {
          type: "edit",
          reviewId,
          edit: { type: "insert", content: clip },
        },
      },
      undefined,
      { kind: "person" },
    );
    const targetId = store.read(reviewId).document[0]!.id;

    // An agent still updates the clip a board holds.
    await callPublicTool(client, await editTool(), {
      sessionId: reviewId,
      edit: { type: "update", targetId, changes: { title: "Race, again" } },
    });
    expect(store.read(reviewId).document[0]).toMatchObject({
      title: "Race, again",
    });

    enabled = false;
    await expect(
      callPublicTool(client, await editTool(), {
        sessionId: reviewId,
        edit: { type: "update", targetId, changes: { title: "Renamed" } },
      }),
    ).rejects.toThrow("Animation authoring is disabled");
    expect(store.read(reviewId).document[0]).toMatchObject({
      type: "clip",
      title: "Race, again",
    });
  } finally {
    store.close();
  }
});

it("gates diagrams with animations, and with them retires the kinds a diagram replaces", async () => {
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

  const diagram = {
    type: "diagram",
    title: "Orders",
    script: 'wb.node({ id: "api", kind: "container", label: "API" });',
  };

  const sequence = {
    type: "sequence",
    title: "Request",
    actors: { a: "Client", b: "Server" },
    steps: [{ from: "a", to: "b", label: "Send", explanation: "It asks." }],
  };

  const editTool = async () =>
    (await client.read<AuthoringTool[]>("/authoring"))
      .map(publicTool)
      .find((tool) => tool.name === "session_edit")!;

  const insert = async (content: JsonObject) =>
    callPublicTool(client, await editTool(), {
      sessionId: reviewId,
      edit: { type: "insert", content },
    });

  const { reviewId } = await store.execute({
    operation: {
      type: "create",
      title: "Diagrams",
      target: {
        kind: "commits",
        repositoryId: "repo",
        base: "base",
        head: "head",
      },
    },
  });

  try {
    // Off: no diagrams, and the old kinds as before.
    expect(await client.read<string>("/instructions")).not.toContain(
      "- diagram ",
    );
    expect((await app.request("/instructions?topic=diagram")).status).toBe(409);
    await expect(insert(diagram)).rejects.toThrow(
      "Animation authoring is disabled",
    );
    await insert(sequence);

    // On: diagrams, and no new sequence, flow or call stack from agents.
    enabled = true;
    const guide = await client.read<string>("/instructions");
    expect(guide).toContain("- diagram ");
    expect(guide).toContain('session_get_instructions({topic:\"diagram\"})');

    for (const retired of [
      "- sequence ",
      "- flow_diagram ",
      "- call_stack_diff ",
    ])
      expect(guide).not.toContain(retired);

    await insert(diagram);
    await expect(insert(sequence)).rejects.toThrow(
      "New sequence components are retired",
    );

    // The sequence the board holds still takes an agent's update.
    const held = store
      .read(reviewId)
      .document.find((block) => block.type === "sequence")!;

    await callPublicTool(client, await editTool(), {
      sessionId: reviewId,
      edit: {
        type: "update",
        targetId: held.id,
        changes: { title: "Renamed" },
      },
    });
    expect(
      store.read(reviewId).document.find((block) => block.id === held.id),
    ).toMatchObject({ title: "Renamed" });
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
