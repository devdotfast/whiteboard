import {
  type JsonObject,
  type ReviewDiffrConfig,
  type ReviewDiffrConfigActions,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { DiffrConfigSection } from "./diffr-config-section";

let root: ReturnType<typeof createRoot>;

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

function config(): ReviewDiffrConfig {
  return {
    credentialSource: "config",
    providers: [
      [
        "gemini",
        "Gemini",
        "gemini-3.8-flash",
        "https://generativelanguage.googleapis.com",
      ],
      ["openai", "OpenAI", "gpt-6-luna", "https://api.openai.com/v1"],
      [
        "anthropic",
        "Anthropic",
        "claude-haiku-4-5",
        "https://api.anthropic.com",
      ],
      ["mistral", "Mistral", "mistral-small", "https://api.mistral.ai/v1"],
    ].map(([id, title, model, endpoint]) => ({
      id,
      title,
      model,
      endpoint,
      keyVariables: [],
      keylessCustomEndpoint: id === "openai",
    })),
    defaultPrompt: "Default prompt.",
    defaultHiddenTags: ["generated", "vendored", "test"],
    values: {
      version: 2,
      plugins: {
        classify: { bundled: { hide: ["test"], hide_deleted: true } },
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr v2 config key.
        shape: {
          bundled: {
            context: { enabled: true, lines: 3 },
            "test-bodies": { enabled: true },
            "deleted-bodies": { enabled: true },
            "removed-runs": { enabled: true },
            summarize: {
              enabled: false,
              provider: "gemini",
              model: "test-model",
              tests: true,
              system_prompt: "Default prompt.",
            },
          },
        },
      },
    },
  };
}

function pluginSettings(config: ReviewDiffrConfig): JsonObject {
  return config.values.plugins as JsonObject;
}

async function mount(overrides: Partial<ReviewDiffrConfig> = {}) {
  const current = { ...config(), ...overrides };

  const actions: ReviewDiffrConfigActions = {
    read: vi.fn<ReviewDiffrConfigActions["read"]>(async () => current),
    set: vi.fn<ReviewDiffrConfigActions["set"]>(async () => ({
      ...current,
      changed: true,
    })),
    saveSummarizer: vi.fn<ReviewDiffrConfigActions["saveSummarizer"]>(
      async (input) => ({
        ...current,
        changed: true,
        defaultHiddenTags: ["generated", "vendored", "test"],
        values: {
          version: 2,
          plugins: {
            classify: { bundled: { hide: ["test"], hide_deleted: true } },
            // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr v2 config key.
            shape: {
              bundled: {
                summarize: {
                  enabled: input.enabled,
                  provider: input.provider,
                  model: input.model,
                  endpoint: input.endpoint,
                  system_prompt: input.systemPrompt,
                  tests: input.tests,
                },
              },
            },
          },
        },
      }),
    ),
    testSummarizer: vi.fn<ReviewDiffrConfigActions["testSummarizer"]>(
      async () => "count positive values",
    ),
  };

  const reload = vi.fn<() => Promise<void>>(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<DiffrConfigSection actions={actions} reloadWindow={reload} />),
  );

  return { actions, reload, current };
}

async function open() {
  await act(async () => {
    await page
      .getByText("Diff display and AI summaries", { exact: true })
      .click();
  });
  await expect
    .element(page.getByLabelText("Collapse test bodies"))
    .toBeVisible();
}

test("file-hiding controls use classify fields and retain custom tags across off and on", async () => {
  const { actions, current } = await mount();
  pluginSettings(current).classify = {
    bundled: { hide: ["custom"], hide_deleted: true },
  };
  vi.mocked(actions.set).mockImplementation(async (key, value) => {
    const field = key.split(".").at(-1)!;
    const classify = pluginSettings(current).classify as JsonObject;
    classify.bundled = {
      ...(classify.bundled as JsonObject),
      [field]: value,
    };

    return { ...current, changed: true };
  });
  await open();
  await act(async () => page.getByLabelText("Hide files by tag").click());
  expect(pluginSettings(current).classify).toMatchObject({
    bundled: { hide: [] },
  });
  await act(async () => page.getByLabelText("Hide files by tag").click());
  expect(pluginSettings(current).classify).toMatchObject({
    bundled: { hide: ["custom"] },
  });
  await act(async () => page.getByLabelText("Hide deleted files").click());
  expect(pluginSettings(current).classify).toMatchObject({
    bundled: { hide_deleted: false },
  });
  expect(actions.set).toHaveBeenCalledWith("plugins.classify.bundled.hide", []);
  expect(actions.set).toHaveBeenCalledWith("plugins.classify.bundled.hide", [
    "custom",
  ]);
  expect(actions.set).toHaveBeenCalledWith(
    "plugins.classify.bundled.hide_deleted",
    false,
  );
});

