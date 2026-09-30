import {
  type AgentContext,
  type ClientConnection,
  type McpServer,
  RequestError,
  type RequestPermissionResponse,
  type SessionUpdate,
  type ToolKind,
  agent,
  methods,
} from "@agentclientprotocol/sdk";
import type { AskAgentLauncher } from "@review/ask/agents.js";
import {
  type AskChoices,
  type AskEntry,
  type AskPicks,
  type AskThreadState,
  applyAskChange,
  askUpdateSchema,
} from "@review/ask/thread-state.js";
import {
  AskThread,
  type AskThreadLimits,
  AskThreads,
} from "@review/ask/thread.js";
import { expect, it, vi } from "vitest";

const permissionOptions = [
  { optionId: "allow", name: "Allow once", kind: "allow_once" as const },
  { optionId: "deny", name: "Deny", kind: "reject_once" as const },
];

/** A scripted ACP agent. `turn` runs inside each `session/prompt`. */
function fakeAgent(
  turn: (client: AgentContext, prompt: string) => Promise<void>,
  /** Replays a saved session; without it the agent cannot load one. */
  load?: (client: AgentContext, sessionId: string) => Promise<void>,
) {
  const modes: string[] = [];
  const mcpServers: McpServer[][] = [];
  const metas: unknown[] = [];
  const cancelled = vi.fn<() => void>();
  let model = "default";
  let effort = "medium";

  // Like the real adapters: which efforts are offered depends on the model.
  const efforts = () =>
    model === "sonnet" ? ["low", "medium"] : ["low", "medium", "high"];

  const configOptions = () => [
    {
      id: "mode",
      name: "Mode",
      type: "select" as const,
      currentValue: "default",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
    },
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select" as const,
      currentValue: model,
      options: [
        { value: "default", name: "Default", description: "Opus 5" },
        { value: "sonnet", name: "Sonnet" },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      type: "select" as const,
      currentValue: effort,
      options: efforts().map((value) => ({ value, name: value })),
    },
  ];

  const app = agent({ name: "fake" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: Boolean(load) },
      authMethods: [],
    }))
    .onRequest(methods.agent.session.new, ({ params }) => {
      mcpServers.push(params.mcpServers);
      metas.push(params._meta);

      return { sessionId: "session", configOptions: configOptions() };
    })
    .onRequest(methods.agent.session.load, async ({ params, client }) => {
      mcpServers.push(params.mcpServers);
      metas.push(params._meta);
      await load?.(client, params.sessionId);

      return { configOptions: configOptions() };
    })
    .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
      if (params.configId === "model") {
        model = String(params.value);

        if (!efforts().includes(effort)) effort = "medium";
      } else if (params.configId === "reasoning_effort")
        effort = String(params.value);
      else modes.push(String(params.value));

      return { configOptions: configOptions() };
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      const before = cancelled.mock.calls.length;

      await turn(
        client,
        params.prompt
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n"),
      );

      // Like the real adapters, a turn cancelled while it ran says so.
      return {
        stopReason:
          cancelled.mock.calls.length > before
            ? ("cancelled" as const)
            : ("end_turn" as const),
      };
    })
    .onNotification(methods.agent.session.cancel, cancelled);

  const connections: ClientConnection[] = [];

  // Stopping the process ends its connection, as the real one's exit does.
  const launch: AskAgentLauncher = async () => {
    let connection: ClientConnection | undefined;

    return {
      connect: (client) => {
        connection = client.connect(app);
        connections.push(connection);

        return connection;
      },
      diagnostics: () => "",
      stop: () => connection?.close(),
    };
  };

  return {
    launch,
    modes,
    mcpServers,
    metas,
    cancelled,
    /** How many times the agent started. */
    launches: () => connections.length,
    /** The agent process exits on its own. */
    exit: () => connections.at(-1)?.close(),
  };
}

/** An agent that starts but never answers `initialize`, then `next`. */
function stuckOnce(next: AskAgentLauncher): AskAgentLauncher {
  let stuck = true;

  const app = agent({ name: "stuck" }).onRequest(
    methods.agent.initialize,
    () => new Promise<never>(() => {}),
  );

  return async (id, cwd) => {
    if (!stuck) return next(id, cwd);
    stuck = false;
    let connection: ClientConnection | undefined;

    return {
      connect: (client) => (connection = client.connect(app)),
      diagnostics: () => "",
      stop: () => connection?.close(),
    };
  };
}

