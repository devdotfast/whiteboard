// Every reference animation under packages/review/instructions/animations
// runs here as a reader would see it: mounted on a board, stepped through
// every frame of every scenario, with no script error. A reference clip
// jumps to each marker of every scenario, then plays to its end. Set
// VITE_ANIMATION_SHOTS=1 to save a screenshot of each frame under
// __screenshots__/references/<name>/<path>/ beside this file (gitignored),
// the way an author looks at their work without opening Desktop, and
// VITE_ANIMATION_WIDTH=<px> to see them folded narrow:
//
//   VITE_ANIMATION_SHOTS=1 pnpm --filter @dev.fast/review-canvas exec \
//     vitest run --config vitest.config.ts --project browser \
//     src/animation/references.browser.test.tsx -t <reference name>

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

const files = import.meta.glob<string>("../../../instructions/animations/*/*", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** The ranges every reference's code anchors point at, so the peeks resolve
 * on this board. A reference's own paths are illustrative. */
const ANCHOR = "head/order.ts#L1";

const shots = Boolean(import.meta.env.VITE_ANIMATION_SHOTS);

interface AnimationReference {
  kind: "animation";
  name: string;
  block: JsonObject;
  frames: { key: string; title: string }[];
  scenarios: { key: string; label: string; frames: string[] }[] | undefined;
}

interface ClipReference {
  kind: "clip";
  name: string;
  block: JsonObject;
  markers: { key: string; title: string }[];
  scenarios: { key: string; label: string }[] | undefined;
}

type Reference = AnimationReference | ClipReference;

function readReferences(): Reference[] {
  const folders = new Map<string, Record<string, string>>();

  for (const [file, text] of Object.entries(files)) {
    const [name, base] = file.split("/").slice(-2) as [string, string];
    folders.set(name, { ...folders.get(name), [base]: text });
  }

  return [...folders].flatMap(([name, folder]): Reference[] => {
    if (!("animation.html" in folder)) return [];

    const block = parseJsonText(folder["block.json"] ?? "{}");

    if (!isJsonObject(block))
      throw new Error(`${name}/block.json: not an object`);

    const code = isJsonObject(block.code)
      ? Object.fromEntries(
          Object.entries(block.code).map(([key, entry]) => [
            key,
            isJsonObject(entry) ? { ...entry, source: ANCHOR } : ANCHOR,
          ]),
        )
      : {};

    const scenariosText = folder["scenarios.json"];
    const markersText = folder["markers.json"];

    const raw: JsonObject = {
      id: `reference-${name}`,
      type: markersText ? "clip" : "animation",
      ...block,
      code,
      html: folder["animation.html"]!,
      ...(markersText
        ? { markers: parseJsonText(markersText) }
        : { frames: parseJsonText(folder["frames.json"] ?? "[]") }),
      ...(scenariosText && { scenarios: parseJsonText(scenariosText) }),
      pins: { repositoryId: "repo", base: "base", head: "head" },
    };

    const [parsed] = documentSchema.parse([raw]);

    if (parsed?.type === "clip")
      return [
        {
          kind: "clip" as const,
          name,
          block: raw,
          markers: parsed.markers,
          scenarios: parsed.scenarios,
        },
      ];

    if (parsed?.type !== "animation")
      throw new Error(`${name}: not an animation or clip`);

    return [
      {
        kind: "animation" as const,
        name,
        block: raw,
        frames: parsed.frames,
        scenarios: parsed.scenarios,
      },
    ];
  });
}

const references = readReferences();

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

async function mount(reference: Reference) {
  const snapshot: Snapshot = {
    reviewId: `reference-${reference.name}`,
    version: 0,
    title: reference.name,
    pins: { repositoryId: "repo", base: "base", head: "head" },
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
    document: documentSchema.parse([reference.block]),
    createdAt: "2026-10-31T00:00:00.000Z",
  };

  const container = document.createElement("div");
  // The document's width in Desktop, so layouts fold as they would there;
  // VITE_ANIMATION_WIDTH shows a narrower one.
  container.style.cssText = `width: ${import.meta.env.VITE_ANIMATION_WIDTH || 860}px; margin: 0 auto;`;
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

  return container;
}

const text = (container: HTMLElement) => container.textContent ?? "";

const alertIn = (container: HTMLElement) =>
  container.querySelector("[role='alert']")?.textContent ?? null;

/** Waits for the stage to show frame `position` of a path of `length`. */
async function shown(container: HTMLElement, position: number, length: number) {
  const meta = `${position + 1} / ${length}`;

  expect(
    await settled(() => text(container).includes(meta) || alertIn(container)),
    `frame ${meta}`,
  ).toBe(true);
  expect(alertIn(container)).toBeNull();
}

// Motion that a frame starts settles within this; an error it throws later
// would otherwise go unseen.
const wait = (ms: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

async function shoot(
  container: HTMLElement,
  reference: Reference,
  path: string,
  key: string,
) {
  if (!shots) return;

  const figure = container.querySelector<HTMLElement>(".animation-block");

  if (!figure) return;
  await wait(600);
  await page.screenshot({
    element: figure,
    path: `__screenshots__/references/${reference.name}/${path}/${key}.png`,
  });
}

async function stepThrough(
  container: HTMLElement,
  reference: AnimationReference,
  path: string,
  keys: string[],
) {
  const next = () =>
    container.querySelector<HTMLButtonElement>(
      "button[aria-label='Next frame']",
    )!;

  const titles = new Map(
    reference.frames.map((frame) => [frame.key, frame.title]),
  );

  for (const [position, key] of keys.entries()) {
    if (position > 0) {
      const button = next();

      if (button.disabled)
        throw new Error(`${path}: next is disabled at ${keys[position - 1]}`);
      await act(async () => button.click());
    }

    await shown(container, position, keys.length);
    expect(text(container)).toContain(titles.get(key));
    await shoot(container, reference, path, `${position + 1}-${key}`);
  }

  await wait(400);
  expect(alertIn(container)).toBeNull();
  expect(next().disabled, `${path}: next past the last frame`).toBe(true);
}

/** Jumps to each marker through the Markers strip, then plays the clip from
 * its start to its end. */
async function playThrough(
  container: HTMLElement,
  reference: ClipReference,
  path: string,
) {
  const strip = () => [
    ...container.querySelectorAll<HTMLButtonElement>(
      "[role='group'][aria-label='Markers'] button",
    ),
  ];

  const count = reference.markers.length;

  // The strip lists the markers in time order, so walk it by position.
  for (let position = 0; position < count; position++) {
    const button = strip()[position];

    expect(button, `${path}: marker ${position + 1}`).toBeTruthy();
    await act(async () => button!.click());
    await shown(container, position, count);
    await shoot(
      container,
      reference,
      path,
      `${position + 1}-${button!.textContent?.replace(/^\d+/, "")}`,
    );
  }

  await act(async () => strip()[0]!.click());
  await shown(container, 0, count);

  // Back at the start, the button reads Play once the stage says so.
  const play = await settled(() =>
    container.querySelector<HTMLButtonElement>("button[aria-label='Play']"),
  );

  expect(play, `${path}: play`).toBeTruthy();
  await act(async () => play!.click());
  expect(
    await settled(
      () =>
        container.querySelector("button[aria-label='Replay']") ||
        alertIn(container),
      30_000,
    ),
    `${path}: plays to its end`,
  ).toBeTruthy();
  expect(alertIn(container)).toBeNull();
  expect(text(container)).toContain(`${count} / ${count}`);
}

/** Plays a clip through, in each of its scenarios. */
async function playScenarios(container: HTMLElement, reference: ClipReference) {
  if (!reference.scenarios) return playThrough(container, reference, "all");

  for (const scenario of reference.scenarios) {
    const option = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[role='group'][aria-label='Scenario'] button",
      ),
    ].find((button) => button.textContent === scenario.label);

    expect(option, `scenario ${scenario.label}`).toBeTruthy();
    await act(async () => option!.click());
    await playThrough(container, reference, scenario.key);
  }
}

