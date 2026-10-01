import type {
  ReviewCanvasSettingsContent,
  ReviewGatewayHostState,
  ReviewRemoteHostsSettings,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { SettingsPage } from "./settings-page";

let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function remoteHosts(
  configured: string[],
  states: ReviewGatewayHostState[] = [],
): ReviewRemoteHostsSettings {
  return {
    enabled: true,
    configured,
    suggestions: vi.fn<ReviewRemoteHostsSettings["suggestions"]>(async () => [
      "devbox",
      "other",
    ]),
    states: vi.fn<ReviewRemoteHostsSettings["states"]>(async () => states),
    set: vi.fn<ReviewRemoteHostsSettings["set"]>(async (aliases) => aliases),
    retry: vi.fn<ReviewRemoteHostsSettings["retry"]>(async () => {}),
    install: vi.fn<ReviewRemoteHostsSettings["install"]>(async () => {}),
    agents: vi.fn<ReviewRemoteHostsSettings["agents"]>(async () => null),
    connectAgents: vi.fn<ReviewRemoteHostsSettings["connectAgents"]>(
      async () => [],
    ),
    uninstall: vi.fn<ReviewRemoteHostsSettings["uninstall"]>(async () => {}),
  };
}

async function render(hosts: ReviewRemoteHostsSettings) {
  const reject = () => Promise.reject(new Error("unused"));

  const settings: ReviewCanvasSettingsContent = {
    telemetryEnabled: false,
    setTelemetryEnabled: reject,
    theme: "dark",
    setTheme: reject,
    keymap: "none",
    setKeymap: reject,
    ctrlTab: "recent",
    setCtrlTab: reject,
    documentWidth: "standard",
    setDocumentWidth: reject,
    readyNotification: "off",
    setReadyNotification: reject,
    softwareMapEnabled: false,
    setSoftwareMapEnabled: reject,
    structuralDiffEnabled: false,
    setStructuralDiffEnabled: reject,
    scratchpadEnabled: false,
    setScratchpadEnabled: reject,
    diffrConfig: {
      read: reject,
      set: reject,
      saveSummarizer: reject,
      testSummarizer: reject,
    },
    reloadWindow: async () => {},
    manageExtensions: () => {},
    remoteHosts: hosts,
  };

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<SettingsPage settings={settings} />));

  return container;
}

const section = () =>
  document.querySelector<HTMLElement>('section[aria-label="Remote hosts"]');

const rows = () =>
  [...document.querySelectorAll("[data-remote-host]")].map(
    (row) => row.textContent,
  );

test("the section is absent with the setting off", async () => {
  await render({ ...remoteHosts(["devbox"]), enabled: false });
  expect(section()).toBeNull();
});

