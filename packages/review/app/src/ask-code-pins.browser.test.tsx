import type {
  ReviewAskMark,
  ReviewAskPinMount,
  ReviewDiffViewHandle,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { AskCodePins } from "./ask-code-pins";
import { AskHistoryProvider } from "./ask-history";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewPanelProvider, useReviewPanel } from "./review-panel";
import { testReviewSession } from "./review-session-test-utils";

import "./styles.css";

const about = (
  id: string,
  line: number,
  { agent = "claude", commit }: { agent?: string; commit?: string } = {},
) => ({
  id,
  agent,
  title: `Question ${id}`,
  selection: {
    title: `src/a.ts:${line}–${line + 1}`,
    target: {
      kind: "code",
      path: "src/a.ts",
      side: "head",
      startLine: line,
      endLine: line + 1,
    },
    apiSource: { reviewId: "review", version: 1, commit },
  },
  version: 1,
  head: "7fd03b8e2",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
});

let view: unknown;

function Probe() {
  view = useReviewPanel(
    ({ asks, askDocked }) =>
      asks.find((ask) => ask.key === askDocked)?.view ?? null,
  );

  return null;
}

/** The host's side: the marks it was given, and its gutter nodes. */
function fakeView() {
  let marks: readonly ReviewAskMark[] = [];
  let mount: ReviewAskPinMount | undefined;

  const handle: ReviewDiffViewHandle = {
    focus() {},
    dispose() {},
    onDidError: () => ({ dispose() {} }),
    setAskMarks(next, pin) {
      marks = next;
      mount = pin;
    },
  };

  return {
    handle,
    marks: () => marks,
    /** As the editor does when a mark's line comes into view. */
    show(id: string) {
      const node = document.createElement("div");
      document.body.append(node);
      let unmount = () => {};

      act(() => {
        unmount = mount!(id, node);
      });

      return {
        node,
        hide: () => act(() => unmount()),
      };
    },
  };
}

async function render(commit?: string) {
  const session = testReviewSession();

  vi.spyOn(session, "fetch").mockImplementation(async () =>
    Response.json({
      threads: [
        about("newest", 30, { agent: "pi" }),
        about("older", 30, { agent: "codex" }),
        about("alone", 50),
        about("in-commit", 30, { commit: "c0ffee" }),
      ],
    }),
  );

  const view = fakeView();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () =>
    root.render(
      <ReviewSessionProvider session={session}>
        <ReviewPanelProvider>
          <AskHistoryProvider>
            <AskCodePins handle={view.handle} commit={commit} />
            <Probe />
          </AskHistoryProvider>
        </ReviewPanelProvider>
      </ReviewSessionProvider>,
    ),
  );
  await vi.waitFor(() => expect(view.marks().length).toBeGreaterThan(0));

  return { view, unmount: () => act(async () => root.unmount()) };
}

it("gives the host one mark per asked-about lines, and pins the conversations about them in its gutter", async () => {
  const { view: diff, unmount } = await render();

  // The commit's conversation is about that commit's lines, not the review's.
  expect(diff.marks()).toEqual([
    expect.objectContaining({
      file: "src/a.ts",
      side: "head",
      fromLine: 30,
      toLine: 31,
    }),
    expect.objectContaining({ fromLine: 50, toLine: 51 }),
  ]);

  const [several, one] = diff.marks();
  const shown = diff.show(several!.id);
  const pin = () => shown.node.querySelector("button");

  await vi.waitFor(() => expect(pin()).not.toBeNull());
  await act(async () => pin()!.click());
  expect(view).toMatchObject({
    type: "history",
    passage: { threadIds: ["newest", "older"] },
  });

  const alone = diff.show(one!.id);
  await vi.waitFor(() =>
    expect(alone.node.querySelector("button")).not.toBeNull(),
  );
  await act(async () => alone.node.querySelector("button")!.click());
  expect(view).toMatchObject({ type: "saved", threadId: "alone" });

  // Scrolled away: the editor takes its node back.
  await shown.hide();
  expect(pin()).toBeNull();

  await unmount();
});

it("marks only that commit's conversations in a commit's diff", async () => {
  const { view: diff, unmount } = await render("c0ffee");

  expect(diff.marks()).toEqual([
    expect.objectContaining({ fromLine: 30, toLine: 31 }),
  ]);

  await unmount();
});
