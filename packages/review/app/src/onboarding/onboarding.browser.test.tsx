import type {
  ReviewCanvasInstallContent,
  ReviewCanvasSetupActions,
  ReviewCliInstallStatus,
  ReviewConnectResult,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Onboarding } from "./onboarding";

const SERVER = "http://127.0.0.1:4000";

/** The desktop server's answers, by method and path. */
function server(connect: (target: string) => ReviewConnectResult) {
  const requests: string[] = [];

  const respond = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const route = `${init?.method ?? "GET"} ${url.pathname}`;

    requests.push(route);

    if (route === "GET /install/agents")
      return Response.json({
        agents: [
          {
            target: "claude",
            name: "Claude Code",
            found: true,
            connected: false,
          },
          { target: "cursor", name: "Cursor", found: true, connected: false },
          { target: "codex", name: "Codex", found: false, connected: false },
        ],
      });

    if (route === "POST /install/connect") {
      const { target } = JSON.parse(String(init?.body));

      return Response.json(connect(target));
    }

    return Response.json({ error: "not found" }, { status: 404 });
  });

  return { requests, respond };
}

function setupActions(): ReviewCanvasSetupActions {
  const status: ReviewCliInstallStatus = {
    fingerprint: "test",
    stamp: null,
    stale: false,
    updateNeeded: false,
    shim: {
      path: "/home/me/.local/bin/whiteboard",
      installed: true,
      profileConfigured: true,
      onPath: true,
    },
    trace: {
      enabled: false,
      configured: false,
      autoActivateRepositories: false,
      envPath: "/tmp/env",
      settingsPath: "/tmp/settings",
    },
    cli: { path: "/tmp/cli.js", version: "0.0.1" },
    connect: {
      command: "sh",
      args: [],
      prompts: {
        claude: "prompt",
        codex: "prompt",
        cursor: "prompt",
        opencode: "prompt",
        pi: "prompt",
        omp: "prompt",
        copilot: "prompt",
      },
      plugins: {
        claude: { label: "plugin" },
        codex: { label: "plugin" },
        cursor: { label: "plugin" },
        opencode: { label: "plugin" },
        pi: { label: "plugin" },
        omp: { label: "plugin" },
        copilot: { label: "plugin" },
      },
    },
    legacySkills: [],
  };

  const same = async () => status;

  const ready: ReviewCanvasInstallContent = {
    status,
    apply: same,
    remove: same,
    removeLegacySkills: same,
    finishUpdate: same,
    decline: same,
    skip: same,
    enablePrompts: same,
  };

  return {
    load: vi.fn<ReviewCanvasSetupActions["load"]>(async () => ready),
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

describe("Onboarding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.startsWith(label),
    );

  const row = (name: string) =>
    [...container.querySelectorAll("[data-state]")].find((candidate) =>
      candidate.textContent?.includes(name),
    );

  const settle = async () => {
    for (let pass = 0; pass < 10; pass++)
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  };

  it("connects every agent it finds, and a pending approval does not block Continue", async () => {
    const { requests, respond } = server((target) => ({
      target: target === "cursor" ? "cursor" : "claude",
      state: target === "cursor" ? "approve" : "connected",
      output: "",
    }));

    vi.stubGlobal("fetch", respond);

    await act(async () =>
      root.render(
        <Onboarding setupActions={setupActions()} onSkip={() => {}} />,
      ),
    );
    expect(container.textContent).toContain(
      "Your codebase, explained by your agent.",
    );
    // Welcome installs nothing until the reader starts.
    expect(requests).toEqual([]);

    await act(async () => button("Get started")?.click());
    await settle();

    // Install lists the agents it found, then changes nothing until agreed to.
    expect(requests).toEqual(["GET /install/agents"]);
    expect(row("Claude Code")?.getAttribute("data-state")).toBe("waiting");

    await act(async () => button("Install")?.click());
    await settle();

    expect(requests).toEqual([
      "GET /install/agents",
      "POST /install/connect",
      "POST /install/connect",
    ]);
    expect(row("whiteboard command")?.getAttribute("data-state")).toBe("done");
    expect(row("Claude Code")?.getAttribute("data-state")).toBe("done");
    expect(row("Cursor")?.getAttribute("data-state")).toBe("approve");
    expect(row("Codex")).toBeUndefined();
    expect(container.textContent).toContain("Not on this machine · Codex");
    expect(container.textContent).toContain("Your agents know Whiteboard.");
    expect(button("Continue")?.disabled).toBe(false);
  });

  it("lets a failed agent be retried without holding up the rest", async () => {
    let attempts = 0;

    const { respond } = server((target) => {
      if (target === "claude") attempts++;

      return {
        target: target === "cursor" ? "cursor" : "claude",
        state: target === "cursor" || attempts > 1 ? "connected" : "failed",
        output: "network down",
      };
    });

    vi.stubGlobal("fetch", respond);

    await act(async () =>
      root.render(
        <Onboarding setupActions={setupActions()} onSkip={() => {}} />,
      ),
    );
    await act(async () => button("Get started")?.click());
    await settle();
    await act(async () => button("Install")?.click());
    await settle();

    expect(row("Claude Code")?.getAttribute("data-state")).toBe("failed");
    expect(row("Cursor")?.getAttribute("data-state")).toBe("done");
    expect(button("Continue")?.disabled).toBe(false);

    await act(async () => button("Retry")?.click());
    await settle();

    expect(row("Claude Code")?.getAttribute("data-state")).toBe("done");
  });
});
