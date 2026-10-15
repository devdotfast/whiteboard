import type {
  ReviewApiSummary,
  ReviewCanvasHandle,
  ReviewCanvasHomeHost,
  ReviewCanvasSetupActions,
  ReviewOnboardingTarget,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { testCanvasUi } from "./canvas-ui-test-utils";
import { mountReviewCanvas } from "./desktop-entry";

const SERVER = "http://127.0.0.1:4000";

const PROJECT = { path: "/repo/main", name: "main" };

function summary(
  title: string,
  extra: Partial<ReviewApiSummary> = {},
): ReviewApiSummary {
  return {
    reviewId: title,
    title,
    version: 1,
    repositoryName: "whiteboard",
    repositoryGroup: { key: "whiteboard", label: "whiteboard" },
    repositoryPath: PROJECT.path,
    createdAt: "2026-10-10T12:00:00Z",
    viewedAt: null,
    trashedAt: null,
    ...extra,
  };
}

/** The desktop server's onboarding routes, counting each one asked. */
function server() {
  const requests: string[] = [];

  const targets: ReviewOnboardingTarget[] = [
    { kind: "branch", path: PROJECT.path, branch: "feature" },
    { kind: "worktree", path: "/repo/agent", branch: "agent-work" },
  ];

  const respond = vi.fn<typeof fetch>(async (input) => {
    const route = new URL(String(input)).pathname;

    requests.push(route);

    if (route === "/reviews-api/onboarding/projects")
      return Response.json({ projects: [PROJECT] });

    if (route === "/reviews-api/onboarding/agents")
      return Response.json({
        agents: [{ id: "claude", name: "Claude Code", available: true }],
      });

    if (route === "/reviews-api/onboarding/targets")
      return Response.json({ project: PROJECT, base: "main", targets });

    return Response.json({ error: "not found" }, { status: 404 });
  });

  return {
    respond,
    targets,
    count: (route: string) =>
      requests.filter((asked) => asked === route).length,
  };
}

function setupActions(): ReviewCanvasSetupActions {
  return {
    load: vi.fn<ReviewCanvasSetupActions["load"]>(),
    installCli: vi.fn<ReviewCanvasSetupActions["installCli"]>(async () => {}),
    connection: vi.fn<ReviewCanvasSetupActions["connection"]>(async () => ({
      serverUrl: SERVER,
      token: "token",
    })),
    pickFolder: vi.fn<ReviewCanvasSetupActions["pickFolder"]>(
      async () => undefined,
    ),
  };
}

describe("Home's New whiteboard", () => {
  let container: HTMLDivElement;
  let canvas: ReviewCanvasHandle | undefined;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(async () => {
    await act(async () => canvas?.dispose());
    canvas = undefined;
    container.remove();
    vi.unstubAllGlobals();
  });

  const settle = async () => {
    for (let pass = 0; pass < 10; pass++)
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  };

  const target = (branch: string) =>
    [...container.querySelectorAll('[role="radio"]')].find((row) =>
      row.textContent?.includes(branch),
    );

  async function openNewWhiteboard(reviews: ReviewApiSummary[]) {
    const host: ReviewCanvasHomeHost = {
      openReview: vi.fn(),
      setupActions: setupActions(),
    };

    await act(async () => {
      canvas = mountReviewCanvas(
        container,
        { kind: "home", data: { reviews }, host },
        testCanvasUi().ui,
      );
    });

    const create = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "New",
    );

    await act(async () => create?.click());
    await settle();

    return host;
  }

  it("keeps its list and choice while Home's reviews change", async () => {
    const { respond, count } = server();

    vi.stubGlobal("fetch", respond);

    const host = await openNewWhiteboard([summary("Plan")]);

    await act(async () => (target("agent-work") as HTMLElement).click());
    expect(target("agent-work")?.getAttribute("aria-checked")).toBe("true");

    // An agent saving a whiteboard pushes a new list with the same host.
    for (const version of [2, 3, 4])
      await act(async () =>
        canvas?.update({
          kind: "home",
          data: { reviews: [summary("Plan", { version })] },
          host,
        }),
      );
    await settle();

    expect(count("/reviews-api/onboarding/targets")).toBe(1);
    expect(target("agent-work")?.getAttribute("aria-checked")).toBe("true");
  });

  it("shows new worktrees on refresh, keeping the choice and prompt", async () => {
    const { respond, targets, count } = server();

    vi.stubGlobal("fetch", respond);

    await openNewWhiteboard([summary("Plan")]);

    await act(async () => (target("agent-work") as HTMLElement).click());

    const prompt = container.querySelector("textarea") as HTMLTextAreaElement;

    await userEvent.fill(prompt, "Walk me through the agent's change.");

    targets.push({ kind: "worktree", path: "/repo/later", branch: "later" });
    expect(target("later")).toBeUndefined();

    const refresh = container.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh branches, worktrees and PRs"]',
    );

    await act(async () => refresh?.click());
    await settle();

    expect(count("/reviews-api/onboarding/targets")).toBe(2);
    expect(target("later")).toBeDefined();
    expect(target("agent-work")?.getAttribute("aria-checked")).toBe("true");
    expect(prompt.value).toBe("Walk me through the agent's change.");
  });

  it("stays open when a whiteboard is published elsewhere", async () => {
    const { respond } = server();

    vi.stubGlobal("fetch", respond);

    const host = await openNewWhiteboard([summary("Plan")]);

    await act(async () =>
      canvas?.update({
        kind: "home",
        data: { reviews: [summary("Plan"), summary("Elsewhere")] },
        host,
      }),
    );
    await settle();

    expect(container.textContent).toContain("New whiteboard.");
  });
});
