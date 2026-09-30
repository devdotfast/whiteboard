import http from "node:http";
import { Readable } from "node:stream";

import {
  REVIEW_CLIENT_HEADER,
  REVIEW_CLIENT_REMOTE,
  type ReviewGatewayHost,
  type ReviewGatewayHostState,
} from "@dev.fast/review-protocol";
import { z } from "zod";

import { StreamLimitError } from "./bounded-stream.js";

const HEALTH_TIMEOUT_MS = 3_000;

/** An answering host is checked again this often, so a hang is found within about 13 s. */
const HEARTBEAT_MS = 10_000;

export const FIRST_RETRY_MS = 500;

export const MAX_RETRY_MS = 30_000;

export const FIRST_BYTE_TIMEOUT_MS = 10_000;

export const NO_ANSWER = `it did not answer within ${FIRST_BYTE_TIMEOUT_MS / 1_000} seconds`;

/** Remotes hold only reviews with these ids. */
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A backoff delay, ±25%. */
export const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5);

// A remote's version reaches the UI, so only a version passes.
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** The command that installs this Desktop's version; never built from a remote's text. */
const INSTALLS = new Set<ReviewGatewayHostState["state"]>([
  "incompatible",
  "not-installed",
]);

const healthSchema = z.object({
  ok: z.literal(true),
  // Absent unless the token is the server's.
  serverId: z.string().optional(),
  instanceId: z.string(),
  version: z.string(),
});

/** A host the gateway can send requests to. */
export interface GatewayRemote {
  readonly alias: string;
  readonly endpoint?: { url: string; token: string };
  readonly agent?: http.Agent;
  readonly serverId?: string;
  /** Its server answered 401: it restarted with a new token. */
  readonly unauthorized?: () => void;
}

interface Host extends GatewayRemote {
  endpoint?: { url: string; token: string };
  agent?: http.Agent;
  unauthorized?: () => void;
  problem?: ReviewGatewayHost["problem"];
  serverId?: string;
  instanceId?: string;
  status: ReviewGatewayHostState["state"];
  detail?: string;
  retryMs: number;
  retry?: NodeJS.Timeout;
  checking?: AbortController;
  /** Its first /health check of this session has finished. */
  checked?: boolean;
  /** Its server restarted; Desktop was asked once to attach again. */
  restarted?: boolean;
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
  /** The alias that now speaks for a server id. */
  machine?(serverId: string, alias: string): void;
  /** Host states may have changed. */
  changed?(): void;
  /** A host's server restarted, so its endpoint and token are stale: Desktop attaches again. */
  restarted?(alias: string): void;
  heartbeatMs?: number;
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

  // The remembered alias of a server id, while it is earlier in the setting
  // and has not reported yet: until it does, a later alias with that id may
  // be a copy. The setting's order says which alias is the machine.
  const pending = (host: Host) => {
    if (host.serverId === undefined) return undefined;
    const alias = input.remembered?.(host.serverId);
    const index = hosts.findIndex((candidate) => candidate.alias === alias);
    const remembered = hosts[index];

    return remembered &&
      index < hosts.indexOf(host) &&
      remembered.serverId === undefined
      ? remembered
      : undefined;
  };

  // An alias that reported is held while an earlier alias in the setting has
  // not answered its first check: that one may be the machine.
  const unsettledBefore = (host: Host) =>
    host.serverId === undefined
      ? []
      : hosts
          .slice(0, hosts.indexOf(host))
          .filter((earlier) => !earlier.problem && !earlier.checked);

