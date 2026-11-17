// A diagram drawn on its own, as a page that is not a board shows one: no
// WhiteboardProvider, no session, no review panel. Its code links and what
// its stage found leave through the callbacks it was given.

import { Diagram, type DiagramFindings } from "@canvas/diagram/diagram";
import { settled } from "@canvas/whiteboard-fixture";
import {
  type DiagramBlock,
  documentSchema,
} from "@dev.fast/whiteboard-document";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import "@canvas/styles.css";

const block = documentSchema.parse([
  {
    id: "diagram-1",
    type: "diagram",
    title: "Orders",
    description: "How an order reaches the store.",
    script: `
const app = wb.node({ id: "app", kind: "container", label: "App" });
const orders = wb.node({ id: "orders", kind: "container", label: "Orders", code: "status" });
wb.edge({ from: app, to: orders, label: "HTTPS" });
await wb.layout();
`,
    code: { status: { source: "head/order.ts#L1", label: "Status line" } },
    pins: { repositoryId: "repo", base: "base", head: "head" },
  },
])[0] as DiagramBlock;

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it("runs its stage and hands a code link's name to the page", async () => {
  const onCode = vi.fn<(name: string) => void>();
  const onFindings = vi.fn<(report: DiagramFindings) => void>();
  const container = document.createElement("div");
  container.style.width = "720px";
  document.body.append(container);

  await act(async () => {
    root = createRoot(container);
    root.render(
      <Diagram
        block={block}
        theme="dark"
        onCode={onCode}
        onFindings={onFindings}
      />,
    );
  });

  const stage = await settled(() =>
    container.querySelector<HTMLElement>(".animation-block[data-stage-ran]"),
  );

  expect(stage).toBeTruthy();
  expect(container.textContent).toContain("How an order reaches the store.");
  expect(await settled(() => onFindings.mock.calls.length > 0)).toBe(true);
  expect(onFindings.mock.lastCall?.[0]).toMatchObject({
    findings: expect.any(Array),
    notes: expect.any(Array),
  });

  await act(() =>
    page
      .frameLocator(page.elementLocator(stage!.querySelector("iframe")!))
      .getByRole("button", { name: "Orders: open its code" })
      .click(),
  );

  expect(await settled(() => onCode.mock.calls.length > 0)).toBe(true);
  expect(onCode).toHaveBeenCalledWith("status");
});
