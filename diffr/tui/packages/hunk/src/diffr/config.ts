/** Read diffr's config schema and values through its CLI, and flatten them into settings rows. */
import { spawnSync } from "node:child_process";
export type SettingType = "boolean" | "integer" | "number" | "string" | "enum";
export interface Setting {
  /** Dotted path, e.g. `folds.min_lines`. */
  key: string;
  /** The human name shown in place of the key. */
  title: string;
  /** The section a settings screen lists this setting under. */
  group: string;
  description: string;
  type: SettingType;
  options?: string[];
  default: unknown;
  value: unknown;
}
export interface ConfigClient {
  schema(): unknown;
  show(): unknown;
  set(key: string, value: string): void;
}
interface JsonSchema {
  type?: string | string[];
  /** `false` on keys a settings screen does not edit, such as lists and query tables. */
  "x-settings"?: boolean;
  title?: string;
  "x-group"?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
}
function resolve(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace(/^#\/(\$defs|definitions)\//, "");
  const target = root.$defs?.[name] ?? root.definitions?.[name];
  if (!target) throw new Error(`Unresolved schema reference ${schema.$ref}`);
  // Keywords beside a `$ref` describe this use of the target, so they win over the target's own.
  const { $ref: _, ...siblings } = schema;
  return { ...resolve(target, root), ...siblings };
}
/** `Option<T>` derives to `anyOf: [T, null]`; settings edit the `T`. */
function unwrap(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const resolved = resolve(schema, root);
  const variants = resolved.anyOf ?? resolved.oneOf;
  if (!variants) return resolved;
  const present = variants.map((v) => resolve(v, root)).filter((v) => v.type !== "null");
  if (present.length !== 1) throw new Error("Settings only support optional single-typed values");
  return {
    ...present[0],
    title: resolved.title ?? present[0].title,
    "x-group": resolved["x-group"] ?? present[0]["x-group"],
    description: resolved.description ?? present[0].description,
    default: "default" in resolved ? resolved.default : present[0].default,
  };
}
function settingType(schema: JsonSchema, key: string): SettingType {
  if (schema.enum) return "enum";
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (type === "boolean" || type === "integer" || type === "number" || type === "string") return type;
  throw new Error(`Setting ${key} has unsupported type ${String(type)}; diffr marks keys settings screens skip with x-settings: false`);
}
export function flattenSchema(rawSchema: unknown, rawValues: unknown): Setting[] {
  const root = rawSchema as JsonSchema;
  const settings: Setting[] = [];
  const walk = (schema: JsonSchema, values: unknown, prefix: string) => {
    // diffr marks what the screen leaves to the file; anything else unsupported is an error below.
    if (schema["x-settings"] === false) return;
    const node = unwrap(schema, root);
    if (node["x-settings"] === false) return;
    if (node.properties) {
      for (const [name, child] of Object.entries(node.properties)) {
        const value = values && typeof values === "object" ? (values as Record<string, unknown>)[name] : undefined;
        walk(child, value, prefix ? `${prefix}.${name}` : name);
      }
      return;
    }
    const type = settingType(node, prefix);
    if (!node.title || !node["x-group"]) throw new Error(`Setting ${prefix} has no title or x-group in the schema`);
    settings.push({
      key: prefix,
      title: node.title,
      group: node["x-group"],
      description: node.description ?? "",
      type,
      options: type === "enum" ? node.enum!.map(String) : undefined,
      default: node.default,
      value: values,
    });
  };
  walk(root, rawValues, "");
  return settings;
}
/** Each setting's value as `values`, the output of `config show`, has it. */
export function withValues(settings: Setting[], values: unknown): Setting[] {
  return settings.map((setting) => ({
    ...setting,
    value: setting.key
      .split(".")
      .reduce<unknown>((value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined), values),
  }));
}
/** Subsequence match: every query character in order, scored by tightness and word starts. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase(), t = text.toLowerCase();
  if (!q) return 0;
  let score = 0, position = 0;
  for (const char of q) {
    const index = t.indexOf(char, position);
    if (index < 0) return null;
    score += index === position ? 3 : index === 0 || /[^a-z0-9]/.test(t[index - 1]) ? 2 : 1;
    position = index + 1;
  }
  return score;
}
/** Titles and keys match fuzzily; group names and descriptions only as whole substrings, so prose does not swamp the list. */
function settingScore(setting: Setting, query: string): number | null {
  const substring = (text: string) => (text.toLowerCase().includes(query.toLowerCase()) ? query.length : null);
  const scores = [
    fuzzyScore(query, setting.title),
    fuzzyScore(query, setting.key),
    substring(setting.group),
    substring(setting.description),
  ].filter((score): score is number => score !== null);
  return scores.length ? Math.max(...scores) : null;
}
/** Settings matching `query`, in schema order within each group; groups follow their best match. */
export function filterSettings(settings: Setting[], query: string): Setting[] {
  const matches = settings
    .map((setting, index) => ({ setting, index, score: settingScore(setting, query) }))
    .filter((entry): entry is { setting: Setting; index: number; score: number } => entry.score !== null);
  const best = new Map<string, number>();
  for (const { setting, score } of matches) best.set(setting.group, Math.max(best.get(setting.group) ?? -1, score));
  const firstIndex = new Map<string, number>();
  for (const { setting, index } of matches) if (!firstIndex.has(setting.group)) firstIndex.set(setting.group, index);
  return matches
    .sort(
      (a, b) =>
        best.get(b.setting.group)! - best.get(a.setting.group)! ||
        firstIndex.get(a.setting.group)! - firstIndex.get(b.setting.group)! ||
        b.score - a.score ||
        a.index - b.index,
    )
    .map((entry) => entry.setting);
}
export const formatValue = (value: unknown) =>
  value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
export const isDefault = (setting: Setting) => formatValue(setting.value) === formatValue(setting.default);
/** Parse an edited value in the setting's type; throws on malformed input. */
export function parseValue(setting: Setting, text: string): unknown {
  switch (setting.type) {
    case "boolean":
      if (text !== "true" && text !== "false") throw new Error("Expected true or false");
      return text === "true";
    case "integer":
    case "number": {
      const number = Number(text);
      if (text.trim() === "" || Number.isNaN(number) || (setting.type === "integer" && !Number.isInteger(number)))
        throw new Error(`Expected ${setting.type === "integer" ? "an integer" : "a number"}`);
      return number;
    }
    case "enum":
      if (!setting.options!.includes(text)) throw new Error(`Expected one of ${setting.options!.join(", ")}`);
      return text;
    case "string":
      return text;
  }
}
function run(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `diffr ${args.join(" ")} exited with ${result.status}`);
  return result.stdout;
}
/** The CLI contract: `config schema`, `config show --json`, `config set <key> <value>`. */
export function cliClient(binary: string): ConfigClient {
  return {
    schema: () => JSON.parse(run(binary, ["config", "schema"])),
    show: () => JSON.parse(run(binary, ["config", "show", "--json"])),
    set: (key, value) => {
      run(binary, ["config", "set", key, value]);
    },
  };
}
