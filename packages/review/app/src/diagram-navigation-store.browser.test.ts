import { beforeEach, expect, it } from "vitest";

import { createDatabaseLensStore } from "./database-lens-store";
import { createDiagramNavigationStore } from "./diagram-navigation-store";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it("restores graph selection and expansion after window storage is lost", () => {
  const first = createDiagramNavigationStore(
    "review-a:map",
    "model-a",
    new Set(["app"]),
  );

  first.getState().setSelectedNodeId("app.api");
  first.getState().setExpandedNodeIds(new Set(["app", "app.api"]));
  first.getState().setExpanded(true);
  sessionStorage.clear();

  const restored = createDiagramNavigationStore(
    "review-a:map",
    "model-a",
    new Set(),
  );

  expect(restored.getState()).toMatchObject({
    selectedNodeId: "app.api",
    expandedNodeIds: new Set(["app", "app.api"]),
    expanded: true,
    restored: true,
  });
  expect(
    createDiagramNavigationStore(
      "review-b:map",
      "model-a",
      new Set(),
    ).getState().selectedNodeId,
  ).toBeNull();
  expect(
    createDiagramNavigationStore(
      "review-a:map",
      "model-b",
      new Set(["new"]),
    ).getState(),
  ).toMatchObject({
    selectedNodeId: null,
    expandedNodeIds: new Set(["new"]),
    restored: false,
  });
});

it("retains database use-case choices independently and falls back when removed", () => {
  const cases = ["place-order", "read-order"];
  const first = createDatabaseLensStore("review:database", cases);
  first.getState().setActiveUseCaseId("read-order");
  expect(
    createDatabaseLensStore("review:database", cases).getState()
      .activeUseCaseId,
  ).toBe("read-order");
  expect(
    createDatabaseLensStore("review:database", ["place-order"]).getState()
      .activeUseCaseId,
  ).toBe("place-order");

  const place = createDiagramNavigationStore(
    "review:database:place-order",
    "place-order",
    new Set(["orders"]),
  );

  place.getState().setExpandedNodeIds(new Set());

  const read = createDiagramNavigationStore(
    "review:database:read-order",
    "read-order",
    new Set(["orders"]),
  );

  read.getState().setSelectedNodeId("orders.id");
  expect(
    createDiagramNavigationStore(
      "review:database:place-order",
      "place-order",
      new Set(["orders"]),
    ).getState().expandedNodeIds,
  ).toEqual(new Set());
  expect(
    createDiagramNavigationStore(
      "review:database:read-order",
      "read-order",
      new Set(),
    ).getState().selectedNodeId,
  ).toBe("orders.id");
});
