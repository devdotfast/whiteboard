import { AgentSelectionProvider } from "@canvas/agent-selection";
import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { ReviewDebugSettingsProvider } from "@canvas/debug-settings";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { ReviewPanelProvider } from "@canvas/review-panel";
import {
  testApiDocumentData,
  testReviewSession,
} from "@canvas/review-session-test-utils";
import { ReviewApiClient } from "@review/review-api/client";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { cdp, userEvent } from "vitest/browser";

import { BoardEditor, BoardEditorHostContext } from "./BoardEditor";

const client = new ReviewApiClient(
  { serverUrl: "http://review.test", token: "t" },
  async () => Response.json({}),
);

const host = { client, setHeadings: () => {} };

it("offers whole-block reference actions for the editor selection, and clears both on Escape or deletion", async () => {
  const page = document.createElement("div");
  page.className = "review-canvas-root review-document";
  document.body.append(page);
  const root = createRoot(page);

  const data = testApiDocumentData([
    {
      id: "code",
      type: "code",
      language: "ts",
      text: "run();",
      caption: "Start the job",
    },
    { id: "after", type: "markdown", markdown: "After.\n" },
    {
      id: "design",
      type: "section",
      title: "Design",
      children: [
        {
          id: "flow",
          type: "flow_diagram",
          title: "Selection gesture",
          nodes: [
            {
              id: "a",
              type: "flow_node",
              key: "a",
              label: "Choose block",
              attachments: [],
            },
            {
              id: "b",
              type: "flow_node",
              key: "b",
              label: "Keep selection",
              attachments: [],
            },
          ],
          edges: [
            { id: "ab", type: "flow_edge", from: "a", to: "b", style: "solid" },
          ],
          direction: "right",
        },
      ],
    },
  ]);

  const session = testReviewSession({ reviewId: data.snapshot.reviewId });

  const listeners = new Set<Parameters<typeof session.surface.subscribe>[0]>();

  vi.spyOn(session.surface, "subscribe").mockImplementation((listener) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  });

  const request = vi
    .spyOn(session, "fetch")
    .mockImplementation(async () =>
      Response.json({ text: "Selected block: run();" }),
    );

  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

  try {
    await act(async () =>
      root.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <ReviewDebugSettingsProvider>
              <ReviewPanelProvider>
                <AgentSelectionProvider revision="v1">
                  <BoardEditorHostContext.Provider value={host}>
                    <BoardEditor data={data} softwareMapEnabled={false} />
                  </BoardEditorHostContext.Provider>
                </AgentSelectionProvider>
              </ReviewPanelProvider>
            </ReviewDebugSettingsProvider>
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );

    const block = await vi.waitFor(() => {
      const element = page.querySelector<HTMLElement>(".review-board-atom");

      if (!element) throw new Error("No block");

      return element;
    });

    const copy = () =>
      page.querySelector<HTMLButtonElement>('[aria-label="Copy ref"]');

    const heading = page.querySelector<HTMLElement>("h2")!;

    const pane = await vi.waitFor(
      () => {
        const found = page.querySelector<HTMLElement>(".react-flow__pane");

        if (!found) throw new Error("No diagram pane");

        return found;
      },
      { timeout: 10_000 },
    );

    const input = cdp();

    for (const distance of [0, 1, 30]) {
      await userEvent.click(heading);
      pane.scrollIntoView();
      expect(document.activeElement).toBe(page.querySelector(".ProseMirror"));
      const rect = pane.getBoundingClientRect();
      const frame = window.frameElement?.getBoundingClientRect();

      const point = {
        x: rect.left + (frame?.left ?? 0) + 30,
        y: rect.top + (frame?.top ?? 0) + 30,
      };

      await input.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...point,
      });
      await input.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...point,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      await input.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...point,
        x: point.x + distance,
        button: "left",
        buttons: 1,
      });

      if (distance > 4)
        await input.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...point,
          button: "left",
          buttons: 1,
        });
      await new Promise((resolve) => setTimeout(resolve, 80));
      await input.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...point,
        x: point.x + (distance > 4 ? 0 : distance),
        button: "left",
        clickCount: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 30));
      await vi.waitFor(() =>
        expect(
          Boolean(
            page.querySelector(
              '[data-board-selected] [data-review-node-id="flow"]',
            ),
          ),
        ).toBe(distance <= 4),
      );
      expect(Boolean(copy())).toBe(distance <= 4);
      await userEvent.keyboard("{Escape}");
    }

    const disclosure = document.createElement("button");
    disclosure.setAttribute("aria-expanded", "true");
    disclosure.textContent = "Collapse file";
    const toggle = vi.fn<() => void>();
    disclosure.addEventListener("click", toggle);
    block.append(disclosure);
    await userEvent.click(disclosure);
    expect(toggle).toHaveBeenCalledOnce();
    expect(page.querySelector("[data-board-selected]")).toBeNull();
    expect(copy()).toBeNull();
    disclosure.remove();

    await userEvent.click(block);
    await vi.waitFor(() => expect(copy()).not.toBeNull());
    expect(page.querySelector("[data-board-selected]")).not.toBeNull();
    await userEvent.click(copy()!);
    expect(JSON.parse(String(request.mock.lastCall?.[1]?.body))).toMatchObject({
      target: { kind: "block", blockId: "code" },
      title: "Start the job",
    });
    expect(write).toHaveBeenCalledWith("Selected block: run();");
    await userEvent.click(block);
    await vi.waitFor(() => expect(copy()).not.toBeNull());
    block.scrollIntoView();
    const bounds = block.getBoundingClientRect();
    const frame = window.frameElement?.getBoundingClientRect();

    const point = {
      x: bounds.left + (frame?.left ?? 0) + 10,
      y: bounds.top + (frame?.top ?? 0) + 10,
    };

    await input.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await act(async () => {
      for (const report of listeners)
        report({
          event: "editorSelectionChanged",
          reviewId: session.reviewId,
          path: "job.ts",
          sideContext: "head",
          isEmpty: true,
          range: { fromLine: 1, toLine: 1 },
        });
    });
    expect(page.querySelector("[data-board-selected]")).not.toBeNull();
    expect(copy()).not.toBeNull();
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
      x: point.x + 1,
      button: "left",
      buttons: 1,
    });
    expect(page.querySelector("[data-board-selected]")).not.toBeNull();
    expect(copy()).not.toBeNull();
    await act(async () => {
      for (const report of listeners)
        report({
          event: "editorSelectionChanged",
          reviewId: session.reviewId,
          path: "job.ts",
          sideContext: "head",
          isEmpty: false,
          range: { fromLine: 1, toLine: 2 },
        });
    });
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      x: point.x + 1,
      button: "left",
      clickCount: 1,
    });
    await vi.waitFor(() => expect(copy()).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(page.querySelector("[data-board-selected]")).toBeNull();
    expect(copy()).not.toBeNull();
    await userEvent.click(copy()!);
    expect(JSON.parse(String(request.mock.lastCall?.[1]?.body))).toMatchObject({
      target: { kind: "code", path: "job.ts", startLine: 1, endLine: 2 },
    });
    await act(async () => {
      for (const report of listeners)
        report({
          event: "editorSelectionChanged",
          reviewId: session.reviewId,
          path: "job.ts",
          sideContext: "head",
          isEmpty: true,
          range: { fromLine: 1, toLine: 1 },
        });
    });
    expect(copy()).toBeNull();
    await userEvent.click(block);
    await vi.waitFor(() => expect(copy()).not.toBeNull());
    await userEvent.click(heading);
    expect(copy()).toBeNull();
    expect(page.querySelector("[data-board-selected]")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(copy()).toBeNull();
    expect(page.querySelector("[data-board-selected]")).toBeNull();
    await userEvent.click(block);
    await vi.waitFor(() => expect(copy()).not.toBeNull());
    copy()!.focus();
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(page.querySelector(".ProseMirror"));
    await userEvent.click(block);
    await vi.waitFor(() => expect(copy()).not.toBeNull());
    page.querySelector<HTMLElement>(".ProseMirror")!.focus();
    await userEvent.keyboard("{Backspace}");
    await vi.waitFor(() =>
      expect(page.querySelector("[data-review-node-id=code]")).toBeNull(),
    );
    expect(copy()).toBeNull();

    const undo = /Mac|iPhone|iPad/.test(navigator.platform)
      ? "{Meta>}z{/Meta}"
      : "{Control>}z{/Control}";

    await userEvent.keyboard(undo);
    await vi.waitFor(() =>
      expect(page.querySelector("[data-review-node-id=code]")).not.toBeNull(),
    );
  } finally {
    await act(async () => root.unmount());
    page.remove();
    request.mockRestore();
    write.mockRestore();
  }
});
