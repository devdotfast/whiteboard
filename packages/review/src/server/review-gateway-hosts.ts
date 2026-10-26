import {
  type REVIEW_REMOTE_INSTALL_STEPS,
  type ReviewGatewayHost,
  type ReviewGatewayHostState,
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

/** A busy server can miss a check; only this many in a row mean it is gone. */
const MISSED_CHECKS = 3;

const HEARTBEAT_MS = 10_000;

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
  package: "Installing the Whiteboard package",
  done: "Installed; starting the server",
};

const healthSchema = z.object({
  ok: z.literal(true),
  serverId: z.string().optional(),
  version: z.string(),
});

export interface GatewayRemote {
  readonly alias: string;
  readonly endpoint?: { url: string; token: string };
  readonly dispatcher?: Agent;
  readonly serverId?: string;
  readonly unauthorized?: () => void;
}

interface Host extends GatewayRemote {
  endpoint?: { url: string; token: string };
  dispatcher?: Agent;
  unauthorized?: () => void;
  problem?: ReviewGatewayHost["problem"];
  languageFeatures?: boolean;
  languageFeaturesDetail?: string;
  languageFeaturesPending?: true;
  languageGroups?: ReviewGatewayHost["languageGroups"];
  installing?: ReviewGatewayHost["installing"];
  declined?: true;
  asking?: string;
  installFailure?: string;
  serverId?: string;
  status: ReviewGatewayHostState["state"];
  detail?: string;
  retryMs: number;
  retry?: NodeJS.Timeout;
  checking?: AbortController;
  missed?: number;
}

export function createGatewayHosts(input: {
  version: string;
  log?(message: string): void;
  machine?(serverId: string, alias: string): void;
  changed?(): void;
  restarted?(alias: string): void;
  heartbeatMs?: number;
  healthTimeoutMs?: number;
}) {
  const healthTimeoutMs = input.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
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
          installCommand: `curl -fsSL https://install.dev.fast/releases/${input.version}/remote/install.sh | sh -s -- --version ${input.version}`,
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

  function restartedHost(
    host: Host,
    detail = `${host.alias} restarted; attaching again.`,
  ) {
    if (closed || !host.endpoint) return;
    host.endpoint = undefined;
    host.missed = 0;
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
    void host.dispatcher?.destroy();
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
      host.installing = given.installing;
      host.status = "installing";
      host.detail = `${INSTALL_STEPS[given.installing.step]}.`;
    } else if (given.asking && !given.endpoint) {
      host.asking = given.asking;
      host.detail = `Waiting for an answer: install Whiteboard ${given.asking} on ${given.alias}?`;
    } else if (!given.endpoint)
      host.detail = `Waiting for a connection to ${given.alias}.`;
    else {
      host.dispatcher = new Agent();
      host.unauthorized = () => restartedHost(host);
    }

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
    const timeout = AbortSignal.timeout(healthTimeoutMs);
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
        reason = `it did not answer within ${healthTimeoutMs / 1_000} seconds`;
      else if (!abort.signal.aborted) reason = errorText(error);
    }

    if (host.checking !== abort) return;
    host.checking = undefined;

    // /health leaves out serverId when it refuses the token, as after a restart.
    if (health && health.serverId === undefined) return restartedHost(host);

    const missed = !health && timeout.aborted && host.serverId !== undefined;
    host.missed = missed ? (host.missed ?? 0) + 1 : 0;

    if (missed && host.missed < MISSED_CHECKS) {
      log(`Host ${host.alias}: ${reason}; checking again.`);

      return schedule(host, FIRST_RETRY_MS);
    }

    if (!health && host.serverId !== undefined)
      return restartedHost(
        host,
        `${host.alias} is offline: ${reason}; attaching again.`,
      );

    if (!health) {
      host.status = "offline";
      host.detail = `${host.alias} is offline: ${reason}.`;
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
          JSON.stringify([
            current.endpoint,
            current.problem,
            current.installing,
            current.declined,
            current.asking,
            current.installFailure,
          ]) ===
            JSON.stringify([
              given.endpoint,
              given.problem,
              given.installing,
              given.declined,
              given.asking,
              given.installFailure,
            ])
        ) {
          previous.delete(given.alias);
          current.languageFeatures = given.languageFeatures;
          current.languageFeaturesDetail = given.languageFeaturesDetail;
          current.languageFeaturesPending = given.languageFeaturesPending;
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

const languageOf = ({
  languageFeatures,
  languageFeaturesDetail,
  languageFeaturesPending,
  languageGroups,
}: Pick<
  ReviewGatewayHost,
  | "languageFeatures"
  | "languageFeaturesDetail"
  | "languageFeaturesPending"
  | "languageGroups"
>) => ({
  ...(languageFeatures !== undefined && { languageFeatures }),
  ...(languageFeaturesDetail !== undefined && { languageFeaturesDetail }),
  ...(languageFeaturesPending && { languageFeaturesPending }),
  ...(languageGroups !== undefined && { languageGroups }),
});
