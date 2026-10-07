import {
  type ReviewVerbRequest,
  type ReviewVerbResponse,
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
import { keepOpen, readLines } from "./review-gateway-transport.js";

const REMOTE_VERBS = new Set<ReviewVerbRequest["name"]>([
  "authoringCapabilities",
  "openApiReview",
  "focusWindow",
]);

export function createGatewayPushes(input: {
  hosts: GatewayHosts;
  relay: ReviewDesktopVerbRelay;
  claim(remote: GatewayRemote, reviewId: string): Promise<string | undefined>;
  log(message: string): void;
}) {
  const { hosts, relay } = input;
  const links = new Map<GatewayRemote, AbortController>();

  async function answer(
    remote: GatewayRemote,
    request: ReviewVerbRequest,
  ): Promise<ReviewVerbResponse> {
    if (!REMOTE_VERBS.has(request.name))
      return {
        ok: false,
        error: `${request.name} is not available from another machine.`,
      };

    if (request.name === "openApiReview") {
      const { reviewId } = request.args;

      if (!UUID.test(reviewId))
        return {
          ok: false,
          error: `${reviewId} cannot be opened from ${remote.alias}: a review on another machine has a UUID.`,
        };

      const refused = await input.claim(remote, reviewId);

      if (refused) return { ok: false, error: refused };
    }

    return relay.dispatch(request);
  }

  async function reply(
    remote: GatewayRemote,
    id: string,
    response: ReviewVerbResponse,
  ) {
    try {
      const answered = await send(remote, {
        method: "POST",
        path: "/control/result",
        headers: {
          ...remoteHeaders(remote),
          "content-type": "application/json",
        },
        body: Buffer.from(JSON.stringify({ id, response })),
        signal: AbortSignal.timeout(FIRST_BYTE_TIMEOUT_MS),
      });

      await answered.body.dump();
    } catch (error) {
      input.log(
        `Could not answer ${remote.alias}'s push: ${errorText(error)}.`,
      );
    }
  }

  async function push(remote: GatewayRemote, data: string) {
    let frame: ReturnType<typeof parseReviewDesktopVerbFrame>;

    try {
      frame = parseReviewDesktopVerbFrame(parseJsonText(data));
    } catch {
      input.log(`Ignored an unreadable push from ${remote.alias}.`);

      return;
    }

    let response: ReviewVerbResponse;

    try {
      response = await answer(remote, frame.request);
    } catch (error) {
      response = { ok: false, error: errorText(error) };
    }

    await reply(remote, frame.id, response);
  }

  return {
    changed() {
      const online = new Set(relay.attached ? hosts.online() : []);

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
