import http from "node:http";
import { Readable } from "node:stream";

import {
  REVIEW_CLIENT_HEADER,
  REVIEW_CLIENT_REMOTE,
  type REVIEW_REMOTE_INSTALL_STEPS,
  type ReviewGatewayHost,
  type ReviewGatewayHostState,
} from "@dev.fast/review-protocol";
import { z } from "zod";

import { StreamLimitError } from "./bounded-stream.js";

const HEALTH_TIMEOUT_MS = 3_000;

const HEARTBEAT_MS = 10_000;

const TIMEOUTS_BEFORE_ATTACH = 3;

export const FIRST_RETRY_MS = 500;

export const MAX_RETRY_MS = 30_000;

export const FIRST_BYTE_TIMEOUT_MS = 10_000;

export const NO_ANSWER = `it did not answer within ${FIRST_BYTE_TIMEOUT_MS / 1_000} seconds`;

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5);

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const INSTALLS = new Set<ReviewGatewayHostState["state"]>([
  "incompatible",
  "not-installed",
]);

const INSTALL_STEPS: Record<
  (typeof REVIEW_REMOTE_INSTALL_STEPS)[number],
  string
> = {
  preparing: "Preparing to install Whiteboard",
  "waiting-for-lock": "Waiting for another install to finish",
  node: "Installing Node 24",
  package: "Installing the Whiteboard package",
  verifying: "Checking the install",
  done: "Installed; starting the server",
};

const healthSchema = z.object({
  ok: z.literal(true),
  serverId: z.string().optional(),
  instanceId: z.string(),
  version: z.string(),
});

export interface GatewayRemote {
  readonly alias: string;
  readonly endpoint?: { url: string; token: string };
  readonly agent?: http.Agent;
  readonly serverId?: string;
  readonly unauthorized?: () => void;
}

interface Host extends GatewayRemote {
  endpoint?: { url: string; token: string };
  agent?: http.Agent;
  unauthorized?: () => void;
  problem?: ReviewGatewayHost["problem"];
  languageFeatures?: boolean;
  languageFeaturesDetail?: string;
  languageGroups?: ReviewGatewayHost["languageGroups"];
  installing?: ReviewGatewayHost["installing"];
  declined?: true;
  installFailure?: string;
  serverId?: string;
  instanceId?: string;
  status: ReviewGatewayHostState["state"];
  detail?: string;
  retryMs: number;
  retry?: NodeJS.Timeout;
  checking?: AbortController;
  checked?: boolean;
  restarted?: boolean;
  timeouts?: number;
}

