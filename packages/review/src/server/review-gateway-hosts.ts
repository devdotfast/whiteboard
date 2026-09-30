import http from "node:http";
import { Readable } from "node:stream";

import type {
  ReviewGatewayHost,
  ReviewGatewayHostState,
} from "@dev.fast/review-protocol";
import { z } from "zod";

import { StreamLimitError } from "./bounded-stream.js";

const HEALTH_TIMEOUT_MS = 3_000;

const FIRST_RETRY_MS = 500;

const MAX_RETRY_MS = 30_000;

const healthSchema = z.object({
  ok: z.literal(true),
  serverId: z.string(),
  instanceId: z.string(),
  version: z.string(),
});

/** A host the gateway can send requests to. */
export interface GatewayRemote {
  readonly alias: string;
  readonly endpoint?: { url: string; token: string };
  readonly agent?: http.Agent;
  readonly serverId?: string;
}

interface Host extends GatewayRemote {
  endpoint?: { url: string; token: string };
  agent?: http.Agent;
  problem?: ReviewGatewayHost["problem"];
  serverId?: string;
  instanceId?: string;
  status: ReviewGatewayHostState["state"];
  detail?: string;
  retryMs: number;
  retry?: NodeJS.Timeout;
  checking?: AbortController;
}

/**
 * Host state for the gateway: a /health check on every change and after
 * every failure, backoff while a host is down, and the identity rules.
 */
export function createGatewayHosts(input: {
  version: string;
  log?(message: string): void;
  /** The alias the memory file last recorded for a server id. */
  remembered?(serverId: string): string | undefined;
}) {
  const log = input.log ?? (() => {});
  let hosts: Host[] = [];
  let closed = false;
  const reported = new Map<string, string>();

  // The first alias in the setting that reported a server id is that
  // machine, whatever its state now. Another alias with the same id and the
  // same instance is the same running server; with another instance it is a
  // copied store, a duplicate for as long as the setting keeps that order.
  const machine = (serverId: string | undefined) =>
    serverId === undefined
      ? undefined
      : hosts.find((host) => host.serverId === serverId);

  // The remembered alias of a server id, while it is in the setting and has
  // not reported yet: until it does, another alias with that id may be a copy.
  const pending = (host: Host) => {
    if (host.serverId === undefined) return undefined;
    const alias = input.remembered?.(host.serverId);

    if (alias === undefined || alias === host.alias) return undefined;
    const remembered = hosts.find((candidate) => candidate.alias === alias);

    return remembered?.serverId === undefined ? remembered : undefined;
  };

  const isDuplicate = (host: Host) => {
    const first = machine(host.serverId);

    if (first !== undefined && first.instanceId !== host.instanceId)
      return true;

    return pending(host) !== undefined;
  };

  const serving = (serverId: string | undefined) =>
    serverId === undefined
      ? undefined
      : hosts.find(
          (host) =>
            host.status === "online" &&
            host.serverId === serverId &&
            !isDuplicate(host),
        );

  function stateOf(host: Host): ReviewGatewayHostState {
    const known = {
      alias: host.alias,
      ...(host.serverId !== undefined && { serverId: host.serverId }),
    };

    const waitingFor = pending(host);

    if (waitingFor)
      return {
        ...known,
        state: "duplicate",
        detail: `${host.alias} reports the server id last seen on ${waitingFor.alias}, which has not answered yet. If they are two machines, run whiteboard server reset-id on ${host.alias} to give it its own.`,
      };

    if (isDuplicate(host))
      return {
        ...known,
        state: "duplicate",
        detail: `${machine(host.serverId)?.alias} and ${host.alias} are two machines that report the same server id. Run whiteboard server reset-id on ${host.alias} to give it its own.`,
      };

    return {
      ...known,
      state: host.status,
      ...(host.detail !== undefined && { detail: host.detail }),
    };
  }

  function report() {
    const states = hosts.map(stateOf);

    for (const state of states) {
      const line = `${state.state}${state.detail ? ` (${state.detail})` : ""}`;

      if (reported.get(state.alias) === line) continue;
      reported.set(state.alias, line);
      log(`Host ${state.alias}: ${line}`);
    }

    for (const alias of reported.keys())
      if (!states.some((state) => state.alias === alias))
        reported.delete(alias);
  }

  function dispose(host: Host) {
    clearTimeout(host.retry);
    host.checking?.abort();
    host.checking = undefined;
    host.agent?.destroy();
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
    else host.agent = new http.Agent({ keepAlive: true });

    return host;
  }

  function retryLater(host: Host) {
    const delay = host.retryMs * (0.75 + Math.random() * 0.5);
    host.retryMs = Math.min(host.retryMs * 2, MAX_RETRY_MS);
    host.retry = setTimeout(() => void check(host), delay);
    host.retry.unref();
  }

  async function check(host: Host) {
    if (closed || !host.endpoint || host.problem) return;
    clearTimeout(host.retry);
    host.checking?.abort();
    const abort = new AbortController();
    host.checking = abort;
    const timer = setTimeout(() => abort.abort(), HEALTH_TIMEOUT_MS);
    let health: z.infer<typeof healthSchema> | undefined;
    let reason = "it did not answer";

    try {
      const response = await send(host, {
        method: "GET",
        path: "/health",
        signal: abort.signal,
      });

      const parsed = healthSchema.safeParse(
        JSON.parse((await readBody(response, 64 * 1024)).toString()),
      );

      if (parsed.success) health = parsed.data;
      else reason = "it did not answer as a Whiteboard server";
    } catch (error) {
      if (!abort.signal.aborted) reason = errorText(error);
      else if (host.checking === abort)
        reason = `it did not answer within ${HEALTH_TIMEOUT_MS / 1_000} seconds`;
    } finally {
      clearTimeout(timer);
    }

    // Replaced by a newer check, a new setting, or close.
    if (host.checking !== abort) return;
    host.checking = undefined;

    if (!health) {
      host.status = "offline";
      host.detail = `${host.alias} is offline: ${reason}.`;
      retryLater(host);
    } else {
      const restarted =
        host.serverId === health.serverId &&
        host.instanceId !== health.instanceId;

      host.serverId = health.serverId;
      host.instanceId = health.instanceId;

      // Other aliases of a restarted server still hold its old instance id.
      if (restarted)
        for (const other of hosts)
          if (other !== host && other.serverId === health.serverId)
            void check(other);
      host.retryMs = FIRST_RETRY_MS;

      // "unknown" is the fallback when a package cannot read its version.
      if (health.version === "unknown" || health.version !== input.version) {
        host.status = "incompatible";
        host.detail = `${host.alias} runs Whiteboard ${health.version}; this Desktop runs ${input.version}. Run npm install -g @dev.fast/whiteboard@${input.version} on ${host.alias}.`;
      } else {
        host.status = "online";
        host.detail = undefined;
      }
    }

    report();
  }

  return {
    /** The hosts in the setting's order. A change checks every host at once. */
    set(list: ReviewGatewayHost[]) {
      const previous = new Map(hosts.map((host) => [host.alias, host]));
      const next: Host[] = [];

      for (const given of list) {
        if (next.some((host) => host.alias === given.alias)) continue;
        const current = previous.get(given.alias);

        if (
          current &&
          JSON.stringify([current.endpoint, current.problem]) ===
            JSON.stringify([given.endpoint, given.problem])
        ) {
          previous.delete(given.alias);
          current.retryMs = FIRST_RETRY_MS;
          next.push(current);
        } else next.push(create(given));
      }

      for (const gone of previous.values()) dispose(gone);
      hosts = next;

      for (const host of hosts) void check(host);
      report();
    },
    states: () => hosts.map(stateOf),
    /** The host that answers for `serverId` now. */
    serving: (serverId: string): GatewayRemote | undefined => serving(serverId),
    /** One host per online machine. */
    online: (): GatewayRemote[] =>
      hosts.filter(
        (host) => host.status === "online" && serving(host.serverId) === host,
      ),
    /** The state of a host that owns `serverId` (or, never reached yet, has `alias`) but cannot answer. */
    unavailable(serverId: string, alias: string) {
      const host = hosts.find(
        (candidate) =>
          candidate.status !== "online" &&
          !isDuplicate(candidate) &&
          (candidate.serverId === serverId ||
            (candidate.serverId === undefined && candidate.alias === alias)),
      );

      return host && stateOf(host);
    },
    /** A request failed: the host is offline until /health says otherwise. */
    failed(remote: GatewayRemote, reason: string) {
      const host = hosts.find((candidate) => candidate === remote);

      if (!host || host.status !== "online") return;
      host.status = "offline";
      host.detail = `${host.alias} is offline: ${reason}.`;
      report();
      void check(host);
    },
    close() {
      closed = true;

      for (const host of hosts) dispose(host);
    },
  };
}

