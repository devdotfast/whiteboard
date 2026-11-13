import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type JsonObject, type JsonValue, isJsonObject } from "@dev.fast/json";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAnimationFolder } from "./animation-drafts.js";
import { readAnimationReferences } from "./animation-references.js";
import { createReviewApi } from "./http.js";
import { openLocalReviewStore } from "./local-data.js";
import { REVIEW_PERSON_HEADER } from "./request-origin.js";

let directory: string, repository: string, reviewId: string;

let local: ReturnType<typeof openLocalReviewStore>;

let app: Hono;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();

/** Posts as an agent, or as a person: agents may no longer add an
 * animation, so the animation references go in as a person's would. */
async function post(route: string, body: JsonValue, person = false) {
  const response = await app.request(route, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(person && { [REVIEW_PERSON_HEADER]: "1" }),
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: (await response.json()) as { error?: string; reviewId?: string },
  };
}

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "animation-references-"));
  repository = path.join(directory, "repository");
  vi.stubEnv("DEV_REVIEW_HOME", directory);
  mkdirSync(repository);
  git("init", "-q");
  git("config", "user.name", "Reference Test");
  git("config", "user.email", "references@example.invalid");
  writeFileSync(path.join(repository, "order.ts"), 'status = "draft";\n');
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "Base");
  writeFileSync(path.join(repository, "order.ts"), 'status = "queued";\n');
  git("-c", "commit.gpgsign=false", "commit", "-qam", "Head");
  local = openLocalReviewStore(path.join(directory, "reviews.db"));

  const registered = await local.data.register(repository);
  const pins = await local.data.resolvePins(registered.id, "HEAD^", "HEAD");

  // Animations sit behind a preference.
  app = createReviewApi(
    local.store,
    local.data,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => true,
  );

  const created = await post("/commands", {
    operation: {
      type: "create",
      title: "References",
      target: {
        kind: "commits",
        repositoryPath: repository,
        base: pins.base,
        head: pins.head,
      },
    },
  });

  reviewId = created.body.reviewId!;
});

afterEach(async () => {
  await local.store.close();
  await local.data.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

/** Code anchors in references are illustrative; the test repository has this one. */
const ANCHOR = "head/order.ts#L1";

describe("the reference animations are what the API accepts", () => {
  it("inserts every reference through the API", async () => {
    for (const reference of await readAnimationReferences()) {
      const fields = await readAnimationFolder(reference.directory);
      const content: JsonObject = { ...fields };

      if (isJsonObject(fields.code))
        content.code = Object.fromEntries(
          Object.entries(fields.code).map(([name, range]) => [
            name,
            isJsonObject(range) ? { ...range, source: ANCHOR } : ANCHOR,
          ]),
        );

      const result = await post(
        "/commands",
        {
          operation: {
            type: "edit",
            reviewId,
            edit: { type: "insert", content },
          },
        },
        true,
      );

      expect({ name: reference.name, ...result }).toEqual({
        name: reference.name,
        status: 200,
        body: result.body,
      });
    }
  });

  it("inserts every reference diagram through the API, as an agent", async () => {
    const diagrams = await readAnimationReferences(undefined, {
      folder: "diagrams",
    });

    expect(diagrams.map(({ name }) => name)).toContain("request-fan-out");

    for (const reference of diagrams) {
      const fields = await readAnimationFolder(reference.directory);
      const content: JsonObject = { ...fields };

      // Every link points at the test repository's order.ts.
      if (isJsonObject(fields.code))
        content.code = Object.fromEntries(
          Object.entries(fields.code).map(([name, range]) => [
            name,
            isJsonObject(range) ? { ...range, source: ANCHOR } : range,
          ]),
        );

      const result = await post("/commands", {
        operation: {
          type: "edit",
          reviewId,
          edit: { type: "insert", content },
        },
      });

      expect({ name: reference.name, ...result }).toEqual({
        name: reference.name,
        status: 200,
        body: result.body,
      });
    }
  });

  it("reads no references from a package without any", async () => {
    expect(await readAnimationReferences(directory)).toEqual([]);
  });

  it("throws on a broken reference for the tests, and leaves it out for agents", async () => {
    const animations = path.join(directory, "instructions", "animations");

    const write = (name: string, files: Record<string, string>) => {
      mkdirSync(path.join(animations, name), { recursive: true });

      for (const [file, text] of Object.entries(files))
        writeFileSync(path.join(animations, name, file), text);
    };

    write("good", {
      "animation.html": "<p>Good</p>",
      "frames.json": JSON.stringify([{ key: "one", title: "One" }]),
      "block.json": JSON.stringify({ title: "Good" }),
      "README.md": "# Good\n\nA good reference.\n",
    });
    // A frame key the schema refuses.
    write("broken", {
      "animation.html": "<p>Broken</p>",
      "frames.json": JSON.stringify([{ key: "1 bad", title: "Bad" }]),
      "block.json": JSON.stringify({ title: "Broken" }),
      "README.md": "# Broken\n\nA broken reference.\n",
    });

    await expect(readAnimationReferences(directory)).rejects.toThrow(
      /Reference animation broken/,
    );
    expect(
      (await readAnimationReferences(directory, { strict: false })).map(
        ({ name }) => name,
      ),
    ).toEqual(["good"]);
  });

  it("gives every reference a title and a summary from its README", async () => {
    for (const { name, title, summary } of await readAnimationReferences())
      expect({
        name,
        title: Boolean(title),
        summary: Boolean(summary),
      }).toEqual({ name, title: true, summary: true });
  });
});
