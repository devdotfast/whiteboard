import { Button } from "@canvas/ui/button";
import type {
  ReviewGatewayHostState,
  ReviewRemoteAgent,
  ReviewRemoteHostsSettings,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";

import { TARGET_LABELS } from "./connect-card";
import { settingsStyles as styles } from "./settings-styles";
import { tokens } from "./tokens.stylex";

const STATES_EVERY_MS = 3000;

// Hosts that stopped trying until someone asks again.
const RETRIED = new Set<ReviewGatewayHostState["state"]>([
  "auth-failed",
  "incompatible",
  "not-installed",
  "unreachable",
  "unsupported",
]);

// The detail can carry a remote's text: shown as one line of plain text.
const plain = (text: string) =>
  text
    .replaceAll(/[\t\n\u2028\u2029]/g, " ")
    .replaceAll(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/**
 * The machines Whiteboard reaches over SSH: each alias with what the gateway
 * says of it, and an alias field that offers the SSH configuration's hosts.
 */
export function RemoteHostsSection({
  hosts,
}: {
  hosts: ReviewRemoteHostsSettings;
}) {
  const [configured, setConfigured] = useState(hosts.configured);
  const [states, setStates] = useState<readonly ReviewGatewayHostState[]>();
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void hosts
      .suggestions()
      .then(setSuggestions)
      .catch(() => undefined);
  }, [hosts]);

  useEffect(() => {
    let live = true;
    // A read can take up to its 30 s timeout; ticks meanwhile are skipped.
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
  }, [hosts]);

  const save = async (next: string[]) => {
    setBusy(true);
    setError(undefined);

    try {
      setConfigured(await hosts.set(next));

      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));

      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (await save([...configured, alias.trim()])) setAlias("");
  };

  return (
    <section {...stylex.props(styles.section)} aria-label="Remote hosts">
      <h2 {...stylex.props(styles.sectionLabel)}>Remote hosts</h2>
      {configured.map((name) => {
        const state = states?.find((host) => host.alias === name);

        return (
          <div key={name} {...stylex.props(styles.row)} data-remote-host="">
            <div {...stylex.props(styles.rowText)}>
              <span {...stylex.props(styles.rowLabel)}>{name}</span>
              {states ? (
                <span {...stylex.props(styles.rowDescription, local.detail)}>
                  {(state?.state ?? "connecting").replace("-", " ")}
                  {state?.detail ? ` · ${state.detail}` : null}
                </span>
              ) : null}
              {state?.state === "online" ? (
                <span {...stylex.props(styles.rowDescription, local.detail)}>
                  {state.languageFeatures
                    ? "Language features: available"
                    : `Language features: unavailable${state.languageFeaturesDetail ? ` — ${plain(state.languageFeaturesDetail)}` : ""}`}
                </span>
              ) : null}
              {state?.state === "online"
                ? state.languageGroups?.map(({ group, installed, detail }) => (
                    <span
                      key={group}
                      {...stylex.props(styles.rowDescription, local.detail)}
                    >
                      {`${plain(group)}: ${installed ? "installed" : "not installed"}${detail ? ` — ${plain(detail)}` : ""}`}
                    </span>
                  ))
                : null}
              {state?.state === "online" ? (
                <RemoteHostAgents hosts={hosts} alias={name} />
              ) : null}
              {state?.installCommand ? (
                <span {...stylex.props(styles.rowDescription, local.detail)}>
                  <code {...stylex.props(local.command)}>
                    {state.installCommand}
                  </code>
                </span>
              ) : null}
            </div>
            <div {...stylex.props(styles.rowControl, local.actions)}>
              {state?.declined ? (
                <Button
                  aria-label={`Install ${name}`}
                  onClick={() =>
                    void hosts.install(name).catch(() => undefined)
                  }
                >
                  Install
                </Button>
              ) : null}
              {state && RETRIED.has(state.state) ? (
                <Button
                  aria-label={`Retry ${name}`}
                  onClick={() => void hosts.retry(name).catch(() => undefined)}
                >
                  Retry
                </Button>
              ) : null}
              <Button
                aria-label={`Remove ${name}`}
                disabled={busy}
                onClick={() =>
                  void save(configured.filter((other) => other !== name))
                }
              >
                Remove
              </Button>
            </div>
          </div>
        );
      })}
      <form
        {...stylex.props(styles.row)}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <div {...stylex.props(styles.rowText)}>
          <span {...stylex.props(styles.rowLabel)}>Add a host</span>
          <span {...stylex.props(styles.rowDescription)}>
            An alias from your SSH configuration. Whiteboard offers to install
            itself there.
          </span>
        </div>
        <div {...stylex.props(styles.rowControl, local.actions)}>
          <input
            {...stylex.props(styles.input, local.alias)}
            aria-label="SSH alias"
            list="remote-host-suggestions"
            value={alias}
            spellCheck={false}
            autoCapitalize="off"
            onChange={(event) => setAlias(event.target.value)}
          />
          <datalist id="remote-host-suggestions">
            {suggestions
              .filter((suggestion) => !configured.includes(suggestion))
              .map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
          </datalist>
          <Button type="submit" disabled={busy}>
            Add
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The agents Desktop found on an online host: Connect runs their install
 * commands there. Nothing on the host changes before that. Names are
 * Desktop's own, never the host's.
 */
function RemoteHostAgents({
  hosts,
  alias,
}: {
  hosts: ReviewRemoteHostsSettings;
  alias: string;
}) {
  const [agents, setAgents] = useState<ReviewRemoteAgent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();

  useEffect(() => {
    let live = true;

    void hosts
      .agents(alias)
      .then((next) => {
        if (live) setAgents(next);
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [hosts, alias]);

  const offered = agents?.filter((agent) => !agent.connected && !agent.manual);
  const manual = agents?.filter((agent) => !agent.connected && agent.manual);

  const connect = async (ids: ReviewRemoteAgent["id"][]) => {
    setBusy(true);
    setResult(undefined);

    try {
      const results = await hosts.connectAgents(alias, ids);

      setResult(
        results
          .map((done) =>
            done.connected
              ? `${TARGET_LABELS[done.id]} is connected on ${alias}.`
              : `${TARGET_LABELS[done.id]} was not connected on ${alias}: ${done.output || "it printed nothing"}`,
          )
          .join(" "),
      );
      setAgents(await hosts.agents(alias));
    } catch (cause) {
      setResult(
        `Could not connect agents on ${alias}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {offered?.length ? (
        <span {...stylex.props(styles.rowDescription, local.detail)}>
          Agents on {alias}:{" "}
          {offered.map((agent) => TARGET_LABELS[agent.id]).join(", ")} —{" "}
          <Button
            aria-label={`Connect agents on ${alias}`}
            disabled={busy}
            onClick={() => void connect(offered.map((agent) => agent.id))}
          >
            Connect
          </Button>
        </span>
      ) : null}
      {manual?.map((agent) => (
        <span
          key={agent.id}
          {...stylex.props(styles.rowDescription, local.detail)}
        >
          Paste into {TARGET_LABELS[agent.id]} on {alias}:{" "}
          <code {...stylex.props(local.command)}>
            Run `whiteboard connect {agent.id}` and follow the instructions to
            connect this agent to Whiteboard.
          </code>
        </span>
      ))}
      {result ? (
        <span
          role="status"
          {...stylex.props(styles.rowDescription, local.detail)}
        >
          {result}
        </span>
      ) : null}
    </>
  );
}

const local = stylex.create({
  detail: {
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  actions: {
    gap: "8px",
  },
  alias: {
    minWidth: 0,
    flex: 1,
  },
  command: {
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    userSelect: "all",
  },
});
