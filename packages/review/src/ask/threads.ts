import { PROTOCOL_VERSION, client, methods } from "@agentclientprotocol/sdk";
import { errorMessage, shellQuote } from "@dev.fast/trace-core";
import {
  type AskAgentLauncher,
  askAgentTakesMcp,
  askAgents,
} from "@review/ask/agents.js";
import { choicesOf, commandOf } from "@review/ask/protocol.js";
import type {
  AskAgentId,
  AskCommand,
  AskOffer,
} from "@review/ask/thread-state.js";
import {
  type AskMcpServers,
  AskThread,
  type AskThreadLimits,
  type AskThreadStart,
  askThreadLimits,
} from "@review/ask/thread.js";

/** How long an agent may take to say what it offers. */
const OFFER_TIMEOUT_MS = 30_000;

/** How long after its session opens an agent may take to list its
 * commands, which it sends on its own rather than in the response. */
const COMMANDS_WAIT_MS = 2_000;

/** What an agent offers, from a session it starts and leaves without
 * asking anything: with the model given, where it offers that model, since
 * the efforts on offer depend on it. */
async function offeredBy(
  launch: AskAgentLauncher,
  agent: AskAgentId,
  cwd: string,
  model?: string,
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

    const initialized = await connection.agent.request(
      methods.agent.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { _meta: { parameterizedModelPicker: true } },
        clientInfo: { name: "whiteboard", title: "Whiteboard", version: "1" },
      },
    );

    const session = await connection.agent.request(methods.agent.session.new, {
      cwd,
      mcpServers: [],
      _meta: askAgents[agent].sessionMeta,
    });

    const offer: AskOffer = {
      choices: {},
      accepts: {
        image:
          initialized.agentCapabilities?.promptCapabilities?.image === true,
      },
    };

    let found = choicesOf(session.configOptions);
    const models = found.get("model");

    if (
      model &&
      models &&
      model !== models.select.current &&
      models.select.options.some((option) => option.value === model)
    )
      found = choicesOf(
        (
          await connection.agent.request(
            methods.agent.session.setConfigOption,
            {
              sessionId: session.sessionId,
              configId: models.configId,
              value: model,
            },
          )
        ).configOptions,
      );

    for (const [kind, { select }] of found) offer.choices[kind] = select;

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

/** Whiteboard's own tools, for every Ask session. */
export interface AskTools {
  /** Its MCP server, for agents whose model gets it. */
  mcpServers?: AskMcpServers;
  /** A shell command that runs Whiteboard's CLI against this server, for
   * the agents that don't. */
  cli?: () => string | undefined;
  /** Whether an agent's model gets the MCP servers it is given. */
  takesMcp?: (agent: AskAgentId) => Promise<boolean>;
}

/** Whiteboard's CLI as the tools, with `selector` in its env so it reaches
 * this server and no other. */
export function cliAskTools(
  cliPath: () => string | undefined,
  selector: { name: string; value: string },
): AskTools {
  const env = () => [
    selector,
    ...(process.versions.electron
      ? [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }]
      : []),
    ...(process.env.DEV_REVIEW_HOME
      ? [{ name: "DEV_REVIEW_HOME", value: process.env.DEV_REVIEW_HOME }]
      : []),
  ];

  return {
    mcpServers: () => {
      const cli = cliPath();

      return cli
        ? [
            {
              name: "whiteboard",
              command: process.execPath,
              args: [cli, "mcp"],
              env: env(),
            },
          ]
        : [];
    },
    cli: () => {
      const cli = cliPath();

      return (
        cli &&
        [
          ...env().map(({ name, value }) => `${name}=${shellQuote(value)}`),
          shellQuote(process.execPath),
          shellQuote(cli),
        ].join(" ")
      );
    },
  };
}

/** How an agent reaches Whiteboard's tools, which its first prompt says. */
export type AskToolsReach =
  | { kind: "mcp" }
  | { kind: "cli"; command: string }
  | undefined;

/** The live Ask threads of one server; they end with it. */
export class AskThreads {
  private readonly threads = new Map<string, AskThread>();
  /** One question to each agent at a time about what it offers with a
   * model. */
  private readonly offers = new Map<string, Promise<AskOffer>>();

  private readonly mcpServers: AskMcpServers;

  constructor(
    private readonly launch: AskAgentLauncher,
    private readonly tools: AskTools = {},
    private readonly limits: AskThreadLimits & {
      idleCloseMs?: number;
    } = askThreadLimits,
  ) {
    this.mcpServers = tools.mcpServers ?? (() => []);
  }

  /** How the agent's sessions reach Whiteboard's tools: the MCP tools they
   * are given where its model gets them, else the CLI from its shell. */
  async reach(agent: AskAgentId): Promise<AskToolsReach> {
    if (
      this.mcpServers().length &&
      (await (this.tools.takesMcp ?? askAgentTakesMcp)(agent))
    )
      return { kind: "mcp" };
    const command = this.tools.cli?.();

    return command ? { kind: "cli", command } : undefined;
  }

  open(start: AskThreadStart) {
    const thread = new AskThread(
      this.launch,
      start,
      this.mcpServers,
      this.limits,
    );

    this.threads.set(thread.id, thread);
    const { idleCloseMs } = this.limits;

    if (idleCloseMs !== undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;

      thread.onUnwatched((unwatched) => {
        if (unwatched)
          timer ??= setTimeout(() => this.close(thread.id), idleCloseMs);
        else {
          clearTimeout(timer);
          timer = undefined;
        }
      });
      thread.onClose(() => clearTimeout(timer));
    }

    void thread.open();

    return thread;
  }

  get(id: string) {
    return this.threads.get(id);
  }

  /** What the agent offers to choose before anything is asked of it, with
   * its own model or the one given. */
  offered(agent: AskAgentId, cwd: string, model?: string) {
    const key = JSON.stringify([agent, model]);
    let offer = this.offers.get(key);

    if (!offer) {
      offer = offeredBy(this.launch, agent, cwd, model).finally(() =>
        this.offers.delete(key),
      );
      this.offers.set(key, offer);
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
