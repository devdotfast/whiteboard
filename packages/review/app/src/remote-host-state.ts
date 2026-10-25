import {
  type ReviewGatewayHostState,
  type ReviewHostStatus,
  type ReviewRemoteHostActions,
  reviewHostStatus,
} from "@dev.fast/review-protocol";
import { type RefObject, useEffect, useState } from "react";

import type { ReviewSessionData } from "./host/review-session-data";

const STATES_EVERY_MS = 3000;

export function useRemoteHostStates(
  hosts: Pick<ReviewRemoteHostActions, "states"> | undefined,
  watch = true,
) {
  const [states, setStates] = useState<readonly ReviewGatewayHostState[]>();

  useEffect(() => {
    if (!hosts || !watch) return;
    let live = true;
    let reading = false;

    const read = () => {
      if (document.hidden || reading) return;
      reading = true;
      void hosts
        .states()
        .then((next) => {
          if (live) setStates(next);
        })
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    };

    read();
    const timer = setInterval(read, STATES_EVERY_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [hosts, watch]);

  return watch ? states : undefined;
}

export function useRemoteHostState(
  hosts: ReviewRemoteHostActions | undefined,
  alias: string | undefined,
  watch: boolean,
) {
  return useRemoteHostStates(alias ? hosts : undefined, watch)?.find(
    (host) => host.alias === alias,
  );
}

/** A remote review's host while it is not online, with the reason read live. */
export function useReviewHostDown(
  review: Pick<ReviewSessionData, "host" | "hostState" | "hosts"> | undefined,
): ReviewHostStatus | undefined {
  const { host, hostState, hosts } = review ?? {};

  const down =
    host !== undefined && hostState !== undefined && hostState !== "online";

  const live = useRemoteHostState(hosts, host, down);

  if (!down) return undefined;

  return reviewHostStatus(
    live && live.state !== "online" ? live : { alias: host, state: hostState },
  );
}

export const ACTION_WORDS: Record<
  NonNullable<ReviewHostStatus["action"]>,
  string
> = { retry: "Retry", install: "Install", settings: "Open Settings" };

/** Runs a host's next step; Settings opens scrolled to Remote hosts. */
export function useHostAction(
  hosts:
    | (Pick<ReviewRemoteHostActions, "retry" | "install"> &
        Partial<Pick<ReviewRemoteHostActions, "openSettings">>)
    | undefined,
  alias: string | undefined,
  retried?: () => void,
) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  const run = (action: NonNullable<ReviewHostStatus["action"]>) => {
    if (!hosts || !alias || pending) return;
    setPending(true);
    setFailure(undefined);

    const step =
      action === "retry"
        ? hosts.retry(alias).then(retried)
        : action === "install"
          ? hosts.install(alias)
          : Promise.resolve(hosts.openSettings?.()).then(revealRemoteHosts);

    void step
      .catch((error: Error) => setFailure(error.message))
      .finally(() => setPending(false));
  };

  return { run, pending, failure };
}

// Every canvas tab shares this module, so a review can ask the Settings tab,
// open or about to mount, to scroll to Remote hosts.
let requested = false;

const reveals = new EventTarget();

function revealRemoteHosts() {
  requested = true;
  reveals.dispatchEvent(new Event("reveal"));
}

export function useSettingsReveal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const reveal = () => {
      if (!requested || !ref.current) return;
      requested = false;
      ref.current.scrollIntoView({ block: "start" });
    };

    reveal();
    reveals.addEventListener("reveal", reveal);

    return () => reveals.removeEventListener("reveal", reveal);
  }, [ref]);
}
