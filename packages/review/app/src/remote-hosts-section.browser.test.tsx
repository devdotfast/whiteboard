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

test("lists each host with its state, its detail, and the install command as code", async () => {
  const install = "npm install -g @dev.fast/whiteboard@0.1.6";

  await render(
    remoteHosts(
      ["devbox", "box2", "box3", "box4"],
      [
        { alias: "devbox", serverId: "s1", state: "online" },
        {
          alias: "box2",
          state: "not-installed",
          detail: `Whiteboard is not installed on box2. Install it there with \`${install}\`. Node 24 is needed.`,
        },
        {
          alias: "box3",
          state: "incompatible",
          detail: `box3 runs Whiteboard 0.1.5; this Desktop runs 0.1.6. Run ${install} on box3.`,
        },
        { alias: "box4", state: "connecting" },
      ],
    ),
  );
  await vi.waitFor(() => expect(rows()).toHaveLength(4));
  await vi.waitFor(() => expect(rows()[0]).toContain("online"));
  expect(rows()[1]).toContain("not installed");
  expect(rows()[1]).toContain(
    `Whiteboard is not installed on box2. Install it there with ${install}. Node 24 is needed.`,
  );
  expect(rows()[2]).toContain("incompatible");
  expect(rows()[3]).toContain("connecting");
  expect(
    [...section()!.querySelectorAll("code")].map((code) => code.textContent),
  ).toEqual([install, install]);
  expect(section()!.querySelector("a")).toBeNull();
  expect(page.getByRole("button", { name: "Retry" }).elements()).toHaveLength(
    0,
  );
});

test("offers Retry to a host that failed to authenticate or is unreachable", async () => {
  const hosts = remoteHosts(
    ["devbox", "box2"],
    [
      { alias: "devbox", state: "auth-failed", detail: "Permission denied" },
      { alias: "box2", state: "unreachable", detail: "timed out" },
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