export type GatewayHosts = ReturnType<typeof createGatewayHosts>;

/** One HTTP request to a host, resolved when its headers arrive. */
export function send(
  remote: GatewayRemote,
  request: {
    method: string;
    path: string;
    headers?: http.OutgoingHttpHeaders;
    body?: Buffer | Readable;
    signal: AbortSignal;
  },
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (!remote.endpoint) {
      reject(new Error(`${remote.alias} has no endpoint.`));

      return;
    }

    const outgoing = http.request(new URL(request.path, remote.endpoint.url), {
      method: request.method,
      headers: request.headers,
      agent: remote.agent,
    });

    // Destroying the request closes the connection, also mid-stream.
    const abort = () => outgoing.destroy(new Error("The request was aborted."));
    const release = () => request.signal.removeEventListener("abort", abort);

    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });

    outgoing.on("response", (response) => {
      response.on("close", release);
      resolve(response);
    });
    outgoing.on("error", (error) => {
      release();
      reject(error);
    });

    if (request.body instanceof Readable) request.body.pipe(outgoing);
    else outgoing.end(request.body);
  });
}

/** A whole answer, refused past `limit` bytes. */
export async function readBody(response: http.IncomingMessage, limit: number) {
  const parts: Buffer[] = [];
  let size = 0;

  for await (const part of response) {
    // SAFETY: an IncomingMessage without an encoding yields Buffers.
    const chunk = part as Buffer;
    size += chunk.byteLength;

    if (size > limit) {
      response.destroy();
      throw new StreamLimitError();
    }

    parts.push(chunk);
  }

  return Buffer.concat(parts, size);
}

const codedError = z.object({ code: z.string() });

/** A network error's code (ECONNREFUSED), else its message. */
export function errorText(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);

  return (
    codedError.safeParse(cause).data?.code ??
    codedError.safeParse(cause.cause).data?.code ??
    cause.message
  );
}
