import { fontSize, radius } from "@canvas/scale.stylex";
import { AGENT_LOGOS } from "@canvas/ui/brand-icons";
import { Button, buttonLook, buttonStyles } from "@canvas/ui/button";
import { useCopy } from "@canvas/ui/copy";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import { CopyIcon, DrawnCheckIcon } from "@canvas/ui/icons";
import { textStyles } from "@canvas/ui/text";
import {
  REVIEW_CLI_INSTALL_TARGET_LABELS,
  type ReviewCanvasInstallContent,
  type ReviewCliInstallStatus,
  type ReviewCliInstallTarget,
  ReviewCliInstallTargetSchema,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { cliInstallReady } from "./cli-install-status";
import { newTabLinkProps } from "./link-props";
import { OptionMenu } from "./option-menu";
import { promptStyles } from "./prompt-styles";
import { tokens } from "./tokens.stylex";
import { SegmentedControl, segmentStyles } from "./ui/segmented";

/** The rest share the Other menu. */
const TAB_TARGETS = ["claude", "codex", "cursor", "opencode"] as const;

const OTHER_TARGETS = ReviewCliInstallTargetSchema.options.filter(
  (target) => !TAB_TARGETS.some((tab) => tab === target),
);

export const REVIEW_CONNECT_TARGET_STORAGE_KEY =
  "dev.fast.review.connectTarget";

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
  const [expanded, setExpanded] = useState(false);

  const selectTarget = (next: ReviewCliInstallTarget) => {
    setTarget(next);
    setExpanded(false);

    try {
      globalThis.localStorage?.setItem(REVIEW_CONNECT_TARGET_STORAGE_KEY, next);
    } catch {
      // The desktop can disable DOM storage; the in-memory selection still works.
    }
  };

  const selectMode = (next: Mode) => {
    setMode(next);
    setExpanded(false);
  };

  const agent = REVIEW_CLI_INSTALL_TARGET_LABELS[target];

  const plugin = status.connect.plugins[target];

  const text =
    mode === "prompt" ? status.connect.prompts[target] : plugin.command;

  const [copiedText, copy] = useCopy({ onCopied });
  const copied = copiedText === text;

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
      <SegmentedControl
        label="Agent"
        value={target}
        options={TAB_TARGETS.map((tab) => {
          const Logo = AGENT_LOGOS[tab];

          return {
            value: tab,
            label: (
              <>
                <Logo xstyle={styles.logo} />
                {REVIEW_CLI_INSTALL_TARGET_LABELS[tab]}
              </>
            ),
          };
        })}
        onChange={selectTarget}
        size="large"
        xstyle={[promptStyles.tabs, styles.agentTabs]}
      >
        <OtherAgentMenu
          selected={OTHER_TARGETS.includes(target) ? target : undefined}
          onSelect={selectTarget}
        />
      </SegmentedControl>
      <SegmentedControl
        label="Setup method"
        value={mode}
        options={MODES.map(({ mode: tab, label }) => ({ value: tab, label }))}
        onChange={selectMode}
        xstyle={promptStyles.tabs}
      />
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
              <Button
                xstyle={styles.expand}
                aria-expanded={false}
                onClick={() => setExpanded(true)}
              >
                Show full {noun}
              </Button>
            ) : null}
          </div>
          <div {...stylex.props(promptStyles.actions)}>
            {collapsible && expanded ? (
              <Button
                variant="link"
                xstyle={styles.collapse}
                aria-expanded={true}
                onClick={() => setExpanded(false)}
              >
                Show less
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="large"
              xstyle={promptStyles.copy}
              aria-live="polite"
              aria-label={`${copied ? "Copied" : "Copy"} ${noun} for ${agent}`}
              onClick={() => copy(text)}
            >
              {copied ? (
                <DrawnCheckIcon />
              ) : (
                <CopyIcon xstyle={iconStyles.inline} />
              )}
              {copied
                ? "Copied"
                : `Copy ${mode === "prompt" ? "prompt" : "command"}`}
            </Button>
          </div>
        </>
      ) : plugin.url ? (
        <>
          <p {...stylex.props(promptStyles.body)}>
            Opens {agent} and adds the Whiteboard server.
          </p>
          <div {...stylex.props(promptStyles.actions)}>
            <a
              {...stylex.props(
                buttonLook({ variant: "primary", size: "large" }),
                promptStyles.copy,
              )}
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
        <p {...stylex.props(textStyles.error, promptStyles.error)}>
          {status.error}
        </p>
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
          label: REVIEW_CLI_INSTALL_TARGET_LABELS[other],
          icon: <OptionLogo />,
        };
      })}
      onChange={onSelect}
      triggerStyle={[
        focusStyles.ringInset,
        buttonStyles.reset,
        segmentStyles.segment,
        segmentStyles.segmentLarge,
        styles.otherTrigger,
        selected !== undefined && segmentStyles.segmentActive,
      ]}
      triggerProps={{ "aria-pressed": selected !== undefined }}
    >
      {Logo ? <Logo xstyle={styles.logo} /> : null}
      {selected ? REVIEW_CLI_INSTALL_TARGET_LABELS[selected] : "Other…"}
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
        <p
          {...stylex.props(
            textStyles.error,
            promptStyles.error,
            styles.legacyText,
          )}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

const styles = stylex.create({
  note: {
    margin: "0 0 8px",
    color: tokens.inkMuted,
    fontSize: fontSize.body,
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
    borderRadius: radius.pill,
    backgroundColor: {
      default: tokens.raised,
      ":hover:not(:disabled)": tokens.well,
    },
    fontFamily: tokens.fontMono,
  },
  collapse: {
    marginRight: "auto",
    font: `${fontSize.body}/22px ${tokens.fontMono}`,
  },
  legacy: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "8px",
    fontSize: fontSize.body,
  },
  legacyText: {
    margin: 0,
  },
  legacyList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    color: tokens.inkMuted,
  },
  legacyCode: {
    fontFamily: tokens.fontMono,
  },
  legacyButton: {
    marginTop: "8px",
  },
});
