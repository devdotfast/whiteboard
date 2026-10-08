/**
 * The page's tools for an agent in the reader's browser, through WebMCP (`navigator.modelContext`):
 * read the comparison, move around it, group it into lenses, and write plugins that fold what
 * diffr's own leave open. main.ts loads this only where the browser has WebMCP.
 */
import * as z from "zod/mini";

import type { Comparison } from "./comparison.js";
import { Engine } from "./engine/engine.js";
import { type Lens, lenses, setLenses } from "./lenses.js";
import {
  type StructuralRegion,
  regionLines,
} from "./review/common/reviewStructuralDiff.js";
import {
  type AgentPlugin,
  agentPlugins,
  configOverrides,
  readSetting,
  setAgentPlugins,
} from "./settings.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** What an agent sends a tool: JSON. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A tool as WebMCP takes it. */
interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute(input: Json | undefined): Promise<ToolResult>;
}

interface ModelContext {
  provideContext?(context: { tools: RegisteredTool[] }): void;
  registerTool?(tool: RegisteredTool): void;
}

declare global {
  interface Navigator {
    modelContext?: ModelContext;
  }
}

export interface AgentHost {
  comparison(): Comparison | undefined;
  /** Diff with `engine` from now on, and load the page again. */
  replaceEngine(engine: Engine): void;
  /** The comparison's lenses or the plugins changed. */
  changed(): void;
}

interface Tool<Input extends z.ZodMiniObject> {
  name: string;
  description: string;
  input: Input;
  readOnly?: boolean;
  /** A string answers as is; anything else as JSON. */
  run(input: z.infer<Input>): Promise<string | object>;
}

const tool = <Input extends z.ZodMiniObject>(definition: Tool<Input>) =>
  definition;

/** Text past this is cut, so one call cannot fill an agent's context. */
const MAX_TEXT = 200_000;

const MAX_MATCHES = 500;

const described = <T extends z.ZodMiniType>(schema: T, description: string) =>
  schema.check(z.describe(description));

const PATH = described(
  z.string(),
  "The file's path, as diffr_get_comparison lists it.",
);

const SIDE = z.enum(["base", "head"]);

const LINE = z.int().check(z.minimum(1));

const RANGES = described(
  z.array(z.object({ side: SIDE, from: LINE, to: LINE })),
  "Lines to show, from 1, both ends included; `base` is the old side, `head` the new. Leave it out to show the whole file.",
);

const PLUGIN_CONTRACT = `A plugin is the source of one JavaScript function, \`(file) => void\`, run in a Web Worker on every diffed text file that diffr does not hide, after diffr's own plugins. \`file\` is { path, status: "added" | "modified" | "deleted", tags: string[], lhs?: Side, rhs?: Side }: lhs is the base (old) side, rhs the head (new) side. Side is { text, root: Region }. Region is { kind: "fold" | "leaf", id, fold_state_id: number, start: { line, column }, end: { line, column } (from 0; an end at column 0 stops before its line), tags?: string[], visibility?: { collapsed: boolean, label: string }, children: Region[] (folds only), changed?: spans (leaves only, the edited parts) }. The plugin folds by setting a region's \`visibility\`, e.g. region.visibility = { collapsed: true, label: "Logging" }; nothing else it changes is kept, and a fold state changed on either side changes on both. Call diffr_get_file to see real regions first. A plugin that throws is reported and skipped for that file.`;

/** diffr's folds in one side of a file, as a flat list. */
function folds(
  path: string,
  comparison: Comparison,
  root: StructuralRegion | undefined,
  side: "base" | "head",
) {
  const out: object[] = [];

  const walk = (region: StructuralRegion, depth: number) => {
    const { start, end } = regionLines(region);

    if (
      region.kind === "fold" ||
      region.visibility?.label ||
      region.visibility?.collapsed
    )
      out.push({
        id: region.fold_state_id,
        side,
        kind: region.kind,
        lines: [start + 1, Math.max(end, start + 1)],
        depth,
        tags: region.tags,
        label: region.visibility?.label || undefined,
        collapsed:
          comparison.isRegionCollapsed(path, region.fold_state_id) ??
          !!region.visibility?.collapsed,
        changed:
          region.kind === "leaf" && region.changed?.length ? true : undefined,
      });

    if (region.kind === "fold")
      region.children.forEach((child) => walk(child, depth + 1));
  };

  if (root?.kind === "fold") root.children.forEach((child) => walk(child, 0));

  return out;
}

