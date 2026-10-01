import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  type AvailableCommand,
  type ClientConnection,
  type ContentBlock,
  type McpServer,
  PROTOCOL_VERSION,
  RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SessionUpdate,
  type StopReason,
  type ToolCallUpdate,
  type ToolKind,
  client,
  methods,
} from "@agentclientprotocol/sdk";
import { errorMessage } from "@dev.fast/trace-core";
import {
  type AskAgentLauncher,
  type AskAgentProcess,
  askAgents,
} from "@review/ask/agents.js";
import {
  type AskAgentId,
  type AskAttachment,
  type AskChange,
  type AskChoiceKind,
  type AskChoices,
  type AskCommand,
  type AskEntry,
  type AskOffer,
  type AskPicks,
  type AskQuestion,
  type AskSelect,
  type AskThreadState,
  type AskUpdate,
  applyAskChange,
  askChoiceKinds,
} from "@review/ask/thread-state.js";
import { z } from "zod";

/** Refused without asking: changes to files, and leaving the read-only
 * mode (Claude asks to exit plan mode with its plan). */
const REFUSED_KINDS = new Set<ToolKind>([
  "edit",
  "delete",
  "move",
  "switch_mode",
]);

type PermissionEntry = Extract<AskEntry, { kind: "permission" }>;

type NoticeEntry = Extract<AskEntry, { kind: "notice" }>;

type ToolEntry = Extract<AskEntry, { kind: "tool" }>;

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
function mcpServerOf(toolCall: Pick<ToolCallUpdate, "_meta" | "rawInput">) {
  const claude = claudeMcpMetaSchema.safeParse(toolCall._meta).data;

  if (claude) return claude.claudeCode.mcpServer.name;
  const input = mcpInputSchema.safeParse(toolCall.rawInput).data;

  return input && ("server" in input ? input.server : input.serverName);
}

const piGreetingSchema = z.object({
  piAcp: z.object({ startupInfo: z.string() }),
});

const cursorTodosSchema = z.object({ todos: z.unknown() }).loose();

/** MCP servers the reviewer's own agent may bring whose tools only read,
 * so their calls run without asking, like the agent reading files. */
const READ_ONLY_MCP_SERVERS = new Set([
  // fff: fast file search (find_files, grep, multi_grep).
  "fff",
]);

/** MCP servers Whiteboard gives every Ask session. Their tool calls are
 * Whiteboard's own, so they run without asking the reviewer. */
export type AskMcpServers = () => McpServer[];

interface AskThreadBase {
  /** Stable across reopening; a new conversation gets a fresh one. */
  id?: string;
  reviewId: string;
  agent: AskAgentId;
  cwd: string;
  head: string;
  selection: { title: string; quote?: string };
  /** What the agent reads before a session's first question: the selection
   * and how to find the review. */
  context: string;
  /** The agent created a session: the id a later reopen loads. A new one
   * replaces a session the agent could not reopen. */
  onSession?: (sessionId: string) => void;
  /** A turn ended. */
  onTurn?: () => void;
  /** What the panel shows, after each turn and on close, so a reopen can
   * show it without waiting for the agent to replay it. */
  onSave?: (entries: AskEntry[]) => void;
  /** The model and effort to answer with, when the agent offers them. */
  picks?: AskPicks;
  /** The agent said what it offers: choices, commands, or what a question
   * may carry. */
  onOffer?: (offer: AskOffer) => void;
}

/** A new conversation, or an earlier one to load from the agent. */
export type AskThreadStart = AskThreadBase &
  (
    | { question: AskQuestion }
    | {
        resume: {
          sessionId: string;
          /** The conversation as last saved; the agent's replay fills in
           * one saved without it. */
          entries?: AskEntry[];
        };
      }
  );

/** Wraps the selection context in the first prompt, so a replayed
 * conversation can show the question without it. */
const CONTEXT_OPEN = "<whiteboard-context>";

const CONTEXT_CLOSE = "</whiteboard-context>";

/** A conversation closed mid-turn, as it should look when reopened: the
 * agent stopped, so nothing is still running or waiting on the reviewer. */
