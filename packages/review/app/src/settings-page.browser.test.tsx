import type { ReviewCanvasSettingsContent } from "@dev.fast/review-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";

import { SettingsPage } from "./settings-page";

let root: ReturnType<typeof createRoot>;

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

function unexpected(): never {
  throw new Error("Unexpected settings action");
}

function settings(): ReviewCanvasSettingsContent {
  return {
    telemetryEnabled: false,
    setTelemetryEnabled: async (enabled) => enabled,
    theme: "dark",
    setTheme: async (choice) => choice,
    keymap: "none",
    setKeymap: async (choice) => choice,
    documentWidth: "standard",
    setDocumentWidth: async (choice) => choice,
    codeFontSize: 12,
    setCodeFontSize: async (size) => size,
    readyNotification: "off",
    setReadyNotification: async (choice) => choice,
    openFilesIn: { choice: "whiteboard", application: null },
    setOpenFilesIn: async (choice) => ({ choice, application: null }),
    chooseOpenFilesInApplication: unexpected,
    softwareMapEnabled: false,
    setSoftwareMapEnabled: async (enabled) => enabled,
    sharingEnabled: false,
    setSharingEnabled: async (enabled) => enabled,
    diffrConfig: {
      read: unexpected,
      set: unexpected,
      saveSummarizer: unexpected,
      testSummarizer: unexpected,
    },
    reloadWindow: unexpected,
    manageExtensions: unexpected,
    importVsCodeSettings: unexpected,
    uninstallApp: unexpected,
    remoteHosts: {
      configured: [],
      suggestions: async () => [],
      states: async () => [],
      set: unexpected,
      retry: unexpected,
      install: unexpected,
      agents: unexpected,
      connectAgents: unexpected,
      uninstall: unexpected,
    },
  };
}

test("preferences stay enabled while overlapping saves settle independently", async () => {
  const content = settings();
  const width = Promise.withResolvers<"wide">();
  const font = Promise.withResolvers<number>();
  content.setDocumentWidth = () => width.promise;
  content.setCodeFontSize = () => font.promise;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SettingsPage settings={content} />));

  const wide = page.getByRole("button", { name: "Wide", exact: true });
  const fontSize = page.getByRole("button", { name: "14", exact: true });
  const dark = page.getByRole("button", { name: "Dark", exact: true });
  await act(async () => wide.click());
  await expect.element(wide).toBeEnabled();
  await expect.element(fontSize).toBeEnabled();
  await expect.element(dark).toBeEnabled();
  await act(async () => fontSize.click());
  await expect.element(fontSize).toBeEnabled();

  await act(async () => font.resolve(14));
  await expect.element(fontSize).toBeEnabled();
  await expect.element(fontSize).toHaveAttribute("aria-pressed", "true");
  await expect.element(wide).toBeEnabled();
  await act(async () => width.reject(new Error("Could not save width")));
  await expect.element(wide).toBeEnabled();
  await expect.element(wide).toHaveAttribute("aria-pressed", "false");
  await expect.element(page.getByText("Could not save width")).toBeVisible();

  content.setDocumentWidth = async () => "wide";
  await act(async () => wide.click());
  await expect.element(wide).toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByText("Could not save width"))
    .not.toBeInTheDocument();
});
