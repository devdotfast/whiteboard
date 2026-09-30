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

const PROMPT_URL =
  "https://github.com/devdotfast/diffr/blob/main/plugins/summarize/plugin.toml#L68-L74";

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
    defaultPromptUrl: PROMPT_URL,
    values: {
      plugins: {
        bundled: {
          context: { enabled: true, lines: 3 },
          "test-bodies": { enabled: true },
          "deleted-bodies": { enabled: true },
          "removed-runs": { enabled: true },
          group: { enabled: true },
          "hide-files": { enabled: true, deleted: true, tags: ["test"] },
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
  };
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
        values: {
          plugins: {
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
    "plugins.bundled.test-bodies.enabled",
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

test("tests draft settings without saving, then saves and clears the key", async () => {
  const { actions } = await mount();
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
    systemPrompt: "Default prompt.",
    tests: true,
    apiKey: "test-secret",
  });
  await expect
    .element(page.getByLabelText("API key", { exact: true }))
    .toHaveValue("");
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

test("shows partial save errors with authoritative values and a reload prompt", async () => {
  const { actions, current } = await mount();
  await open();
  vi.mocked(actions.saveSummarizer).mockResolvedValue({
    ...current,
    changed: true,
    error: "Some settings were saved.",
  });
  await act(async () => {
    await page.getByLabelText("Model", { exact: true }).fill("new-model");
  });
  await act(async () => {
    await page.getByRole("button", { name: "Save summaries" }).click();
  });
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Some settings were saved.");
  await expect
    .element(page.getByLabelText("Model", { exact: true }))
    .toHaveValue("test-model");
  await expect
    .element(page.getByRole("button", { name: "Reload window", exact: true }))
    .toBeVisible();
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
  await expect
    .element(page.getByRole("link", { name: "Default prompt on GitHub" }))
    .toHaveAttribute("href", PROMPT_URL);
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

  await mount({ values: { ...values, plugins: { bundled: { summarize } } } });
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