function settled(entries: AskEntry[]): AskEntry[] {
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
const selectOptionsSchema = z.array(
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
function choicesOf(options: SessionConfigOption[] | null | undefined) {
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
function commandOf({ name, description, input }: AvailableCommand): AskCommand {
  return input?.hint
    ? { name, description, hint: input.hint }
    : { name, description };
}

/** What a question carries, as its entry shows it. */
function attachmentsOf({ mentions = [] }: AskQuestion): AskAttachment[] {
  return mentions.map((mention) => ({ kind: "file" as const, path: mention }));
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
function toolDetails(update: ToolCallUpdate) {
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
function toolOutput(update: ToolCallUpdate) {
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
function withContext(context: string, question: string): ContentBlock[] {
  return [
    { type: "text", text: `${CONTEXT_OPEN}\n${context}\n${CONTEXT_CLOSE}` },
    { type: "text", text: question },
  ];
}

/** A replayed first message, as the reviewer typed it. */
function withoutContext(text: string) {
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
function signedOut(error: unknown): error is RequestError {
  return (
    error instanceof RequestError &&
    error.code === RequestError.authRequired().code &&
    /auth/i.test(error.message)
  );
}

/** How long an agent may take to start and open its session. */
const START_TIMEOUT_MS = 60_000;

/** How long a turn may run on after Stop before Whiteboard stops its agent.
 * Claude's adapter ends a wedged turn itself after 30 seconds; Codex's does not. */
const STOP_GRACE_MS = 15_000;

/** How long an agent may take to start, and to stop a turn when asked. */
export interface AskThreadLimits {
  startMs: number;
  stopGraceMs: number;
}

const askThreadLimits: AskThreadLimits = {
  startMs: START_TIMEOUT_MS,
  stopGraceMs: STOP_GRACE_MS,
};

/** One Ask conversation: an agent process and one ACP session in the review's checkout. */
export class AskThread {
  readonly id: string;
  private state: AskThreadState;
  /** The number of changes so far; a snapshot carries the one it includes. */
  private seq = 0;
  private readonly listeners = new Set<(update: AskUpdate) => void>();
  private readonly closers = new Set<() => void>();
  private readonly decisions = new Map<
    string,
    (response: RequestPermissionResponse) => void
  >();
  private process?: AskAgentProcess;
  private connection?: ClientConnection;
  /** Counts connections, so a start that was given up on cannot take over. */
  private generation = 0;
  /** What the last agent process said on stderr, once it is gone. */
  private stderr = "";
  private sessionId?: string;
  private closed = false;
  /** The MCP server behind each tool call an adapter reported one for. */
  private readonly mcpCalls = new Map<string, string>();
  private readonly mcpServers: McpServer[];
  /** Loading an earlier conversation: the agent replays it as updates. */
  private replaying = false;
  /** Replayed user messages as sent, context included. */
  private readonly replayedUser = new Map<string, string>();
  /** The panel already shows the conversation, so a load's replay is not
   * needed: a saved copy, or the thread itself when it tries again. */
  private shown: boolean;
  /** The config option that sets each choice the agent offers. */
  private readonly configIds = new Map<AskChoiceKind, string>();
  /** The model and effort in use, which a new agent process starts with. */
  private readonly picks: AskPicks;
  /** The question being answered, until its turn ends; after a failure,
   * the one trying again asks. */
  private asking?: { id: string; question: AskQuestion };
  /** The session has not had the selection yet: a new conversation, or a
   * new session for one the agent could not reopen. */
  private needsContext: boolean;
  /** The agent could not reopen the session, for a reason signing in would
   * not fix, so trying again starts a new one. */
  private unloadable = false;
  /** Stop ended the agent itself: a start, or a turn that would not stop. */
  private halted = false;
  private stopTimer?: ReturnType<typeof setTimeout>;
  /** What Pi greets a new session with, its version and skills, which is no
   * part of the answer. */
  private greeting?: string;

  constructor(
    private readonly launch: AskAgentLauncher,
    private readonly start: AskThreadStart,
    mcpServers: AskMcpServers = () => [],
    private readonly limits: AskThreadLimits = askThreadLimits,
  ) {
    this.id = start.id ?? randomUUID();
    this.mcpServers = mcpServers();
    this.picks = { ...start.picks };
    this.state = {
      id: this.id,
      agent: start.agent,
      agentName: askAgents[start.agent].name,
      status: "starting",
      readOnly: false,
      head: start.head,
      cwd: start.cwd,
      selection: start.selection,
      entries: ("resume" in start && start.resume.entries) || [],
    };

    if ("resume" in start) this.sessionId = start.resume.sessionId;
    this.shown = "resume" in start && Boolean(start.resume.entries);
    this.needsContext = !("resume" in start);
  }

  get reviewId() {
    return this.start.reviewId;
  }

  read(): AskThreadState {
    return this.state;
  }

  snapshot(): AskUpdate {
    return { seq: this.seq, snapshot: this.state };
  }

  /** Every change after the current `seq`, in order. */
  subscribe(listener: (update: AskUpdate) => void) {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  /** Starts the agent and asks the first question, or loads an earlier
   * conversation; failures land in the state. */
  async open() {
    const start = this.start;

    if ("resume" in start) {
      await this.attempt(async () => {
        await this.connect();
        this.emit({ type: "set", status: "idle" });
      });

      return;
    }

    this.asking = {
      id: this.addUser(start.question),
      question: start.question,
    };
    await this.attempt(async () => {
      await this.connect();
      await this.prompt(start.question);
    });
  }

  /** Why a question cannot be asked now, if it cannot. */
  askRefusal(): string | undefined {
    switch (this.state.status) {
      case "idle":
        return undefined;
      case "failed":
        return `${this.state.agentName} stopped. Try again first.`;
      default:
        return "The agent is still answering.";
    }
  }

  /** Asks a follow-up, starting the agent again if it has stopped since. */
  async ask(question: AskQuestion) {
    const refusal = this.askRefusal();

    if (refusal) throw new Error(refusal);

    this.asking = { id: this.addUser(question), question };
    await this.attempt(async () => {
      await this.reconnect();
      await this.prompt(question);
    });
  }

  /** Starts the agent again after it failed, as when its login lapsed, and
   * asks again the question it did not answer, if one failed. */
  async retry() {
    if (this.state.status !== "failed")
      throw new Error("Only a conversation that failed can try again.");

    this.disconnect();

    const asked = this.state.entries.findIndex(
      (entry) => entry.kind === "user" && entry.id === this.asking?.id,
    );

    const question = asked === -1 ? undefined : this.asking?.question;

    // What the failed turn left, such as the agent's own login notice. A
    // reopen that failed left nothing: its last answer stays.
    const partial = asked === -1 ? [] : this.state.entries.slice(asked + 1);

    if (partial.length)
      this.emit({ type: "remove", ids: partial.map((entry) => entry.id) });

    if (this.unloadable) {
      this.unloadable = false;
      this.sessionId = undefined;
      this.needsContext = true;
    }

    this.emit({ type: "set", status: "starting", error: null, signIn: null });
    await this.attempt(async () => {
      await this.connect();

      if (question) await this.prompt(question);
      else this.emit({ type: "set", status: "idle" });
    });
  }

  decide(permissionId: string, optionId: string) {
    const resolve = this.decisions.get(permissionId);

    if (!resolve) return false;
    resolve({ outcome: { outcome: "selected", optionId } });

    return true;
  }

  /** Stops the turn, or the start, in progress. A turn the agent does not
   * end soon after is ended by stopping the agent. */
  async cancel() {
    // ACP: the Client answers every pending permission request as cancelled.
    for (const resolve of this.decisions.values())
      resolve({ outcome: { outcome: "cancelled" } });

    const { status } = this.state;

    if (status === "starting") {
      this.halt();

      return;
    }

    const { connection, sessionId } = this;

    if ((status !== "running" && status !== "waiting") || !connection) return;

    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      if (this.connection === connection) this.halt();
    }, this.limits.stopGraceMs);

    if (sessionId)
      await connection.agent
        .notify(methods.agent.session.cancel, { sessionId })
        .catch(() => {});
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    // A conversation still starting may be half replayed, and one that
    // failed has nothing new; neither replaces what was saved.
    if (
      this.sessionId &&
      this.state.status !== "starting" &&
      this.state.status !== "failed"
    )
      this.start.onSave?.(settled(this.state.entries));

    for (const resolve of this.decisions.values())
      resolve({ outcome: { outcome: "cancelled" } });

    if (this.connection && this.sessionId)
      void this.connection.agent
        .notify(methods.agent.session.cancel, { sessionId: this.sessionId })
        .catch(() => {});
    this.disconnect();
    this.listeners.clear();

    for (const closed of this.closers) closed();
    this.closers.clear();
  }

  /** Runs when the thread closes, at once if it already has. */
  onClose(closed: () => void) {
    if (this.closed) {
      closed();

      return () => {};
    }

    this.closers.add(closed);

    return () => this.closers.delete(closed);
  }

  /** Runs a step that talks to the agent; failures land in the state. */
  private async attempt(step: () => Promise<void>) {
    this.halted = false;

    try {
      await step();
    } catch (error) {
      if (this.closed) return;

      if (this.halted) this.stopped();
      else this.fail(error);
    }
  }

  /** Stop ended the agent before a turn could: nothing is running now, and
   * the next question starts the agent again. */
  private stopped() {
    this.halted = false;

    if (this.asking)
      this.push({
        kind: "notice",
        id: randomUUID(),
        severity: "info",
        title: "Stopped here.",
      });
    this.asking = undefined;
    this.emit({ type: "set", status: "idle", error: null });
  }

  /** Ends the agent process, failing whatever was waiting on it. */
  private halt() {
    this.halted = true;
    this.disconnect();
  }

  private disconnect() {
    this.generation += 1;
    clearTimeout(this.stopTimer);

    if (this.process) this.stderr = this.process.diagnostics();
    this.connection?.close();
    this.process?.stop();
    this.connection = undefined;
    this.process = undefined;
  }

  /** Starts the agent again if it stopped since the last turn. */
  private async reconnect() {
    if (this.connection && !this.connection.signal.aborted) return;

    this.disconnect();
    this.emit({ type: "set", status: "starting" });
    await this.connect();
  }

  /** Starts the agent and opens the session, or gives up after a while. */
  private async connect() {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `${this.state.agentName} did not start within ${Math.round(this.limits.startMs / 1000)} seconds.`,
            ),
          ),
        this.limits.startMs,
      );
    });

    const starting = this.startAgent();

    // A start given up on fails later, once its agent is stopped.
    starting.catch(() => {});

    try {
      await Promise.race([starting, expired]);
    } catch (error) {
      this.disconnect();

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async startAgent() {
    const generation = ++this.generation;
    const launched = await this.launch(this.start.agent, this.start.cwd);

    // Closed, stopped or given up on while the process started.
    if (this.closed || this.halted || generation !== this.generation) {
      launched.stop();

      throw new Error(`${this.state.agentName} was stopped while it started.`);
    }

    this.process = launched;

    // Advertise no file system or terminal: the agent reads the checkout itself.
    const connection = launched.connect(
      client({ name: "whiteboard" })
        .onRequest(
          methods.client.session.requestPermission,
          ({ params, signal }) => this.requestPermission(params, signal),
        )
        .onNotification(methods.client.session.update, ({ params }) =>
          this.update(params),
        )
        // Cursor waits on an answer to its todo list before it carries on.
        .onRequest("cursor/update_todos", cursorTodosSchema, ({ params }) => ({
          outcome: { outcome: "accepted", todos: params.todos },
        })),
    );

    this.connection = connection;

    const agent = connection.agent;

    const initialized = await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      // Notices keep an agent's asides about itself (Codex's warnings about
      // its own config) out of the answer's text.
      // Cursor offers its models as config options only when asked to.
      clientCapabilities: {
        session: { notices: {} },
        _meta: { parameterizedModelPicker: true },
      },
      clientInfo: { name: "whiteboard", title: "Whiteboard", version: "1" },
    });

    const session = await this.session(
      connection,
      generation,
      initialized.agentCapabilities?.loadSession === true,
    );

    const mode = askAgents[this.start.agent].readOnlyMode;

    // An agent without a read-only mode still answers, as it is.
    const configurable =
      mode !== undefined &&
      session.response.configOptions?.some(
        (option) =>
          option.id === "mode" &&
          option.type === "select" &&
          selectOptionsSchema
            .safeParse(option.options)
            .data?.flatMap((choice) =>
              "group" in choice ? choice.options : [choice],
            )
            .some((choice) => choice.value === mode),
      );

    const selectable =
      mode !== undefined &&
      session.response.modes?.availableModes.some(
        (available) => available.id === mode,
      );

    let config = session.response.configOptions;

    if (configurable)
      config =
        (
          await agent.request(methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: "mode",
            value: mode,
          })
        ).configOptions ?? config;
    else if (selectable)
      await agent.request(methods.agent.session.setMode, {
        sessionId: session.sessionId,
        modeId: mode,
      });

    this.emit({ type: "set", readOnly: Boolean(configurable || selectable) });
    this.useConfig(config);

    // The model first: the efforts on offer depend on it. A pick the agent
    // no longer offers keeps its default.
    for (const kind of askChoiceKinds) {
      const picked = this.picks[kind];
      const select = this.state.choices?.[kind];

      if (
        picked &&
        picked !== select?.current &&
        select?.options.some((option) => option.value === picked)
      )
        await this.change(kind, picked);
    }
  }

  /** Answers the next question with another model or effort, starting the
   * agent again if it has stopped since. */
  async choose(kind: AskChoiceKind, value: string) {
    if (this.state.status !== "idle")
      throw new Error("Settings can change between answers.");

    if (!this.connection || this.connection.signal.aborted) {
      await this.attempt(async () => {
        await this.reconnect();
        this.emit({ type: "set", status: "idle" });
      });

      if (this.state.status !== "idle") return;
    }

    await this.change(kind, value);
  }

  private async change(kind: AskChoiceKind, value: string) {
    const configId = this.configIds.get(kind);

    if (!this.connection || !this.sessionId || !configId)
      throw new Error(`${this.state.agentName} offers no such choice.`);

    const response = await this.connection.agent.request(
      methods.agent.session.setConfigOption,
      { sessionId: this.sessionId, configId, value },
    );

    this.picks[kind] = value;
    this.useConfig(response.configOptions);
  }

  private useConfig(options: SessionConfigOption[] | null | undefined) {
    const found = choicesOf(options);

    if (!found.size) return;
    const choices: AskChoices = {};

    for (const [kind, { configId, select }] of found) {
      this.configIds.set(kind, configId);
      choices[kind] = select;
    }

    this.emit({ type: "set", choices });
    this.announce();
  }

  /** Tells the host what the agent offers now. */
  private announce() {
    const { choices = {}, commands } = this.state;
    const offer: AskOffer = { choices };

    if (commands) offer.commands = commands;
    this.start.onOffer?.(offer);
  }

  /** The agent says which mode it is in now; only its read-only one keeps
   * the checkout as it is. */
  private useMode(mode: string) {
    const readOnly = mode === askAgents[this.start.agent].readOnlyMode;

    if (readOnly !== this.state.readOnly) this.emit({ type: "set", readOnly });
  }

  /** A new session, or the earlier one loaded with its history replayed. */
  private async session(
    connection: ClientConnection,
    generation: number,
    canLoad: boolean,
  ) {
    const agent = connection.agent;
    const start = this.start;
    const name = this.state.agentName;
    // Reopening, or trying again, loads the session there is.
    const earlier = this.sessionId;

    if (!earlier) {
      const response = await agent.request(methods.agent.session.new, {
        cwd: start.cwd,
        mcpServers: this.mcpServers,
        _meta: askAgents[start.agent].sessionMeta,
      });

      this.sessionId = response.sessionId;
      start.onSession?.(response.sessionId);

      this.greeting = piGreetingSchema.safeParse(
        response._meta,
      ).data?.piAcp.startupInfo;

      return { sessionId: response.sessionId, response };
    }

    // Trying again cannot help: continue in a new session instead.
    const unloadable = (reason: string, cause?: unknown) => {
      this.unloadable = true;

      return new Error(
        `${name} could not reopen this conversation. ${reason} Try again to continue it in a new session, which starts without what was said before.`,
        { cause },
      );
    };

    if (!canLoad) throw unloadable(`${name} cannot reopen past conversations.`);
    this.shown ||= this.state.entries.length > 0;
    // The replay arrives before the response, addressed to this session.
    this.replaying = true;

    try {
      const response = await agent.request(methods.agent.session.load, {
        sessionId: earlier,
        cwd: start.cwd,
        mcpServers: this.mcpServers,
        _meta: askAgents[start.agent].sessionMeta,
      });

      return { sessionId: earlier, response };
    } catch (error) {
      // A lapsed login, Stop, or a start given up on: the session may
      // still be there.
      if (
        signedOut(error) ||
        this.closed ||
        this.halted ||
        generation !== this.generation
      )
        throw error;

      throw unloadable(errorMessage(error), error);
    } finally {
      this.replaying = false;
    }
  }

  /** Asks a question in the session, with the selection first if the
   * session has not had it. */
  private async prompt(question: AskQuestion) {
    const { connection, sessionId } = this;

    if (!connection || !sessionId)
      throw new Error(`${this.state.agentName} is not running.`);

    // Agents read a slash command only at the start of a prompt, so it goes
    // alone; the selection goes with the next question instead.
    const withSelection = this.needsContext && !question.text.startsWith("/");

    this.emit({ type: "set", status: "running", error: null });

    const prompt: ContentBlock[] = [
      ...(withSelection
        ? withContext(this.start.context, question.text)
        : [{ type: "text" as const, text: question.text }]),
      ...this.attachments(question),
    ];

    let stopReason: StopReason;

    try {
      ({ stopReason } = await connection.agent.request(
        methods.agent.session.prompt,
        { sessionId, prompt },
      ));
    } catch (error) {
      // Stop ended an agent that would not stop the turn itself.
      if (!this.halted) throw error;
      stopReason = "cancelled";
      this.halted = false;
    } finally {
      clearTimeout(this.stopTimer);
    }

    if (withSelection) this.needsContext = false;
    this.asking = undefined;

    // An answer cut off by Stop ends mid-sentence; say where it stopped.
    if (stopReason === "cancelled")
      this.push({
        kind: "notice",
        id: randomUUID(),
        severity: "info",
        title: "Stopped here.",
      });

    this.emit({
      type: "set",
      status: "idle",
      error:
        stopReason === "refusal"
          ? `${this.state.agentName} declined to answer.`
          : stopReason === "max_tokens" || stopReason === "max_turn_requests"
            ? `${this.state.agentName} stopped before finishing.`
            : null,
    });
    this.start.onTurn?.();
    this.start.onSave?.(this.state.entries);
  }

  private async requestPermission(
    request: RequestPermissionRequest,
    /** Aborts when the agent withdraws the request, or goes away. */
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    const id = request.toolCall.toolCallId;
    const toolKind = request.toolCall.kind ?? "other";
    const server = mcpServerOf(request.toolCall) ?? this.mcpCalls.get(id);

    const allowOnce = request.options.find(
      (option) => option.kind === "allow_once",
    );

    // Whiteboard's own tools, and tools that only read, run without asking.
    // Allow once, never "always": an adapter may save an "always" rule into
    // the checkout's settings.
    if (
      allowOnce &&
      server &&
      (READ_ONLY_MCP_SERVERS.has(server) ||
        this.mcpServers.some((provided) => provided.name === server))
    )
      return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };

    // Codex titles a command's request only "Run command"; what it would run
    // is in the request, or in the tool call it started.
    const input =
      toolDetails(request.toolCall).input ??
      this.state.entries.find(
        (entry): entry is ToolEntry => entry.kind === "tool" && entry.id === id,
      )?.input;

    const entry: PermissionEntry = {
      kind: "permission",
      id,
      title: request.toolCall.title ?? "Run a tool",
      toolKind,
      options: request.options,
    };

    if (input) entry.input = input;

    if (REFUSED_KINDS.has(toolKind)) {
      const reject = request.options.find(
        (option) => option.kind === "reject_once",
      );

      this.push({
        ...entry,
        outcome: reject?.optionId ?? "cancelled",
        automatic: true,
      });

      return reject
        ? { outcome: { outcome: "selected", optionId: reject.optionId } }
        : { outcome: { outcome: "cancelled" } };
    }

    this.push(entry);
    this.emit({ type: "set", status: "waiting" });

    const response = await new Promise<RequestPermissionResponse>((resolve) => {
      this.decisions.set(id, resolve);

      // Nothing waits on a request its agent withdrew: it is no longer
      // the reviewer's to answer.
      const withdrawn = () => resolve({ outcome: { outcome: "cancelled" } });

      if (signal.aborted) withdrawn();
      else signal.addEventListener("abort", withdrawn, { once: true });
    });

    this.decisions.delete(id);
    this.replace(id, "permission", (current) => ({
      ...current,
      outcome:
        response.outcome.outcome === "selected"
          ? response.outcome.optionId
          : "cancelled",
    }));

    // The agent carries on, unless it still waits on another answer.
    if (this.state.status === "waiting" && !this.decisions.size)
      this.emit({ type: "set", status: "running" });

    return response;
  }

  private update({ sessionId, update }: SessionNotification) {
    if (sessionId !== this.sessionId) return;
    this.apply(update);
  }

  private apply(update: SessionUpdate) {
    if (this.useSessionState(update)) return;

    // The saved copy already shows what the agent replays.
    if (this.replaying && this.shown) return;

    switch (update.sessionUpdate) {
      // Only a loaded conversation replays what the reviewer asked.
      case "user_message_chunk":
        if (this.replaying && update.content.type === "text")
          this.replayUser(update.content.text, update.messageId ?? undefined);

        return;
      case "agent_message_chunk": {
        if (update.content.type !== "text") return;

        const { text } = update.content;

        if (text === this.greeting) {
          this.greeting = undefined;

          return;
        }

        const last = this.state.entries.at(-1);
        const id = update.messageId ?? undefined;

        if (last?.kind === "agent" && (!id || last.id === id)) {
          this.emit({ type: "append", id: last.id, text });

          return;
        }

        this.push({ kind: "agent", id: id ?? randomUUID(), text });

        return;
      }

      case "config_option_update": {
        this.useConfig(update.configOptions);

        const mode = update.configOptions.find(
          (option) => option.id === "mode" && option.type === "select",
        );

        if (mode?.type === "select") this.useMode(mode.currentValue);

        return;
      }

      case "current_mode_update":
        this.useMode(update.currentModeId);

        return;
      case "notice": {
        const notice: NoticeEntry = {
          kind: "notice",
          id: randomUUID(),
          severity: update.severity,
          title: update.title,
        };

        if (update.description) notice.description = update.description;
        this.push(notice);

        return;
      }

      case "tool_call":
        this.noteMcpServer(update);
        this.push({
          kind: "tool",
          id: update.toolCallId,
          title: update.title,
          toolKind: update.kind ?? "other",
          status: update.status ?? "pending",
          ...toolDetails(update),
        });
        this.showPlan(update);

        return;
      case "tool_call_update":
        this.noteMcpServer(update);

        // An agent may report a tool call's first state as an update.
        if (
          !this.state.entries.some(
            (entry) => entry.kind === "tool" && entry.id === update.toolCallId,
          )
        ) {
          this.push({
            kind: "tool",
            id: update.toolCallId,
            title: update.title ?? "Tool call",
            toolKind: update.kind ?? "other",
            status: update.status ?? "pending",
            ...toolDetails(update),
          });
          this.showPlan(update);

          return;
        }

        this.replace(update.toolCallId, "tool", (current) => {
          const status = update.status ?? current.status;

          const output =
            status === "completed" || status === "failed"
              ? toolOutput(update)
              : undefined;

          const next = {
            ...current,
            title: update.title ?? current.title,
            toolKind: update.kind ?? current.toolKind,
            status,
            // The complete input can come after the call starts.
            ...toolDetails(update),
          };

          if (output) next.output = output;

          return next;
        });
        this.showPlan(update);

        return;
      default:
    }
  }

  /** What the session says about itself rather than the turn: its
   * commands. A reload's replay keeps them. */
  private useSessionState(update: SessionUpdate) {
    switch (update.sessionUpdate) {
      case "available_commands_update":
        this.emit({
          type: "set",
          commands: update.availableCommands.map(commandOf),
        });
        this.announce();

        return true;
      default:
        return false;
    }
  }

  private noteMcpServer(update: ToolCallUpdate) {
    const server = mcpServerOf(update);

    if (server) this.mcpCalls.set(update.toolCallId, server);
  }

  /**
   * In its read-only mode Claude answers by writing a plan and asking to
   * leave the mode with it. That request is refused, so the plan is shown
   * as the answer; the refusal's own text, once it comes, is not.
   */
  private showPlan(update: ToolCallUpdate) {
    const call = this.state.entries.find(
      (entry) => entry.kind === "tool" && entry.id === update.toolCallId,
    );

    if (
      call?.kind !== "tool" ||
      call.toolKind !== "switch_mode" ||
      call.status === "completed" ||
      call.status === "failed"
    )
      return;

    const plan = (update.content ?? [])
      .flatMap((item) =>
        item.type === "content" && item.content.type === "text"
          ? [item.content.text]
          : [],
      )
      .join("\n\n")
      .trim();

    if (!plan) return;
    const id = `plan:${update.toolCallId}`;

    if (this.state.entries.some((entry) => entry.id === id))
      this.replace(id, "agent", (current) => ({ ...current, text: plan }));
    else this.push({ kind: "agent", id, text: plan });
  }

  /** Chunks of one replayed message join, like an answer's. */
  private replayUser(text: string, messageId: string | undefined) {
    const last = this.state.entries.at(-1);

    if (
      last?.kind === "user" &&
      this.replayedUser.has(last.id) &&
      (!messageId || last.id === messageId)
    ) {
      const sent = this.replayedUser.get(last.id) + text;

      this.replayedUser.set(last.id, sent);
      this.emit({
        type: "entry",
        entry: { ...last, text: withoutContext(sent) },
      });

      return;
    }

    const id = messageId ?? randomUUID();

    this.replayedUser.set(id, text);
    this.push({ kind: "user", id, text: withoutContext(text) });
  }

  private addUser(question: AskQuestion) {
    const id = randomUUID();
    const attachments = attachmentsOf(question);

    const entry: Extract<AskEntry, { kind: "user" }> = {
      kind: "user",
      id,
      text: question.text,
      at: Date.now(),
    };

    if (attachments.length) entry.attachments = attachments;
    this.push(entry);

    return id;
  }

  /** A question's files, as links into the checkout. */
  private attachments(question: AskQuestion): ContentBlock[] {
    const root = path.resolve(this.start.cwd);
    const blocks: ContentBlock[] = [];

    for (const mention of question.mentions ?? []) {
      const file = path.resolve(root, mention);

      // Only the checkout's own files.
      if (!file.startsWith(root + path.sep)) continue;
      blocks.push({
        type: "resource_link",
        uri: pathToFileURL(file).href,
        name: path.basename(file),
        title: mention,
      });
    }

    return blocks;
  }

  private fail(cause: unknown) {
    if (this.closed) return;

    if (signedOut(cause)) {
      const { name, signIn } = askAgents[this.start.agent];

      this.emit({
        type: "set",
        status: "failed",
        error: `${name} is signed out.`,
        signIn,
      });

      return;
    }

    const diagnostics = (this.process?.diagnostics() ?? this.stderr).trim();

    this.emit({
      type: "set",
      status: "failed",
      error: [errorMessage(cause), diagnostics?.split("\n").at(-1)]
        .filter(Boolean)
        .join("\n"),
    });
  }

  private push(entry: AskEntry) {
    this.emit({ type: "add", entry });
  }

  private replace<Kind extends AskEntry["kind"]>(
    id: string,
    kind: Kind,
    change: (
      entry: Extract<AskEntry, { kind: Kind }>,
    ) => Extract<AskEntry, { kind: Kind }>,
  ) {
    const current = this.state.entries.find(
      (entry) => entry.id === id && entry.kind === kind,
    );

    if (current)
      this.emit({
        type: "entry",
        // SAFETY: current.kind === kind, and each kind has one entry shape.
        entry: change(current as Extract<AskEntry, { kind: Kind }>),
      });
  }

  /** The one way the state changes, so watchers can follow it change by change. */
  private emit(change: AskChange) {
    if (this.closed) return;
    this.state = applyAskChange(this.state, change);
    this.seq += 1;
    const update = { seq: this.seq, change };

    for (const listener of this.listeners) listener(update);
  }
}

