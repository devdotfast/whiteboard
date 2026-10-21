import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { libavoidWasmUrl, settled } from "./fixture-review-bridge";
import { share } from "./shared-board-test-utils";
import {
  type SharedBoardBundle,
  Whiteboard,
  createSourceViewer,
} from "./web-entry";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

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
