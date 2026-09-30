import {
  type JsonValue,
  type ReviewVerbResponse,
  isJsonObject,
  parseJsonText,
  parseReviewDesktopVerbFrame,
} from "@dev.fast/review-protocol";

import type { ReviewDesktopVerbRelay } from "./global-verb-relay.js";
import {
  FIRST_BYTE_TIMEOUT_MS,
  type GatewayHosts,
  type GatewayRemote,
  UUID,
  errorText,
  remoteHeaders,
  send,
} from "./review-gateway-hosts.js";
import type { GatewayMemory } from "./review-gateway-memory.js";
import { keepOpen, readLines } from "./review-gateway-streams.js";

/**
 * Attaches to `/control` on each online machine, so a remote's "open this
 * review" and its other Desktop verbs reach the laptop's windows through the
 * laptop's own relay.
 */
export function createGatewayPushes(input: {
  hosts: GatewayHosts;
  memory: GatewayMemory;
  relay: ReviewDesktopVerbRelay;
  log(message: string): void;
}) {
  const { hosts, memory, relay } = input;
  const links = new Map<GatewayRemote, AbortController>();

  async function answer(
    remote: GatewayRemote,
    request: JsonValue,
    reviewId: string | undefined,
  ): Promise<ReviewVerbResponse> {
    if (reviewId !== undefined) {
      // The scratchpad and shared reviews are only ever the laptop's.
      if (!UUID.test(reviewId))
        return {
          ok: false,
          error: `${reviewId} cannot be opened from ${remote.alias}: a review on another machine has a UUID.`,
        };

      // Known before the window's first request for it.
      if (remote.serverId !== undefined)
        memory.remember(
          remote.serverId,
          hosts.machineAlias(remote.serverId) ?? remote.alias,
          reviewId,
        );
    }

    return relay.dispatch(request);
  }

  async function reply(
    remote: GatewayRemote,
    id: string,
    response: ReviewVerbResponse,
  ) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FIRST_BYTE_TIMEOUT_MS);

    try {
      const answered = await send(remote, {
        method: "POST",
        path: "/control/result",
        headers: {
          ...remoteHeaders(remote),
          "content-type": "application/json",
        },
        body: Buffer.from(JSON.stringify({ id, response })),
        signal: abort.signal,
      });

      answered.resume();
    } catch (error) {
      input.log(
        `Could not answer ${remote.alias}'s push: ${errorText(error)}.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function push(remote: GatewayRemote, data: string) {
    let id: string;
    let reviewId: string | undefined;
    let request: JsonValue;

    try {
      const value = parseJsonText(data);
      const frame = parseReviewDesktopVerbFrame(value);
      id = frame.id;

      if (frame.request.name === "openApiReview")
        reviewId = frame.request.args.reviewId;
      else if (frame.request.name === "openReview")
        reviewId = frame.request.args.reviewUuid;

      // The relay parses the request itself.
      request = isJsonObject(value) ? (value.request ?? null) : null;
    } catch {
      input.log(`Ignored an unreadable push from ${remote.alias}.`);

      return;
    }

    let response: ReviewVerbResponse;

    try {
      response = await answer(remote, request, reviewId);
    } catch (error) {
      response = { ok: false, error: errorText(error) };
    }

    await reply(remote, id, response);
  }

  return {
    /** Host states changed: one link per online machine. */
    changed() {
      const online = new Set(hosts.online());

      for (const [remote, abort] of links)
        if (!online.has(remote)) {
          abort.abort();
          links.delete(remote);
        }

      for (const remote of online) {
        if (links.has(remote)) continue;
        const abort = new AbortController();
        links.set(remote, abort);

        keepOpen({
          hosts,
          remote,
          path: "/control",
          signal: abort.signal,
          read: (body) =>
            readLines(body, (line) => {
              if (line.startsWith("data: "))
                void push(remote, line.slice("data: ".length));
            }),
        });
      }
    },
    close() {
      for (const abort of links.values()) abort.abort();
      links.clear();
    },
  };
}