/** How long an agent may take to say what it offers. */
const OFFER_TIMEOUT_MS = 30_000;

/** How long after its session opens an agent may take to list its
 * commands, which it sends on its own rather than in the response. */
const COMMANDS_WAIT_MS = 2_000;

/** What an agent offers, from a session it starts and leaves without
 * asking anything. */
async function offeredBy(
  launch: AskAgentLauncher,
  agent: AskAgentId,
  cwd: string,
): Promise<AskOffer> {
  const process = await launch(agent, cwd);
  // Stopping the process ends the connection, which fails its requests.
  const timer = setTimeout(() => process.stop(), OFFER_TIMEOUT_MS);
  let listed: (commands: AskCommand[]) => void = () => {};

  const commands = new Promise<AskCommand[]>((resolve) => {
    listed = resolve;
  });

  try {
    const connection = process.connect(
      client({ name: "whiteboard" }).onNotification(
        methods.client.session.update,
        ({ params: { update } }) => {
          if (update.sessionUpdate === "available_commands_update")
            listed(update.availableCommands.map(commandOf));
        },
      ),
    );

    await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { _meta: { parameterizedModelPicker: true } },
      clientInfo: { name: "whiteboard", title: "Whiteboard", version: "1" },
    });

    const session = await connection.agent.request(methods.agent.session.new, {
      cwd,
      mcpServers: [],
      _meta: askAgents[agent].sessionMeta,
    });

    const offer: AskOffer = { choices: {} };

    for (const [kind, { select }] of choicesOf(session.configOptions))
      offer.choices[kind] = select;

    let wait: ReturnType<typeof setTimeout> | undefined;

    const offered = await Promise.race([
      commands,
      new Promise<undefined>((resolve) => {
        wait = setTimeout(() => resolve(undefined), COMMANDS_WAIT_MS);
      }),
    ]).finally(() => clearTimeout(wait));

    if (offered) offer.commands = offered;

    return offer;
  } catch (error) {
    const diagnostics = process.diagnostics().trim();

    throw new Error(
      `${askAgents[agent].name} did not say what it offers. ${errorMessage(error)}${diagnostics ? `\n${diagnostics}` : ""}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    process.stop();
  }
}

/** The live Ask threads of one server; they end with it. */
export class AskThreads {
  private readonly threads = new Map<string, AskThread>();
  /** One question to each agent at a time about what it offers. */
  private readonly offers = new Map<AskAgentId, Promise<AskOffer>>();

  constructor(
    private readonly launch: AskAgentLauncher,
    private readonly mcpServers: AskMcpServers = () => [],
    private readonly limits: AskThreadLimits = askThreadLimits,
  ) {}

  /** Whether sessions get Whiteboard's MCP tools, which the first prompt mentions. */
  get providesMcp() {
    return this.mcpServers().length > 0;
  }

  open(start: AskThreadStart) {
    const thread = new AskThread(
      this.launch,
      start,
      this.mcpServers,
      this.limits,
    );

    this.threads.set(thread.id, thread);
    void thread.open();

    return thread;
  }

  get(id: string) {
    return this.threads.get(id);
  }

  /** What the agent offers to choose before anything is asked of it. */
  offered(agent: AskAgentId, cwd: string) {
    let offer = this.offers.get(agent);

    if (!offer) {
      offer = offeredBy(this.launch, agent, cwd).finally(() =>
        this.offers.delete(agent),
      );
      this.offers.set(agent, offer);
    }

    return offer;
  }

  close(id: string) {
    this.threads.get(id)?.close();
    this.threads.delete(id);
  }

  closeAll() {
    for (const id of [...this.threads.keys()]) this.close(id);
  }
}