const say = (client: AgentContext, text: string) =>
  client.notify(methods.client.session.update, {
    sessionId: "session",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  });

const askPermission = (
  client: AgentContext,
  kind: ToolKind,
  cancellationSignal?: AbortSignal,
) =>
  client.request<RequestPermissionResponse>(
    methods.client.session.requestPermission,
    {
      sessionId: "session",
      toolCall: { toolCallId: `call-${kind}`, title: `A ${kind} tool`, kind },
      options: permissionOptions,
    },
    { cancellationSignal },
  );

function openThread(
  launch: AskAgentLauncher,
  mcpServers: () => McpServer[] = () => [],
  options: {
    picks?: AskPicks;
    onChoices?: (choices: AskChoices) => void;
    limits?: AskThreadLimits;
  } = {},
) {
  const { limits, ...start } = options;

  const thread = new AskThread(
    launch,
    {
      reviewId: "review",
      agent: "claude",
      cwd: "/checkout",
      head: "abc123",
      selection: { title: "Paragraph 3", quote: "The index is concurrent." },
      context: "Selected text from Whiteboard.",
      question: "Is this safe?",
      ...start,
    },
    mcpServers,
    limits,
  );

  void thread.open();

  return thread;
}

function until(
  thread: AskThread,
  predicate: (state: AskThreadState) => boolean,
) {
  return new Promise<AskThreadState>((resolve) => {
    const check = () => {
      if (predicate(thread.read())) {
        stop();
        resolve(thread.read());
      }
    };

    const stop = thread.subscribe(check);
    check();
  });
}

it("asks in read-only mode and streams the answer and tool activity", async () => {
  const prompts: string[] = [];

  const { launch, modes } = fakeAgent(async (client, prompt) => {
    prompts.push(prompt);

    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "read",
        title: "Read db/migrate/runner.ts",
        kind: "read",
        status: "in_progress",
      },
    });

    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "read",
        status: "completed",
      },
    });

    await say(client, "It does, ");
    await say(client, "because 0042 opts out.");
  });

  const thread = openThread(launch);
  const state = await until(thread, ({ status }) => status === "idle");

  expect(modes).toEqual(["default"]);
  expect(state.readOnly).toBe(true);
  expect(prompts[0]).toContain("Selected text from Whiteboard.");
  expect(prompts[0]).toContain("Is this safe?");

  expect(state.entries).toEqual([
    {
      kind: "user",
      id: expect.any(String),
      text: "Is this safe?",
      at: expect.any(Number),
    },
    {
      kind: "tool",
      id: "read",
      title: "Read db/migrate/runner.ts",
      toolKind: "read",
      status: "completed",
    },
    {
      kind: "agent",
      id: expect.any(String),
      text: "It does, because 0042 opts out.",
    },
  ]);

  await thread.ask("And on replicas?");
  await until(thread, ({ status }) => status === "idle");

  expect(prompts[1]).toBe("And on replicas?");
  thread.close();
});

it("waits for the user to decide a command and returns their choice", async () => {
  let decision: RequestPermissionResponse | undefined;

  const { launch } = fakeAgent(async (client) => {
    decision = await askPermission(client, "execute");
  });

  const thread = openThread(launch);

  const waiting = await until(thread, ({ status }) => status === "waiting");

  expect(waiting.entries.at(-1)).toMatchObject({
    kind: "permission",
    id: "call-execute",
    options: permissionOptions,
  });

  expect(thread.decide("call-execute", "allow")).toBe(true);

  const done = await until(thread, ({ status }) => status === "idle");

  expect(decision).toEqual({
    outcome: { outcome: "selected", optionId: "allow" },
  });
  expect(done.entries.at(-1)).toMatchObject({ outcome: "allow" });
  expect(thread.decide("call-execute", "allow")).toBe(false);
  thread.close();
});

