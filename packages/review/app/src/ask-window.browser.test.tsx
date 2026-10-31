import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { AskDock } from "./ask-dock";
import { AskSlot, AskWindow } from "./ask-window";
import { ReviewDebugSettingsProvider } from "./debug-settings";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewPanelProvider } from "./review-panel";
import { testReviewSession } from "./review-session-test-utils";

// A conversation whose thread scrolls, as Ask's does.
function conversation() {
  const node = document.createElement("div");
  const thread = document.createElement("div");
  const content = document.createElement("div");

  thread.style.height = "200px";
  thread.style.overflowY = "auto";
  content.style.height = "2000px";
  thread.append(content);
  node.append(thread);

  return { node, thread };
}

async function slotted(node: HTMLElement) {
  const container = document.createElement("div");

  container.style.height = "200px";
  container.style.display = "flex";
  document.body.append(container);

  const root = createRoot(container);

  const show = (shown: boolean) =>
    act(async () => root.render(shown ? <AskSlot node={node} /> : null));

  await show(true);

  return {
    show,
    async done() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("reopens a minimized Ask where it was read", async () => {
  const { node, thread } = conversation();
  const slot = await slotted(node);

  thread.scrollTop = 700;

  // Minimized, then reopened.
  await slot.show(false);
  await slot.show(true);

  expect(thread.scrollTop).toBe(700);
  await slot.done();
});

it("reopens a minimized Ask at its latest when it was there", async () => {
  const { node, thread } = conversation();
  const slot = await slotted(node);

  thread.scrollTop = thread.scrollHeight;
  await slot.show(false);
  await slot.show(true);

  expect(thread.scrollHeight - thread.scrollTop - thread.clientHeight).toBe(0);
  await slot.done();
});

it.each(["docked", "floating"])(
  "selects conversation text in a %s Ask outside the canvas host",
  async (placement) => {
    const container = document.createElement("div");
    const host = document.createElement("div");
    const node = document.createElement("div");
    const message = document.createElement("p");
    const root = createRoot(container);
    const previous = document.body.style.userSelect;

    document.body.style.userSelect = "none";
    message.textContent = "Selectable";
    node.append(message);
    document.body.append(container, host);

    try {
      const content = <AskSlot node={node} />;

      await act(async () =>
        root.render(
          <ReviewSessionProvider session={testReviewSession()}>
            <ReviewDebugSettingsProvider>
              <ReviewPanelProvider>
                {placement === "docked" ? (
                  <AskDock host={host}>{content}</AskDock>
                ) : (
                  <AskWindow
                    askKey={0}
                    actions={null}
                    onHide={() => {}}
                    onClose={() => {}}
                    onEscape={() => {}}
                  >
                    {content}
                  </AskWindow>
                )}
              </ReviewPanelProvider>
            </ReviewDebugSettingsProvider>
          </ReviewSessionProvider>,
        ),
      );

      await userEvent.dblClick(message, { position: { x: 10, y: 8 } });

      expect(document.getSelection()?.toString()).toBe("Selectable");
    } finally {
      document.getSelection()?.removeAllRanges();
      document.body.style.userSelect = previous;
      await act(async () => root.unmount());
      container.remove();
      host.remove();
    }
  },
);
