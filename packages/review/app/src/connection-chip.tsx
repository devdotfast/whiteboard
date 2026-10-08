import { fontSize, fontWeight, motion, radius } from "@canvas/scale.stylex";
import { Button } from "@canvas/ui/button";
import {
  type ReviewRemoteHostActions,
  reviewHostStatus,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { createContext, useContext } from "react";

import { RefreshIcon } from "./icons";
import {
  ACTION_WORDS,
  useHostAction,
  useRemoteHostState,
} from "./remote-host-state";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { useTooltip } from "./use-tooltip";

export interface LostConnection {
  host?: string;
  hosts?: ReviewRemoteHostActions;
  detail: string;
  /** Reopen the review stream after a retry. */
  reconnect(): void;
}

export const ConnectionContext = createContext<LostConnection | undefined>(
  undefined,
);

/** Shown while the review stream is down; on a remote review it offers the host's next step. */
export function ConnectionChip() {
  const connection = useContext(ConnectionContext);
  const { host, hosts } = connection ?? {};
  const state = useRemoteHostState(hosts, host, connection !== undefined);

  const status =
    state && state.state !== "online" ? reviewHostStatus(state) : undefined;

  const action = status ? status.action : host && hosts ? "retry" : undefined;

  const { run, pending, failure } = useHostAction(
    hosts,
    host,
    connection?.reconnect,
  );

  const tooltip = useTooltip<HTMLElement>(
    action ? `Click to ${ACTION_WORDS[action].toLowerCase()}` : "Reconnecting…",
    { detail: failure ?? status?.sentence ?? connection?.detail },
  );

  if (!connection) return null;

  const label =
    status?.label ?? (host ? `${host} disconnected` : "Disconnected");

  const spinning = pending || status?.busy;

  if (!action)
    return (
      <span
        {...withClass("connection-chip", styles.chip)}
        role="status"
        ref={tooltip}
      >
        <span {...stylex.props(styles.text)}>{label}</span>
        {spinning ? (
          <RefreshIcon xstyle={[styles.icon, styles.spinning]} />
        ) : null}
      </span>
    );

  return (
    <button
      type="button"
      {...withClass("connection-chip", styles.chip, styles.button)}
      aria-label={`${label}. ${ACTION_WORDS[action]}.`}
      aria-busy={pending || undefined}
      disabled={pending}
      ref={tooltip}
      onClick={() => run(action)}
    >
      <span role="status" {...stylex.props(styles.text)}>
        {label}
      </span>
      {action === "retry" ? (
        <RefreshIcon xstyle={[styles.icon, spinning && styles.spinning]} />
      ) : (
        <span {...stylex.props(styles.action)}>{ACTION_WORDS[action]}</span>
      )}
    </button>
  );
}

/** A remote review that has not loaded: what its host is doing, and the next step. */
export function HostWaiting({
  host,
  hosts,
  reconnect,
  lost,
}: {
  host: string;
  hosts: ReviewRemoteHostActions;
  reconnect(): void;
  lost?: string;
}) {
  const state = useRemoteHostState(hosts, host, true);
  const { run, pending, failure } = useHostAction(hosts, host, reconnect);

  if (!state || state.state === "online")
    return lost === undefined ? null : (
      <p {...stylex.props(styles.waiting)} role="status">
        Connection lost. Reconnecting… {lost}
      </p>
    );

  const status = reviewHostStatus(state);
  const { action } = status;

  return (
    <section
      {...withClass("host-waiting", styles.waiting)}
      role="status"
      aria-busy={status.busy}
    >
      <h2 {...stylex.props(styles.waitingLabel)}>{status.label}</h2>
      <p {...stylex.props(styles.waitingSentence)}>
        {failure ?? status.sentence}
      </p>
      {action ? (
        <Button disabled={pending} onClick={() => run(action)}>
          {ACTION_WORDS[action]}
        </Button>
      ) : null}
    </section>
  );
}

const REDUCED = "@media (prefers-reduced-motion: reduce)";

const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  chip: {
    display: "inline-flex",
    flex: "0 1 auto",
    minWidth: 0,
    maxWidth: "320px",
    alignItems: "center",
    gap: "6px",
    height: tokens.chromeControlHeight,
    marginInline: "4px",
    padding: "0 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.warningOutline,
    borderRadius: radius.pill,
    backgroundColor: tokens.warningWash,
    color: tokens.changeModified,
    font: `${fontWeight.semibold} ${fontSize.small} ${tokens.fontMono}`,
    whiteSpace: "nowrap",
  },
  // A long alias ends in an ellipsis; the tooltip has it all.
  text: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  button: {
    paddingInlineEnd: "7px",
    cursor: { default: "pointer", ":disabled": "progress" },
    filter: { default: null, ":hover:not(:disabled)": "brightness(1.15)" },
    outline: {
      default: null,
      ":focus-visible": `1px solid ${tokens.changeModified}`,
    },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  waiting: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "12px",
    maxWidth: "72ch",
    margin: "32px auto",
    padding: "0 24px",
    font: `${fontSize.reading}/1.6 ${tokens.fontDisplay}`,
  },
  waitingLabel: {
    margin: 0,
    color: tokens.changeModified,
    font: `${fontWeight.semibold} ${fontSize.reading} ${tokens.fontMono}`,
  },
  waitingSentence: {
    margin: 0,
    color: tokens.inkMuted,
  },
  action: {
    textDecorationLine: "underline",
    textUnderlineOffset: "2px",
  },
  icon: {
    flexShrink: 0,
    width: "13px",
    height: "13px",
  },
  spinning: {
    animationName: { default: spin, [REDUCED]: "none" },
    animationDuration: { default: motion.pulse, [REDUCED]: motion.instant },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});
