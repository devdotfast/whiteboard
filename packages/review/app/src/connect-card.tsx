import { Button } from "@canvas/ui/button";
import {
  type ReviewCanvasInstallContent,
  type ReviewCliInstallStatus,
  type ReviewCliInstallTarget,
  ReviewCliInstallTargetSchema,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";

import { AGENT_LOGOS } from "./agent-logos";
import { cliInstallReady } from "./cli-install-status";
import { controlStyles } from "./controls-styles";
import { CopyIcon, copyText } from "./copy-text";
import { DrawnCheckIcon } from "./icons";
import { newTabLinkProps } from "./link-props";
import { OptionMenu } from "./option-menu";
import { promptStyles } from "./prompt-styles";
import { tokens } from "./tokens.stylex";

export const TARGET_LABELS: Record<ReviewCliInstallTarget, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "oh-my-pi",
  copilot: "Copilot CLI",
};

/** The rest share the Other menu. */
const TAB_TARGETS = ["claude", "codex", "cursor", "opencode"] as const;

const OTHER_TARGETS = ReviewCliInstallTargetSchema.options.filter(
  (target) => !TAB_TARGETS.some((tab) => tab === target),
);

export const REVIEW_CONNECT_TARGET_STORAGE_KEY =
  "dev.fast.review.connectTarget";

const COPIED_RESET_MS = 2000;

/** Lines of a prompt shown before the reader expands it. */
const COLLAPSED_LINES = 4;

type Mode = "prompt" | "plugin";

const MODES: ReadonlyArray<{ mode: Mode; label: string }> = [
  { mode: "prompt", label: "Paste a prompt" },
  { mode: "plugin", label: "Install the plugin" },
];

/**
 * One agent at a time: a paste-in prompt that has the agent add Whiteboard's MCP
 * server, or the published plugin (an install command, or Cursor's link).
 */