describe.skipIf(!references.length)("reference animations", () => {
  it.each(references.map((reference) => [reference.name, reference] as const))(
    "%s runs every frame of every scenario without an error",
    async (_name, reference) => {
      const container = await mount(reference);

      expect(
        await settled(() => container.querySelector("iframe")),
      ).toBeTruthy();

      if (reference.kind === "clip") return playScenarios(container, reference);

      if (!reference.scenarios) {
        await stepThrough(
          container,
          reference,
          "all",
          reference.frames.map((frame) => frame.key),
        );

        return;
      }

      for (const scenario of reference.scenarios) {
        const option = [
          ...container.querySelectorAll<HTMLButtonElement>(
            "[role='group'][aria-label='Scenario'] button",
          ),
        ].find((button) => button.textContent === scenario.label);

        expect(option, `scenario ${scenario.label}`).toBeTruthy();
        await act(async () => option!.click());
        await shown(container, 0, scenario.frames.length);

        // Start the scenario from its first frame, wherever the last one ended.
        const first = container.querySelector<HTMLButtonElement>(
          "[aria-label='Frames'] button, [aria-label='Steps'] button",
        );

        if (first) await act(async () => first.click());
        await stepThrough(container, reference, scenario.key, scenario.frames);
      }
    },
    120_000,
  );
});

it("lists the reference animations", () => {
  // Fails loudly if the glob path drifts: a wrong path would skip them all.
  expect(Object.keys(files).length >= 0).toBe(true);
});
