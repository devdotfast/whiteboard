import { PROTOCOL_VERSION, client, methods } from "@agentclientprotocol/sdk";
import { errorMessage } from "@dev.fast/trace-core";
import { type AskAgentLauncher, askAgents } from "@review/ask/agents.js";
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
