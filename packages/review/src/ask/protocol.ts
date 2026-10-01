import path from "node:path";

import {
  type AvailableCommand,
  type ContentBlock,
  RequestError,
  type SessionConfigOption,
  type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import {
  type AskAttachment,
  type AskChoiceKind,
  type AskCommand,
  type AskEntry,
  type AskQuestion,
  type AskSelect,
  askChoiceKinds,
} from "@review/ask/thread-state.js";
import { z } from "zod";

/** Claude's adapter names the MCP server behind an `mcp__*` permission here. */
const claudeMcpMetaSchema = z.object({
  claudeCode: z.object({ mcpServer: z.object({ name: z.string() }) }),
});

/** Codex's adapter puts the server in an MCP tool call's input. */
const mcpInputSchema = z.union([
  z.object({ server: z.string() }),
  z.object({ serverName: z.string() }),
]);

/** The MCP server a tool call runs on, if the adapter says. */
export function mcpServerOf(
  toolCall: Pick<ToolCallUpdate, "_meta" | "rawInput">,
) {
  const claude = claudeMcpMetaSchema.safeParse(toolCall._meta).data;

  if (claude) return claude.claudeCode.mcpServer.name;
  const input = mcpInputSchema.safeParse(toolCall.rawInput).data;

  return input && ("server" in input ? input.server : input.serverName);
}

/** Wraps the selection context in the first prompt, so a replayed
 * conversation can show the question without it. */
const CONTEXT_OPEN = "<whiteboard-context>";

const CONTEXT_CLOSE = "</whiteboard-context>";

/** A conversation closed mid-turn, as it should look when reopened: the
 * agent stopped, so nothing is still running or waiting on the reviewer. */
export function settled(entries: AskEntry[]): AskEntry[] {
  return entries.map((entry) => {
    if (entry.kind === "permission" && entry.outcome === undefined)
      return { ...entry, outcome: "cancelled" };

    if (
      entry.kind === "tool" &&
      (entry.status === "pending" || entry.status === "in_progress")
    )
      return { ...entry, status: "failed" };

    return entry;
  });
}

/** Enough of a tool's output to see what came back. */
const OUTPUT_LIMIT = 4_000;

const selectOptionSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().nullish(),
});

/** A select's choices, flat or in groups. */
export const selectOptionsSchema = z.array(
  z.union([
    selectOptionSchema,
    z.object({ group: z.string(), options: z.array(selectOptionSchema) }),
  ]),
);

/** The ACP config option category each choice comes from. */
const choiceCategories = new Map<AskChoiceKind, string>([
  ["model", "model"],
  ["effort", "thought_level"],
]);

/** What the agent offers of each choice, from its session config options,
 * with the config option that sets it. */
export function choicesOf(options: SessionConfigOption[] | null | undefined) {
  const found = new Map<
    AskChoiceKind,
    { configId: string; select: AskSelect }
  >();

  for (const kind of askChoiceKinds) {
    const option = options?.find(
      (candidate) =>
        candidate.type === "select" &&
        (candidate.category === choiceCategories.get(kind) ||
          candidate.id === kind),
    );

    if (option?.type !== "select") continue;
    const choices = selectOptionsSchema.safeParse(option.options).data;

    if (!choices) continue;

    found.set(kind, {
      configId: option.id,
      select: {
        current: option.currentValue,
        options: choices
          .flatMap((choice) => ("group" in choice ? choice.options : [choice]))
          .map(({ value, name, description }) =>
            description ? { value, name, description } : { value, name },
          ),
      },
    });
  }

  return found;
}

/** A slash command as the panel offers it. */
export function commandOf({
  name,
  description,
  input,
}: AvailableCommand): AskCommand {
  return input?.hint
    ? { name, description, hint: input.hint }
    : { name, description };
}

/** What a question carries, as its entry shows it. */
export function attachmentsOf({
  mentions = [],
  images = [],
}: AskQuestion): AskAttachment[] {
  return [
    ...mentions.map((mention) => ({ kind: "file" as const, path: mention })),
    ...images.map(({ name }) => ({ kind: "image" as const, name })),
  ];
}

const toolInputSchema = z.object({
  command: z.union([z.string(), z.array(z.string())]).optional(),
  description: z.string().optional(),
  file_path: z.string().optional(),
  path: z.string().optional(),
  // What a search looked for: fff's grep and find_files, and multi_grep's
  // alternatives.
  query: z.string().optional(),
  pattern: z.string().optional(),
  patterns: z.array(z.string()).optional(),
});

type ToolDetails = Pick<
  Extract<AskEntry, { kind: "tool" }>,
  "input" | "summary"
>;

/** What a tool call ran or opened, and why, from what the adapter sent. */
export function toolDetails(update: ToolCallUpdate) {
  const input = toolInputSchema.safeParse(update.rawInput).data;
  const command = input?.command;

  const target =
    (Array.isArray(command) ? command.join(" ") : command) ??
    input?.file_path ??
    input?.path ??
    input?.query ??
    input?.pattern ??
    input?.patterns?.join(" | ") ??
    update.locations?.[0]?.path;

  const details: ToolDetails = {};

  if (target) details.input = target;

  if (input?.description) details.summary = input.description;

  return details;
}

/** A finished tool's text output. Claude fences a command's output. */
export function toolOutput(update: ToolCallUpdate) {
  const text = (update.content ?? [])
    .flatMap((item) =>
      item.type === "content" && item.content.type === "text"
        ? [item.content.text]
        : [],
    )
    .join("\n")
    .replace(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/u, "$1")
    .trimEnd();

  if (!text) return undefined;

  return text.length > OUTPUT_LIMIT
    ? `${text.slice(0, OUTPUT_LIMIT)}\n…`
    : text;
}

/** A first question, after the selection it is about. */
export function withContext(context: string, question: string): ContentBlock[] {
  return [
    { type: "text", text: `${CONTEXT_OPEN}\n${context}\n${CONTEXT_CLOSE}` },
    { type: "text", text: question },
  ];
}

/** A replayed first message, as the reviewer typed it. */
export function withoutContext(text: string) {
  const start = text.indexOf(CONTEXT_OPEN);

  if (start === -1) return text.trim();
  const end = text.indexOf(CONTEXT_CLOSE, start);

  return (
    text.slice(0, start) +
    (end === -1 ? "" : text.slice(end + CONTEXT_CLOSE.length))
  ).trim();
}

/** ACP's "authentication required": the agent's login lapsed or never was.
 * Some adapters send the same code for other failures, so its message has
 * to say so too. */
export function signedOut(error: unknown): error is RequestError {
  return (
    error instanceof RequestError &&
    error.code === RequestError.authRequired().code &&
    /auth/i.test(error.message)
  );
}
