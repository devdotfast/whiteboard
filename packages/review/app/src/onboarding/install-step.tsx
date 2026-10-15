import { cliInstallReady } from "@canvas/cli-install-status";
import { ArrowRightIcon, DrawnCheckIcon, PlusIcon } from "@canvas/icons";
import { installRowMarker } from "@canvas/markers.stylex";
import { fontSize, fontWeight, motion, radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { Button } from "@canvas/ui/button";
import { Checkbox } from "@canvas/ui/checkbox";
import { CopyIcon, useCopy } from "@canvas/ui/copy";
import type {
  ReviewCanvasSetupActions,
  ReviewCliInstallStatus,
  ReviewCliInstallTarget,
  ReviewConnectAgent,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { OnboardingClient } from "./onboarding-client";
import { ScreenHeader, Spinner, useReturnKey } from "./onboarding-parts";
import { onboardingStyles } from "./onboarding-styles";

type RowState = "waiting" | "running" | "done" | "approve" | "failed";

interface Row {
  id: "cli" | ReviewCliInstallTarget;
  name: string;
  /** What it runs, shown under the name. */
  detail: string;
  state: RowState;
  /** What the step printed, for a failure's tooltip. */
  output?: string;
}

/** What each harness runs, as the row shows it. */
const COMMANDS: Record<ReviewCliInstallTarget, string> = {
  claude: "claude plugin install whiteboard@devfast",
  codex: "codex plugin add whiteboard@devfast",
  opencode: "opencode mcp add --global whiteboard",
  pi: "pi mcp add whiteboard",
  omp: "~/.omp/agent/mcp.json",
  copilot: "copilot plugin install whiteboard@devfast",
  cursor: "Cursor asks you to approve new MCP servers",
};

// Cursor last, as it connects last: its approval opens Cursor over Whiteboard.
const ORDER: ReviewCliInstallTarget[] = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "omp",
  "copilot",
  "cursor",
];

const byOrder = (a: ReviewConnectAgent, b: ReviewConnectAgent) =>
  ORDER.indexOf(a.target) - ORDER.indexOf(b.target);

/** Second screen: list what it will install, then, once the reader agrees,
 * install the command and connect each agent found that they left ticked. */
export function InstallStep({
  client,
  setupActions,
  onProgress,
  onContinue,
}: {
  client: OnboardingClient;
  setupActions: ReviewCanvasSetupActions;
  onProgress(fraction: number): void;
  onContinue(): void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(true);
  // How each agent connects by hand, as Settings shows it.
  const [manual, setManual] = useState<ReviewCliInstallStatus["connect"]>();
  const [approved, setApproved] = useState(false);
  // The agents the reader unticked; every one found starts ticked.
  const [skipped, setSkipped] = useState<ReadonlySet<Row["id"]>>(new Set());
  const started = useRef(false);
  const rowsRef = useRef(rows);
  const approvedRef = useRef(approved);
  const skippedRef = useRef(skipped);

  rowsRef.current = rows;
  approvedRef.current = approved;
  skippedRef.current = skipped;

  const toggle = (id: Row["id"]) =>
    setSkipped((current) => {
      const next = new Set(current);

      if (!next.delete(id)) next.add(id);

      return next;
    });

  const update = (id: Row["id"], patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  const connect = useCallback(
    async (target: ReviewCliInstallTarget) => {
      update(target, { state: "running", output: undefined });

      try {
        const result = await client.connect(target);

        update(target, {
          state:
            result.state === "connected"
              ? "done"
              : result.state === "approve"
                ? "approve"
                : "failed",
          output: result.output,
        });
      } catch (cause) {
        update(target, { state: "failed", output: String(cause) });
      }
    },
    [client],
  );

  /** Connects every CLI agent at once, each writing its own config; Cursor
   * waits for them, since its approval opens Cursor over Whiteboard. */
  const connectAll = useCallback(
    async (targets: ReviewCliInstallTarget[]) => {
      await Promise.all(
        targets.flatMap((target) =>
          target === "cursor" ? [] : [connect(target)],
        ),
      );

      if (targets.includes("cursor")) await connect("cursor");
    },
    [connect],
  );

  const installCli = useCallback(async () => {
    update("cli", { state: "running", output: undefined });

    try {
      if (!cliInstallReady((await setupActions.load()).status)) {
        await setupActions.installCli();

        if (!cliInstallReady((await setupActions.load()).status))
          throw new Error("The whiteboard command is not on PATH yet.");
      }

      update("cli", { state: "done" });
    } catch (cause) {
      update("cli", {
        state: "failed",
        output: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [setupActions]);

  /** Finds the agents on this machine; once installing is agreed, connects
   * any not yet listed. */
  const scan = useCallback(
    async (first: boolean) => {
      setScanning(true);
      setError(undefined);

      try {
        const [agents, cliReady] = await Promise.all([
          client.agents().then((listed) => listed.sort(byOrder)),
          first
            ? setupActions.load().then(
                ({ status }) => {
                  setManual(status.connect);

                  return cliInstallReady(status);
                },
                () => false,
              )
            : Promise.resolve(false),
        ]);

        const found = agents.filter((agent) => agent.found);

        setMissing(agents.filter((agent) => !agent.found).map((a) => a.name));

        const known = new Set(rowsRef.current.map((row) => row.id));
        const fresh = found.filter((agent) => !known.has(agent.target));

        setRows((current) => [
          ...(first
            ? [
                {
                  id: "cli" as const,
                  name: "whiteboard command",
                  detail: "~/.local/bin/whiteboard",
                  state: cliReady ? ("done" as const) : ("waiting" as const),
                },
              ]
            : current),
          ...fresh.map((agent) => ({
            id: agent.target,
            name: agent.name,
            detail: COMMANDS[agent.target],
            state: agent.connected ? ("done" as const) : ("waiting" as const),
          })),
        ]);
        setScanning(false);

        if (!approvedRef.current) return;

        await connectAll(
          fresh.flatMap((agent) => (agent.connected ? [] : [agent.target])),
        );
      } catch (cause) {
        setScanning(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [client, connectAll, setupActions],
  );

  const install = async () => {
    setApproved(true);

    // First, so each agent's server launches the installed command.
    if (rowsRef.current.find((row) => row.id === "cli")?.state !== "done")
      await installCli();

    await connectAll(
      rowsRef.current.flatMap((row) =>
        row.id !== "cli" &&
        row.state === "waiting" &&
        !skippedRef.current.has(row.id)
          ? [row.id]
          : [],
      ),
    );
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void scan(true);
  }, [scan]);

  // An unticked agent is never connected, so nothing waits on it.
  const outstanding = (row: Row) =>
    row.state === "running" ||
    (row.state === "waiting" && !skipped.has(row.id));

  const busy = scanning || (approved && rows.some(outstanding));
  const settled = rows.filter((row) => !outstanding(row)).length;

  useEffect(() => {
    onProgress(rows.length ? settled / rows.length : 0);
  }, [onProgress, rows.length, settled]);

  // With everything already there, nothing waits on the reader's say-so.
  const nothingToDo =
    !scanning && rows.length > 0 && rows.every((row) => row.state === "done");

  const ready = approved || nothingToDo;

  useReturnKey(!busy, ready ? onContinue : () => void install());

  return (
    <div {...stylex.props(onboardingStyles.sheet)}>
      <ScreenHeader
        eyebrow="Step 2 of 3 · Install"
        heading="Install Whiteboard."
        lead="Choose the agents to add it to."
      >
        <Button
          variant="primary"
          size="large"
          xstyle={onboardingStyles.primary}
          disabled={busy}
          onClick={ready ? onContinue : () => void install()}
        >
          {ready ? "Continue" : "Install"}
          <ArrowRightIcon />
        </Button>
        {busy ? null : (
          <span {...stylex.props(onboardingStyles.keyHint)}>↵ Return</span>
        )}
      </ScreenHeader>
      <div {...stylex.props(onboardingStyles.panel, styles.list)}>
        {rows.map((row) => {
          const id = row.id;

          return (
            <InstallRow
              key={id}
              row={row}
              manual={id === "cli" ? undefined : manual?.plugins[id].command}
              choosing={!approved && id !== "cli" && row.state === "waiting"}
              skipped={skipped.has(id)}
              onToggle={() => toggle(id)}
              onRetry={
                id === "cli" ? () => void installCli() : () => void connect(id)
              }
            />
          );
        })}
        {error ? (
          <p
            role="alert"
            {...stylex.props(onboardingStyles.error, styles.note)}
          >
            {error}
          </p>
        ) : null}
        {manual ? <OtherAgentRow launch={manual} /> : null}
        <div {...stylex.props(styles.row, styles.footer)}>
          <span {...stylex.props(styles.status)} />
          <span {...stylex.props(styles.missing)}>
            {missing.length
              ? `Not on this machine · ${missing.join(", ")}`
              : ""}
          </span>
          <span {...stylex.props(styles.trailing)}>
            <Button
              variant="ghost"
              xstyle={styles.rescan}
              disabled={busy}
              onClick={() => void scan(false)}
            >
              Rescan
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Any MCP client, set up by hand: the entry its config takes, in the
 * mcpServers shape most of them read. */
function OtherAgentRow({
  launch,
}: {
  launch: Pick<ReviewCliInstallStatus["connect"], "command" | "args">;
}) {
  const [copied, copy] = useCopy(
    JSON.stringify(
      {
        mcpServers: {
          whiteboard: { command: launch.command, args: launch.args },
        },
      },
      null,
      2,
    ),
  );

  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.status)}>
        <PlusIcon xstyle={styles.plus} />
      </span>
      <span {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.name)}>Any other agent</span>
        <span {...stylex.props(styles.detail, styles.prose)}>
          Add Whiteboard to its MCP config
        </span>
      </span>
      <span {...stylex.props(styles.trailing)}>
        <Button onClick={copy}>{copied ? "Copied" : "Copy config"}</Button>
      </span>
    </div>
  );
}

/** Copies a row's whole setup command; shows while the row is hovered. */
function CopyChip({ text, name }: { text: string; name: string }) {
  const [copied, copy] = useCopy(text);

  return (
    <button
      type="button"
      aria-label={`Copy the ${name} setup command`}
      title={text}
      {...stylex.props(styles.chip, copied && styles.chipShown)}
      onClick={copy}
    >
      <CopyIcon xstyle={styles.chipIcon} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function InstallRow({
  row,
  manual,
  choosing,
  skipped,
  onToggle,
  onRetry,
}: {
  row: Row;
  /** What connects it by hand, to copy. */
  manual?: string;
  /** Still to install, and the reader can still leave it out. */
  choosing: boolean;
  skipped: boolean;
  onToggle(): void;
  onRetry(): void;
}) {
  const checkboxId = useId();
  const left = skipped && row.state === "waiting";

  return (
    <div
      {...stylex.props(
        installRowMarker,
        styles.row,
        row.state === "running" && styles.rowRunning,
      )}
      data-state={row.state}
    >
      <span {...stylex.props(styles.status)}>
        {choosing ? (
          <Checkbox id={checkboxId} checked={!skipped} onChange={onToggle} />
        ) : (
          <RowStatus state={row.state} />
        )}
      </span>
      <span {...stylex.props(styles.text)}>
        <label
          htmlFor={choosing ? checkboxId : undefined}
          {...stylex.props(
            styles.name,
            (left || (row.state === "waiting" && !choosing)) &&
              styles.nameWaiting,
            choosing && styles.nameChoosing,
          )}
        >
          {row.name}
        </label>
        <span {...stylex.props(styles.detailLine)}>
          <span
            {...stylex.props(
              styles.detail,
              row.id === "cursor" && styles.prose,
            )}
          >
            {row.id === "cursor" &&
            row.state !== "waiting" &&
            row.state !== "running"
              ? "Approve in Cursor now, or later from Settings"
              : row.detail}
          </span>
          {manual ? <CopyChip text={manual} name={row.name} /> : null}
        </span>
      </span>
      <span {...stylex.props(styles.trailing)}>
        {row.state === "approve" ? (
          <Button onClick={onRetry}>Open Cursor</Button>
        ) : row.state === "failed" ? (
          <Button onClick={onRetry} title={row.output}>
            Retry
          </Button>
        ) : (
          <span
            {...stylex.props(
              styles.label,
              row.state === "done" && styles.labelDone,
              row.state === "running" && styles.labelRunning,
            )}
          >
            {row.state === "done"
              ? row.id === "cli"
                ? "Installed"
                : "Connected"
              : row.state === "running"
                ? "Installing…"
                : left
                  ? "Skipped"
                  : "Waiting"}
          </span>
        )}
      </span>
    </div>
  );
}

function RowStatus({ state }: { state: RowState }) {
  if (state === "running") return <Spinner />;

  if (state === "done")
    return (
      <span {...stylex.props(styles.badge, styles.badgeDone)}>
        <DrawnCheckIcon />
      </span>
    );

  if (state === "approve" || state === "failed")
    return (
      <span
        {...stylex.props(
          styles.badge,
          state === "approve" ? styles.badgeApprove : styles.badgeFailed,
        )}
      >
        !
      </span>
    );

  return <span {...stylex.props(styles.badge, styles.badgeWaiting)} />;
}

const styles = stylex.create({
  list: {
    flex: "0 1 auto",
    minHeight: 0,
    overflowY: "auto",
    paddingBlock: "8px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    paddingBlock: "12px",
    paddingInline: "24px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    transitionProperty: "background-color",
    transitionDuration: motion.medium,
  },
  rowRunning: {
    backgroundColor: tokens.surface,
  },
  footer: {
    paddingBlock: "16px 8px",
    borderBottomWidth: 0,
  },
  status: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    flexShrink: 0,
  },
  badge: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    borderRadius: radius.round,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
  },
  badgeWaiting: {
    width: "20px",
    height: "20px",
    borderWidth: "1.5px",
    borderStyle: "dashed",
    borderColor: tokens.ruleSoft,
  },
  badgeDone: {
    color: tokens.changeAdded,
    backgroundColor: `color-mix(in srgb, ${tokens.changeAdded} 16%, ${tokens.transparent})`,
  },
  badgeApprove: {
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.changeModified,
    color: tokens.changeModified,
  },
  badgeFailed: {
    color: tokens.onAccent,
    backgroundColor: tokens.changeRemoved,
  },
  text: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
  name: {
    fontSize: fontSize.reading,
    fontWeight: fontWeight.medium,
  },
  nameWaiting: {
    color: tokens.inkMuted,
  },
  nameChoosing: { cursor: "pointer" },
  detail: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  prose: {
    color: tokens.inkMuted,
    fontFamily: "inherit",
  },
  trailing: {
    display: "flex",
    justifyContent: "flex-end",
    width: "150px",
    flexShrink: 0,
  },
  label: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
  },
  labelDone: { color: tokens.changeAdded },
  labelRunning: { color: tokens.accent },
  missing: {
    flex: 1,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
  },
  rescan: {
    marginInlineEnd: "-10px",
    fontFamily: tokens.fontMono,
  },
  note: {
    paddingInline: "72px 28px",
  },
  detailLine: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  // Out of sight until its row is hovered or it holds focus.
  chip: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: "4px",
    height: "16px",
    paddingInline: "6px",
    borderWidth: 0,
    borderRadius: radius.hairline,
    backgroundColor: { default: tokens.chromeHoverBg, ":hover": tokens.rule },
    color: tokens.ink,
    cursor: "pointer",
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", installRowMarker)]: 1,
      ":focus-visible": 1,
    },
  },
  chipShown: { opacity: 1 },
  chipIcon: { width: "11px", height: "11px" },
  plus: { width: "16px", height: "16px", color: tokens.inkFaint },
});
