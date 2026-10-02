import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview } from "../harness.mjs";

export const name = "extra-diff-languages";

export const phase = 1;

export const options = {
  settings: { "review.experimental.structuralDiff.enabled": true },
  env: {
    REVIEW_DIFFR_BINARY: "",
    GEMINI_API_KEY: "",
    GOOGLE_API_KEY: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
  },
  async beforeLaunch(ctx) {
    ctx.env.XDG_CACHE_HOME = path.join(ctx.root, "cache");
    const file = path.join(ctx.repo, "example.jl");
    await writeFile(file, "function example()\n    value = 1\nend\n");
    await ctx.git("add", ".");
    await ctx.git(
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Before optional grammar",
    );
    ctx.base = await ctx.git("rev-parse", "HEAD");
    await writeFile(file, "function example()\n    value = 2\nend\n");
    await ctx.git(
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qam",
      "After optional grammar",
    );
    ctx.head = await ctx.git("rev-parse", "HEAD");
  },
};

export async function run(ctx) {
  const review = await createReview(ctx, {
    title: "Extra diffr languages",
    blocks: [
      {
        type: "code_peek",
        source: {
          file: "example.jl",
          start: { side: "head", line: 1 },
          end: { side: "head", line: 1 },
        },
      },
    ],
  });

  const before = await ctx.apiOk(`/reviews-api/${review.reviewId}?full=true`);

  const compare = async () => {
    const response = await fetch(
      new URL(
        `/reviews-api/${review.reviewId}/structural-diff`,
        ctx.discovery.url,
      ),
      { headers: { "x-review-token": ctx.discovery.token } },
    );

    assert.equal(response.status, 200);

    return (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find(
        (event) =>
          event.type === "file" &&
          (event.file.rhs ?? event.file.lhs).path === "example.jl",
      ).diff;
  };

  assert.ok((await compare()).stats.fallback);

  await review.canvas
    .getByRole("button", { name: "Diff", exact: true })
    .click();

  let navigations = 0;
  let installed = false;

  const installationResponse = (response) => {
    if (response.url().endsWith("/diffr-languages/install") && response.ok())
      installed = true;
  };

  ctx.page.on("response", installationResponse);

  const navigated = (frame) => {
    if (frame === ctx.page.mainFrame()) navigations++;
  };

  ctx.page.on("framenavigated", navigated);

  const refreshed = ctx.page.waitForResponse(
    (response) =>
      installed &&
      response
        .url()
        .includes(`/reviews-api/${review.reviewId}/structural-diff`),
    { timeout: 180000 },
  );

  await ctx.page.keyboard.press("F1");
  const palette = ctx.page.locator(".quick-input-widget input").first();
  await palette.fill(">Install extra diffr languages");
  await ctx.page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: "Install extra diffr languages" })
    .first()
    .click();
  const response = await refreshed;
  assert.equal(response.status(), 200);

  const structural = await compare();

  assert.equal(structural.stats.fallback, undefined);
  assert.equal(structural.rhs.text, "function example()\n    value = 2\nend\n");
  await review.canvas
    .getByText("example.jl", { exact: true })
    .first()
    .waitFor();
  assert.equal(navigations, 0, "installation must not reload the window");
  ctx.page.off("framenavigated", navigated);
  ctx.page.off("response", installationResponse);
  await ctx.page.screenshot({
    path: path.join(ctx.root, "extra-diff-languages-ready.png"),
  });
  const after = await ctx.apiOk(`/reviews-api/${review.reviewId}?full=true`);
  assert.deepEqual(after, before);
  ctx.check(
    "extra languages: command palette installs the full edition and refreshes the current review without reloading the window",
    "extra languages: pinned review identity and content remain unchanged",
  );
}
