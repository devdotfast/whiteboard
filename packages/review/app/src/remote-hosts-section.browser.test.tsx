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
    documentWidth: "standard",
    setDocumentWidth: reject,
    codeFontSize: 13,
    setCodeFontSize: reject,
    readyNotification: "off",
    setReadyNotification: reject,
    openFilesIn: { choice: "whiteboard", application: null },
    setOpenFilesIn: reject,
    chooseOpenFilesInApplication: reject,
    softwareMapEnabled: false,
    setSoftwareMapEnabled: reject,
    sharingEnabled: false,
    setSharingEnabled: reject,
    diffrConfig: {
      read: reject,
      set: reject,
      saveSummarizer: reject,
      testSummarizer: reject,
    },
    reloadWindow: async () => {},
    manageExtensions: () => {},
    importVsCodeSettings: () => {},
    uninstallApp: () => {},
    remoteHosts: hosts,
  };

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<SettingsPage settings={settings} />));

  return container;
}

const section = () =>
  document.querySelector<HTMLElement>(
    'section[aria-label="Remote Hosts (Experimental)"]',
  );

const rows = () =>
  [...document.querySelectorAll("[data-remote-host]")].map(
    (row) => row.textContent,
  );

const hostRow = (index: number) =>
  document.querySelectorAll("[data-remote-host]")[index]!;

const toggle = (index: number) =>
  hostRow(index).querySelector<HTMLButtonElement>("button[aria-expanded]")!;

const heading = (index: number, group: string) =>
  hostRow(index).querySelector(`[role="group"][aria-label="${group}"] > span`)!
    .textContent;

const lines = (index: number, group: string) =>
  [
    ...hostRow(index).querySelectorAll(
      `[role="group"][aria-label="${group}"] > :not(:first-child)`,
    ),
  ].map((item) =>
    item.tagName === "DIV"
      ? [...item.children]
          .flatMap((part) =>
            part.tagName === "SPAN" && part.querySelector("button")
              ? [...part.querySelectorAll("button")].map(
                  (button) => button.textContent,
                )
              : part.textContent || [],
          )
          .join(" · ")
      : item.textContent,
  );

test("lists each host with its state and detail, and the install command from Desktop as code", async () => {
  const install =
    'curl -fsSL https://example.test/a.tar.xz | tar -xJ\nexport PATH="$HOME/bin:$PATH"';

  await render(
    remoteHosts(
      ["devbox", "box2", "box4"],
      [
        { alias: "devbox", serverId: "s1", state: "online" },
        {
          alias: "box2",
          state: "not-installed",
          detail:
            "Whiteboard is not installed on box2. Install Whiteboard 0.1.6 there.",
          installCommand: install,
        },
        { alias: "box4", state: "connecting" },
      ],
    ),
  );
  await vi.waitFor(() => expect(rows()).toHaveLength(3));
  await vi.waitFor(() => expect(rows()[0]).toContain("online"));
  expect(rows()[1]).toContain("not installed");
  expect(rows()[1]).toContain(
    "Whiteboard is not installed on box2. Install Whiteboard 0.1.6 there.",
  );
  expect(rows()[2]).toContain("connecting");
  expect(
    [...section()!.querySelectorAll("code")].map((code) => code.textContent),
  ).toEqual([install]);
  expect(
    getComputedStyle(section()!.querySelector("code")!).whiteSpace,
  ).toMatch(/^pre/);
  expect(
    page
      .getByRole("button", { name: /^Retry / })
      .elements()
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Retry box2"]);
});

test("says whether an online host has language features, and why not; only a host that needs something starts open", async () => {
  await render(
    remoteHosts(
      ["devbox", "box2", "box3", "box4"],
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
          languageFeaturesDetail: "it runs e10c782, this Desktop 3c82a2a",
        },
        {
          alias: "box3",
          state: "offline",
          detail: "timed out",
          languageFeatures: false,
        },
        {
          alias: "box4",
          serverId: "s4",
          state: "online",
          languageFeatures: false,
          languageFeaturesDetail: "Installing the language extensions.",
          languageFeaturesPending: true,
        },
      ],
    ),
  );
  await vi.waitFor(() => expect(rows()[0]).toContain("online"));
  expect([0, 1, 2, 3].map((index) => toggle(index).ariaExpanded)).toEqual([
    "false",
    "true",
    "true",
    "false",
  ]);
  expect(heading(1, "Language features")).toBe("Language featuresunavailable");
  expect(lines(1, "Language features")).toEqual([
    "it runs e10c782, this Desktop 3c82a2a",
  ]);
  expect(rows()[2]).not.toContain("Language features");

  await act(async () => toggle(0).click());
  expect(heading(0, "Language features")).toBe("Language featuresavailable");
  expect(lines(0, "Language features")).toEqual([]);

  await act(async () => toggle(3).click());
  expect(heading(3, "Language features")).toBe("Language featuresstarting…");
  expect(lines(3, "Language features")).toEqual([]);
});

