import type {
  ReviewAppearance,
  ReviewCanvasSettingsContent,
} from "@dev.fast/review-protocol";
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
    theme: "Review Dark",
    setTheme: async (id) => id,
    diffTheme: "",
    setDiffTheme: async (id) => id,
    colorThemes: [
      { id: "Review Dark", label: "Whiteboard Dark", kind: "dark" },
      { id: "Tokyo Night", label: "Tokyo Night", kind: "dark" },
      { id: "Review Light", label: "Whiteboard Light", kind: "light" },
    ],
    importColorTheme: unexpected,
    keymap: "none",
    setKeymap: async (choice) => choice,
    documentWidth: "standard",
    setDocumentWidth: async (choice) => choice,
    appearance: {
      documentFontSize: 15,
      readingFont: "serif",
      codeFontSize: 13,
      codeFontFamily: "Geist Mono",
      fontLigatures: false,
      diffFontSize: 12,
      diffWordWrap: false,
      diffIgnoreWhitespace: true,
    },
    setAppearance: unexpected,
    readyNotification: "off",
    setReadyNotification: async (choice) => choice,
    openFilesIn: { choice: "whiteboard", application: null },
    setOpenFilesIn: async (choice) => ({ choice, application: null }),
    chooseOpenFilesInApplication: unexpected,
    softwareMapEnabled: false,
    setSoftwareMapEnabled: async (enabled) => enabled,
    sharingEnabled: false,
    setSharingEnabled: async (enabled) => enabled,
    animationsEnabled: false,
    setAnimationsEnabled: async (enabled) => enabled,
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
  const appearance = Promise.withResolvers<ReviewAppearance>();
  content.setDocumentWidth = () => width.promise;
  content.setAppearance = () => appearance.promise;
  const container = document.createElement("div");
  // Desktop gives Settings a fixed height.
  container.style.height = "700px";
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SettingsPage settings={content} />));

  const wide = page.getByRole("button", { name: "Wide", exact: true });
  await act(async () => page.getByText("Specifics").click());
  const fontSize = page.getByRole("combobox", { name: "Code font size" });
  await act(async () => wide.click());
  await expect.element(wide).toBeEnabled();
  await expect.element(fontSize).toBeEnabled();
  await act(async () => fontSize.selectOptions("14px"));
  await expect.element(fontSize).toBeEnabled();

  await act(async () =>
    appearance.resolve({ ...content.appearance, codeFontSize: 14 }),
  );
  await expect.element(fontSize).toBeEnabled();
  await expect.element(fontSize).toHaveValue("14");
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

test("Diff theme offers only themes as light or dark as Theme", async () => {
  const content = settings();
  content.diffTheme = "Review Light";
  content.setTheme = async () => "Review Light";
  const container = document.createElement("div");
  container.style.height = "700px";
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SettingsPage settings={content} />));

  const diffTheme = page.getByRole("combobox", { name: "Diff theme" });

  const options = () =>
    [...diffTheme.element().querySelectorAll("option")].map(
      (option) => option.textContent,
    );

  // A saved theme of the other kind follows Theme.
  await expect.element(diffTheme).toHaveValue("");
  expect(options()).toEqual([
    "Same as Theme",
    "Whiteboard Dark",
    "Tokyo Night",
  ]);

  await act(async () =>
    page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOptions("Review Light"),
  );
  await expect.element(diffTheme).toHaveValue("Review Light");
  expect(options()).toEqual(["Same as Theme", "Whiteboard Light"]);
});