/** Line ranges, from 1 with both ends included, of what changed on one side. */
const changedLines = (ranges: readonly (readonly [number, number])[]) =>
  ranges.map(([start, end]) => [start + 1, Math.max(end, start + 1)]);

const cut = (value: string | undefined) =>
  value === undefined || value.length <= MAX_TEXT
    ? value
    : `${value.slice(0, MAX_TEXT)}\n[cut: ${value.length - MAX_TEXT} more characters]`;

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `lens-${Date.now()}`;

export function tools(host: AgentHost) {
  const comparison = () => {
    const current = host.comparison();

    if (!current?.change)
      throw new Error("No comparison is open, or it is still loading");

    return current;
  };

  /** Save the plugins, try them in a fresh engine, and report what it says of them. */
  const usePlugins = async (next: AgentPlugin[]) => {
    const previous = agentPlugins();
    setAgentPlugins(next);
    const engine = new Engine(readSetting("config"), configOverrides());

    try {
      const notices = await engine.notices;
      host.replaceEngine(engine);
      host.changed();

      return notices;
    } catch (error) {
      engine.dispose();
      setAgentPlugins(previous);
      throw error;
    }
  };

  return [
    tool({
      name: "diffr_get_comparison",
      description:
        "The pull request or comparison open in diffr: its title, URL, base and head commits, and every changed file in the order the page lists them, with whether diffr hides it (generated, vendored, lockfiles) and whether it is diffed yet. Also the comparison's lenses and the one shown.",
      input: z.object({}),
      readOnly: true,
      async run() {
        const current = comparison();
        const change = current.change!;
        const stats = new Map(change.files.map((file) => [file.path, file]));

        return {
          title: current.title,
          url: current.url,
          base: change.base,
          head: change.head,
          files: current.fileList.map((file) => ({
            ...file,
            additions: stats.get(file.path)?.additions,
            deletions: stats.get(file.path)?.deletions,
          })),
          lenses: lenses(current).map(({ id, title, description, files }) => ({
            id,
            title,
            description,
            files: files.length,
          })),
          shownLens: current.activeLens?.id,
        };
      },
    }),
    tool({
      name: "diffr_get_file",
      description:
        "One changed file, diffed first if it is still waiting: the lines that changed on each side, diffr's folds (ids, line ranges, labels, whether collapsed), which diffr_set_folds and plugins act on, and optionally each side's text. Line numbers count from 1.",
      input: z.object({
        path: PATH,
        text: z.optional(
          described(z.boolean(), "Include each side's whole text."),
        ),
        folds: z.optional(
          described(z.boolean(), "Include diffr's folds. Default true."),
        ),
      }),
      readOnly: true,
      async run(input) {
        const current = comparison();
        await current.whenDiffed(input.path);
        const result = current.fileResult(input.path);

        const listed = current.fileList.find(
          (file) => file.path === input.path,
        );

        if (!result?.diff)
          return { ...listed, error: result?.error ?? "Not diffed" };

        if (result.diff.type !== "text") return { ...listed, binary: true };
        const diff = result.diff;

        return {
          ...listed,
          changed: {
            base: changedLines(diff.structural_changes.base),
            head: changedLines(diff.structural_changes.head),
          },
          fallback: diff.stats.fallback?.message,
          folds:
            input.folds === false
              ? undefined
              : [
                  ...folds(input.path, current, diff.lhs?.root, "base"),
                  ...folds(input.path, current, diff.rhs?.root, "head"),
                ],
          base: input.text ? cut(diff.lhs?.text) : undefined,
          head: input.text ? cut(diff.rhs?.text) : undefined,
        };
      },
    }),
    tool({
      name: "diffr_search",
      description:
        "Find text in every diffed file: the whole head side, and the base side's removed lines. Files still waiting are not searched; diffr_get_comparison says which.",
      input: z.object({
        query: described(
          z.string(),
          "Text, or a JavaScript regular expression when regex is true.",
        ),
        regex: z.optional(z.boolean()),
        matchCase: z.optional(z.boolean()),
      }),
      readOnly: true,
      async run(input) {
        const current = comparison();

        const pattern = new RegExp(
          input.regex
            ? input.query
            : input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          input.matchCase ? "u" : "iu",
        );

        const matches: object[] = [];

        outer: for (const file of current.texts()) {
          const removed = current.removedLines(file.path);

          for (const [side, source] of [
            ["head", file.modified],
            ["base", file.original],
          ] as const)
            for (const [index, line] of (source ?? "").split("\n").entries()) {
              if ((side === "base" && !removed(index)) || !pattern.test(line))
                continue;
              matches.push({
                path: file.path,
                side,
                line: index + 1,
                text: line.slice(0, 300),
              });

              if (matches.length >= MAX_MATCHES) break outer;
            }
        }

        return { matches, truncated: matches.length >= MAX_MATCHES };
      },
    }),
    tool({
      name: "diffr_reveal",
      description:
        "Scroll the reader to a file, or to a line of one side of it, opening the folds around it.",
      input: z.object({
        path: PATH,
        side: z.optional(described(SIDE, "Default head.")),
        line: z.optional(LINE),
      }),
      async run(input) {
        const current = comparison();

        if (input.line === undefined) {
          current.openFile(input.path);

          return `Showing ${input.path}`;
        }

        await current.whenDiffed(input.path);
        current.revealLine(
          input.path,
          input.side === "base" ? "original" : "modified",
          input.line,
        );

        return `Showing ${input.path}:${input.line}`;
      },
    }),
    tool({
      name: "diffr_set_folds",
      description:
        "Fold or unfold diffr's regions in a file, by the ids diffr_get_file lists. For the reader's view only, until the page reloads; a plugin makes it last.",
      input: z.object({
        path: PATH,
        ids: z.array(z.int()),
        collapsed: z.boolean(),
      }),
      async run(input) {
        const current = comparison();
        await current.whenDiffed(input.path);

        for (const id of input.ids)
          current.setRegionCollapsed(input.path, id, input.collapsed);

        return `${input.collapsed ? "Folded" : "Unfolded"} ${input.ids.length} region${input.ids.length === 1 ? "" : "s"}`;
      },
    }),
    tool({
      name: "diffr_create_lens",
      description:
        "Save a lens: a named part of this comparison for the reader to read on its own, such as one layer of the design, the tests, or a refactor's mechanical edits. It is listed over the diff, kept in this browser for this comparison, and shown at once unless show is false. Showing it folds every other file, and in each of its files that gives ranges, every fold that holds none of them. Saving with an existing id replaces that lens.",
      input: z.object({
        id: z.optional(
          described(
            z.string(),
            "A short slug; made from the title if left out.",
          ),
        ),
        title: described(z.string(), "A few words, shown on its button."),
        description: z.optional(
          described(
            z.string(),
            "One sentence on what the reader will find in it.",
          ),
        ),
        files: z.array(z.object({ path: PATH, ranges: z.optional(RANGES) })),
        show: z.optional(z.boolean()),
      }),
      async run(input) {
        const current = comparison();

        const paths = new Set(
          current.fileList.flatMap((file) => [
            file.path,
            file.previousPath ?? file.path,
          ]),
        );

        const unknown = input.files
          .filter((file) => !paths.has(file.path))
          .map((file) => file.path);

        if (unknown.length)
          throw new Error(
            `Not changed in this comparison: ${unknown.join(", ")}`,
          );
        const id = input.id || slug(input.title);

        const lens: Lens = {
          id,
          title: input.title,
          description: input.description,
          files: input.files.map(({ path, ranges }) => ({
            path,
            ranges: ranges?.length ? ranges : undefined,
          })),
        };

        const others = lenses(current).filter((other) => other.id !== id);
        setLenses(current, [...others, lens]);
        const show = input.show !== false || current.activeLens?.id === id;

        if (show) current.showLens(lens);
        host.changed();

        return `Saved the lens ${id}${show ? " and showed it" : ""}`;
      },
    }),
    tool({
      name: "diffr_show_lens",
      description:
        "Show one of the comparison's lenses by id, or every file again when id is left out.",
      input: z.object({ id: z.optional(z.string()) }),
      async run(input) {
        const current = comparison();
        const lens = lenses(current).find((lens) => lens.id === input.id);

        if (input.id !== undefined && !lens)
          throw new Error(`No lens ${input.id}`);
        current.showLens(lens);
        host.changed();

        return lens ? `Showing ${lens.title}` : "Showing every file";
      },
    }),
    tool({
      name: "diffr_delete_lens",
      description: "Delete one of the comparison's lenses by id.",
      input: z.object({ id: z.string() }),
      async run(input) {
        const current = comparison();
        const all = lenses(current);
        const rest = all.filter((lens) => lens.id !== input.id);

        if (rest.length === all.length) throw new Error(`No lens ${input.id}`);
        setLenses(current, rest);

        if (current.activeLens?.id === input.id) current.showLens(undefined);
        host.changed();

        return `Deleted the lens ${input.id}`;
      },
    }),
    tool({
      name: "diffr_list_plugins",
      description: `The plugins agents have installed on this page, with their code. ${PLUGIN_CONTRACT}`,
      input: z.object({}),
      readOnly: true,
      run: async () => agentPlugins(),
    }),
    tool({
      name: "diffr_install_plugin",
      description: `Install a plugin, or replace the one with the same name. It is kept in this browser and runs on every comparison from now on; the open one is diffed again with it. ${PLUGIN_CONTRACT} Returns diffr's notices: one says if the code did not compile.`,
      input: z.object({
        name: described(z.string(), "A short name."),
        description: described(
          z.string(),
          "One sentence on what it folds, shown in the page's settings.",
        ),
        code: described(
          z.string(),
          "The function's source, such as `(file) => { … }`.",
        ),
      }),
      async run(input) {
        const notices = await usePlugins([
          ...agentPlugins().filter((other) => other.name !== input.name),
          { ...input, enabled: true },
        ]);

        return { installed: input.name, notices };
      },
    }),
    tool({
      name: "diffr_remove_plugin",
      description:
        "Remove an installed plugin by name, or keep it and turn it on or off with enabled.",
      input: z.object({
        name: z.string(),
        enabled: z.optional(
          described(
            z.boolean(),
            "Keep the plugin, on or off, instead of removing it.",
          ),
        ),
      }),
      async run(input) {
        const all = agentPlugins();

        if (!all.some((plugin) => plugin.name === input.name))
          throw new Error(`No plugin ${input.name}`);

        const { enabled } = input;

        await usePlugins(
          enabled === undefined
            ? all.filter((plugin) => plugin.name !== input.name)
            : all.map((plugin) =>
                plugin.name === input.name ? { ...plugin, enabled } : plugin,
              ),
        );

        return enabled === undefined
          ? `Removed ${input.name}`
          : `Turned ${input.name} ${enabled ? "on" : "off"}`;
      },
    }),
  ];
}

const answer = (text: string, isError = false): ToolResult => ({
  content: [{ type: "text", text }],
  isError,
});

/** Offer the tools to the browser's agent. */
export function registerAgentTools(host: AgentHost): void {
  const context = navigator.modelContext;

  if (!context) return;
  // zod/mini says only "Invalid input" until given its messages.
  z.config(z.locales.en());

  // A tool that fails answers with why, so the agent can correct its call.
  const registered = tools(host).map(
    ({ name, description, input, readOnly, run }): RegisteredTool => ({
      name,
      description,
      inputSchema: z.toJSONSchema(input),
      annotations: { readOnlyHint: !!readOnly },
      async execute(raw) {
        const parsed = z.safeParse(input, raw ?? {});

        if (!parsed.success) return answer(z.prettifyError(parsed.error), true);

        try {
          const result = await run(parsed.data);

          return answer(
            result instanceof Object ? JSON.stringify(result) : String(result),
          );
        } catch (error) {
          return answer(
            error instanceof Error ? error.message : String(error),
            true,
          );
        }
      },
    }),
  );

  if (context.provideContext) context.provideContext({ tools: registered });
  else for (const tool of registered) context.registerTool?.(tool);
}