test("lists an online host's language groups with what is missing, and a way to check again that waits for the check", async () => {
  const hosts = remoteHosts(
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
            detail: "swift was not found on the login shell's PATH",
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
  );

  let finish!: () => void;
  vi.mocked(hosts.retry).mockImplementation(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );

  await render(hosts);
  await vi.waitFor(() => expect(rows()[0]).toContain("online"));
  expect(lines(0, "Language features")).toEqual([
    "rust · installed",
    "swift · swift was not found on the login shell's PATH",
    "csharp · download failed",
  ]);
  expect(rows()[1]).not.toContain("rust");

  const check = page.getByRole("button", { name: "Check devbox again" });
  await check.click();
  expect(hosts.retry).toHaveBeenCalledWith("devbox");
  await vi.waitFor(() => expect(check.element()).toBeDisabled());
  expect(check.element().getAttribute("aria-busy")).toBe("true");
  await act(async () => finish());
  await vi.waitFor(() => expect(check.element()).toBeEnabled());
});

test("a collapsed host sums up its agents, and stays as it was opened", async () => {
  const hosts = remoteHosts(
    ["tidy"],
    [
      {
        alias: "tidy",
        serverId: "s1",
        state: "online",
        languageFeatures: true,
        languageGroups: [{ group: "rust", installed: true }],
      },
    ],
  );

  vi.mocked(hosts.agents).mockResolvedValue([
    { id: "claude", connected: true },
    { id: "codex", connected: true },
  ]);

  await render(hosts);
  await vi.waitFor(() => expect(rows()[0]).toContain("2 agents connected"));
  await act(async () => toggle(0).click());
  expect(lines(0, "Agents")).toEqual([
    "Claude Code · connected · Reconnect",
    "Codex · connected · Reconnect",
  ]);

  await act(async () => root!.unmount());
  document.body.replaceChildren();
  await render(hosts);
  await vi.waitFor(() => expect(lines(0, "Agents")).toHaveLength(2));
});