it("refuses file changes without asking the user", async () => {
  const decisions: RequestPermissionResponse[] = [];

  const { launch } = fakeAgent(async (client) => {
    for (const kind of ["edit", "delete", "move"] as const)
      decisions.push(await askPermission(client, kind));
  });

  const thread = openThread(launch);
  const state = await until(thread, ({ status }) => status === "idle");

  expect(decisions).toEqual(
    Array(3).fill({ outcome: { outcome: "selected", optionId: "deny" } }),
  );
  expect(
    state.entries.filter((entry) => entry.kind === "permission"),
  ).toMatchObject(Array(3).fill({ automatic: true, outcome: "deny" }));
  thread.close();
});

it("cancels a pending decision and tells the agent to stop", async () => {
  let decision: RequestPermissionResponse | undefined;

  const { launch, cancelled } = fakeAgent(async (client) => {
    decision = await askPermission(client, "execute");
  });

  const thread = openThread(launch);

  await until(thread, ({ status }) => status === "waiting");
  await thread.cancel();

  const state = await until(thread, ({ status }) => status === "idle");

  expect(decision).toEqual({ outcome: { outcome: "cancelled" } });
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());

  // The request goes unanswered, and the turn says where it stopped.
  expect(state.entries.slice(-2)).toMatchObject([
    { kind: "permission", outcome: "cancelled" },
    { kind: "notice" },
  ]);
  thread.close();
});

it("streams changes that rebuild the thread exactly, in order", async () => {
  const { launch } = fakeAgent(async (client, prompt) => {
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "read",
        title: "Read db/migrate/runner.ts",
        kind: "read",
        status: "in_progress",
      },
    });
    await say(client, "It does, ");
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "read",
        status: "completed",
      },
    });
    await say(client, "because 0042 opts out.");

    if (prompt === "Prove it.") await askPermission(client, "execute");
  });

  const thread = openThread(launch);
  const first = askUpdateSchema.parse(thread.snapshot());
  let seq = first.seq;
  let state = "snapshot" in first ? first.snapshot : null;
  const mismatches: number[] = [];

  thread.subscribe((sent) => {
    // What the panel receives: the update after a trip through JSON.
    const update = askUpdateSchema.parse(JSON.parse(JSON.stringify(sent)));

    if (!("change" in update) || !state || update.seq !== seq + 1) {
      mismatches.push(-update.seq);

      return;
    }

    seq = update.seq;
    state = applyAskChange(state, update.change);

    if (JSON.stringify(state) !== JSON.stringify(thread.read()))
      mismatches.push(seq);
  });

  await until(thread, ({ status }) => status === "idle");
  // The turn ends only after the decision, so the ask is not awaited.
  const asked = thread.ask("Prove it.");
  await until(thread, ({ status }) => status === "waiting");
  thread.decide("call-execute", "allow");
  await asked;

  expect(mismatches).toEqual([]);
  expect(state).toEqual(thread.read());
  expect(seq).toBeGreaterThan(10);
  thread.close();
});

it("reports an agent that cannot start", async () => {
  const thread = openThread(async () => {
    throw new Error("Codex is not installed.");
  });

  const state = await until(thread, ({ status }) => status === "failed");

  expect(state.error).toBe("Codex is not installed.");
});

const whiteboardMcp: McpServer = {
  name: "whiteboard",
  command: "/usr/bin/whiteboard",
  args: ["mcp"],
  env: [],
};

