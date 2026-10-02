import { ReviewDebugSettingsProvider } from "@canvas/debug-settings";
import { settled } from "@canvas/fixture-review-bridge";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { testReviewSession } from "@canvas/review-session-test-utils";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { defineSoftwareModel } from "./model";
import { SoftwareMap } from "./SoftwareMap";

let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

const range = [{ file: "src/orders.ts", fromLine: 1, toLine: 1 }];

const model = defineSoftwareModel({
  systems: {
    shop: {
      containers: {
        app: {
          components: {
            orders: { codeElements: { create: { sourceRanges: range } } },
            billing: { codeElements: { charge: { sourceRanges: range } } },
          },
        },
      },
    },
  },
});

const selectedNodeIds = (container: HTMLElement) =>
  container
    .querySelectorAll<HTMLElement>(".react-flow__node")
    .values()
    .filter(
      (node) =>
        node.matches("[data-selected]") ||
        node.querySelector("[data-selected]"),
    )
    .map((node) => node.dataset.id)
    .toArray();

it("selects the element a focus request asks for when it mounts the map", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const handled = vi.fn<(requestId: number) => void>();

  await act(async () =>
    root?.render(
      <ReviewSessionProvider session={testReviewSession()}>
        <ReviewDebugSettingsProvider>
          <SoftwareMap
            model={model}
            pinnedData={{
              side: "head",
              counts: new Map(),
              unmappedByElementPath: new Map(),
            }}
            focusRequest={{
              requestId: 1,
              elementPath: "shop.app.orders.create",
            }}
            onFocusRequestHandled={handled}
            height={600}
          />
        </ReviewDebugSettingsProvider>
      </ReviewSessionProvider>,
    ),
  );

  await settled(
    () =>
      handled.mock.calls.length > 0 && selectedNodeIds(container).length > 0,
  );
  await act(async () => {});

  expect(selectedNodeIds(container)).toEqual(["shop.app.orders.create"]);
  expect(handled).toHaveBeenCalledWith(1);
});
