import type {
  ReviewGatewayHost,
  ReviewGatewayHostState,
} from "@dev.fast/review-protocol";
import { Agent } from "undici";
import { z } from "zod";

import {
  FIRST_RETRY_MS,
  MAX_RETRY_MS,
  errorText,
  jitter,
  readBody,
  send,
} from "./review-gateway-transport.js";

const HEALTH_TIMEOUT_MS = 3_000;

const HEARTBEAT_MS = 30_000;

const healthSchema = z.object({
  ok: z.literal(true),
  serverId: z.string().optional(),
  instanceId: z.string(),
  version: z.string(),
});

export interface GatewayRemote {
  readonly alias: string;
  readonly endpoint?: { url: string; token: string };
  readonly dispatcher?: Agent;
  readonly serverId?: string;
}

interface Host extends GatewayRemote {
  endpoint?: { url: string; token: string };
  dispatcher?: Agent;
  problem?: ReviewGatewayHost["problem"];
  serverId?: string;
  status: ReviewGatewayHostState["state"];
  detail?: string;
  retryMs: number;
  retry?: NodeJS.Timeout;
  checking?: AbortController;
}

export function createGatewayHosts(input: {
  version: string;
  log?(message: string): void;
  machine?(serverId: string, alias: string): void;
  changed?(): void;
  heartbeatMs?: number;
}) {
  const log = input.log ?? (() => {});
  let hosts: Host[] = [];
  let closed = false;
  const reported = new Map<string, string>();

  const sharing = (host: Host) =>
    host.serverId === undefined
      ? [host]
      : hosts.filter((other) => other.serverId === host.serverId);

  const serving = (serverId: string | undefined) =>
    serverId === undefined
      ? undefined
      : hosts.find(
          (host) =>
            host.status === "online" &&
            host.serverId === serverId &&
            sharing(host).length === 1,
        );

  function stateOf(host: Host): ReviewGatewayHostState {
    const known = {
      alias: host.alias,
      ...(host.serverId !== undefined && { serverId: host.serverId }),
    };

    const aliases = sharing(host).map((other) => other.alias);

    if (aliases.length > 1)
      return {
        ...known,
        state: "duplicate",
        detail: `${aliases.join(", ")} report the same server id, so Whiteboard uses none of them. If they are one machine, keep one alias. If they are separate machines, run \`whiteboard server stop\` and then \`whiteboard server reset-id\` on all but one.`,
      };

    return {
      ...known,
      state: host.status,
      ...(host.detail !== undefined && { detail: host.detail }),
    };
  }

  function report() {
    const states = hosts.map(stateOf);

    for (const host of hosts)
      if (host.serverId !== undefined && serving(host.serverId) === host)
        input.machine?.(host.serverId, host.alias);

    for (const state of states) {
      const line = `${state.state}${state.detail ? ` (${state.detail})` : ""}`;

      if (reported.get(state.alias) === line) continue;
      reported.set(state.alias, line);
      log(`Host ${state.alias}: ${line}`);
    }

    for (const alias of reported.keys())
      if (!states.some((state) => state.alias === alias))
        reported.delete(alias);

    input.changed?.();
  }

  function dispose(host: Host) {
    clearTimeout(host.retry);
    host.checking?.abort();
    host.checking = undefined;
    void host.dispatcher?.destroy();
  }

  function create(given: ReviewGatewayHost): Host {
    const host: Host = {
      alias: given.alias,
      status: "connecting",
      retryMs: FIRST_RETRY_MS,
    };

    if (given.endpoint) host.endpoint = given.endpoint;

    if (given.problem) {
      host.problem = given.problem;
      host.status = given.problem.state;
      host.detail = given.problem.detail;
    } else if (!given.endpoint)
      host.detail = `Waiting for a connection to ${given.alias}.`;
    else host.dispatcher = new Agent();

    return host;
  }

  function schedule(host: Host, ms: number) {
    host.retry = setTimeout(() => void check(host), ms);
    host.retry.unref();
  }

  function retryLater(host: Host) {
    schedule(host, jitter(host.retryMs));
    host.retryMs = Math.min(host.retryMs * 2, MAX_RETRY_MS);
  }

  async function check(host: Host) {
    if (closed || !host.endpoint || host.problem) return;
    clearTimeout(host.retry);
    host.checking?.abort();
    const abort = new AbortController();
    host.checking = abort;
    const timeout = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
    let health: z.infer<typeof healthSchema> | undefined;
    let reason = "it did not answer";

    try {
      const response = await send(host, {
        method: "GET",
        path: "/health",
        headers: { "x-review-token": host.endpoint.token },
        signal: AbortSignal.any([abort.signal, timeout]),
      });

      const parsed = healthSchema.safeParse(
        JSON.parse((await readBody(response.body, 64 * 1024)).toString()),
      );

      if (parsed.success) health = parsed.data;
      else reason = "it did not answer as a Whiteboard server";
    } catch (error) {
      if (timeout.aborted)
        reason = `it did not answer within ${HEALTH_TIMEOUT_MS / 1_000} seconds`;
      else if (!abort.signal.aborted) reason = errorText(error);
    }

    if (host.checking !== abort) return;
    host.checking = undefined;

    if (!health) {
      host.status = "offline";
      host.detail = `${host.alias} is offline: ${reason}.`;
      retryLater(host);
    } else if (health.serverId === undefined) {
      host.status = "offline";
      host.detail = `${host.alias} is offline: it did not accept the token.`;
      retryLater(host);
    } else {
      host.serverId = health.serverId;
      host.retryMs = FIRST_RETRY_MS;

      if (health.version === "unknown" || health.version !== input.version) {
        host.status = "incompatible";
        host.detail = `${host.alias} runs Whiteboard ${health.version}; this Desktop runs ${input.version}. Install Whiteboard ${input.version} on ${host.alias}.`;
      } else {
        host.status = "online";
        host.detail = undefined;
      }

      schedule(host, input.heartbeatMs ?? HEARTBEAT_MS);
    }

    report();
  }

  return {
    set(list: ReviewGatewayHost[]) {
      const previous = new Map(hosts.map((host) => [host.alias, host]));
      const next: Host[] = [];
      const changed: Host[] = [];

      for (const given of list) {
        if (next.some((host) => host.alias === given.alias)) continue;
        const current = previous.get(given.alias);

        if (
          current &&
          JSON.stringify([current.endpoint, current.problem]) ===
            JSON.stringify([given.endpoint, given.problem])
        ) {
          previous.delete(given.alias);
          next.push(current);
        } else {
          const host = create(given);
          next.push(host);
          changed.push(host);
        }
      }

      for (const gone of previous.values()) dispose(gone);
      hosts = next;

      for (const host of changed) void check(host);
      report();
    },
    states: () => hosts.map(stateOf),
    serving: (serverId: string): GatewayRemote | undefined => serving(serverId),
    online: (): GatewayRemote[] =>
      hosts.filter((host) => serving(host.serverId) === host),
    failed(remote: GatewayRemote, reason: string) {
      const host = hosts.find((candidate) => candidate === remote);

      if (!host || host.status !== "online") return;
      host.status = "offline";
      host.detail = `${host.alias} is offline: ${reason}.`;
      report();
      void check(host);
    },
    recheck(remote: GatewayRemote) {
      const host = hosts.find((candidate) => candidate === remote);

      if (host && !host.checking) void check(host);
    },
    close() {
      closed = true;

      for (const host of hosts) dispose(host);
    },
  };
}

export type GatewayHosts = ReturnType<typeof createGatewayHosts>;
