// Every reference diagram under packages/review/instructions/diagrams runs
// here as a reader would see it: mounted on a board, every frame of every
// scenario stepped through, with no script error and nothing its stage
// found drawn wrong. Set VITE_ANIMATION_SHOTS=1 to save a screenshot of
// each under __screenshots__/references/<name>/ beside this file:
//
//   VITE_ANIMATION_SHOTS=1 pnpm --filter @dev.fast/review-canvas exec \
//     vitest run --config vitest.config.ts --project browser \
//     src/diagram/references.browser.test.tsx -t <reference name>

import {
  loadFixture,
  mountWhiteboard,
  settled,
} from "@canvas/whiteboard-fixture";
import { type JsonObject, isJsonObject, parseJsonText } from "@dev.fast/json";
import { documentSchema, selectionKey } from "@dev.fast/whiteboard-document";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import "@canvas/styles.css";

const files = import.meta.glob<string>("../../../instructions/diagrams/*/*", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Every reference's code points here, so its peeks resolve on this board.
 * A reference's own paths are illustrative. */
const ANCHOR = "head/order.ts#L1";

const shots = Boolean(import.meta.env.VITE_ANIMATION_SHOTS);

const pins = { repositoryId: "repo", base: "base", head: "head" };

function readReferences() {
  const folders = new Map<string, Record<string, string>>();

  for (const [file, text] of Object.entries(files)) {
    const [name, base] = file.split("/").slice(-2) as [string, string];
    folders.set(name, { ...folders.get(name), [base]: text });
  }

  return [...folders].map(([name, folder]) => {
    const block = parseJsonText(folder["block.json"] ?? "{}");

    if (!isJsonObject(block))
      throw new Error(`${name}/block.json: not an object`);

    const code = isJsonObject(block.code)
      ? Object.fromEntries(
          Object.entries(block.code).map(([key, entry]) => [
            key,
            isJsonObject(entry) ? { ...entry, source: ANCHOR } : entry,
          ]),
        )
      : {};

    const raw: JsonObject = {
      id: `reference-${name}`,
      type: "diagram",
      ...block,
      code,
      ...(folder["diagram.js"] && { script: folder["diagram.js"] }),
      ...(folder["diagram.html"] && { html: folder["diagram.html"] }),
      ...(folder["frames.json"] && {
        frames: parseJsonText(folder["frames.json"]),
      }),
      ...(folder["scenarios.json"] && {
        scenarios: parseJsonText(folder["scenarios.json"]),
      }),
      pins,
    };

    const [parsed] = documentSchema.parse([raw]);

    if (parsed?.type !== "diagram") throw new Error(`${name}: not a diagram`);

    return { name, block: parsed };
  });
}

const progress: ReviewProgress = {
  files: [],
  lenses: [],
  resolvedSelections: {
    [selectionKey({
      file: "order.ts",
      start: { side: "head", line: 1 },
      end: { side: "head", line: 1 },
    })]: [{ file: "order.ts", side: "head", fromLine: 1, toLine: 1 }],
  },
};

let canvas: ReturnType<typeof mountWhiteboard> | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
  document.body.replaceChildren();
});

const figure = () => document.querySelector<HTMLElement>(".animation-block");

const alertText = () =>
  figure()?.querySelector("[role='alert']")?.textContent ?? null;

const button = (name: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(".animation-block button"),
  ].find(
    (item) =>
      item.textContent === name || item.getAttribute("aria-label") === name,
  );

const scenarioOptions = () => [
  ...document.querySelectorAll<HTMLElement>(
    ".animation-block [role='group'][aria-label='Scenario'] button",
  ),
];

describe("reference diagrams", () => {
  const references = readReferences();

  for (const { name, block } of references)
    it(`${name} runs clean through every step`, async () => {
      const snapshot: Snapshot = {
        reviewId: `reference-${name}`,
        version: 0,
        title: name,
        pins,
        target: { kind: "commits", ...pins },
        document: [block],
        createdAt: "2026-11-01T00:00:00.000Z",
      };

      const container = document.createElement("div");
      container.style.cssText = `width: ${import.meta.env.VITE_ANIMATION_WIDTH ?? 860}px; margin: 0 auto;`;
      document.body.append(container);

      await act(async () => {
        canvas = mountWhiteboard(
          container,
          loadFixture({
            snapshot,
            progress,
            commits: [],
            images: {},
            traces: {},
            maps: {},
          }),
        );
      });

      expect(
        await settled(
          () => figure()?.hasAttribute("data-stage-ran") === true,
          10_000,
        ),
      ).toBe(true);

      const check = async (shot: string) => {
        // Moves settle and charts draw a moment after a step.
        await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
        expect(alertText()).toBeNull();
        expect(figure()?.dataset.findings ?? "").toBe("");

        if (shots)
          await page.screenshot({
            element: figure()!,
            path: `__screenshots__/references/${name}/${shot}.png`,
          });
      };

      const steps = block.frames?.length ?? 0;
      const scenarios = scenarioOptions();

      for (const [index, option] of (scenarios.length
        ? scenarios
        : [null]
      ).entries()) {
        if (option) await act(async () => option.click());
        await check(`${index}-0`);

        for (let step = 1; step < steps; step++) {
          // The name after the one showing, under the player's track.
          const next = document.querySelector(
            ".animation-block [aria-current='step']",
          )?.nextElementSibling;

          if (!(next instanceof HTMLButtonElement)) break;
          await act(async () => next.click());
          await check(`${index}-${step}`);
        }
      }

      // A played diagram plays to its end: Play turns to Replay. One with
      // steps has no Play-to-Replay end without a timeline; it plays on.
      const played =
        !block.timeline ||
        (await act(async () => button("Play")!.click()),
        await settled(() => button("Replay") !== undefined, 10_000));

      expect(played).toBe(true);
      await check("played");
    });
});