test("offers Retry to a host that failed to authenticate, is offline or unreachable, not installed or unsupported", async () => {
  const hosts = remoteHosts(
    ["devbox", "box2", "box3", "box4", "box5", "box6"],
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
      { alias: "box6", state: "offline" },
    ],
  );

  await render(hosts);
  await vi.waitFor(() =>
    expect(
      page.getByRole("button", { name: "Retry devbox" }).elements(),
    ).toHaveLength(1),
  );
  expect(rows()[3]).toContain("glibc 2.31");
  expect(rows()[4]).toContain("installing");
  expect(
    page
      .getByRole("button", { name: /^Retry / })
      .elements()
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([
    "Retry devbox",
    "Retry box2",
    "Retry box3",
    "Retry box4",
    "Retry box6",
  ]);
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
        detail: "Installing the Whiteboard package.",
      },
      {
        alias: "box2",
        state: "not-installed",
        detail: "Whiteboard is not installed on box2.",
        installCommand: "curl -fsSL https://example.test/a.tar.xz | tar -xJ",
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
    expect(rows()[0]).toBe("box1Installing the Whiteboard package.Remove"),
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

test("lists an online host's agents by Desktop's names, connects or reconnects each, offers a prompt to copy, and shows the result as plain text", async () => {
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
      { id: "opencode", connected: false },
    ])
    .mockResolvedValue([
      { id: "claude", connected: true },
      { id: "codex", connected: false },
      { id: "opencode", connected: false },
    ]);
  vi.mocked(hosts.connectAgents).mockResolvedValue([
    { id: "codex", connected: false, output: "<b>codex: command failed</b>" },
  ]);

  await render(hosts);
  await vi.waitFor(() =>
    expect(lines(0, "Agents")).toEqual([
      "Claude Code · connected · Reconnect",
      "Codex · not connected · Copy prompt · Connect",
      "OpenCode · not connected · Copy prompt · Connect",
    ]),
  );
  expect(hosts.agents).toHaveBeenCalledWith("box1");
  expect(hosts.agents).not.toHaveBeenCalledWith("box2");
  expect(hosts.connectAgents).not.toHaveBeenCalled();

  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue();

  await page
    .getByRole("button", { name: "Copy a prompt for OpenCode on box1" })
    .click();
  expect(writeText).toHaveBeenCalledWith(
    "Run `whiteboard connect opencode` and follow the instructions to connect this agent to Whiteboard.",
  );

  await page.getByRole("button", { name: "Connect Codex on box1" }).click();
  expect(hosts.connectAgents).toHaveBeenCalledWith("box1", ["codex"]);
  await vi.waitFor(() =>
    expect(rows()[0]).toContain(
      "Codex was not connected on box1: <b>codex: command failed</b>",
    ),
  );
  expect(section()!.querySelector("b")).toBeNull();

  vi.mocked(hosts.connectAgents).mockResolvedValue([
    { id: "claude", connected: true, output: "" },
  ]);
  await page
    .getByRole("button", { name: "Reconnect Claude Code on box1" })
    .click();
  expect(hosts.connectAgents).toHaveBeenLastCalledWith("box1", ["claude"]);
  await vi.waitFor(() =>
    expect(rows()[0]).toContain("Claude Code is connected on box1."),
  );
});

test("looks for an online host's agents again, busy until the answer, and says when they cannot be read", async () => {
  const hosts = remoteHosts(
    ["box1"],
    [{ alias: "box1", serverId: "s1", state: "online" }],
  );

  let answer!: (agents: null) => void;
  vi.mocked(hosts.agents)
    .mockResolvedValueOnce([{ id: "codex", connected: false }])
    .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

  await render(hosts);
  await vi.waitFor(() =>
    expect(lines(0, "Agents")).toEqual([
      "Codex · not connected · Copy prompt · Connect",
    ]),
  );

  const again = page.getByRole("button", {
    name: "Look for agents on box1 again",
  });

  await again.click();
  expect(hosts.agents).toHaveBeenLastCalledWith("box1", true);
  await vi.waitFor(() => expect(again.element()).toBeDisabled());
  await act(async () => answer(null));
  await vi.waitFor(() => expect(again.element()).toBeEnabled());
  expect(lines(0, "Agents")).toEqual(["Could not read the agents on box1."]);
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

test("a failed host's detail copies on click; a healthy one does not", async () => {
  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue();

  await render(
    remoteHosts(
      ["devbox", "box2"],
      [
        { alias: "devbox", serverId: "s1", state: "online" },
        { alias: "box2", state: "unreachable", detail: "ssh: timed out" },
      ],
    ),
  );

  await vi.waitFor(() => expect(rows()[1]).toContain("ssh: timed out"));
  expect(
    page.getByRole("button", { name: "online", exact: true }).query(),
  ).toBeNull();

  await page.getByRole("button", { name: "ssh: timed out" }).click();
  expect(writeText).toHaveBeenCalledWith("ssh: timed out");
});