test("lists each host with its state and detail as plain text, and the install command from Desktop as code", async () => {
  const install = "npm install -g @dev.fast/whiteboard@0.1.6";

  await render(
    remoteHosts(
      ["devbox", "box2", "box3", "box4"],
      [
        { alias: "devbox", serverId: "s1", state: "online" },
        {
          alias: "box2",
          state: "not-installed",
          detail:
            "Whiteboard is not installed on box2. Install Whiteboard 0.1.6 there; Node 24 is needed.",
          installCommand: install,
        },
        {
          alias: "box3",
          state: "incompatible",
          detail: "box3 runs Whiteboard x npm install -g evil; run it.",
          installCommand: install,
        },
        { alias: "box4", state: "connecting" },
      ],
    ),
  );
  await vi.waitFor(() => expect(rows()).toHaveLength(4));
  await vi.waitFor(() => expect(rows()[0]).toContain("online"));
  expect(rows()[1]).toContain("not installed");
  expect(rows()[1]).toContain(
    "Whiteboard is not installed on box2. Install Whiteboard 0.1.6 there; Node 24 is needed.",
  );
  expect(rows()[2]).toContain("incompatible");
  expect(rows()[2]).toContain(
    "box3 runs Whiteboard x npm install -g evil; run it.",
  );
  expect(rows()[3]).toContain("connecting");
  expect(
    [...section()!.querySelectorAll("code")].map((code) => code.textContent),
  ).toEqual([install, install]);
  expect(section()!.querySelector("a")).toBeNull();
  // A host that needs an install is retried once it has one; the others are not.
  expect(
    page
      .getByRole("button", { name: /^Retry / })
      .elements()
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Retry box2", "Retry box3"]);
});

test("says whether an online host has language features, and why not as one line of plain text", async () => {
  await render(
    remoteHosts(
      ["devbox", "box2", "box3"],
      [
        {
          alias: "devbox",
          serverId: "s1",
          state: "online",
          languageFeatures: true,
        },
        {
          alias: "box2",
          serverId: "s2",
          state: "online",
          languageFeatures: false,
          languageFeaturesDetail:
            "it runs [e10c782](command:x) <b>new</b>\nthis\u0007 Desktop\r\u20283c82a2a",
        },
        {
          alias: "box3",
          state: "offline",
          detail: "timed out",
          languageFeatures: false,
        },
      ],
    ),
  );
  await vi.waitFor(() => expect(rows()[0]).toContain("online"));
  expect(rows()[0]).toContain("Language features: available");
  expect(rows()[1]).toContain(
    "Language features: unavailable — it runs [e10c782](command:x) <b>new</b> this Desktop 3c82a2a",
  );
  expect(rows()[2]).not.toContain("Language features");
  expect(section()!.querySelector("a, b")).toBeNull();
});

test("lists an online host's language groups after its language features, each with what is missing as plain text", async () => {
  await render(
    remoteHosts(
      ["devbox", "box2"],
      [
        {
          alias: "devbox",
          serverId: "s1",
          state: "online",
          languageFeatures: true,
          languageGroups: [
            { group: "rust", installed: true },
            {
              group: "swift",
              installed: true,
              detail:
                "swift was not found\non the <b>login</b> shell's PATH\u0007",
            },
            { group: "csharp", installed: false, detail: "download failed" },
          ],
        },
        {
          alias: "box2",
          state: "offline",
          languageGroups: [{ group: "rust", installed: true }],
        },
      ],
    ),
  );
  await vi.waitFor(() => expect(rows()[0]).toContain("online"));
  expect(
    [
      ...document.querySelector("[data-remote-host]")!.querySelectorAll("span"),
    ].map((line) => line.textContent),
  ).toEqual([
    "devbox",
    "online",
    "Language features: available",
    "rust: installed",
    "swift: installed — swift was not found on the <b>login</b> shell's PATH",
    "csharp: not installed — download failed",
  ]);
  expect(rows()[1]).not.toContain("rust");
  expect(section()!.querySelector("b")).toBeNull();
});

test("reads the states again only once the last read has answered", async () => {
  const pending = Promise.withResolvers<ReviewGatewayHostState[]>();
  const hosts = remoteHosts(["devbox"]);

  vi.mocked(hosts.states).mockReturnValue(pending.promise);
  vi.useFakeTimers();

  try {
    await render(hosts);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(hosts.states).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve([]));
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(hosts.states).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test("offers Retry to a host that failed to authenticate, is unreachable, not installed or unsupported", async () => {
  const hosts = remoteHosts(
    ["devbox", "box2", "box3", "box4", "box5"],
    [
      { alias: "devbox", state: "auth-failed", detail: "Permission denied" },
      { alias: "box2", state: "unreachable", detail: "timed out" },
      { alias: "box3", state: "not-installed", detail: "Not installed." },
      {
        alias: "box4",
        state: "unsupported",
        detail: "This host runs glibc 2.31; Whiteboard needs 2.34 or newer.",
      },
      { alias: "box5", state: "installing" },
    ],
  );

  await render(hosts);
  await vi.waitFor(() =>
    expect(
      page.getByRole("button", { name: "Retry devbox" }).elements(),
    ).toHaveLength(1),
  );
  expect(rows()[3]).toContain("unsupported");
  expect(rows()[3]).toContain("glibc 2.31");
  expect(rows()[4]).toContain("installing");
  expect(
    page
      .getByRole("button", { name: /^Retry / })
      .elements()
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Retry devbox", "Retry box2", "Retry box3", "Retry box4"]);
  await page.getByRole("button", { name: "Retry box2" }).click();
  expect(hosts.retry).toHaveBeenCalledWith("box2");
  await page.getByRole("button", { name: "Retry box3" }).click();
  expect(hosts.retry).toHaveBeenCalledWith("box3");
});

test("shows the install step, offers Install to a declined host, and Retry after a failed install", async () => {
  const hosts = remoteHosts(
    ["box1", "box2", "box3", "box4"],
    [
      {
        alias: "box1",
        state: "installing",
        detail: "Installing Node 24 (uploaded from this computer).",
      },
      {
        alias: "box2",
        state: "not-installed",
        detail: "Whiteboard is not installed on box2.",
        installCommand: "npm install -g @dev.fast/whiteboard@0.1.6",
        declined: true,
      },
      {
        alias: "box3",
        state: "not-installed",
        detail:
          "Installing Whiteboard 0.1.6 on box3 failed while installing the package: the package does not match its pinned integrity.",
      },
      {
        alias: "box4",
        state: "incompatible",
        detail:
          "box4 runs Whiteboard 0.1.5; this Desktop runs 0.1.6. Install Whiteboard 0.1.6 on box4.",
        declined: true,
      },
    ],
  );

  await render(hosts);
  await vi.waitFor(() =>
    expect(rows()[0]).toContain(
      "installing · Installing Node 24 (uploaded from this computer).",
    ),
  );
  expect(
    page
      .getByRole("button", { name: /^(Retry|Install) / })
      .elements()
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([
    "Install box2",
    "Retry box2",
    "Retry box3",
    "Install box4",
    "Retry box4",
  ]);
  await page.getByRole("button", { name: "Install box2" }).click();
  expect(hosts.install).toHaveBeenCalledWith("box2");
  await page.getByRole("button", { name: "Retry box3" }).click();
  expect(hosts.retry).toHaveBeenCalledWith("box3");
});

test("offers an online host's unconnected agents by Desktop's names, connects them, and shows the result as plain text", async () => {
  const hosts = remoteHosts(
    ["box1", "box2"],
    [
      { alias: "box1", serverId: "s1", state: "online" },
      { alias: "box2", state: "unreachable", detail: "timed out" },
    ],
  );

  vi.mocked(hosts.agents)
    .mockResolvedValueOnce([
      { id: "claude", connected: true },
      { id: "codex", connected: false },
      { id: "pi", connected: false },
      { id: "opencode", connected: false, manual: true },
    ])
    .mockResolvedValue([
      { id: "claude", connected: true },
      { id: "codex", connected: false },
      { id: "pi", connected: true },
      { id: "opencode", connected: false, manual: true },
    ]);
  vi.mocked(hosts.connectAgents).mockResolvedValue([
    { id: "codex", connected: false, output: "<b>codex: command failed</b>" },
    { id: "pi", connected: true, output: "" },
  ]);

  await render(hosts);
  await vi.waitFor(() =>
    expect(rows()[0]).toContain("Agents on box1: Codex, Pi — Connect"),
  );
  // Only an online host is read; nothing runs on it until Connect.
  expect(hosts.agents).toHaveBeenCalledWith("box1");
  expect(hosts.agents).not.toHaveBeenCalledWith("box2");
  expect(hosts.connectAgents).not.toHaveBeenCalled();
  expect(rows()[0]).toContain(
    "Paste into OpenCode on box1: Run `whiteboard connect opencode` and follow the instructions to connect this agent to Whiteboard.",
  );

  await page.getByRole("button", { name: "Connect agents on box1" }).click();

  expect(hosts.connectAgents).toHaveBeenCalledWith("box1", ["codex", "pi"]);
  await vi.waitFor(() =>
    expect(rows()[0]).toContain(
      "Codex was not connected on box1: <b>codex: command failed</b> Pi is connected on box1.",
    ),
  );
  expect(section()!.querySelector("b")).toBeNull();
  await vi.waitFor(() =>
    expect(rows()[0]).toContain("Agents on box1: Codex — Connect"),
  );
});

test("a refused connect shows why", async () => {
  const hosts = remoteHosts(["box1"], [{ alias: "box1", state: "online" }]);

  vi.mocked(hosts.agents).mockResolvedValue([{ id: "pi", connected: false }]);
  vi.mocked(hosts.connectAgents).mockRejectedValue(
    new Error("box1 is not connected, or its agents could not be read."),
  );

  await render(hosts);
  await page.getByRole("button", { name: "Connect agents on box1" }).click();
  await vi.waitFor(() =>
    expect(rows()[0]).toContain(
      "Could not connect agents on box1: box1 is not connected, or its agents could not be read.",
    ),
  );
});

test("adding -bad is refused with the reason", async () => {
  const hosts = remoteHosts([]);

  vi.mocked(hosts.set).mockRejectedValue(
    new Error('The SSH alias "-bad" starts with -.'),
  );
  await render(hosts);
  await page.getByLabelText("SSH alias").fill("-bad");
  await page.getByRole("button", { name: "Add" }).click();
  await vi.waitFor(() =>
    expect(section()!.querySelector('[role="alert"]')?.textContent).toBe(
      'The SSH alias "-bad" starts with -.',
    ),
  );
  expect(rows()).toEqual([]);
});

test("adds a host from the suggestions, and removes one", async () => {
  const hosts = remoteHosts(["other"]);

  await render(hosts);
  await vi.waitFor(() =>
    expect(
      [...section()!.querySelectorAll("datalist option")].map((option) =>
        option.getAttribute("value"),
      ),
    ).toEqual(["devbox"]),
  );
  await page.getByLabelText("SSH alias").fill("devbox");
  await page.getByRole("button", { name: "Add" }).click();
  expect(hosts.set).toHaveBeenLastCalledWith(["other", "devbox"]);
  await vi.waitFor(() => expect(rows()).toHaveLength(2));
  await page.getByRole("button", { name: "Remove other" }).click();
  expect(hosts.set).toHaveBeenLastCalledWith(["other", "devbox"]);
  await page.getByRole("button", { name: "Remove host" }).click();
  await vi.waitFor(() =>
    expect(hosts.set).toHaveBeenLastCalledWith(["devbox"]),
  );
  await vi.waitFor(() => expect(rows()).toHaveLength(1));
});

test("removing a host leaves Whiteboard on it unless asked", async () => {
  const hosts = remoteHosts(["devbox", "<b>box2</b>"]);

  await render(hosts);
  await page.getByRole("button", { name: "Remove devbox" }).click();
  const also = page.getByLabelText("Also remove Whiteboard from devbox");
  await expect.element(also).not.toBeChecked();
  await page.getByRole("button", { name: "Remove host" }).click();
  await vi.waitFor(() =>
    expect(hosts.set).toHaveBeenLastCalledWith(["<b>box2</b>"]),
  );
  expect(hosts.uninstall).not.toHaveBeenCalled();

  // The alias is text, never markup.
  await page.getByRole("button", { name: "Remove <b>box2</b>" }).click();
  await expect
    .element(page.getByLabelText("Also remove Whiteboard from <b>box2</b>"))
    .not.toBeChecked();
  expect(section()!.querySelector("b")).toBeNull();
});

test("also removing Whiteboard uninstalls before the host goes, and a failure is shown while the host is still removed", async () => {
  const hosts = remoteHosts(["devbox", "box2"]);
  const order: string[] = [];

  vi.mocked(hosts.uninstall).mockImplementation(async (alias) => {
    order.push(`uninstall ${alias}`);
    if (alias === "box2")
      throw new Error(
        "Could not remove Whiteboard from box2: A Whiteboard server you started (process 7) runs from it.",
      );
  });
  vi.mocked(hosts.set).mockImplementation(async (aliases) => {
    order.push(`set ${aliases.join(",")}`);

    return aliases;
  });
  await render(hosts);

  await page.getByRole("button", { name: "Remove devbox" }).click();
  await page.getByLabelText("Also remove Whiteboard from devbox").click();
  await page.getByRole("button", { name: "Remove host" }).click();
  await vi.waitFor(() => expect(rows()).toHaveLength(1));
  expect(order).toEqual(["uninstall devbox", "set box2"]);
  expect(section()!.querySelector('[role="alert"]')).toBeNull();

  await page.getByRole("button", { name: "Remove box2" }).click();
  await page.getByLabelText("Also remove Whiteboard from box2").click();
  await page.getByRole("button", { name: "Remove host" }).click();
  await vi.waitFor(() =>
    expect(section()!.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not remove Whiteboard from box2: A Whiteboard server you started (process 7) runs from it.",
    ),
  );
  expect(rows()).toEqual([]);
  expect(order.slice(2)).toEqual(["uninstall box2", "set "]);
});