it("gives the agent Whiteboard's MCP server and runs its tools, and read-only search, without asking", async () => {
  const decisions: RequestPermissionResponse[] = [];

  const options = [
    { optionId: "always", name: "Always allow", kind: "allow_always" as const },
    { optionId: "once", name: "Allow", kind: "allow_once" as const },
    { optionId: "deny", name: "Deny", kind: "reject_once" as const },
  ];

  const { launch, mcpServers } = fakeAgent(async (client) => {
    // Claude names the server in the permission request's _meta.
    decisions.push(
      await client.request<RequestPermissionResponse>(
        methods.client.session.requestPermission,
        {
          sessionId: "session",
          toolCall: {
            toolCallId: "claude-call",
            title: "mcp__whiteboard__session_get",
            kind: "other",
            _meta: {
              claudeCode: {
                toolName: "mcp__whiteboard__session_get",
                mcpServer: { name: "whiteboard", source: "acp" },
              },
            },
          },
          options,
        },
      ),
    );

    // Codex names it in the tool call, then asks about that call by id.
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "codex-call",
        title: "mcp.whiteboard.session_get",
        kind: "execute",
        rawInput: { server: "whiteboard", tool: "session_get", arguments: {} },
      },
    });
    decisions.push(
      await client.request<RequestPermissionResponse>(
        methods.client.session.requestPermission,
        {
          sessionId: "session",
          toolCall: { toolCallId: "codex-call", kind: "execute" },
          options,
        },
      ),
    );

    // A search server that only reads runs too.
    decisions.push(
      await client.request<RequestPermissionResponse>(
        methods.client.session.requestPermission,
        {
          sessionId: "session",
          toolCall: {
            toolCallId: "search-call",
            title: "mcp__fff__grep",
            kind: "other",
            _meta: {
              claudeCode: { mcpServer: { name: "fff", source: "user" } },
            },
          },
          options,
        },
      ),
    );

    // Another server's tool still waits for the reviewer.
    decisions.push(
      await client.request<RequestPermissionResponse>(
        methods.client.session.requestPermission,
        {
          sessionId: "session",
          toolCall: {
            toolCallId: "other-call",
            title: "mcp__github__create_issue",
            kind: "other",
            _meta: {
              claudeCode: { mcpServer: { name: "github", source: "user" } },
            },
          },
          options,
        },
      ),
    );
  });

  const thread = openThread(launch, () => [whiteboardMcp]);
  const waiting = await until(thread, ({ status }) => status === "waiting");

  expect(mcpServers).toEqual([[whiteboardMcp]]);
  expect(decisions).toEqual([
    { outcome: { outcome: "selected", optionId: "once" } },
    { outcome: { outcome: "selected", optionId: "once" } },
    { outcome: { outcome: "selected", optionId: "once" } },
  ]);
  expect(
    waiting.entries
      .filter((entry) => entry.kind === "permission")
      .map((entry) => entry.id),
  ).toEqual(["other-call"]);

  thread.decide("other-call", "deny");
  await until(thread, ({ status }) => status === "idle");
  thread.close();
});

function reopenThread(
  launch: AskAgentLauncher,
  saved: {
    entries?: AskEntry[];
    onSave?: (entries: AskEntry[]) => void;
    onSession?: (sessionId: string) => void;
  } = {},
) {
  const thread = new AskThread(launch, {
    reviewId: "review",
    agent: "claude",
    cwd: "/checkout",
    head: "abc123",
    selection: { title: "Paragraph 3", quote: "The index is concurrent." },
    context: "Selected text from Whiteboard.",
    resume: { sessionId: "session", entries: saved.entries },
    onSave: saved.onSave,
    onSession: saved.onSession,
  });

  void thread.open();

  return thread;
}

const replay = (client: AgentContext, update: SessionUpdate) =>
  client.notify(methods.client.session.update, {
    sessionId: "session",
    update,
  });

it("reopens a saved conversation as the reviewer saw it and continues it", async () => {
  const prompts: string[] = [];

  const { launch } = fakeAgent(
    async (client, prompt) => {
      prompts.push(prompt);
      await say(client, "Yes, replicas too.");
    },
    async (client) => {
      // The first question arrives with the context Whiteboard sent it.
      for (const text of [
        "<whiteboard-context>\nSelected text from Whiteboard.\n",
        "</whiteboard-context>",
        "Is this safe?",
      ])
        await replay(client, {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text },
        });

      await replay(client, {
        sessionUpdate: "tool_call",
        toolCallId: "read",
        title: "Read db/migrate/runner.ts",
        kind: "read",
        status: "completed",
      });
      await say(client, "It does, ");
      await say(client, "because 0042 opts out.");
    },
  );

  const thread = reopenThread(launch);
  const state = await until(thread, ({ status }) => status === "idle");

  expect(state.entries).toEqual([
    { kind: "user", id: expect.any(String), text: "Is this safe?" },
    {
      kind: "tool",
      id: "read",
      title: "Read db/migrate/runner.ts",
      toolKind: "read",
      status: "completed",
    },
    {
      kind: "agent",
      id: expect.any(String),
      text: "It does, because 0042 opts out.",
    },
  ]);

  await thread.ask("And on replicas?");
  const answered = await until(thread, ({ status }) => status === "idle");

  expect(prompts).toEqual(["And on replicas?"]);
  expect(answered.entries.slice(3)).toMatchObject([
    { kind: "user", text: "And on replicas?" },
    { kind: "agent", text: "Yes, replicas too." },
  ]);
  thread.close();
});

