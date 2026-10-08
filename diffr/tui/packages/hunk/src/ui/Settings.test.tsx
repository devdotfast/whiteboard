import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { Settings, displayValue, isSecret, nextValue } from "./Settings";
import { schemaFixture, valuesFixture } from "../diffr/config.test";
import { flattenSchema, parseValue, type ConfigClient } from "../diffr/config";

test("values show as not set, secrets only as stored, and toggles flip or cycle", () => {
  const [minLines, collapse, provider, apiKey] = flattenSchema(schemaFixture, valuesFixture);
  expect(displayValue(minLines)).toBe("12");
  expect(displayValue({ ...minLines, value: null })).toBe("not set");
  expect(displayValue(apiKey)).toBe("not set");
  expect(displayValue({ ...apiKey, value: "abc" })).toBe("✓ stored");
  expect(isSecret("plugins.shape.bundled.summarize.api_key")).toBe(true);
  expect(isSecret("plugins.shape.bundled.deleted-bodies.min_lines")).toBe(false);
  expect(nextValue(collapse)).toBe("false");
  expect(nextValue(provider)).toBe("none");
  expect(nextValue({ ...provider, value: "none" })).toBe("gemini");
});

test("rows lead with titles under group headings; toggles change in place and typed values open a prompt", async () => {
  const writes: [string, string][] = [];
  const values = structuredClone(valuesFixture);
  const settings = flattenSchema(schemaFixture, valuesFixture);
  const client: ConfigClient = {
    schema: () => schemaFixture,
    show: () => structuredClone(values),
    set: (key, value) => {
      writes.push([key, value]);
      // Store it as diffr would, typed by the setting.
      const parts = key.split(".");
      const parent = parts.slice(0, -1).reduce<Record<string, unknown>>((object, part) => object[part] as Record<string, unknown>, values);
      parent[parts.at(-1)!] = parseValue(settings.find((setting) => setting.key === key)!, value);
    },
  };
  let quit = false;
  const t = await testRender(
    <Settings client={client} initial={flattenSchema(schemaFixture, valuesFixture)} onQuit={() => { quit = true; }} />,
    { width: 100, height: 24 },
  );
  const press = async (key: string) => {
    await act(async () => { t.mockInput.pressKey(key); });
    await act(async () => { await t.renderOnce(); });
  };
  const type = async (text: string) => {
    for (const char of text) await press(char);
  };
  const clear = async () => {
    for (let i = 0; i < 12; i++) await press("BACKSPACE");
  };
  const escape = async () => {
    await press("ESCAPE");
    // A lone escape is only recognised once the parser's escape-sequence timeout passes.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await act(async () => { await t.renderOnce(); });
  };
  const frame = () => t.captureCharFrame();
  const line = (text: string) => frame().split("\n").find((l) => l.includes(text)) ?? "";
  try {
    await act(async () => { await t.renderOnce(); });
    // Groups in schema order, each setting under its heading, titles first and keys only in the detail line.
    const order = ["Collapsed code", "Shortest body to collapse", "Collapse deleted functions", "Summaries", "Provider", "Hidden files", "Hide deleted files"]
      .map((text) => frame().split("\n").findIndex((l) => l.includes(text)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(line("Shortest body to collapse")).toContain("→");
    expect(line("Shortest body to collapse")).not.toContain("plugins.shape.bundled.deleted-bodies.min_lines");
    expect(frame()).toContain("plugins.shape.bundled.deleted-bodies.min_lines · default 12");
    expect(frame()).toContain("Bodies shorter than this are never summarized or collapsed.");
    expect(frame()).toContain("(1/6)");
    expect(frame()).toContain("Type to search · Enter/Space to change · Esc to quit");
    expect(line("API key")).toContain("not set");

    // Boolean: space flips it in place and writes through the CLI.
    await type("hidedeleted");
    expect(frame()).toContain("(1/1)");
    expect(line("Hide deleted files")).toContain("false");
    await press(" ");
    expect(writes).toEqual([["plugins.classify.bundled.hide_deleted", "true"]]);
    expect(line("Hide deleted files")).toContain("true");
    expect(frame()).toContain("Hide deleted files: true");

    // Enum: enter cycles to the next option.
    await clear();
    await type("provider");
    await press("RETURN");
    expect(writes.at(-1)).toEqual(["plugins.shape.bundled.summarize.provider", "none"]);
    expect(line("Provider")).toContain("none");

    // Number: enter opens a prompt titled by the setting; escape discards, enter saves.
    await clear();
    await type("shortest");
    await press("RETURN");
    expect(frame()).toContain("Shortest body to collapse");
    expect(frame()).toContain("> 12");
    expect(frame()).toContain("(escape/ctrl+c to cancel, enter to submit)");
    await press("BACKSPACE");
    await type("9");
    await escape();
    expect(frame()).toContain("Type to search");
    expect(writes).toHaveLength(2);
    await press("RETURN");
    await press("BACKSPACE");
    await press("BACKSPACE");
    await type("2.5");
    await press("RETURN");
    expect(frame()).toContain("Expected an integer");
    expect(writes).toHaveLength(2);
    await press("BACKSPACE");
    await press("BACKSPACE");
    await press("BACKSPACE");
    await type("20");
    await press("RETURN");
    expect(writes.at(-1)).toEqual(["plugins.shape.bundled.deleted-bodies.min_lines", "20"]);
    expect(line("Shortest body to collapse")).toContain("20");

    // Secret: the prompt starts empty and masks typing; the row only says it is stored.
    await clear();
    await type("api");
    await press("RETURN");
    expect(frame()).toContain("API key for the provider.");
    // Keys that arrive in one burst, before any re-render, all land, including the enter after them.
    await act(async () => {
      for (const key of ["a", "b", "c"]) t.mockInput.pressKey(key);
    });
    await act(async () => { await t.renderOnce(); });
    expect(frame()).toContain("> •••");
    expect(frame()).not.toContain("abc");
    await act(async () => {
      t.mockInput.pressKey("d");
      t.mockInput.pressKey("RETURN");
    });
    await act(async () => { await t.renderOnce(); });
    expect(writes.at(-1)).toEqual(["plugins.shape.bundled.summarize.api_key", "abcd"]);
    expect(line("API key")).toContain("✓ stored");
    expect(frame()).not.toContain("abc");

    await escape();
    expect(quit).toBe(true);
  } finally {
    await act(async () => { t.renderer.destroy(); });
  }
});

test("a change shows every value it moves, such as a default that follows the provider", async () => {
  const values = structuredClone(valuesFixture);
  const client: ConfigClient = {
    schema: () => schemaFixture,
    show: () => structuredClone(values),
    set: (key, value) => {
      if (key === "plugins.shape.bundled.summarize.provider") {
        values.plugins.shape.bundled.summarize.provider = value;
        values.plugins.shape.bundled.summarize.model = `${value}-model`;
      }
    },
  };
  const t = await testRender(
    <Settings client={client} initial={flattenSchema(schemaFixture, values)} onQuit={() => {}} />,
    { width: 100, height: 24 },
  );
  const press = async (key: string) => {
    await act(async () => { t.mockInput.pressKey(key); });
    await act(async () => { await t.renderOnce(); });
  };
  const line = (text: string) => t.captureCharFrame().split("\n").find((l) => l.includes(text)) ?? "";
  try {
    await act(async () => { await t.renderOnce(); });
    const query = "provider";
    for (const char of query) await press(char);
    await press("RETURN");
    for (const _ of query) await press("BACKSPACE");
    expect(line("Provider")).toContain("none");
    expect(line("Model")).toContain("none-model");
  } finally {
    await act(async () => { t.renderer.destroy(); });
  }
});
