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

/** The only verbs another machine may send to the laptop's windows. */
const REMOTE_VERBS = new Set<ReviewVerbRequest["name"]>([
  "authoringCapabilities",
  "openApiReview",
  "focusWindow",
]);

/**
 * Attaches to `/control` on each online machine, so a remote's "open this
 * review" reaches the laptop's windows through the laptop's own relay.
 */
export function createGatewayPushes(input: {
  hosts: GatewayHosts;
  relay: ReviewDesktopVerbRelay;
  /** Why `remote` may not open `reviewId`; undefined records it as the owner. */
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

      // The scratchpad and shared reviews are only ever the laptop's.
      if (!UUID.test(reviewId))
        return {
          ok: false,
          error: `${reviewId} cannot be opened from ${remote.alias}: a review on another machine has a UUID.`,
        };

      // Known before the window's first request for it.
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
    /** Hosts or the laptop's windows changed: one link per online machine. */
    changed() {
      // With no window here, a remote must see no Desktop attached.
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
