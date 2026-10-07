import { Button } from "@canvas/ui/button";
import { TextField } from "@canvas/ui/text-field";
import type {
  ReviewGatewayHostState,
  ReviewRemoteHostsSettings,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";

import { settingsStyles as styles } from "./settings-styles";
import { tokens } from "./tokens.stylex";

const STATES_EVERY_MS = 3000;

const RETRIED = new Set<ReviewGatewayHostState["state"]>([
  "auth-failed",
  "not-installed",
  "unreachable",
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
              {state?.installCommand ? (
                <span {...stylex.props(styles.rowDescription, local.detail)}>
                  <code {...stylex.props(local.command)}>
                    {state.installCommand}
                  </code>
                </span>
              ) : null}
            </div>
            <div {...stylex.props(styles.rowControl, local.actions)}>
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
            An alias from your SSH configuration. Whiteboard must be installed
            there.
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
          {error}
        </p>
      ) : null}
    </section>
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
