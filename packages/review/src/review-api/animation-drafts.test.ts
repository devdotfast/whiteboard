import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonObject } from "@dev.fast/json";
import { afterEach, beforeEach, expect, it } from "vitest";

import { type AuthoringTool } from "./agent-client.js";
import { ReviewApiClient } from "./client.js";
import { createReviewApi } from "./http.js";
import { callPublicTool, publicTool } from "./public-tools.js";
import { ReviewStore } from "./store.js";

const animation = {
  type: "animation",
  title: "Raft",
  html: "<script>whiteboard.on('*', ({ frame }) => render(frame.data));</script>",
  frames: [
    { key: "steady", title: "Steady state", data: { leader: "S1" } },
    { key: "crash", title: "The leader crashes", data: { leader: null } },
  ],
  scenarios: [
    { key: "normal", label: "Normal", frames: ["steady"] },
    { key: "crash", label: "Crash", frames: ["steady", "crash"] },
  ],
};

let store: ReviewStore;

let client: ReviewApiClient;

let tools: AuthoringTool[];

let drafts: string;

let sessionId: string;

beforeEach(async () => {
  store = new ReviewStore(":memory:", {
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
    () => true,
  );

  client = new ReviewApiClient(
    { serverUrl: "http://review.test", token: "test" },
    async (url, init) => app.request(url.replace("/reviews-api", ""), init),
  );
  tools = (await client.read<AuthoringTool[]>("/authoring")).map(publicTool);
  drafts = await mkdtemp(path.join(tmpdir(), "animation-drafts-"));
  ({ reviewId: sessionId } = await store.execute({
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
  }));
});

afterEach(async () => {
  store.close();
  await rm(drafts, { recursive: true, force: true });
});

const call = (name: string, input: JsonObject) =>
  callPublicTool(client, tools.find((tool) => tool.name === name)!, {
    sessionId,
    ...input,
  });

const block = () => store.read(sessionId).document[0]!;

async function inserted() {
  await call("session_edit", { edit: { type: "insert", content: animation } });

  return block().id!;
}

const draftFile = (name: string) => path.join(drafts, name);

async function editJson(name: string, change: (value: any) => void) {
  const value = JSON.parse(await readFile(draftFile(name), "utf8"));
  change(value);
  await writeFile(draftFile(name), JSON.stringify(value, null, 2));
}

it("checks an animation out as files, and publishes only what the edits changed", async () => {
  const targetId = await inserted();

  await call("session_checkout", { targetId, dir: drafts });
  expect(await readFile(draftFile("animation.html"), "utf8")).toBe(
    animation.html,
  );
  expect(JSON.parse(await readFile(draftFile("block.json"), "utf8"))).toEqual({
    title: "Raft",
    code: {},
    height: "auto",
  });

  // A new scenario: one frame and one path, the HTML untouched.
  await editJson("frames.json", (frames) =>
    frames.push({
      key: "split",
      title: "The vote splits",
      data: { leader: null },
    }),
  );
  await editJson("scenarios.json", (scenarios) =>
    scenarios.push({
      key: "split",
      label: "Split vote",
      frames: ["steady", "split"],
    }),
  );

  const published = await call("session_edit", {
    edit: { type: "update", targetId, fromFiles: drafts },
  });

  expect(published).toMatchObject({ targetId });
  expect(store.read(sessionId).lastEdit).toMatchObject({
    fields: ["frames", "scenarios"],
  });
  expect(block()).toMatchObject({
    html: animation.html,
    frames: expect.arrayContaining([
      expect.objectContaining({ key: "split", data: { leader: null } }),
    ]),
  });

  // The folder follows its own publish: another round needs no new checkout.
  await editJson("block.json", (fields) => (fields.title = "Raft, five nodes"));
  await call("session_edit", {
    edit: { type: "update", targetId, fromFiles: drafts },
  });
  expect(block()).toMatchObject({ title: "Raft, five nodes" });

  expect(
    await call("session_edit", {
      edit: { type: "update", targetId, fromFiles: drafts },
    }),
  ).toEqual({ targetId, unchanged: true });
});

it("refuses a publish once the animation changed after its checkout, keeping the drafts", async () => {
  const targetId = await inserted();

  await call("session_checkout", { targetId, dir: drafts });
  await call("session_edit", {
    edit: { type: "update", targetId, changes: { title: "Renamed elsewhere" } },
  });
  await editJson("block.json", (fields) => (fields.title = "Mine"));

  await expect(
    call("session_edit", {
      edit: { type: "update", targetId, fromFiles: drafts },
    }),
  ).rejects.toThrow(/changed after it was checked out/);
  expect(block()).toMatchObject({ title: "Renamed elsewhere" });
  expect(
    JSON.parse(await readFile(draftFile("block.json"), "utf8")).title,
  ).toBe("Mine");
});

it("names the file and place of a mistake in the drafts", async () => {
  const targetId = await inserted();

  const publish = () =>
    call("session_edit", {
      edit: { type: "update", targetId, fromFiles: drafts },
    });

  await call("session_checkout", { targetId, dir: drafts });
  await writeFile(draftFile("frames.json"), "[{ broken");
  await expect(publish()).rejects.toThrow(/^frames\.json: /);

  await call("session_checkout", { targetId, dir: drafts });
  await editJson("frames.json", (frames) => (frames[1].duration = 10));
  await expect(publish()).rejects.toThrow(/frames\.json \[1\]\.duration: /);

  await call("session_checkout", { targetId, dir: drafts });
  await editJson("block.json", (fields) => (fields.frames = []));
  await expect(publish()).rejects.toThrow(/block\.json holds only/);
});

it("inserts an animation written as files, and later publishes update it", async () => {
  const { html, frames, scenarios, type: _type, ...fields } = animation;

  await writeFile(draftFile("animation.html"), html);
  await writeFile(draftFile("frames.json"), JSON.stringify(frames));
  await writeFile(draftFile("scenarios.json"), JSON.stringify(scenarios));
  await writeFile(draftFile("block.json"), JSON.stringify(fields));

  const { targetId } = (await call("session_edit", {
    edit: { type: "insert", fromFiles: drafts },
  })) as { targetId: string };

  expect(block()).toMatchObject({
    id: targetId,
    type: "animation",
    title: "Raft",
  });

  await editJson("block.json", (value) => (value.title = "Raft again"));
  await call("session_edit", {
    edit: { type: "update", targetId, fromFiles: drafts },
  });
  expect(block()).toMatchObject({ title: "Raft again" });
});

it("checks out only animations", async () => {
  await call("session_edit", {
    edit: { type: "insert", content: { type: "markdown", markdown: "Prose" } },
  });

  await expect(
    call("session_checkout", { targetId: block().id!, dir: drafts }),
  ).rejects.toThrow(/is a markdown; only animations check out/);
});

it("hands agents whiteboard.css and whiteboard.d.ts, read-only, from checkout and the animation instructions", async () => {
  const targetId = await inserted();

  const { styles, api, next } = (await call("session_checkout", {
    targetId,
    dir: drafts,
  })) as { styles: string; api: string; next: string };

  expect(next).toContain(styles);
  expect(next).toContain(api);
  expect(path.basename(styles)).toBe("whiteboard.css");
  expect(path.basename(api)).toBe("whiteboard.d.ts");
  expect((await stat(styles)).mode & 0o222).toBe(0);
  expect((await stat(api)).mode & 0o222).toBe(0);
  expect(await readFile(api, "utf8")).toContain("interface Whiteboard");

  const css = await readFile(styles, "utf8");
  expect(css).toContain(".wb-card");
  expect(css).toContain("--wb-space-12");

  // A second write replaces the read-only file.
  const instructions = await callPublicTool(
    client,
    tools.find((tool) => tool.name === "session_get_instructions")!,
    { topic: "animation" },
  );

  expect(JSON.stringify(instructions)).toContain(styles);
  expect(JSON.stringify(instructions)).toContain(api);
});

it("shows the agent what the script did when a canvas last ran it", async () => {
  const targetId = await inserted();

  const read = async () =>
    JSON.stringify(await call("session_get", { targetId }));

  const ran = (version: number, error: string | null) =>
    client.post(`/${sessionId}/animation-run?version=${version}`, {
      blockId: targetId,
      error,
    });

  const version = store.read(sessionId).version;

  expect(await read()).toContain("Not run yet");

  await ran(version, "render is not defined");
  // A later clean boot of the same version keeps the error it threw.
  await ran(version, null);
  expect(await read()).toContain("Script error: render is not defined");

  await call("session_edit", {
    edit: { type: "update", targetId, changes: { title: "Raft, fixed" } },
  });
  expect(await read()).toContain("Not run yet");

  // A canvas still drawing the old version reports too late: ignored.
  await ran(version, "render is not defined");
  expect(await read()).toContain("Not run yet");

  await ran(store.read(sessionId).version, null);
  expect(await read()).toContain(
    "Ran in an open whiteboard without a script error",
  );
});
