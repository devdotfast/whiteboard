import {
  type ReviewGatewayHostState,
  type ReviewHostStatus,
  type ReviewRemoteHostActions,
  reviewHostStatus,
} from "@dev.fast/review-protocol";
import { type RefObject, useEffect, useState } from "react";

import type { ReviewSessionData } from "./host/review-session-data";

export const STATES_EVERY_MS = 3000;

export function useRemoteHostState(
  hosts: ReviewRemoteHostActions | undefined,
  alias: string | undefined,
  watch: boolean,
) {
  const [state, setState] = useState<ReviewGatewayHostState>();

  useEffect(() => {
    if (!hosts || !alias || !watch) return;
    let live = true;

    const read = () => {
      if (document.hidden) return;
      void hosts
        .states()
        .then((states) => {
          if (live) setState(states.find((host) => host.alias === alias));
        })
        .catch(() => undefined);
    };

    read();
    const timer = setInterval(read, STATES_EVERY_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [hosts, alias, watch]);

  return watch ? state : undefined;
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
  hosts: ReviewRemoteHostActions | undefined,
  alias: string | undefined,
  retried?: () => void,
) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  const run = (action: NonNullable<ReviewHostStatus["action"]>) => {
    if (!hosts || !alias) return;
    setPending(true);
    setFailure(undefined);

    const step =
      action === "retry"
        ? hosts.retry(alias).then(retried)
        : action === "install"
          ? hosts.install(alias)
          : hosts
              .openSettings()
              .then(() => revealSettingsSection(REMOTE_HOSTS));

    void step
      .catch((error: Error) => setFailure(error.message))
      .finally(() => setPending(false));
  };

  return { run, pending, failure };
}

export const REMOTE_HOSTS = "remote-hosts";

// Every canvas tab shares this module, so a review can ask the Settings tab,
// open or about to mount, to scroll.
let requested: string | undefined;

const reveals = new EventTarget();

function revealSettingsSection(section: string) {
  requested = section;
  reveals.dispatchEvent(new Event("reveal"));
}

export function useSettingsReveal(
  section: string,
  ref: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const reveal = () => {
      if (requested !== section || !ref.current) return;
      requested = undefined;
      ref.current.scrollIntoView({ block: "start" });
    };

    reveal();
    reveals.addEventListener("reveal", reveal);

    return () => reveals.removeEventListener("reveal", reveal);
  }, [section, ref]);
}
