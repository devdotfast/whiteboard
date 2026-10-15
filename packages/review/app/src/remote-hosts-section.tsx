import { controlStyles } from "@canvas/controls-styles";
import { DisclosureChevron, RefreshIcon } from "@canvas/icons";
import { fontSize } from "@canvas/scale.stylex";
import { Button, IconButton } from "@canvas/ui/button";
import { Checkbox } from "@canvas/ui/checkbox";
import { CopyableText, useCopy } from "@canvas/ui/copy";
import { useUiTooltip } from "@canvas/ui/host";
import { textStyles } from "@canvas/ui/text";
import { TextField } from "@canvas/ui/text-field";
import {
  REVIEW_CLI_INSTALL_TARGET_LABELS,
  type ReviewGatewayHostState,
  type ReviewRemoteAgent,
  type ReviewRemoteAgentId,
  type ReviewRemoteHostsSettings,
  reviewHostStatus,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { chevronMarker } from "./markers.stylex";
import {
  ACTION_WORDS,
  useHostAction,
  useRemoteHostStates,
  useSettingsReveal,
} from "./remote-host-state";
import { Section } from "./settings-section";
import { settingsStyles as styles } from "./settings-styles";
import { tokens } from "./tokens.stylex";

export function RemoteHostsSection({
  hosts,
}: {
  hosts: ReviewRemoteHostsSettings;
}) {
  const [configured, setConfigured] = useState(hosts.configured);
  const states = useRemoteHostStates(hosts);
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [uninstall, setUninstall] = useState(false);
  const section = useRef<HTMLElement>(null);
  useSettingsReveal(section);

  useEffect(() => {
    void hosts
      .suggestions()
      .then(setSuggestions)
      .catch(() => undefined);
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
    <Section ref={section} label="Remote Hosts (Experimental)">
      {configured.map((name) => (
        <HostRow
          key={name}
          hosts={hosts}
          name={name}
          state={states?.find((host) => host.alias === name)}
          loaded={!!states}
          remove={
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
          }
        >
          {removing === name ? (
            <div
              {...stylex.props(local.confirm)}
              role="group"
              aria-label={`Remove ${name}`}
            >
              <label {...stylex.props(styles.toggle)}>
                <Checkbox
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
        </HostRow>
      ))}
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
        <p role="alert" {...stylex.props(textStyles.error, styles.error)}>
          <CopyableText text={error} />
        </p>
      ) : null}
    </Section>
  );
}

// Rows toggled by hand, kept for the window.
const expandedHosts = new Map<string, boolean>();

function HostRow({
  hosts,
  name,
  state,
  loaded,
  remove,
  children,
}: {
  hosts: ReviewRemoteHostsSettings;
  name: string;
  state: ReviewGatewayHostState | undefined;
  loaded: boolean;
  remove: ReactNode;
  children: ReactNode;
}) {
  const online = state?.state === "online";

  const status = reviewHostStatus(
    state ?? { alias: name, state: "connecting" },
  );

  const failed = !!state && !!status.action;
  const agents = useRemoteAgents(hosts, name, online);

  const starting = online && !!state.languageFeaturesPending;

  const languageFailed =
    online &&
    !starting &&
    !state.languageFeatures &&
    !!state.languageFeaturesDetail;

  const missing = online
    ? (state.languageGroups ?? []).filter((group) => group.detail)
    : [];

  const unconnected = agents.list?.filter((agent) => !agent.connected) ?? [];

  const connected = agents.list?.filter((agent) => agent.connected).length ?? 0;

  const needsAction =
    failed ||
    !!state?.declined ||
    languageFailed ||
    missing.length > 0 ||
    unconnected.length > 0;

  const [chosen, setChosen] = useState(() => expandedHosts.get(name));

  // A row that opened itself stays open as its problem clears.
  if (chosen === undefined && needsAction) setChosen(true);

  const expanded = chosen ?? needsAction;
  const body = useId();

  const summary = [
    status.busy && state?.detail ? state.detail : status.status,
    ...(online && !expanded
      ? [
          connected
            ? `${connected} ${connected === 1 ? "agent" : "agents"} connected`
            : undefined,
          unconnected.length ? `${unconnected.length} to connect` : undefined,
          ...missing.map((group) => `${group.group} missing`),
        ]
      : []),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div {...stylex.props(styles.row, local.hostRow)} data-remote-host="">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={body}
        {...stylex.props(chevronMarker, local.toggle)}
        onClick={() => {
          expandedHosts.set(name, !expanded);
          setChosen(!expanded);
        }}
      >
        <DisclosureChevron expanded={expanded} />
        <span {...stylex.props(styles.rowText)}>
          <span {...stylex.props(styles.rowLabel)}>{name}</span>
          {loaded ? (
            <span
              {...stylex.props(
                styles.rowDescription,
                failed && textStyles.error,
              )}
            >
              {summary}
            </span>
          ) : null}
        </span>
      </button>
      <div {...stylex.props(styles.rowControl, local.actions)}>
        {state?.declined ? (
          <HostStep hosts={hosts} alias={name} action="install" />
        ) : null}
        {failed ? <HostStep hosts={hosts} alias={name} action="retry" /> : null}
        {remove}
      </div>
      {expanded ? (
        <div id={body} {...stylex.props(local.body)}>
          {state?.detail && !status.busy ? (
            <Detail failed={failed} text={state.detail} />
          ) : null}
          {state?.installCommand ? (
            <span {...stylex.props(styles.rowDescription, local.detail)}>
              <code {...stylex.props(local.command)}>
                {state.installCommand}
              </code>
            </span>
          ) : null}
          {online ? (
            <Group
              label="Language features"
              note={
                starting
                  ? "starting…"
                  : state.languageFeatures
                    ? "available"
                    : "unavailable"
              }
              refresh={<CheckAgain hosts={hosts} alias={name} />}
            >
              {languageFailed && state.languageFeaturesDetail ? (
                <span {...stylex.props(local.wide)}>
                  <Detail failed text={state.languageFeaturesDetail} />
                </span>
              ) : null}
              {state.languageGroups?.map(({ group, installed, detail }) => (
                <Item
                  key={group}
                  name={group}
                  text={detail ?? (installed ? "installed" : "not installed")}
                  failed={!!detail}
                />
              ))}
            </Group>
          ) : null}
          {online ? (
            <Group
              label="Agents"
              refresh={
                <RefreshButton
                  label={`Look for agents on ${name} again`}
                  pending={agents.refreshing}
                  onClick={agents.refresh}
                />
              }
            >
              {agents.list?.length ? null : (
                <span {...stylex.props(styles.rowDescription, local.wide)}>
                  {agents.list === undefined
                    ? "Looking for agents…"
                    : agents.list === null
                      ? `Could not read the agents on ${name}.`
                      : `No agents found on ${name}.`}
                </span>
              )}
              {agents.list?.map((agent) => (
                <AgentItem
                  key={agent.id}
                  agent={agent}
                  alias={name}
                  busy={agents.busy}
                  onConnect={() => void agents.connect(agent.id)}
                />
              ))}
              {agents.result ? (
                <span {...stylex.props(local.wide)}>
                  <Detail
                    role="status"
                    failed={agents.result.failed}
                    text={agents.result.text}
                  />
                </span>
              ) : null}
            </Group>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function AgentItem({
  agent,
  alias,
  busy,
  onConnect,
}: {
  agent: ReviewRemoteAgent;
  alias: string;
  busy: boolean;
  onConnect: () => void;
}) {
  const label = REVIEW_CLI_INSTALL_TARGET_LABELS[agent.id];
  const verb = agent.connected ? "Reconnect" : "Connect";

  const [copied, copy] = useCopy(
    `Run \`whiteboard connect ${agent.id}\` and follow the instructions to connect this agent to Whiteboard.`,
  );

  return (
    <Item name={label} text={agent.connected ? "connected" : "not connected"}>
      {agent.connected ? null : (
        <Button
          aria-label={`Copy a prompt for ${label} on ${alias}`}
          onClick={copy}
        >
          {copied ? "Copied" : "Copy prompt"}
        </Button>
      )}
      <Button
        aria-label={`${verb} ${label} on ${alias}`}
        disabled={busy}
        onClick={onConnect}
      >
        {verb}
      </Button>
    </Item>
  );
}

function useRemoteAgents(
  hosts: ReviewRemoteHostsSettings,
  alias: string,
  online: boolean,
) {
  const [list, setList] = useState<ReviewRemoteAgent[] | null>();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; failed: boolean }>();

  useEffect(() => {
    if (!online) return;
    let live = true;

    void hosts
      .agents(alias)
      .then((next) => {
        if (live) setList(next);
      })
      .catch(() => {
        if (live) setList(null);
      });

    return () => {
      live = false;
    };
  }, [hosts, alias, online]);

  const refresh = () => {
    setRefreshing(true);
    setResult(undefined);
    void hosts
      .agents(alias, true)
      .then(setList, () => setList(null))
      .finally(() => setRefreshing(false));
  };

  const connect = async (id: ReviewRemoteAgentId) => {
    const label = REVIEW_CLI_INSTALL_TARGET_LABELS[id];
    setBusy(true);
    setResult(undefined);

    try {
      const [done] = await hosts.connectAgents(alias, [id]);

      setResult(
        done?.connected
          ? { failed: false, text: `${label} is connected on ${alias}.` }
          : {
              failed: true,
              text: `${label} was not connected on ${alias}: ${done?.output || "it printed nothing"}`,
            },
      );
      setList(await hosts.agents(alias));
    } catch (cause) {
      setResult({
        failed: true,
        text: `Could not connect ${label} on ${alias}: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return {
    list: online ? list : undefined,
    refreshing,
    busy,
    result,
    refresh,
    connect,
  };
}

function Group({
  label,
  note,
  refresh,
  children,
}: {
  label: string;
  note?: string;
  refresh: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} {...stylex.props(local.group)}>
      <span {...stylex.props(local.groupLabel)}>
        {label}
        {note ? (
          <span {...stylex.props(styles.rowDescription)}>{note}</span>
        ) : null}
        {refresh}
      </span>
      {children}
    </div>
  );
}

function Item({
  name,
  text,
  failed = false,
  children,
}: {
  name: string;
  text: string;
  failed?: boolean;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(local.item)}>
      <span {...stylex.props(local.itemName)}>{name}</span>
      <Detail failed={failed} text={text} />
      <span {...stylex.props(local.itemAction)}>{children}</span>
    </div>
  );
}

function HostStep({
  hosts,
  alias,
  action,
}: {
  hosts: ReviewRemoteHostsSettings;
  alias: string;
  action: "retry" | "install";
}) {
  const { run, pending, failure } = useHostAction(hosts, alias);
  const label = ACTION_WORDS[action];

  return (
    <>
      {failure ? (
        <span role="alert" {...stylex.props(textStyles.error, styles.error)}>
          {failure}
        </span>
      ) : null}
      <Button
        aria-label={`${label} ${alias}`}
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={() => run(action)}
      >
        {label}
      </Button>
    </>
  );
}

function CheckAgain({
  hosts,
  alias,
}: {
  hosts: ReviewRemoteHostsSettings;
  alias: string;
}) {
  const { run, pending } = useHostAction(hosts, alias);

  return (
    <RefreshButton
      label={`Check ${alias} again`}
      pending={pending}
      onClick={() => run("retry")}
    />
  );
}

function RefreshButton({
  label,
  pending,
  onClick,
}: {
  label: string;
  pending: boolean;
  onClick: () => void;
}) {
  const tooltip = useUiTooltip("Check again");

  return (
    <IconButton
      ref={tooltip}
      size="small"
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={onClick}
    >
      <RefreshIcon xstyle={controlStyles.inlineIcon} spinning={pending} />
    </IconButton>
  );
}

function Detail({
  text,
  failed,
  role,
  children,
}: {
  text: string;
  failed: boolean;
  role?: "status";
  children?: ReactNode;
}) {
  return (
    <span
      role={role}
      {...stylex.props(
        styles.rowDescription,
        local.detail,
        failed && textStyles.error,
      )}
    >
      {failed ? <CopyableText text={text} /> : text}
      {children}
    </span>
  );
}

const local = stylex.create({
  detail: {
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  hostRow: {
    rowGap: "12px",
  },
  toggle: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: "transparent",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    gap: "8px",
    textAlign: "left",
  },
  body: {
    display: "flex",
    gridColumn: "1 / -1",
    flexDirection: "column",
    gap: "14px",
    paddingInlineStart: "24px",
  },
  group: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: "16px",
    rowGap: "6px",
  },
  groupLabel: {
    display: "flex",
    gridColumn: "1 / -1",
    alignItems: "center",
    color: tokens.ink,
    fontSize: fontSize.body,
    gap: "8px",
  },
  item: {
    display: "contents",
  },
  itemName: {
    color: tokens.ink,
    fontSize: fontSize.body,
  },
  itemAction: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
  },
  wide: {
    gridColumn: "1 / -1",
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
    whiteSpace: "pre-wrap",
  },
});
