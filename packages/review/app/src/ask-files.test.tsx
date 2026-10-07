// @vitest-environment jsdom
import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
import type { AskEntry, AskThreadState } from "@review/ask/thread-state";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { AskFilesProvider } from "./ask-files";
import { AskAgentTurn } from "./ask-turn";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";

type AgentEntry = Exclude<AskEntry, { kind: "user" }>;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("links the files an answer names to the Source window, once the checkout has them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const post = vi.fn<ReviewCanvasBridge["post"]>(async () => ({ ok: true }));
  const session = testReviewSession({}, { post });

  vi.spyOn(session, "fetch").mockImplementation(async (endpoint) =>
    endpoint === "/ask/thread/files"
      ? Response.json({
          files: [
            {
              path: "src/extension.ts",
              file: "extensions/review-files/src/extension.ts",
            },
            {
              path: "dist/extension.js",
              file: "extensions/review-files/dist/extension.js",
            },
          ],
        })
      : Response.json({}, { status: 404 }),
  );

  const entries: AgentEntry[] = [
    {
      kind: "agent",
      id: "answer",
      text: "Runs `esbuild.mts`, bundling `src/extension.ts:12` into [the bundle](dist/extension.js) with `pnpm build`.",
    },
  ];

  const thread: AskThreadState = {
    id: "thread",
    agent: "codex",
    agentName: "Codex",
    status: "idle",
    readOnly: true,
    bypass: false,
    head: "7fd03b8e2",
    cwd: "/checkouts/whiteboard",
    selection: { title: "review-files extension" },
    entries,
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () =>
    root.render(
      <ReviewSessionProvider session={session}>
        <AskFilesProvider threadId="thread">
          <AskAgentTurn
            thread={thread}
            entries={entries}
            renderPermission={() => null}
          />
        </AskFilesProvider>
      </ReviewSessionProvider>,
    ),
  );

  const links = [...container.querySelectorAll<HTMLElement>('[role="link"]')];

  // The checkout has no esbuild.mts it can be sure of, so it stays code.
  expect(links.map((link) => link.textContent)).toEqual([
    "src/extension.ts:12",
    "the bundle",
  ]);
  expect(container.textContent).toContain("esbuild.mts");

  await act(async () => links[0]!.click());
  expect(post).toHaveBeenCalledWith({
    name: "reveal",
    args: {
      path: "extensions/review-files/src/extension.ts",
      startLine: 12,
      endLine: 12,
      side: "head",
      highlight: true,
      preserveFocus: false,
    },
  });

  // From the keyboard, Enter opens it as it would any link.
  links[1]!.focus();
  await act(async () =>
    links[1]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(post).toHaveBeenLastCalledWith({
    name: "reveal",
    args: {
      path: "extensions/review-files/dist/extension.js",
      startLine: 1,
      endLine: 1,
      side: "head",
      highlight: false,
      preserveFocus: false,
    },
  });

  await act(async () => root.unmount());
});

it("shows the files an answer names as text where Source windows are unavailable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const post = vi.fn<ReviewCanvasBridge["post"]>(async () => ({ ok: true }));
  const session = testReviewSession({}, { post });
  const fetch = vi.spyOn(session, "fetch");

  session.review!.available = {
    sourceWindows: false,
    languageFeatures: false,
  };

  const entries: AgentEntry[] = [
    { kind: "agent", id: "answer", text: "See `src/f.ts:12`." },
  ];

  const thread: AskThreadState = {
    id: "thread",
    agent: "codex",
    agentName: "Codex",
    status: "idle",
    readOnly: true,
    bypass: false,
    head: "7fd03b8e2",
    cwd: "/checkouts/whiteboard",
    selection: { title: "remote review" },
    entries,
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () =>
    root.render(
      <ReviewSessionProvider session={session}>
        <AskFilesProvider threadId="thread">
          <AskAgentTurn
            thread={thread}
            entries={entries}
            renderPermission={() => null}
          />
        </AskFilesProvider>
      </ReviewSessionProvider>,
    ),
  );

  const code = [...container.querySelectorAll("code")].find(
    (element) => element.textContent === "src/f.ts:12",
  )!;

  expect(code.title).toBe(
    "Source windows are not available for a review on another machine.",
  );
  expect(container.querySelector('[role="link"], a, button')).toBeNull();

  await act(async () => code.click());
  expect(fetch).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();

  await act(async () => root.unmount());
});
