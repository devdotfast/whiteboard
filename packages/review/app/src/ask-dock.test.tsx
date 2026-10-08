// @vitest-environment jsdom
import type { ReviewAskState } from "@dev.fast/review-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { AskDesktopSync } from "./ask-dock";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewPanelProvider } from "./review-panel";
import { testReviewSession } from "./review-session-test-utils";

const selection = {
  title: "Startup",
  target: { kind: "text", quote: "start();" },
} as const;

const saved = (threadId: string) =>
  ({ type: "saved", threadId, selection, agent: "claude" }) as const;

it("tells Desktop about every thread on screen, the floating one too", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const reports: ReviewAskState[] = [];

  const session = testReviewSession(
    {},
    { reportAsk: (state) => void reports.push(state) },
  );

  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewPanelProvider
            restore={() => ({
              asks: {
                asks: [
                  { key: 0, view: saved("floating") },
                  { key: 1, view: saved("docked") },
                ],
                askColumn: 1,
                askWindow: 0,
                askAnchor: null,
                askSize: null,
              },
            })}
          >
            <AskDesktopSync />
          </ReviewPanelProvider>
        </ReviewSessionProvider>,
      ),
    );

    expect(reports.at(-1)?.threadIds).toEqual(["docked", "floating"]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
