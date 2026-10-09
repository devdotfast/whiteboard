import { expect, test } from "bun:test";
import { filterSettings, flattenSchema, fuzzyScore, isDefault, parseValue } from "./config";
/** The shape of `diffr config schema`: `plugins.shape.bundled` contains one entry per stock plugin; lists and multi-line
 * values are marked `x-settings: false`. */
export const schemaFixture = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Config",
  type: "object",
  properties: {
    plugins: {
      type: "object",
      properties: {
        shape: {
          type: "object",
          properties: {
            order: { type: "array", items: { type: "string" }, "x-settings": false, default: ["bundled.deleted-bodies", "bundled.summarize"] },
            bundled: {
              type: "object",
              properties: {
                "deleted-bodies": {
                  type: "object",
                  title: "Collapsed code",
                  properties: {
                    min_lines: { type: "integer", title: "Shortest body to collapse", "x-group": "Collapsed code", description: "Bodies shorter than this are never summarized or collapsed.", default: 12 },
                    enabled: { type: "boolean", title: "Collapse deleted functions", "x-group": "Collapsed code", description: "Collapse deleted function bodies.", default: true },
                  },
                },
                summarize: {
                  type: "object",
                  title: "Summaries",
                  properties: {
                    provider: { type: "string", title: "Provider", "x-group": "Summaries", enum: ["gemini", "none"], description: "Model provider.", default: "gemini" },
                    api_key: { title: "API key", "x-group": "Summaries", anyOf: [{ type: "string" }, { type: "null" }], description: "API key for the provider.", default: null },
                    model: { $ref: "#/$defs/Model", title: "Model", "x-group": "Summaries" },
                    system_prompt: { type: "string", title: "System prompt", "x-group": "Summaries", "x-settings": false, description: "The system instruction.", default: "Summarize." },
                  },
                },
              },
            },
          },
        },
        classify: {
          type: "object",
          properties: {
            bundled: {
              type: "object",
              title: "Hidden files",
              properties: {
                hide_deleted: { type: "boolean", title: "Hide deleted files", "x-group": "Hidden files", description: "Hide deleted files.", default: true },
                hide: { type: "array", items: { type: "string" }, "x-group": "Hidden files", "x-settings": false, default: ["generated", "vendored"] },
              },
            },
          },
        },
      },
    },
  },
  $defs: {
    Model: { type: "string", description: "Model name.", default: "gemini-2.5-flash" },
  },
};
export const valuesFixture = {
  plugins: {
    shape: {
      order: ["bundled.deleted-bodies", "bundled.summarize"],
      bundled: {
        "deleted-bodies": { min_lines: 12, enabled: true },
        summarize: { provider: "gemini", api_key: null, model: "gemini-2.5-flash", system_prompt: "Summarize." },
      },
    },
    classify: { bundled: { hide_deleted: false, hide: ["test"] } },
  },
};
test("schema flattens to dotted keys with descriptions, defaults, and current values", () => {
  const settings = flattenSchema(schemaFixture, valuesFixture);
  expect(settings.map((s) => [s.key, s.type, s.default, s.value])).toEqual([
    ["plugins.shape.bundled.deleted-bodies.min_lines", "integer", 12, 12],
    ["plugins.shape.bundled.deleted-bodies.enabled", "boolean", true, true],
    ["plugins.shape.bundled.summarize.provider", "enum", "gemini", "gemini"],
    ["plugins.shape.bundled.summarize.api_key", "string", null, null],
    ["plugins.shape.bundled.summarize.model", "string", "gemini-2.5-flash", "gemini-2.5-flash"],
    ["plugins.classify.bundled.hide_deleted", "boolean", true, false],
  ]);
  expect(settings.map((s) => [s.title, s.group])).toEqual([
    ["Shortest body to collapse", "Collapsed code"],
    ["Collapse deleted functions", "Collapsed code"],
    ["Provider", "Summaries"],
    ["API key", "Summaries"],
    ["Model", "Summaries"],
    ["Hide deleted files", "Hidden files"],
  ]);
  expect(settings[2].options).toEqual(["gemini", "none"]);
  expect(settings.map(isDefault)).toEqual([true, true, true, true, true, false]);
});
test("a setting without a title or group is a schema error", () => {
  const schema = structuredClone(schemaFixture);
  delete (schema.properties.plugins.properties.shape.properties.bundled.properties["deleted-bodies"].properties.min_lines as Record<string, unknown>).title;
  expect(() => flattenSchema(schema, valuesFixture)).toThrow("plugins.shape.bundled.deleted-bodies.min_lines");
});
test("keys marked x-settings: false are left to the file; any other list or table is a schema error", () => {
  const keys = flattenSchema(schemaFixture, valuesFixture).map((s) => s.key);
  expect(keys.some((key) => key.includes("order") || key.includes("queries") || key === "plugins.classify.bundled.hide")).toBe(false);
  const schema = structuredClone(schemaFixture);
  delete (schema.properties.plugins.properties.classify.properties.bundled.properties.hide as Record<string, unknown>)["x-settings"];
  expect(() => flattenSchema(schema, valuesFixture)).toThrow("Setting plugins.classify.bundled.hide has unsupported type array");
});
test("fuzzy filtering narrows over title, key, group and description, keeping groups together", () => {
  const settings = flattenSchema(schemaFixture, valuesFixture);
  expect(fuzzyScore("cbhide", "plugins.classify.bundled.hide_deleted")).not.toBeNull();
  expect(fuzzyScore("xyz", "plugins.classify.bundled.hide_deleted")).toBeNull();
  // An empty query keeps schema order, which is already grouped.
  expect(filterSettings(settings, "").map((s) => s.key)).toEqual(settings.map((s) => s.key));
  expect(filterSettings(settings, "hide deleted").map((s) => s.key)).toEqual(["plugins.classify.bundled.hide_deleted"]);
  expect(filterSettings(settings, "api")[0].key).toBe("plugins.shape.bundled.summarize.api_key");
  // A description mention ("... or collapsed.") still finds the setting.
  expect(filterSettings(settings, "shorter").map((s) => s.key)).toEqual(["plugins.shape.bundled.deleted-bodies.min_lines"]);
  // Matching a group name lists the group in schema order.
  expect(filterSettings(settings, "summaries").map((s) => s.key)).toEqual(["plugins.shape.bundled.summarize.provider", "plugins.shape.bundled.summarize.api_key", "plugins.shape.bundled.summarize.model"]);
});
test("edited values are parsed in the setting's type and bad input is rejected", () => {
  const [minLines, collapse, provider] = flattenSchema(schemaFixture, valuesFixture);
  expect(parseValue(minLines, "20")).toBe(20);
  expect(() => parseValue(minLines, "2.5")).toThrow("integer");
  expect(parseValue(collapse, "false")).toBe(false);
  expect(() => parseValue(collapse, "yes")).toThrow();
  expect(parseValue(provider, "none")).toBe("none");
  expect(() => parseValue(provider, "openai")).toThrow("gemini, none");
});