it("says a signed-out agent needs signing in, and asks again once it is", async () => {
  let signedIn = false;
  const prompts: string[] = [];
  const loaded: string[] = [];

  const { launch } = fakeAgent(
    async (client, prompt) => {
      prompts.push(prompt);

      if (!signedIn) {
        await say(client, "Failed to authenticate: OAuth session expired");

        throw RequestError.authRequired();
      }

      await say(client, "It is.");
    },
    async (client, sessionId) => {
      loaded.push(sessionId);
      // The panel shows the conversation already; this replay is not wanted.
      await say(client, "A replayed answer.");
    },
  );

  const thread = openThread(launch);
  const failed = await until(thread, ({ status }) => status === "failed");

  expect(failed.signIn).toBe("claude auth login");

  signedIn = true;
  await thread.retry();

  const state = await until(thread, ({ status }) => status === "idle");

  // The same session, with the question asked again as it first was.
  expect(loaded).toEqual(["session"]);
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toBe(prompts[0]);
  expect(state.signIn).toBeUndefined();
  expect(state.error).toBeUndefined();
  expect(state.entries).toEqual([
    {
      kind: "user",
      id: expect.any(String),
      text: "Is this safe?",
      at: expect.any(Number),
    },
    { kind: "agent", id: expect.any(String), text: "It is." },
  ]);
  thread.close();
});

it("shows the saved conversation at once and keeps it as it goes", async () => {
  const saves: AskEntry[][] = [];
  let loaded!: () => void;

  const { launch } = fakeAgent(
    async (client) => {
      await say(client, "Yes, replicas too.");
      await askPermission(client, "execute");
    },
    async (client) => {
      // Whiteboard's copy is shown, so the replay is not added to it.
      await say(client, "Replayed answer.");
      await new Promise<void>((resolve) => (loaded = resolve));
    },
  );

  const entries: AskEntry[] = [
    { kind: "user", id: "q", text: "Is this safe?", at: 1 },
    { kind: "agent", id: "a", text: "It does, because 0042 opts out." },
  ];

  const thread = reopenThread(launch, {
    entries,
    onSave: (saved) => saves.push(saved),
  });

  expect(thread.read()).toMatchObject({ status: "starting", entries });
  await vi.waitFor(() => expect(loaded).toBeDefined());
  loaded();

  const idle = await until(thread, ({ status }) => status === "idle");

  expect(idle.entries).toEqual(entries);

  // A follow-up that is closed while it waits on the reviewer.
  void thread.ask("And on replicas?").catch(() => {});
  await until(thread, ({ status }) => status === "waiting");
  thread.close();

  expect(saves.at(-1)?.slice(2)).toMatchObject([
    { kind: "user", text: "And on replicas?" },
    { kind: "agent", text: "Yes, replicas too." },
    // Reopened, it is not waiting for a decision any more.
    { kind: "permission", id: "call-execute", outcome: "cancelled" },
  ]);
});

it("saves nothing for a conversation closed while it loads", async () => {
  const saves: AskEntry[][] = [];

  const { launch } = fakeAgent(
    async () => {},
    () => new Promise<void>(() => {}),
  );

  const thread = reopenThread(launch, { onSave: (saved) => saves.push(saved) });

  await new Promise((resolve) => setTimeout(resolve, 20));
  thread.close();

  expect(saves).toEqual([]);
});

