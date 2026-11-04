import { readFile } from "node:fs/promises";
import path from "node:path";

import { devReviewHome } from "@dev.fast/trace-core";
import { describe, expect, it } from "vitest";

import { type AuthoringTool, ToolText } from "./agent-client.js";
import { type RenderRequest, renderTarget } from "./animation-render.js";
import { ReviewApiClient } from "./client.js";
import { createReviewApi } from "./http.js";
import { callPublicTool, publicTool, renderedImage } from "./public-tools.js";
import { ReviewStore } from "./store.js";

// A 1x1 PNG: what a Desktop would answer, base64.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const animation = {
  type: "animation",
  title: "Retry",
  html: "<p>Retry</p>",
  frames: [
    { key: "a1", title: "Attempt 1" },
    { key: "a2", title: "Attempt 2" },
    { key: "ok", title: "Succeeds" },
    { key: "fail", title: "Gives up" },
  ],
  scenarios: [
    { key: "succeeds", label: "Succeeds", frames: ["a1", "ok"] },
    { key: "gives-up", label: "Gives up", frames: ["a1", "a2", "fail"] },
  ],
};

const clip = {
  type: "clip",
  title: "Trip",
  html: "<p>Trip</p>",
  markers: [
    { key: "sent", title: "Sent" },
    { key: "stored", title: "Stored" },
  ],
};

function openStore() {
  return new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });
}

async function board(store: ReviewStore) {
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

  const ids: string[] = [];

  for (const content of [
    animation,
    clip,
    { type: "markdown", markdown: "x" },
  ]) {
    const result = await store.execute({
      operation: { type: "edit", reviewId, edit: { type: "insert", content } },
    });

    ids.push(result.targetId!);
  }

  const [animationId, clipId, markdownId] = ids as [string, string, string];

  return { reviewId, animationId, clipId, markdownId };
}

describe("renderTarget", () => {
  it("takes a frame of an animation, a marker of a clip, or the first stop", async () => {
    const store = openStore();

    try {
      const { reviewId, animationId, clipId, markdownId } = await board(store);
      const snapshot = store.read(reviewId);

      expect(renderTarget(snapshot, animationId, "a2")).toEqual({
        type: "animation",
        key: "a2",
      });
      // The first scenario's first frame, not the first frame declared.
      expect(renderTarget(snapshot, animationId, undefined)).toEqual({
        type: "animation",
        key: "a1",
      });
      expect(renderTarget(snapshot, clipId, undefined)).toEqual({
        type: "clip",
        key: "sent",
      });
      expect(() => renderTarget(snapshot, animationId, "a9")).toThrow(
        "a9 is not a frame of " +
          animationId +
          ". Its frames: a1, a2, ok, fail.",
      );
      expect(() => renderTarget(snapshot, clipId, "a1")).toThrow(
        "Its markers: sent, stored.",
      );
      expect(() => renderTarget(snapshot, markdownId, undefined)).toThrow(
        "is a markdown; only an animation or a clip renders a frame.",
      );
      expect(() => renderTarget(snapshot, "missing", undefined)).toThrow(
        "Target not found",
      );
    } finally {
      store.close();
    }
  });
});

describe("GET /:id/render", () => {
  it("asks Desktop for the stop and answers its capture", async () => {
    const store = openStore();
    const requests: RenderRequest[] = [];

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
      async (request) => {
        requests.push(request);

        return {
          frame: {
            key: request.frame,
            title: "Attempt 2",
            position: 1,
            count: 3,
          },
          scenario: "gives-up",
          clipped: false,
          error: null,
          png: PNG,
        };
      },
    );

    try {
      const { reviewId, animationId, clipId } = await board(store);

      const rendered = await app.request(
        `/${reviewId}/render?targetId=${animationId}&frame=a2`,
      );

      expect(rendered.status).toBe(200);
      expect(await rendered.json()).toEqual({
        reviewId,
        targetId: animationId,
        type: "animation",
        frame: { key: "a2", title: "Attempt 2", position: 1, count: 3 },
        scenario: "gives-up",
        clipped: false,
        error: null,
        png: PNG,
      });
      expect(requests).toEqual([
        { reviewId, targetId: animationId, frame: "a2" },
      ]);

      // Desktop is not asked for a stop the block does not have.
      const missing = await app.request(
        `/${reviewId}/render?targetId=${clipId}&frame=a2`,
      );

      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({
        error: `a2 is not a marker of ${clipId}. Its markers: sent, stored.`,
      });
      expect(requests).toHaveLength(1);

      const noTarget = await app.request(`/${reviewId}/render`);
      expect(noTarget.status).toBe(400);
    } finally {
      store.close();
    }
  });

  it("refuses without a Desktop to render in", async () => {
    const store = openStore();
    const app = createReviewApi(store);

    try {
      const { reviewId, animationId } = await board(store);

      const response = await app.request(
        `/${reviewId}/render?targetId=${animationId}`,
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error:
          "Rendering a frame needs Whiteboard Desktop, which this server cannot reach.",
      });
    } finally {
      store.close();
    }
  });
});

describe("session_render", () => {
  it("is listed with animation authoring, writes the PNG beside the drafts, and hands the image to the agent", async () => {
    const store = openStore();
    let enabled = false;

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
      async (request) => ({
        frame: { key: request.frame, title: "Sent", position: 0, count: 2 },
        clipped: true,
        error: "boom",
        png: PNG,
      }),
    );

    const client = new ReviewApiClient(
      { serverUrl: "http://review.test", token: "test" },
      async (url, init) => app.request(url.replace("/reviews-api", ""), init),
    );

    const catalog = async () =>
      (await client.read<AuthoringTool[]>("/authoring")).map(publicTool);

    try {
      const { reviewId, clipId } = await board(store);

      expect((await catalog()).map((tool) => tool.name)).not.toContain(
        "session_render",
      );
      enabled = true;

      const tool = (await catalog()).find(
        (tool) => tool.name === "session_render",
      )!;

      expect(tool.description).toContain("session_open");
      expect(tool.inputSchema.required).toEqual(["sessionId", "targetId"]);

      const result = await callPublicTool(client, tool, {
        sessionId: reviewId,
        targetId: clipId,
      });

      const file = path.join(
        devReviewHome(),
        "animation-renders",
        reviewId,
        clipId,
        "sent.png",
      );

      expect(result).toEqual({
        sessionId: reviewId,
        targetId: clipId,
        type: "clip",
        frame: { key: "sent", title: "Sent", position: 0, count: 2 },
        clipped: true,
        error: "boom",
        png: PNG,
        file,
      });
      expect((await readFile(file)).toString("base64")).toBe(PNG);

      // MCP shows the PNG as an image; the text keeps the rest.
      const split = renderedImage(tool, result);
      expect(split.image).toEqual({ data: PNG, mimeType: "image/png" });
      expect(split.result).toEqual({
        sessionId: reviewId,
        targetId: clipId,
        type: "clip",
        frame: { key: "sent", title: "Sent", position: 0, count: 2 },
        clipped: true,
        error: "boom",
        file,
      });

      // Other tools' results pass through, text included.
      const text = new ToolText("plain");
      expect(renderedImage(tool, text)).toEqual({ result: text });
      expect(renderedImage({ name: "session_get" }, { png: PNG })).toEqual({
        result: { png: PNG },
      });
    } finally {
      store.close();
    }
  });
});