test("enabling tag hiding from an empty list uses the schema defaults", async () => {
  const { actions, current } = await mount();
  pluginSettings(current).classify = {
    bundled: { hide: [], hide_deleted: false },
  };
  await open();
  await act(async () => page.getByLabelText("Hide files by tag").click());
  expect(actions.set).toHaveBeenCalledWith(
    "plugins.classify.bundled.hide",
    current.defaultHiddenTags,
  );
});

test("starts collapsed and reads only on first expansion", async () => {
  const { actions } = await mount();
  expect(actions.read).not.toHaveBeenCalled();
  expect(document.querySelector("input")).toBeNull();
  await open();
  expect(actions.read).toHaveBeenCalledOnce();
  await act(async () => {
    await page
      .getByText("Diff display and AI summaries", { exact: true })
      .click();
  });
  await open();
  expect(actions.read).toHaveBeenCalledOnce();
});

test("writes the selected key and keeps reload visible when collapsed", async () => {
  const { actions, reload } = await mount();
  await open();
  await act(async () => {
    await page.getByLabelText("Collapse test bodies").click();
  });
  expect(actions.set).toHaveBeenCalledWith(
    "plugins.shape.bundled.test-bodies.enabled",
    false,
  );
  await expect
    .element(page.getByRole("button", { name: "Reload window", exact: true }))
    .toBeVisible();
  await act(async () => {
    await page
      .getByText("Diff display and AI summaries", { exact: true })
      .click();
  });
  await act(async () => {
    await page
      .getByRole("button", { name: "Reload window", exact: true })
      .click();
  });
  expect(reload).toHaveBeenCalledOnce();
});

test("rejects invalid context lines without writing", async () => {
  const { actions } = await mount();
  await open();
  await act(async () => {
    await page.getByLabelText("Context lines").fill("-1");
  });
  await act(async () => {
    await page.getByLabelText("Model", { exact: true }).click();
  });
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("nonnegative whole number");
  expect(actions.set).not.toHaveBeenCalled();
});

test("tests draft settings without saving, then saves the custom prompt and clears the key", async () => {
  const saved = config();

  const foldPlugins = (pluginSettings(saved).shape as JsonObject)
    .bundled as JsonObject;

  (foldPlugins.summarize as JsonObject).system_prompt = "Keep my wording.";
  const { actions } = await mount(saved);
  await open();
  expect(
    (document.querySelector("input[type=password]") as HTMLInputElement).value,
  ).toBe("");
  await act(async () => {
    await page.getByLabelText("API key", { exact: true }).fill("test-secret");
  });
  await act(async () => {
    await page.getByRole("button", { name: "Test setup", exact: true }).click();
  });
  await expect
    .element(page.getByLabelText("Sample summary"))
    .toHaveTextContent("count positive values");
  expect(actions.saveSummarizer).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("Reload the window");
  await act(async () => {
    await page.getByRole("button", { name: "Save summaries" }).click();
  });
  expect(actions.saveSummarizer).toHaveBeenCalledWith({
    enabled: false,
    provider: "gemini",
    model: "test-model",
    endpoint: "",
    systemPrompt: "Keep my wording.",
    tests: true,
    apiKey: "test-secret",
  });
  await expect
    .element(page.getByLabelText("API key", { exact: true }))
    .toHaveValue("");
  await expect
    .element(page.getByLabelText("Prompt", { exact: true }))
    .toHaveValue("Keep my wording.");
});

test("confirms discarding unsaved summary edits before reloading", async () => {
  const { reload } = await mount();
  await open();
  await act(async () => {
    await page.getByLabelText("Collapse test bodies").click();
  });
  await act(async () => {
    await page.getByLabelText("Model", { exact: true }).fill("new-model");
  });
  await act(async () => {
    await page
      .getByRole("button", { name: "Reload window", exact: true })
      .click();
  });
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  expect(reload).not.toHaveBeenCalled();
  await act(async () => {
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });
  expect(reload).not.toHaveBeenCalled();
  await act(async () => {
    await page
      .getByRole("button", { name: "Reload window", exact: true })
      .click();
  });
  await act(async () => {
    await page.getByRole("button", { name: "Discard and reload" }).click();
  });
  expect(reload).toHaveBeenCalledOnce();
});

test("does not prompt for reload after a no-op and disables reload while testing", async () => {
  const { actions, current } = await mount();
  await open();
  vi.mocked(actions.set).mockResolvedValueOnce({ ...current, changed: false });
  await act(async () => {
    await page.getByLabelText("Collapse test bodies").click();
  });
  expect(document.body.textContent).not.toContain("Reload the window");
  await act(async () => {
    await page.getByLabelText("Collapse test bodies").click();
  });
  let finish!: (value: string) => void;
  vi.mocked(actions.testSummarizer).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await page.getByRole("button", { name: "Test setup", exact: true }).click();
  });
  await expect
    .element(page.getByRole("button", { name: "Reload window", exact: true }))
    .toBeDisabled();
  await act(async () => finish("summary"));
});

