import { AgentSelectionSchema } from "@review/agent-selection.js";
import { z } from "zod";

// The canvas imports this module, so it stays free of Node APIs.
export const askAgentIds = ["claude", "codex"] as const;

export type AskAgentId = (typeof askAgentIds)[number];

const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
});

export const askEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    id: z.string(),
    text: z.string(),
    /** When it was asked, in epoch milliseconds; unknown for a replayed one. */
    at: z.number().optional(),
  }),
  z.object({ kind: z.literal("agent"), id: z.string(), text: z.string() }),
  z.object({
    kind: z.literal("tool"),
    id: z.string(),
    title: z.string(),
    toolKind: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "failed"]),
    /** The command it ran, or the file it opened. */
    input: z.string().optional(),
    /** The agent's own note on why, when it gives one. */
    summary: z.string().optional(),
    /** What came back, shortened. */
    output: z.string().optional(),
  }),
  z.object({
    kind: z.literal("permission"),
    id: z.string(),
    title: z.string(),
    toolKind: z.string(),
    /** The command it would run, or the file it would open, when the title
     * does not say. */
    input: z.string().optional(),
    options: z.array(permissionOptionSchema),
    /** The chosen option, `cancelled`, or absent while the user decides. */
    outcome: z.string().optional(),
    /** Refused by Whiteboard's read-only policy, not by the user. */
    automatic: z.boolean().optional(),
  }),
  /** An aside apart from the answer, which it is not part of: an agent's
   * warning about its own setup, or where the reviewer stopped it. */
  z.object({
    kind: z.literal("notice"),
    id: z.string(),
    severity: z.string(),
    title: z.string(),
    description: z.string().optional(),
  }),
]);

/** One of the agent's settings: its choices, and the one in use. */
export const askSelectSchema = z.object({
  current: z.string(),
  options: z.array(
    z.object({
      value: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
  ),
});

export type AskSelect = z.infer<typeof askSelectSchema>;

/** The settings a reviewer can pick: the model, and how hard it thinks. */
export const askChoiceKinds = ["model", "effort"] as const;

export type AskChoiceKind = (typeof askChoiceKinds)[number];

/** What the agent offers of each, when it offers it. */
export const askChoicesSchema = z.object({
  model: askSelectSchema.optional(),
  effort: askSelectSchema.optional(),
});

export type AskChoices = z.infer<typeof askChoicesSchema>;

/** The values picked, before the agent says what it offers. */
export const askPicksSchema = z.strictObject({
  model: z.string().min(1).max(200).optional(),
  effort: z.string().min(1).max(200).optional(),
});

export type AskPicks = z.infer<typeof askPicksSchema>;

const statusSchema = z.enum([
  "starting",
  "running",
  "waiting",
  "idle",
  "failed",
]);

/** Everything the Ask panel renders. A watcher gets it whole once, then
 * follows it through `AskChange`s. */
export const askThreadStateSchema = z.object({
  id: z.string(),
  agent: z.enum(askAgentIds),
  agentName: z.string(),
  status: statusSchema,
  error: z.string().optional(),
  /** The agent's login lapsed: the command that signs in again. */
  signIn: z.string().optional(),
  /** The mode that keeps the agent from changing files was accepted. */
  readOnly: z.boolean(),
  head: z.string(),
  /** The checkout the agent works in. */
  cwd: z.string(),
  /** Absent until the agent says, or when it offers no choice. */
  choices: askChoicesSchema.optional(),
  selection: z.object({ title: z.string(), quote: z.string().optional() }),
  entries: z.array(askEntrySchema),
});

export type AskEntry = z.infer<typeof askEntrySchema>;

export type AskThreadState = z.infer<typeof askThreadStateSchema>;

/** One change to a thread. Answer text arrives as `append`, so a streamed
 * token costs its own length, not the thread's. */
export const askChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set"),
    status: statusSchema.optional(),
    readOnly: z.boolean().optional(),
    choices: askChoicesSchema.optional(),
    /** `null` clears the error; absent leaves it. */
    error: z.string().nullable().optional(),
    /** `null` clears it; absent leaves it. */
    signIn: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal("add"), entry: askEntrySchema }),
  /** Replaces the entry with the same id and kind. */
  z.object({ type: z.literal("entry"), entry: askEntrySchema }),
  z.object({ type: z.literal("append"), id: z.string(), text: z.string() }),
  /** Drops what a failed turn left, before it is asked again. */
  z.object({ type: z.literal("remove"), ids: z.array(z.string()) }),
]);

export type AskChange = z.infer<typeof askChangeSchema>;

/** A line of the watch stream. A snapshot can come at any point and resets
 * the watcher; each change carries the next `seq` after the one before it. */
export const askUpdateSchema = z.union([
  z.object({
    seq: z.number().int().nonnegative(),
    snapshot: askThreadStateSchema,
  }),
  z.object({ seq: z.number().int().positive(), change: askChangeSchema }),
]);

export type AskUpdate = z.infer<typeof askUpdateSchema>;

/** The server and the panel both advance a thread with this, so they agree. */
export function applyAskChange(
  state: AskThreadState,
  change: AskChange,
): AskThreadState {
  switch (change.type) {
    case "set": {
      const { error: _error, signIn: _signIn, ...rest } = state;

      const next: AskThreadState = {
        ...rest,
        status: change.status ?? state.status,
        readOnly: change.readOnly ?? state.readOnly,
      };

      const choices = change.choices ?? state.choices;

      if (choices) next.choices = choices;

      // Absent keeps the error, null clears it, a message replaces it.
      const error = change.error === undefined ? state.error : change.error;

      if (error) next.error = error;

      const signIn = change.signIn === undefined ? state.signIn : change.signIn;

      if (signIn) next.signIn = signIn;

      return next;
    }

    case "add":
      return { ...state, entries: [...state.entries, change.entry] };
    case "entry":
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.id === change.entry.id && entry.kind === change.entry.kind
            ? change.entry
            : entry,
        ),
      };
    case "remove": {
      const ids = new Set(change.ids);

      return {
        ...state,
        entries: state.entries.filter((entry) => !ids.has(entry.id)),
      };
    }

    case "append":
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.kind === "agent" && entry.id === change.id
            ? { ...entry, text: entry.text + change.text }
            : entry,
        ),
      };
  }
}

/** A saved conversation, as the history list shows it. The transcript stays
 * with the agent; Whiteboard keeps what it needs to find and reopen it. */
export const askHistoryEntrySchema = z.object({
  id: z.string(),
  agent: z.enum(askAgentIds),
  /** The first question. */
  title: z.string(),
  selection: AgentSelectionSchema,
  /** The commit the agent read. */
  head: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AskHistoryEntry = z.infer<typeof askHistoryEntrySchema>;