it("answers with Claude's plan and does not let it leave the read-only mode", async () => {
  let decision: RequestPermissionResponse | undefined;
  const plan = "## Answer\n\nIt does, because 0042 opts out.";

  const { launch } = fakeAgent(async (client) => {
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "plan",
        title: "Approve Plan",
        kind: "switch_mode",
        status: "pending",
        content: [{ type: "content", content: { type: "text", text: plan } }],
      },
    });

    decision = await client.request<RequestPermissionResponse>(
      methods.client.session.requestPermission,
      {
        sessionId: "session",
        toolCall: {
          toolCallId: "plan",
          title: "Approve Plan",
          kind: "switch_mode",
        },
        options: [
          {
            optionId: "auto",
            name: "Yes, and use auto mode",
            kind: "allow_always",
          },
          {
            optionId: "bypass",
            name: "Yes, and bypass permissions",
            kind: "allow_always",
          },
          {
            optionId: "default",
            name: "Yes, manually approve edits",
            kind: "allow_once",
          },
          { optionId: "plan", name: "No, keep planning", kind: "reject_once" },
        ],
      },
    );

    // The refusal comes back as the call's result; the plan stays.
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "plan",
        status: "failed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "User chose to keep planning" },
          },
        ],
      },
    });
  });

  const thread = openThread(launch);
  const state = await until(thread, ({ status }) => status === "idle");

  expect(decision).toEqual({
    outcome: { outcome: "selected", optionId: "plan" },
  });
  expect(state.entries.slice(1)).toMatchObject([
    { kind: "tool", id: "plan", toolKind: "switch_mode", status: "failed" },
    { kind: "agent", text: plan },
    { kind: "permission", id: "plan", automatic: true, outcome: "plan" },
  ]);
  thread.close();
});

it("starts Claude without its file tools, in a mode that asks, with the chosen model and effort", async () => {
  const offered: AskChoices[] = [];
  const { launch, metas } = fakeAgent(async () => {});

  const thread = openThread(launch, () => [], {
    picks: { model: "sonnet", effort: "low" },
    onChoices: (choices) => offered.push(choices),
  });

  const state = await until(thread, ({ status }) => status === "idle");

  // Claude's file tools are gone, and it cannot bypass its questions.
  expect(metas).toEqual([
    {
      claudeCode: {
        options: expect.objectContaining({
          disallowedTools: expect.arrayContaining(["Edit", "Write"]),
          allowDangerouslySkipPermissions: false,
        }),
      },
    },
  ]);
  expect(state.choices).toEqual({
    model: {
      current: "sonnet",
      options: [
        { value: "default", name: "Default", description: "Opus 5" },
        { value: "sonnet", name: "Sonnet" },
      ],
    },
    effort: {
      current: "low",
      options: [
        { value: "low", name: "low" },
        { value: "medium", name: "medium" },
      ],
    },
  });
  expect(offered.at(-1)?.effort?.current).toBe("low");

  // Another model offers other efforts; the choice follows the agent.
  await thread.choose("model", "default");
  await thread.choose("effort", "high");
  expect(thread.read().choices?.model?.current).toBe("default");
  expect(thread.read().choices?.effort).toMatchObject({
    current: "high",
    options: [{ value: "low" }, { value: "medium" }, { value: "high" }],
  });
  thread.close();
});

it("shows what a command ran or a search looked for, why, and what came back", async () => {
  const { launch } = fakeAgent(async (client) => {
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "grep",
        title: "git grep -n CONCURRENTLY",
        kind: "execute",
        status: "pending",
        rawInput: {
          command: "git grep -n CONCURRENTLY",
          description: "Find concurrent indexes",
        },
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "grep",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "```console\ndb/0042.sql:1:CREATE INDEX CONCURRENTLY\n```",
            },
          },
        ],
      },
    });
    // A search names what it looked for.
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "search",
        title: "mcp__fff__multi_grep",
        kind: "other",
        status: "completed",
        rawInput: { patterns: ["setMode", "set_mode"] },
      },
    });
  });

  const thread = openThread(launch);
  const state = await until(thread, ({ status }) => status === "idle");

  expect(state.entries[1]).toEqual({
    kind: "tool",
    id: "grep",
    title: "git grep -n CONCURRENTLY",
    toolKind: "execute",
    status: "completed",
    input: "git grep -n CONCURRENTLY",
    summary: "Find concurrent indexes",
    output: "db/0042.sql:1:CREATE INDEX CONCURRENTLY",
  });
  expect(state.entries[2]).toMatchObject({
    id: "search",
    input: "setMode | set_mode",
  });
  thread.close();
});

