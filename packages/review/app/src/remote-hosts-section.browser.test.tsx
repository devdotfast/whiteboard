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
    codeFontSize: 13,
    setCodeFontSize: reject,
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
    importVsCodeSettings: () => {},
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
  expect(
    page
      .getByRole("button", { name: /^Retry / })
      .elements()
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Retry box2"]);
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

test("offers Retry to a host that failed to authenticate, is unreachable or is not installed", async () => {
  const hosts = remoteHosts(
    ["devbox", "box2", "box3"],
    [
      { alias: "devbox", state: "auth-failed", detail: "Permission denied" },
      { alias: "box2", state: "unreachable", detail: "timed out" },
      { alias: "box3", state: "not-installed", detail: "Not installed." },
    ],
  );

  await render(hosts);
  await vi.waitFor(() =>
    expect(
      page.getByRole("button", { name: "Retry devbox" }).elements(),
    ).toHaveLength(1),
  );
  await page.getByRole("button", { name: "Retry box2" }).click();
  expect(hosts.retry).toHaveBeenCalledWith("box2");
  await page.getByRole("button", { name: "Retry box3" }).click();
  expect(hosts.retry).toHaveBeenCalledWith("box3");
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
  expect(hosts.set).toHaveBeenLastCalledWith(["devbox"]);
  await vi.waitFor(() => expect(rows()).toHaveLength(1));
});
