import type { JsonValue } from "@dev.fast/review-protocol";
import type { ShareManifest } from "@dev.fast/review-share-protocol";
import { assignFreshIds, documentSchema } from "@review/review-api/document";
import type { parseSharedSnapshot } from "@review/sharing/content";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { libavoidWasmUrl, settled } from "./fixture-review-bridge";
import {
  type SharedBoardBundle,
  Whiteboard,
  createSourceViewer,
} from "./web-entry";

const goldens = import.meta.glob<{ default: JsonValue }>(
  "./fixtures/saved-reviews/*.json",
  { eager: true },
);

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

/** A sealed share object: its JSON bytes, named by their digest. */
async function object(
  value: JsonValue | ReturnType<typeof parseSharedSnapshot>,
) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

  const id = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return { id, bytes };
}

/** A share of a saved review, as the sender's Desktop seals it. */
async function share(name: string): Promise<SharedBoardBundle> {
  // Authoring assigns ids before a board is shared.
  const document = documentSchema.parse(
    Object.entries(goldens).find(([key]) => key.endsWith(`/${name}.json`))![1]
      .default,
  );

  let nextId = 0;

  for (const block of document)
    assignFreshIds(block, (prefix) => `${prefix}-${++nextId}`);

  const snapshot = await object({
    reviewId: `shared-${name}`,
    version: 3,
    title: name,
    document,
    createdAt: "2026-10-20T00:00:00.000Z",
  });

  const presentation = await object({ maps: {} });

  const manifest: ShareManifest = {
    format: "review-share/1",
    reviewId: `shared-${name}`,
    version: 3,
    title: name,
    snapshot: snapshot.id,
    presentation: presentation.id,
    objects: [snapshot, presentation].map(({ id, bytes }) => ({
      id,
      sha256: id,
      size: bytes.byteLength,
    })),
    resources: [],
  };

  return {
    manifest,
    objects: new Map(
      [snapshot, presentation].map((item) => [item.id, item.bytes]),
    ),
  };
}

async function mount(board: SharedBoardBundle) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <Whiteboard share={board} wasmUrl={libavoidWasmUrl} theme="light" />,
    ),
  );

  return container;
}

it.each(["bug-report-dialog", "opencode-agentserver", "three-minute-tour"])(
  "renders the shared review %s read-only in a page",
  async (name) => {
    const container = await mount(await share(name));

    expect(
      await settled(() => container.querySelector("[data-review-node-id]")),
    ).not.toBeNull();
    expect(container.querySelector("[data-block-error]")).toBeNull();
    expect(container.textContent).not.toContain("Layout failed");
    expect(container.textContent).not.toContain("Not in this snapshot");
  },
);

it("settles code peeks as unavailable without the sender's checkout", async () => {
  const container = await mount(await share("three-minute-tour"));

  expect(
    await settled(() => container.textContent?.includes("Code unavailable")),
  ).toBe(true);
  expect(container.textContent).not.toContain("Loading code");
});

it("renders the document alone, without the app around it", async () => {
  const container = await mount(await share("three-minute-tour"));

  expect(
    await settled(() => container.querySelector("article.review-document")),
  ).not.toBeNull();
  // No app shell: its top bar, views and panels live in .review-app.
  expect(container.querySelector(".review-app")).toBeNull();
});

it("shows a quote's lines from the page's source", async () => {
  const text = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  const container = document.createElement("div");
  document.body.append(container);

  const viewer = createSourceViewer({
    readSource: async ({ path }) => {
      expect(path).toBe("src/orders/order-service.ts");

      return text.join("\n");
    },
  });

  const editor = await act(async () =>
    viewer.create({
      container,
      path: "src/orders/order-service.ts",
      title: "order-service.ts",
      side: "head",
      ranges: [{ startLine: 13, endLine: 29 }],
      heightMode: "content",
      active: false,
    }),
  );

  try {
    expect(
      await settled(() => container.textContent?.includes("line 29")),
    ).toBe(true);
    expect(container.textContent).toContain("line 13");
    expect(container.textContent).not.toContain("line 30");
    expect(await settled(() => editor.height)).toBeGreaterThan(0);
    expect(
      await editor.setFindQuery({
        text: "LINE 2",
        matchCase: false,
        wholeWord: false,
        isRegex: false,
      }),
    ).toEqual({ matchCount: 10 });
  } finally {
    await act(async () => editor.dispose());
    container.remove();
  }
});

it("reports a source it cannot read", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const errors: string[] = [];

  const editor = createSourceViewer({
    readSource: () => Promise.reject(new Error("No source text.")),
  }).create({
    container,
    path: "a.ts",
    title: "a.ts",
    side: "head",
    ranges: [{ startLine: 1, endLine: 2 }],
    heightMode: "capped",
    active: false,
  });

  editor.onDidError((message) => errors.push(message));

  try {
    expect(await settled(() => errors.length)).toBe(1);
    expect(errors).toEqual(["No source text."]);
  } finally {
    await act(async () => editor.dispose());
    container.remove();
  }
});