it("says what an agent offers before anything is asked, starting it once for everyone waiting", async () => {
  const fake = fakeAgent(async () => {});
  const stopped = vi.fn<() => void>();

  const launch = vi.fn<AskAgentLauncher>(async (...args) => ({
    ...(await fake.launch(...args)),
    stop: stopped,
  }));

  const threads = new AskThreads(launch);

  const [first, second] = await Promise.all([
    threads.offered("codex", "/checkouts/payments"),
    threads.offered("codex", "/checkouts/payments"),
  ]);

  expect(first).toEqual({
    model: {
      current: "default",
      options: [
        { value: "default", name: "Default", description: "Opus 5" },
        { value: "sonnet", name: "Sonnet" },
      ],
    },
    effort: {
      current: "medium",
      options: ["low", "medium", "high"].map((value) => ({
        value,
        name: value,
      })),
    },
  });
  expect(second).toBe(first);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(stopped).toHaveBeenCalled();
});

const quick: AskThreadLimits = { startMs: 50, stopGraceMs: 50 };

it("tries a failed reopen again without asking its last question again", async () => {
  let signedIn = false;
  const prompts: string[] = [];

  const { launch } = fakeAgent(
    async (_client, prompt) => {
      prompts.push(prompt);
    },
    async () => {
      if (!signedIn) throw RequestError.authRequired();
    },
  );

  const saved: AskEntry[] = [
    { kind: "user", id: "asked", text: "Is this safe?" },
    { kind: "agent", id: "answered", text: "It is." },
  ];

  const thread = reopenThread(launch, { entries: saved });
  const failed = await until(thread, ({ status }) => status === "failed");

  expect(failed.signIn).toBe("claude auth login");

  signedIn = true;
  await thread.retry();

  const state = await until(thread, ({ status }) => status === "idle");

  expect(prompts).toEqual([]);
  expect(state.entries).toEqual(saved);
  thread.close();
});

it("gives up on an agent that does not start, and starts it again", async () => {
  const prompts: string[] = [];

  const { launch } = fakeAgent(async (client, prompt) => {
    prompts.push(prompt);
    await say(client, "It is.");
  });

  const thread = openThread(stuckOnce(launch), undefined, { limits: quick });
  const failed = await until(thread, ({ status }) => status === "failed");

  expect(failed.error).toMatch(/Claude Code did not start within/);

  await thread.retry();
  const state = await until(thread, ({ status }) => status === "idle");

  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Selected text from Whiteboard.");
  expect(state.entries.map((entry) => entry.kind)).toEqual(["user", "agent"]);
  thread.close();
});

it("stops an agent that is still starting, and starts it again for the next question", async () => {
  const prompts: string[] = [];

  const { launch } = fakeAgent(async (client, prompt) => {
    prompts.push(prompt);
    await say(client, "It is.");
  });

  const thread = openThread(stuckOnce(launch));

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(thread.read().status).toBe("starting");
  await thread.cancel();

  const stopped = await until(thread, ({ status }) => status === "idle");

  expect(stopped.entries.map((entry) => entry.kind)).toEqual([
    "user",
    "notice",
  ]);

  await thread.ask("Is it safe now?");
  await until(thread, ({ status }) => status === "idle");

  // The agent never saw the selection, so the next question brings it.
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Selected text from Whiteboard.");
  expect(prompts[0]).toContain("Is it safe now?");
  thread.close();
});

it("stops the agent when a turn does not stop, and starts it again for the next question", async () => {
  const prompts: string[] = [];
  const loaded: string[] = [];

  const { launch, launches } = fakeAgent(
    async (client, prompt) => {
      prompts.push(prompt);

      // The first turn ignores Stop.
      if (prompts.length === 1) await new Promise<never>(() => {});
      await say(client, "Yes.");
    },
    async (_client, sessionId) => {
      loaded.push(sessionId);
    },
  );

  const thread = openThread(launch, undefined, { limits: quick });

  await until(thread, ({ status }) => status === "running");
  await thread.cancel();

  const stopped = await until(thread, ({ status }) => status === "idle");

  expect(stopped.entries.at(-1)).toMatchObject({
    kind: "notice",
    title: "Stopped here.",
  });

  await thread.ask("And now?");
  const state = await until(thread, ({ status }) => status === "idle");

  expect(launches()).toBe(2);
  expect(loaded).toEqual(["session"]);
  expect(prompts[1]).toBe("And now?");
  expect(state.entries.at(-1)).toMatchObject({ kind: "agent", text: "Yes." });
  thread.close();
});