export function createGatewayHosts(input: {
  version: string;
  log?(message: string): void;
  remembered?(serverId: string): string | undefined;
  machine?(serverId: string, alias: string): void;
  changed?(): void;
  restarted?(alias: string): void;
  heartbeatMs?: number;
}) {
  const log = input.log ?? (() => {});
  let hosts: Host[] = [];
  let closed = false;
  const reported = new Map<string, string>();

  const machine = (serverId: string | undefined) =>
    serverId === undefined
      ? undefined
      : hosts.find((host) => host.serverId === serverId);

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

    const detail =
      host.status === "incompatible" && host.installFailure
        ? `${host.detail ? `${host.detail} ` : ""}${host.installFailure}`
        : host.detail;

    return {
      ...known,
      state: host.status,
      ...(detail !== undefined && { detail }),
      ...(INSTALLS.has(host.status) &&
        host.problem?.state !== "incompatible" && {
          installCommand: `npm install -g @dev.fast/whiteboard@${input.version}`,
        }),
      ...(host.declined &&
        host.status !== "online" &&
        host.status !== "connecting" && { declined: true as const }),
      ...(host.status === "online" && languageOf(host)),
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
      ...languageOf(given),
    };

    if (given.endpoint) host.endpoint = given.endpoint;

    if (given.declined) host.declined = true;

    if (given.installFailure) host.installFailure = given.installFailure;

    if (given.problem) {
      host.problem = given.problem;
      host.status = given.problem.state;
      host.detail = given.problem.detail;
    } else if (given.installing && !given.endpoint) {
      const { step, detail } = given.installing;
      host.installing = given.installing;
      host.status = "installing";
      host.detail = `${INSTALL_STEPS[step]}${detail ? ` (${detail})` : ""}.`;
    } else if (!given.endpoint)
      host.detail = `Waiting for a connection to ${given.alias}.`;
    else {
      host.agent = new http.Agent({ keepAlive: true, timeout: 60_000 });
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
    let timedOut = false;

    try {
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
      } else if (host.checking === abort) {
        timedOut = true;
        reason = `it did not answer within ${HEALTH_TIMEOUT_MS / 1_000} seconds`;
      }
    } finally {
      clearTimeout(timer);
    }

    if (host.checking !== abort) return;
    host.checking = undefined;
    host.checked = true;

    if (
      !health &&
      host.instanceId !== undefined &&
      (code === "ECONNRESET" || code === "ECONNREFUSED")
    )
      return restartedHost(
        host,
        `${host.alias} is offline: ${reason}; attaching again.`,
      );

    host.timeouts = timedOut ? (host.timeouts ?? 0) + 1 : 0;

    if (
      host.instanceId !== undefined &&
      host.timeouts >= TIMEOUTS_BEFORE_ATTACH
    )
      return restartedHost(
        host,
        `${host.alias} is offline: ${reason}, ${host.timeouts} times in a row; attaching again.`,
      );

    if (!health) {
      host.status = "offline";
      host.detail = `${host.alias} is offline: ${reason}.`;
      retryLater(host);
    } else if (health.serverId === undefined) {
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

      if (restarted)
        for (const other of hosts)
          if (other !== host && other.serverId === health.serverId)
            void check(other);
      host.retryMs = FIRST_RETRY_MS;

      if (restarted) return restartedHost(host);

      if (health.version !== "unknown" && !VERSION.test(health.version)) {
        host.status = "incompatible";
        host.detail = `${host.alias} reports an invalid version.`;
      } else if (
        health.version === "unknown" ||
        health.version !== input.version
      ) {
        host.status = "incompatible";
        host.detail = `${host.alias} runs Whiteboard ${health.version}; this Desktop runs ${input.version}. Install Whiteboard ${input.version} on ${host.alias}.`;
      } else {
        host.status = "online";
        host.detail = undefined;
      }

      host.retry = setTimeout(
        () => void check(host),
        input.heartbeatMs ?? HEARTBEAT_MS,
      );
      host.retry.unref();
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
          JSON.stringify([
            current.endpoint,
            current.problem,
            current.installing,
            current.declined,
            current.installFailure,
          ]) ===
            JSON.stringify([
              given.endpoint,
              given.problem,
              given.installing,
              given.declined,
              given.installFailure,
            ])
        ) {
          previous.delete(given.alias);
          current.languageFeatures = given.languageFeatures;
          current.languageFeaturesDetail = given.languageFeaturesDetail;
          current.languageGroups = given.languageGroups;
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
    machineAlias: (serverId: string) => machine(serverId)?.alias,
    online: (): GatewayRemote[] =>
      hosts.filter(
        (host) => host.status === "online" && serving(host.serverId) === host,
      ),
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

const languageOf = ({
  languageFeatures,
  languageFeaturesDetail,
  languageGroups,
}: Pick<
  ReviewGatewayHost,
  "languageFeatures" | "languageFeaturesDetail" | "languageGroups"
>) => ({
  ...(languageFeatures !== undefined && { languageFeatures }),
  ...(languageFeaturesDetail !== undefined && { languageFeaturesDetail }),
  ...(languageGroups !== undefined && { languageGroups }),
});

export const remoteHeaders = (remote: GatewayRemote) => ({
  "x-review-token": remote.endpoint?.token ?? "",
  [REVIEW_CLIENT_HEADER]: REVIEW_CLIENT_REMOTE,
});

export function send(
  remote: GatewayRemote,
  request: {
    method: string;
    path: string;
    headers?: http.OutgoingHttpHeaders;
    body?: Buffer | Readable;
    signal: AbortSignal;
  },
  retry = true,
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

      if (
        retry &&
        outgoing.reusedSocket &&
        !request.signal.aborted &&
        !(request.body instanceof Readable) &&
        errorCode(error) === "ECONNRESET"
      )
        resolve(send(remote, request, false));
      else reject(error);
    });

    if (request.body instanceof Readable) request.body.pipe(outgoing);
    else outgoing.end(request.body);
  });
}

export async function readBody(
  response: http.IncomingMessage,
  limit: number,
  received?: () => void,
) {
  const parts: Buffer[] = [];
  let size = 0;

  for await (const part of response) {
    // SAFETY: an IncomingMessage without an encoding yields Buffers.
    const chunk = part as Buffer;
    received?.();
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

function errorCode(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);

  return (
    codedError.safeParse(cause).data?.code ??
    codedError.safeParse(cause.cause).data?.code ??
    cause.message
  );
}

export function errorText(cause: unknown): string {
  const code = errorCode(cause);

  return ERROR_WORDS.get(code) ?? code;
}