test("defaults to Gemini and switching provider resets the model and key", async () => {
  const { actions } = await mount();
  await open();
  await expect
    .element(page.getByRole("radio", { name: "Gemini" }))
    .toHaveAttribute("aria-checked", "true");
  await act(async () => {
    await page.getByLabelText("API key", { exact: true }).fill("typed-secret");
  });
  await act(async () => {
    await page.getByRole("radio", { name: "Anthropic" }).click();
  });
  await expect
    .element(page.getByLabelText("Model", { exact: true }))
    .toHaveValue("claude-haiku-4-5");
  await expect
    .element(page.getByLabelText("API key", { exact: true }))
    .toHaveValue("");
  await expect
    .element(page.getByText("Saving clears the key saved for Gemini."))
    .toBeVisible();
  await act(async () => {
    await page
      .getByLabelText("Endpoint URL", { exact: true })
      .fill(" https://proxy.example/anthropic ");
  });
  await act(async () => {
    await page.getByRole("button", { name: "Save summaries" }).click();
  });
  expect(actions.saveSummarizer).toHaveBeenCalledWith({
    enabled: false,
    provider: "anthropic",
    model: "claude-haiku-4-5",
    endpoint: " https://proxy.example/anthropic ",
    systemPrompt: "Default prompt.",
    tests: true,
    apiKey: "",
  });
});

test("edits the prompt, links its default, and resets it", async () => {
  const { actions } = await mount();
  await open();
  const prompt = page.getByLabelText("Prompt", { exact: true });
  await expect.element(prompt).toHaveValue("Default prompt.");
  await expect
    .element(page.getByText("Default", { exact: true }))
    .toBeVisible();
  await act(async () => {
    await prompt.fill("Be terse.");
  });
  await expect
    .element(page.getByText("Customized", { exact: true }))
    .toBeVisible();
  await act(async () => {
    await page.getByRole("button", { name: "Test setup" }).click();
  });
  expect(actions.testSummarizer).toHaveBeenCalledWith(
    expect.objectContaining({ systemPrompt: "Be terse." }),
  );
  await act(async () => {
    await page.getByRole("button", { name: "Reset to default" }).click();
  });
  await expect.element(prompt).toHaveValue("Default prompt.");
  await expect
    .element(page.getByRole("button", { name: "Save summaries" }))
    .toBeDisabled();
});

test("switching provider without a saved key does not promise to clear one", async () => {
  await mount({ credentialSource: "missing" });
  await open();
  await act(async () => {
    await page.getByRole("radio", { name: "OpenAI" }).click();
  });
  await expect
    .element(
      page.getByText(
        "Enter a key for OpenAI, or leave blank to use its environment variable.",
      ),
    )
    .toBeVisible();
  expect(document.body.textContent).not.toContain("Saving clears");
});

test("switching provider clears a custom endpoint, and a new endpoint warns about the saved key", async () => {
  const { values } = config();

  const summarize: JsonObject = {
    enabled: false,
    provider: "openai",
    model: "test-model",
    endpoint: "https://openrouter.ai/api/v1",
    tests: true,
    system_prompt: "Default prompt.",
  };

  await mount({
    values: {
      ...values,
      plugins: {
        ...(values.plugins as JsonObject),
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr v2 config key.
        shape: { bundled: { summarize } },
      },
    },
  });
  await open();
  const endpoint = page.getByLabelText("Endpoint URL", { exact: true });
  await expect.element(endpoint).toHaveValue("https://openrouter.ai/api/v1");
  await act(async () => {
    await endpoint.fill("https://other.example/v1");
  });
  await expect
    .element(
      page.getByText(
        "Saving clears the saved key, since the endpoint changed.",
      ),
    )
    .toBeVisible();
  await act(async () => {
    await page.getByRole("radio", { name: "Anthropic" }).click();
  });
  await expect.element(endpoint).toHaveValue("");
});

test("offers whatever providers diffr describes, with their defaults", async () => {
  await mount();
  await open();
  await act(async () => {
    await page.getByRole("radio", { name: "Mistral" }).click();
  });
  await expect
    .element(page.getByLabelText("Model", { exact: true }))
    .toHaveValue("mistral-small");
  await expect
    .element(page.getByLabelText("Endpoint URL", { exact: true }))
    .toHaveAttribute("placeholder", "https://api.mistral.ai/v1");
});