it("continues a conversation its agent can no longer reopen in a new session", async () => {
  const prompts: string[] = [];
  const sessions: string[] = [];

  const { launch } = fakeAgent(
    async (client, prompt) => {
      prompts.push(prompt);
      await say(client, "Still here.");
    },
    async (_client, sessionId) => {
      throw RequestError.resourceNotFound(sessionId);
    },
  );

  const saved: AskEntry[] = [
    { kind: "user", id: "asked", text: "Is this safe?" },
    { kind: "agent", id: "answered", text: "It is." },
  ];

  const thread = reopenThread(launch, {
    entries: saved,
    onSession: (sessionId) => sessions.push(sessionId),
  });

  const failed = await until(thread, ({ status }) => status === "failed");

  expect(failed.error).toMatch(/could not reopen this conversation/);

  await thread.retry();
  await until(thread, ({ status }) => status === "idle");

  expect(sessions).toEqual(["session"]);

  await thread.ask("Are you still there?");
  const state = await until(thread, ({ status }) => status === "idle");

  // The new session has not seen the selection.
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Selected text from Whiteboard.");
  expect(prompts[0]).toContain("Are you still there?");
  expect(state.entries.slice(0, 2)).toEqual(saved);
  thread.close();
});

it("stops waiting on a permission its agent withdrew", async () => {
  const withdrawn = new AbortController();

  const { launch } = fakeAgent(async (client) => {
    await askPermission(client, "execute", withdrawn.signal);
    await say(client, "Carried on.");
  });

  const thread = openThread(launch);

  await until(thread, ({ status }) => status === "waiting");
  withdrawn.abort();

  const state = await until(thread, ({ status }) => status === "idle");

  expect(state.entries).toContainEqual(
    expect.objectContaining({ kind: "permission", outcome: "cancelled" }),
  );
  expect(thread.decide("call-execute", "allow")).toBe(false);
  thread.close();
});

it("leaves nothing to answer when the agent exits while it waits for a permission", async () => {
  const { launch, exit } = fakeAgent(async (client) => {
    await askPermission(client, "execute");
  });

  const thread = openThread(launch);

  await until(thread, ({ status }) => status === "waiting");
  exit();

  const state = await until(thread, ({ status }) => status === "failed");

  expect(state.entries.at(-1)).toMatchObject({
    kind: "permission",
    outcome: "cancelled",
  });
  expect(thread.decide("call-execute", "allow")).toBe(false);
  thread.close();
});

it("starts the agent again for a follow-up after it exited", async () => {
  const prompts: string[] = [];
  const loaded: string[] = [];

  const { launch, launches, exit } = fakeAgent(
    async (client, prompt) => {
      prompts.push(prompt);
      await say(client, "Yes.");
    },
    async (_client, sessionId) => {
      loaded.push(sessionId);
    },
  );

  const thread = openThread(launch);

  await until(thread, ({ status }) => status === "idle");
  exit();
  await thread.ask("And on replicas?");

  const state = await until(
    thread,
    ({ status, entries }) => status === "idle" && entries.length === 4,
  );

  expect(launches()).toBe(2);
  expect(loaded).toEqual(["session"]);
  expect(prompts[1]).toBe("And on replicas?");
  expect(state.error).toBeUndefined();
  thread.close();
});

it("says so when the agent leaves its read-only mode", async () => {
  const { launch } = fakeAgent(async (client) => {
    await client.notify(methods.client.session.update, {
      sessionId: "session",
      update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
    });
  });

  const thread = openThread(launch);
  const state = await until(thread, ({ status }) => status === "idle");

  expect(state.readOnly).toBe(false);
  thread.close();
});