  const held = (host: Host) =>
    host.status === "online" && unsettledBefore(host).length > 0;

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
            !held(host) &&
            !isDuplicate(host),
        );

  function stateOf(host: Host): ReviewGatewayHostState {
    const known = {
      alias: host.alias,
      ...(host.serverId !== undefined && { serverId: host.serverId }),
    };

    if (held(host))
      return {
        ...known,
        state: "connecting",
        detail: `Waiting for ${unsettledBefore(host)
          .map((earlier) => earlier.alias)
          .join(", ")} to answer before using ${host.alias}.`,
      };

    const waitingFor = pending(host);

    if (waitingFor)
      return {
        ...known,
        state: "duplicate",
        detail: `${host.alias} is waiting for ${waitingFor.alias}, which last served this server id and has not answered yet. If they are one machine, remove one of the aliases. If they are two machines, run \`whiteboard server reset-id\` on ${host.alias}.`,
      };

    const first = machine(host.serverId);

    if (isDuplicate(host))
      return {
        ...known,
        state: "duplicate",
        detail: `${first?.alias} and ${host.alias} report the same server id. If they are one machine, remove one of the aliases. If they are two machines, run \`whiteboard server reset-id\` on ${host.alias}.`,
      };

    return {
      ...known,
      state: host.status,
      ...(host.detail !== undefined && { detail: host.detail }),
      ...(INSTALLS.has(host.status) && {
        installCommand: `npm install -g @dev.fast/whiteboard@${input.version}`,
      }),
    };
  }

  function report() {
    const states = hosts.map(stateOf);

    for (const host of hosts)
      if (
        host.serverId !== undefined &&
        serving(host.serverId) === host &&
        machine(host.serverId) === host
      )
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

  /** Once per endpoint: offline until Desktop sends the new one. */
  function restartedHost(
    host: Host,
    detail = `${host.alias} restarted; attaching again.`,
  ) {
    if (host.restarted || closed) return;
    host.restarted = true;
    clearTimeout(host.retry);
    host.checking?.abort();
    host.checking = undefined;
    host.status = "offline";
    host.detail = detail;
    report();
    input.restarted?.(host.alias);
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
    else {
      host.agent = new http.Agent({ keepAlive: true });
      host.unauthorized = () => restartedHost(host);
    }

    return host;
  }

  function retryLater(host: Host) {
    const delay = jitter(host.retryMs);
    host.retryMs = Math.min(host.retryMs * 2, MAX_RETRY_MS);
    host.retry = setTimeout(() => void check(host), delay);
    host.retry.unref();
  }

  async function check(host: Host) {
    if (closed || !host.endpoint || host.problem || host.restarted) return;
    clearTimeout(host.retry);
    host.checking?.abort();
    const abort = new AbortController();
    host.checking = abort;
    const timer = setTimeout(() => abort.abort(), HEALTH_TIMEOUT_MS);
    let health: z.infer<typeof healthSchema> | undefined;
    let reason = "it did not answer";
    let code: string | undefined;

    try {
      // /health names the server only to its token's holder.
      const response = await send(host, {
        method: "GET",
        path: "/health",
        headers: { "x-review-token": host.endpoint?.token ?? "" },
        signal: abort.signal,
      });

      const parsed = healthSchema.safeParse(
        JSON.parse((await readBody(response, 64 * 1024)).toString()),
      );

      if (parsed.success) health = parsed.data;
      else reason = "it did not answer as a Whiteboard server";
    } catch (error) {
      if (!abort.signal.aborted) {
        code = errorCode(error);
        reason = errorText(error);
      } else if (host.checking === abort)
        reason = `it did not answer within ${HEALTH_TIMEOUT_MS / 1_000} seconds`;
    } finally {
      clearTimeout(timer);
    }

    // Replaced by a newer check, a new setting, or close.
    if (host.checking !== abort) return;
    host.checking = undefined;
    host.checked = true;

    // Through a forward, a reset or refusal means nothing listens on the
    // remote port: its server stopped, or restarted on another port.
    if (
      !health &&
      host.instanceId !== undefined &&
      (code === "ECONNRESET" || code === "ECONNREFUSED")
    )
      return restartedHost(
        host,
        `${host.alias} is offline: ${reason}; attaching again.`,
      );

    if (!health) {
      host.status = "offline";
      host.detail = `${host.alias} is offline: ${reason}.`;
      retryLater(host);
    } else if (health.serverId === undefined) {
      // The token is refused: the server restarted with a new one. Other
      // aliases of it hold the old token too.
      if (host.serverId !== undefined)
        for (const other of hosts)
          if (other !== host && other.serverId === host.serverId)
            void check(other);

      return restartedHost(host);
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

      // A restarted server has a new token, which only a new attach reads.
      if (restarted) return restartedHost(host);

      if (health.version !== "unknown" && !VERSION.test(health.version)) {
        host.status = "incompatible";
        host.detail = `${host.alias} reports an invalid version.`;
      } else if (
        // "unknown" is the fallback when a package cannot read its version.
        health.version === "unknown" ||
        health.version !== input.version
      ) {
        host.status = "incompatible";
        host.detail = `${host.alias} runs Whiteboard ${health.version}; this Desktop runs ${input.version}. Install Whiteboard ${input.version} on ${host.alias}.`;
      } else {
        host.status = "online";
        host.detail = undefined;
      }

      // Its streams would not notice a server that stops answering.
      host.retry = setTimeout(
        () => void check(host),
        input.heartbeatMs ?? HEARTBEAT_MS,
      );
      host.retry.unref();
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
    /** The first alias in the setting that reported `serverId`. */
    machineAlias: (serverId: string) => machine(serverId)?.alias,
    /** One host per online machine. */
    online: (): GatewayRemote[] =>
      hosts.filter(
        (host) => host.status === "online" && serving(host.serverId) === host,
      ),
    /** The state of a host that owns `serverId` (or, never reached yet, has `alias`) but cannot answer. */
    unavailable(serverId: string, alias: string) {
      const host = hosts.find(
        (candidate) =>
          (candidate.status !== "online" || held(candidate)) &&
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
    /** A stream to the host ended: /health decides whether it is down. */
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

/** The headers every request to a remote carries. */
export const remoteHeaders = (remote: GatewayRemote) => ({
  "x-review-token": remote.endpoint?.token ?? "",
  [REVIEW_CLIENT_HEADER]: REVIEW_CLIENT_REMOTE,
});

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
      if (response.statusCode === 401) remote.unauthorized?.();
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

const ERROR_WORDS = new Map([
  ["ECONNREFUSED", "it refused the connection"],
  ["ECONNRESET", "it closed the connection"],
  ["ETIMEDOUT", "it did not answer"],
]);

/** A network error's code (ECONNREFUSED), else its message. */
function errorCode(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);

  return (
    codedError.safeParse(cause).data?.code ??
    codedError.safeParse(cause.cause).data?.code ??
    cause.message
  );
}

/** A network error for a person: common codes in words. */
export function errorText(cause: unknown): string {
  const code = errorCode(cause);

  return ERROR_WORDS.get(code) ?? code;
}
