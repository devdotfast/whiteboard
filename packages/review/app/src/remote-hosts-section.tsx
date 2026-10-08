import { Button } from "@canvas/ui/button";
import { TextField } from "@canvas/ui/text-field";
import {
  REVIEW_CLI_INSTALL_TARGET_LABELS,
  type ReviewGatewayHostState,
  type ReviewRemoteAgent,
  type ReviewRemoteHostsSettings,
  reviewHostStatus,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";

import { CopyableText } from "./copy-text";
import {
  REMOTE_HOSTS,
  STATES_EVERY_MS,
  useSettingsReveal,
} from "./remote-host-state";
import { settingsStyles as styles } from "./settings-styles";
import { tokens } from "./tokens.stylex";

const RETRIED = new Set<ReviewGatewayHostState["state"]>([
  "auth-failed",
  "incompatible",
  "not-installed",
  "offline",
  "unreachable",
  "duplicate",
  "unsupported",
]);

const plain = (text: string) =>
  text
    .replaceAll(/[\t\n\u2028\u2029]/g, " ")
    .replaceAll(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

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
  const [removing, setRemoving] = useState<string>();
  const [uninstall, setUninstall] = useState(false);
  const section = useRef<HTMLElement>(null);
  useSettingsReveal(REMOTE_HOSTS, section);

  useEffect(() => {
    void hosts
      .suggestions()
      .then(setSuggestions)
      .catch(() => undefined);
  }, [hosts]);

  useEffect(() => {
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

  const remove = async (name: string) => {
    setRemoving(undefined);
    let problem: string | undefined;

    if (uninstall) {
      setBusy(true);

      try {
        await hosts.uninstall(name);
      } catch (cause) {
        problem = cause instanceof Error ? cause.message : String(cause);
      }
    }

    await save(configured.filter((other) => other !== name));

    if (problem) setError(problem);
  };

  return (
    <section
      ref={section}
      {...stylex.props(styles.section)}
      aria-label="Remote hosts"
    >
      <h2 {...stylex.props(styles.sectionLabel)}>Remote hosts</h2>
      {configured.map((name) => {
        const state = states?.find((host) => host.alias === name);

        return (
          <div key={name} {...stylex.props(styles.row)} data-remote-host="">
            <div {...stylex.props(styles.rowText)}>
              <span {...stylex.props(styles.rowLabel)}>{name}</span>
              {states ? (
                <Detail
                  failed={state !== undefined && RETRIED.has(state.state)}
                  text={
                    state?.detail ??
                    reviewHostStatus(
                      state ?? { alias: name, state: "connecting" },
                    ).status
                  }
                />
              ) : null}
              {state?.state === "online" ? (
                <Detail
                  failed={
                    !state.languageFeatures && !!state.languageFeaturesDetail
                  }
                  text={
                    state.languageFeatures
                      ? "Language features: available"
                      : `Language features: unavailable${state.languageFeaturesDetail ? ` · ${plain(state.languageFeaturesDetail)}` : ""}`
                  }
                />
              ) : null}
              {state?.state === "online"
                ? state.languageGroups?.map(({ group, installed, detail }) => (
                    <Detail
                      key={group}
                      failed={!!detail}
                      text={`${plain(group)}: ${installed ? "installed" : "not installed"}${detail ? ` · ${plain(detail)}` : ""}`}
                    />
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
                <HostStep
                  label="Install"
                  alias={name}
                  run={() => hosts.install(name)}
                />
              ) : null}
              {state && RETRIED.has(state.state) ? (
                <HostStep
                  label="Retry"
                  alias={name}
                  run={() => hosts.retry(name)}
                />
              ) : null}
              <Button
                aria-label={`Remove ${name}`}
                aria-expanded={removing === name}
                disabled={busy}
                onClick={() => {
                  setUninstall(false);
                  setRemoving(removing === name ? undefined : name);
                }}
              >
                Remove
              </Button>
            </div>
            {removing === name ? (
              <div
                {...stylex.props(local.confirm)}
                role="group"
                aria-label={`Remove ${name}`}
              >
                <label {...stylex.props(styles.toggle)}>
                  <input
                    {...stylex.props(styles.checkbox)}
                    type="checkbox"
                    checked={uninstall}
                    onChange={(event) => setUninstall(event.target.checked)}
                  />
                  Also remove Whiteboard from {name}
                </label>
                <Button disabled={busy} onClick={() => void remove(name)}>
                  Remove host
                </Button>
                <Button onClick={() => setRemoving(undefined)}>Cancel</Button>
              </div>
            ) : null}
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
          <TextField
            xstyle={[styles.input, local.alias]}
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
          <CopyableText text={error} />
        </p>
      ) : null}
    </section>
  );
}

function RemoteHostAgents({
  hosts,
  alias,
}: {
  hosts: ReviewRemoteHostsSettings;
  alias: string;
}) {
  const [agents, setAgents] = useState<ReviewRemoteAgent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; failed: boolean }>();

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

      setResult({
        failed: results.some((done) => !done.connected),
        text: results
          .map((done) =>
            done.connected
              ? `${REVIEW_CLI_INSTALL_TARGET_LABELS[done.id]} is connected on ${alias}.`
              : `${REVIEW_CLI_INSTALL_TARGET_LABELS[done.id]} was not connected on ${alias}: ${done.output || "it printed nothing"}`,
          )
          .join(" "),
      });
      setAgents(await hosts.agents(alias));
    } catch (cause) {
      setResult({
        failed: true,
        text: `Could not connect agents on ${alias}: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {offered?.length ? (
        <span {...stylex.props(styles.rowDescription, local.detail)}>
          Agents on {alias}:{" "}
          {offered
            .map((agent) => REVIEW_CLI_INSTALL_TARGET_LABELS[agent.id])
            .join(", ")}{" "}
          —{" "}
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
          Paste into {REVIEW_CLI_INSTALL_TARGET_LABELS[agent.id]} on {alias}:{" "}
          <code {...stylex.props(local.command)}>
            Run `whiteboard connect {agent.id}` and follow the instructions to
            connect this agent to Whiteboard.
          </code>
        </span>
      ))}
      {result ? (
        <Detail role="status" failed={result.failed} text={result.text} />
      ) : null}
    </>
  );
}

/** A row's detail line; a failure reads as an error and copies on click. */
function HostStep({
  label,
  alias,
  run,
}: {
  label: string;
  alias: string;
  run(): Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  return (
    <>
      {failure ? (
        <span role="alert" {...stylex.props(styles.error)}>
          {failure}
        </span>
      ) : null}
      <Button
        aria-label={`${label} ${alias}`}
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={() => {
          setPending(true);
          setFailure(undefined);
          void run()
            .catch((error: Error) => setFailure(error.message))
            .finally(() => setPending(false));
        }}
      >
        {label}
      </Button>
    </>
  );
}

function Detail({
  text,
  failed,
  role,
}: {
  text: string;
  failed: boolean;
  role?: "status";
}) {
  return (
    <span
      role={role}
      {...stylex.props(
        styles.rowDescription,
        local.detail,
        failed && local.failed,
      )}
    >
      {failed ? <CopyableText text={text} /> : text}
    </span>
  );
}

const local = stylex.create({
  detail: {
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  failed: {
    color: tokens.changeRemoved,
  },
  actions: {
    gap: "8px",
  },
  confirm: {
    display: "flex",
    gridColumn: "1 / -1",
    flexWrap: "wrap",
    alignItems: "center",
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