export function ConnectCard({
  install,
  onCopied,
}: {
  install: ReviewCanvasInstallContent;
  onCopied?: () => void;
}) {
  const { status } = install;

  const [target, setTarget] =
    useState<ReviewCliInstallTarget>(readStoredTarget);

  const [mode, setMode] = useState<Mode>("prompt");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const clearCopied = () => {
    setCopied(false);
    clearTimeout(resetTimer.current);
  };

  const selectTarget = (next: ReviewCliInstallTarget) => {
    setTarget(next);
    clearCopied();
    setExpanded(false);

    try {
      globalThis.localStorage?.setItem(REVIEW_CONNECT_TARGET_STORAGE_KEY, next);
    } catch {
      // The desktop can disable DOM storage; the in-memory selection still works.
    }
  };

  const selectMode = (next: Mode) => {
    setMode(next);
    clearCopied();
    setExpanded(false);
  };

  const agent = TARGET_LABELS[target];

  const plugin = status.connect.plugins[target];

  const text =
    mode === "prompt" ? status.connect.prompts[target] : plugin.command;

  const copy = (value: string) => {
    void copyText(value).then((ok) => {
      if (!ok) {
        return;
      }

      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
      onCopied?.();
    });
  };

  const noun = mode === "prompt" ? "prompt" : "install command";

  // Prompts run to a dozen lines; show the opening and let the reader expand.
  const collapsible = (text?.split("\n").length ?? 0) > COLLAPSED_LINES;

  const collapsed = collapsible && !expanded;

  if (status.legacySkills.length > 0 || !cliInstallReady(status)) {
    return (
      <section aria-label="Connect your agents">
        <p {...stylex.props(styles.note)}>
          {status.legacySkills.length > 0
            ? "Remove deprecated skills first."
            : "Install the whiteboard command in PATH first."}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Connect your agents">
      <div
        {...stylex.props(
          controlStyles.segmented,
          promptStyles.tabs,
          styles.agentTabs,
        )}
        role="group"
        aria-label="Agent"
      >
        {TAB_TARGETS.map((tab) => {
          const Logo = AGENT_LOGOS[tab];

          return (
            <button
              key={tab}
              type="button"
              {...stylex.props(
                controlStyles.segment,
                controlStyles.segmentLarge,
                target === tab && controlStyles.segmentActive,
              )}
              aria-pressed={target === tab}
              onClick={() => selectTarget(tab)}
            >
              <Logo xstyle={styles.logo} />
              {TARGET_LABELS[tab]}
            </button>
          );
        })}
        <OtherAgentMenu
          selected={OTHER_TARGETS.includes(target) ? target : undefined}
          onSelect={selectTarget}
        />
      </div>
      <div
        {...stylex.props(controlStyles.segmented, promptStyles.tabs)}
        role="group"
        aria-label="Setup method"
      >
        {MODES.map(({ mode: tab, label }) => (
          <button
            key={tab}
            type="button"
            {...stylex.props(
              controlStyles.segment,
              mode === tab && controlStyles.segmentActive,
            )}
            aria-pressed={mode === tab}
            onClick={() => selectMode(tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {text ? (
        <>
          <div {...stylex.props(styles.bodyWrap)}>
            <pre
              {...stylex.props(
                promptStyles.body,
                collapsed && styles.collapsedBody,
              )}
              data-collapsed={collapsed}
            >
              {text.split(/(--[a-z][a-z-]*)/g).map((part, index) =>
                part.startsWith("--") ? (
                  <span {...stylex.props(styles.option)} key={index}>
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </pre>
            {collapsed ? (
              <button
                type="button"
                {...stylex.props(styles.expand)}
                aria-expanded={false}
                onClick={() => setExpanded(true)}
              >
                Show full {noun}
              </button>
            ) : null}
          </div>
          <div {...stylex.props(promptStyles.actions)}>
            {collapsible && expanded ? (
              <button
                type="button"
                {...stylex.props(styles.collapse)}
                aria-expanded={true}
                onClick={() => setExpanded(false)}
              >
                Show less
              </button>
            ) : null}
            <button
              type="button"
              {...stylex.props(promptStyles.copy)}
              aria-live="polite"
              aria-label={`${copied ? "Copied" : "Copy"} ${noun} for ${agent}`}
              onClick={() => copy(text)}
            >
              {copied ? <DrawnCheckIcon /> : <CopyIcon />}
              {copied
                ? "Copied"
                : `Copy ${mode === "prompt" ? "prompt" : "command"}`}
            </button>
          </div>
        </>
      ) : plugin.url ? (
        <>
          <p {...stylex.props(promptStyles.body)}>
            Opens {agent} and adds the review server.
          </p>
          <div {...stylex.props(promptStyles.actions)}>
            <a
              {...stylex.props(promptStyles.copy)}
              href={plugin.url}
              {...newTabLinkProps(plugin.url)}
            >
              {plugin.label}
            </a>
          </div>
        </>
      ) : (
        <p {...stylex.props(promptStyles.body)}>
          {`${plugin.label}\nInstall the whiteboard command first.`}
        </p>
      )}
      {status.error ? (
        <p {...stylex.props(promptStyles.error)}>{status.error}</p>
      ) : null}
    </section>
  );
}

function OtherAgentMenu({
  selected,
  onSelect,
}: {
  selected: ReviewCliInstallTarget | undefined;
  onSelect(target: ReviewCliInstallTarget): void;
}) {
  const Logo = selected ? AGENT_LOGOS[selected] : undefined;

  return (
    <OptionMenu
      ariaLabel="Other agent"
      value={selected}
      options={OTHER_TARGETS.map((other) => {
        const OptionLogo = AGENT_LOGOS[other];

        return {
          value: other,
          label: TARGET_LABELS[other],
          icon: <OptionLogo />,
        };
      })}
      onChange={onSelect}
      triggerStyle={[
        controlStyles.segment,
        controlStyles.segmentLarge,
        styles.otherTrigger,
        selected !== undefined && controlStyles.segmentActive,
      ]}
      triggerProps={{ "aria-pressed": selected !== undefined }}
    >
      {Logo ? <Logo xstyle={styles.logo} /> : null}
      {selected ? TARGET_LABELS[selected] : "Other…"}
    </OptionMenu>
  );
}

function readStoredTarget(): ReviewCliInstallTarget {
  try {
    const stored = ReviewCliInstallTargetSchema.safeParse(
      globalThis.localStorage?.getItem(REVIEW_CONNECT_TARGET_STORAGE_KEY),
    );

    if (stored.success) {
      return stored.data;
    }
  } catch {
    // Fall through to the default when DOM storage is unavailable.
  }

  return "claude";
}

/**
 * Skills that earlier versions of Whiteboard installed into agent configs. After
 * a removal the row names what went, until the next status refresh.
 */
export function LegacySkillsRow({
  install,
  onStatusChange,
}: {
  install: ReviewCanvasInstallContent;
  onStatusChange?: (status: ReviewCliInstallStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [removal, setRemoval] = useState<{
    paths: string[];
    status: ReviewCliInstallStatus;
  } | null>(null);

  const { legacySkills } = install.status;

  const removed = removal?.status === install.status ? removal.paths : [];

  if (legacySkills.length === 0 && removed.length === 0) return null;

  const removeSkills = async () => {
    setBusy(true);
    setError(null);

    try {
      const next = await install.removeLegacySkills();

      const remaining = new Set(next.legacySkills.map((skill) => skill.path));

      const paths = legacySkills
        .map((skill) => skill.path)
        .filter((path) => !remaining.has(path));

      setRemoval({ paths, status: next });
      onStatusChange?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      {...stylex.props(styles.legacy)}
      aria-label="Deprecated Whiteboard skills"
    >
      {legacySkills.length > 0 ? (
        <>
          <p {...stylex.props(styles.legacyText)}>
            Earlier versions of Whiteboard installed these skills. Whiteboard no
            longer uses them.
          </p>
          <ul {...stylex.props(styles.legacyList)}>
            {legacySkills.map((skill) => (
              <li key={skill.path}>
                <code {...stylex.props(styles.legacyCode)}>{skill.path}</code>
              </li>
            ))}
          </ul>
          <Button
            size="large"
            xstyle={styles.legacyButton}
            disabled={busy}
            onClick={() => void removeSkills()}
          >
            Remove deprecated skills
          </Button>
        </>
      ) : null}
      {removed.length > 0 ? (
        <>
          <p {...stylex.props(styles.legacyText)}>
            Removed {removed.length} skill{removed.length === 1 ? "" : "s"}
          </p>
          <ul {...stylex.props(styles.legacyList)}>
            {removed.map((path) => (
              <li key={path}>
                <code {...stylex.props(styles.legacyCode)}>{path}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? (
        <p {...stylex.props(promptStyles.error, styles.legacyText)}>{error}</p>
      ) : null}
    </section>
  );
}

const styles = stylex.create({
  note: {
    margin: "0 0 8px",
    color: tokens.reviewHomeMeta,
    fontSize: "12px",
  },
  // The prompt card's tabs, one agent at a time.
  agentTabs: {
    flexWrap: "wrap",
    marginBottom: "6px",
  },
  logo: {
    width: "14px",
    height: "14px",
  },
  otherTrigger: {
    paddingRight: "6px",
  },
  bodyWrap: {
    position: "relative",
  },
  collapsedBody: {
    maxHeight: "calc(22px * 4)",
    overflow: "hidden",
    maskImage: "linear-gradient(to bottom, #000 35%, transparent)",
  },
  option: {
    whiteSpace: "nowrap",
  },
  // Sits on the fade, centered, like a "show full prompt" pill.
  expand: {
    position: "absolute",
    bottom: 0,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "3px 12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.reviewHomeRuleSoft,
      ":hover": tokens.inkMuted,
    },
    borderRadius: "999px",
    backgroundColor: tokens.raised,
    color: tokens.ink,
    font: `12px/18px ${tokens.fontMono}`,
    cursor: "pointer",
  },
  collapse: {
    marginRight: "auto",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: "transparent",
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
    font: `12px/22px ${tokens.fontMono}`,
    cursor: "pointer",
  },
  legacy: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "8px",
    fontSize: "12px",
  },
  legacyText: {
    margin: 0,
  },
  legacyList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    color: tokens.reviewHomeMeta,
  },
  legacyCode: {
    fontFamily: tokens.fontMono,
  },
  legacyButton: {
    marginTop: "8px",
  },
});
