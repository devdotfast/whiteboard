import { SearchIcon } from "@canvas/icons";
import { OptionMenu } from "@canvas/option-menu";
import {
  elevation,
  fontSize,
  fontWeight,
  motion,
  radius,
  tracking,
} from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { Button, buttonStyles } from "@canvas/ui/button";
import { Shortcut } from "@canvas/ui/kbd";
import { fieldStyles } from "@canvas/ui/text-field";
import type {
  ReviewCanvasSetupActions,
  ReviewOnboardingProject,
  ReviewOnboardingTarget,
  ReviewOnboardingTargetsResponse,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { OnboardingClient, OnboardingRunAgent } from "./onboarding-client";
import { type BackLink, ScreenHeader, useCopyKey } from "./onboarding-parts";
import { onboardingStyles } from "./onboarding-styles";

const PICK_FOLDER = "\0pick";

// Title and detail widths for the rows held while targets load.
const PLACEHOLDERS = [
  ["140px", "180px"],
  ["112px", "240px"],
  ["220px", "200px"],
  ["160px", "260px"],
  ["180px", "150px"],
  ["124px", "220px"],
] as const;

type Kind = ReviewOnboardingTarget["kind"];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "worktree", label: "Worktrees" },
  { kind: "branch", label: "Branches" },
  { kind: "pr", label: "PRs" },
];

/** Everything a filter can match in a target. */
function searchable(target: ReviewOnboardingTarget): string {
  return (
    target.kind === "pr"
      ? [`#${target.number}`, target.title, target.author, target.branch]
      : [target.branch, target.path]
  )
    .join(" ")
    .toLowerCase();
}

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const breathe = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.45 },
});

/** The agents Whiteboard can run, best first. */
const AGENT_ORDER: OnboardingRunAgent["id"][] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "pi",
];

/** What a screen says above its content; first run and Home word it
 * differently. */
export interface StepIntro {
  eyebrow?: string;
  back?: BackLink;
  heading: string;
  lead: string;
}

export function targetKey(target: ReviewOnboardingTarget): string {
  return target.kind === "pr"
    ? `pr:${target.number}`
    : `${target.kind}:${target.path}`;
}

/** The default prompt; Whiteboard's server gives the agent the authoring
 * instructions, so it only names the subject. */
export function defaultPrompt(target: ReviewOnboardingTarget): string {
  return target.kind === "pr"
    ? `Draw a whiteboard that walks me through pull request #${target.number}, "${target.title}".`
    : `Draw a whiteboard that walks me through ${target.branch}.`;
}

/** The name of the folder holding `folder`, on any platform's separators. */
function parentName(folder: string) {
  return folder.split(/[\\/]/).filter(Boolean).at(-2) ?? folder;
}

/** Choose what to draw, then draw it here, or copy the prompt for an agent
 * of the reader's own. Without an intro it sits inside a page that has one. */
export function RunStep({
  client,
  setupActions,
  intro,
  embedded = false,
  onStarted,
  onCopy,
}: {
  client: OnboardingClient;
  setupActions: ReviewCanvasSetupActions;
  intro?: StepIntro;
  embedded?: boolean;
  /** The whiteboard is made and opening, with its agent at work. */
  onStarted?(reviewId: string): void;
  onCopy(prompt: string): void;
}) {
  const [projects, setProjects] = useState<ReviewOnboardingProject[]>([]);

  const [discovered, setDiscovered] =
    useState<ReviewOnboardingTargetsResponse>();

  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>();
  const [prompt, setPrompt] = useState("");
  const [edited, setEdited] = useState(false);
  const [agents, setAgents] = useState<OnboardingRunAgent[]>([]);
  const [agent, setAgent] = useState<OnboardingRunAgent["id"]>();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const open = useCallback(
    async (directory: string) => {
      setLoading(true);
      setError(undefined);

      try {
        const next = await client.targets(directory);

        // A checkout of the base branch has nothing to draw against it;
        // start from the first target that has.
        const first =
          next.targets.find(
            (target) => target.kind !== "branch" || target.branch !== next.base,
          ) ?? next.targets[0];

        setDiscovered(next);
        setSelected(first ? targetKey(first) : undefined);
        setQuery("");
        setKind(undefined);
        setEdited(false);
        setPrompt(first ? defaultPrompt(first) : "");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  const pickFolder = useCallback(async () => {
    const folder = await setupActions.pickFolder();

    if (folder) await open(folder);
  }, [open, setupActions]);

  useEffect(() => {
    let live = true;

    void Promise.all([client.projects(), client.runAgents()]).then(
      ([known, runAgents]) => {
        if (!live) return;

        const available = runAgents
          .filter((candidate) => candidate.available)
          .sort(
            (a, b) => AGENT_ORDER.indexOf(a.id) - AGENT_ORDER.indexOf(b.id),
          );

        setProjects(known);
        setAgents(available);
        setAgent((current) => current ?? available[0]?.id);

        if (known[0]) void open(known[0].path);
        else setLoading(false);
      },
      (cause: unknown) => {
        if (!live) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );

    return () => {
      live = false;
    };
  }, [client, open]);

  const targets = discovered?.targets ?? [];

  const target = targets.find((candidate) => targetKey(candidate) === selected);

  const kinds = KINDS.flatMap((option) => {
    const count = targets.filter(
      (candidate) => candidate.kind === option.kind,
    ).length;

    return count ? [{ ...option, count }] : [];
  });

  const needle = query.trim().toLowerCase();

  const shown = targets.filter(
    (candidate) =>
      (!kind || candidate.kind === kind) &&
      (!needle || searchable(candidate).includes(needle)),
  );

  const choose = (next: ReviewOnboardingTarget) => {
    setSelected(targetKey(next));

    if (!edited && discovered) setPrompt(defaultPrompt(next));
  };

  const agentName = agents.find((candidate) => candidate.id === agent)?.name;

  const canDraw =
    !starting &&
    target !== undefined &&
    agent !== undefined &&
    prompt.trim() !== "";

  const draw = useCallback(async () => {
    if (!canDraw || !discovered || !target || !agent) return;
    setStarting(true);
    setError(undefined);

    try {
      const reviewId = await client.startRun({
        projectPath: discovered.project.path,
        base: discovered.base,
        target,
        agent,
        prompt: prompt.trim(),
      });

      onStarted?.(reviewId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }, [agent, canDraw, client, discovered, onStarted, prompt, target]);

  const canCopy = target !== undefined && prompt.trim() !== "";

  const copy = useCallback(() => {
    if (!canCopy) return;
    onCopy(prompt.trim());
  }, [canCopy, onCopy, prompt]);

  useCopyKey(canCopy, copy);

  // ⌘↵ draws from anywhere on the screen, the prompt included.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void draw();
      }
    };

    window.addEventListener("keydown", keydown);

    return () => window.removeEventListener("keydown", keydown);
  }, [draw]);

  const agentMode = agentName
    ? `${agentName} runs here in ${agents.find((option) => option.id === agent)?.auto ? "auto mode" : "read-only mode"}`
    : undefined;

  const projectOptions = useMemo(() => {
    const shared = (name: string) =>
      projects.filter((project) => project.name === name).length > 1;

    return [
      ...projects.map((project) => ({
        value: project.path,
        // Two checkouts named alike tell apart by the folder holding them.
        label: shared(project.name)
          ? `${project.name} · ${parentName(project.path)}`
          : project.name,
      })),
      { value: PICK_FOLDER, label: "Choose a folder…" },
    ];
  }, [projects]);

  return (
    <div
      {...stylex.props(
        onboardingStyles.sheet,
        embedded && onboardingStyles.sheetEmbedded,
        styles.fit,
        embedded && styles.fitEmbedded,
      )}
    >
      {intro ? <ScreenHeader {...intro} /> : null}
      <div
        {...stylex.props(
          onboardingStyles.panel,
          styles.composer,
          onboardingStyles.enter2,
        )}
      >
        <div {...stylex.props(styles.project)}>
          <FolderIcon />
          {discovered ? (
            <>
              <span {...stylex.props(styles.projectName)}>
                {discovered.project.name}
              </span>
              <span {...stylex.props(styles.projectPath)}>
                {discovered.project.path}
              </span>
            </>
          ) : loading ? (
            <span
              aria-label="Looking for your projects"
              {...stylex.props(styles.projectPlaceholder)}
            >
              <span {...stylex.props(styles.bar, styles.barWidth("96px"))} />
              <span {...stylex.props(styles.bar, styles.barWidth("240px"))} />
            </span>
          ) : (
            <span {...stylex.props(styles.projectPath)}>
              Choose a project to draw from
            </span>
          )}
          {projects.length ? (
            <OptionMenu
              ariaLabel="Project"
              triggerStyle={[buttonStyles.base, buttonStyles.secondary]}
              value={discovered?.project.path}
              options={projectOptions}
              onChange={(value) =>
                void (value === PICK_FOLDER ? pickFolder() : open(value))
              }
            >
              Change
            </OptionMenu>
          ) : (
            <Button onClick={() => void pickFolder()}>Choose a folder…</Button>
          )}
        </div>
        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.toolbar)}>
            <SearchIcon xstyle={styles.searchIcon} />
            <input
              type="search"
              aria-label="Filter what to draw"
              title="From git worktree list and gh pr list"
              placeholder={
                targets.length
                  ? `Filter ${targets.length} branches, worktrees and PRs`
                  : "Filter branches, worktrees and PRs"
              }
              disabled={!targets.length}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              {...stylex.props(styles.filter)}
            />
            {kinds.length > 1 ? (
              <div
                role="group"
                aria-label="Kind"
                {...stylex.props(styles.kinds)}
              >
                {[{ kind: undefined, label: "All", count: 0 }, ...kinds].map(
                  (option) => (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={kind === option.kind}
                      {...stylex.props(
                        styles.kindTab,
                        kind === option.kind && styles.kindTabOn,
                      )}
                      onClick={() => setKind(option.kind)}
                    >
                      {option.label}
                      {option.count ? (
                        <span {...stylex.props(styles.kindCount)}>
                          {option.count}
                        </span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
          {loading ? (
            <div
              role="status"
              aria-label="Reading branches, worktrees and pull requests"
              {...stylex.props(styles.targets)}
            >
              {PLACEHOLDERS.map(([title, detail]) => (
                <div key={title + detail} {...stylex.props(styles.target)}>
                  <span {...stylex.props(styles.kind)}>
                    <span
                      {...stylex.props(styles.bar, styles.barWidth("52px"))}
                    />
                  </span>
                  <span
                    {...stylex.props(
                      styles.bar,
                      styles.barTitle,
                      styles.barWidth(title),
                    )}
                  />
                  <span
                    {...stylex.props(styles.bar, styles.barWidth(detail))}
                  />
                </div>
              ))}
            </div>
          ) : targets.length === 0 ? (
            <p {...stylex.props(styles.empty)}>
              {discovered
                ? "Nothing to draw here yet: check out a branch, then choose the folder again."
                : "Choose a project folder above."}
            </p>
          ) : shown.length === 0 ? (
            <p {...stylex.props(styles.empty)}>
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            // The list scrolls in place, so the prompt and Draw stay on screen.
            <div
              role="radiogroup"
              aria-label="What to draw"
              {...stylex.props(
                styles.targets,
                styles.targetsMin(Math.min(shown.length, 4)),
              )}
            >
              {shown.map((candidate) => (
                <TargetRow
                  key={targetKey(candidate)}
                  target={candidate}
                  selected={targetKey(candidate) === selected}
                  onSelect={() => choose(candidate)}
                />
              ))}
            </div>
          )}
          <label {...stylex.props(styles.prompt)}>
            <span {...stylex.props(styles.sectionHeader, styles.promptHeader)}>
              <span {...stylex.props(styles.label)}>Prompt</span>
              <span {...stylex.props(styles.source)}>Edit freely</span>
            </span>
            <textarea
              {...stylex.props(
                fieldStyles.box,
                fieldStyles.multiline,
                styles.promptField,
              )}
              value={prompt}
              rows={3}
              disabled={!target}
              onChange={(event) => {
                setPrompt(event.target.value);
                setEdited(true);
              }}
            />
          </label>
        </div>
        {error ? (
          <p
            role="alert"
            {...stylex.props(onboardingStyles.error, styles.alert)}
          >
            {error}
          </p>
        ) : null}
        {/* Two ways to draw: the reader's own agent, or one Whiteboard runs. */}
        <div {...stylex.props(styles.footer)}>
          <div {...stylex.props(styles.choice)}>
            <span {...stylex.props(styles.label)}>Paste into your agent</span>
            <div {...stylex.props(styles.choiceRow)}>
              <Button
                size="large"
                xstyle={styles.action}
                disabled={!canCopy}
                onClick={copy}
              >
                Copy prompt
                <span {...stylex.props(styles.shortcut)}>y</span>
              </Button>
            </div>
          </div>
          <div {...stylex.props(styles.or)} aria-hidden="true">
            <i {...stylex.props(styles.orRule)} />
            or
            <i {...stylex.props(styles.orRule)} />
          </div>
          <div {...stylex.props(styles.choice, styles.choiceHere)}>
            <span {...stylex.props(styles.label)}>Draw it here</span>
            <div {...stylex.props(styles.choiceRow)}>
              {agents.length ? (
                <OptionMenu
                  ariaLabel="Agent"
                  triggerStyle={[
                    buttonStyles.base,
                    buttonStyles.secondary,
                    styles.picker,
                  ]}
                  value={agent}
                  options={agents.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name,
                  }))}
                  onChange={(next: OnboardingRunAgent["id"]) => setAgent(next)}
                >
                  <span {...stylex.props(styles.agentDot)} />
                  {agentName}
                </OptionMenu>
              ) : loading ? null : (
                <span {...stylex.props(styles.source, styles.noAgent)}>
                  No agent Whiteboard can run is installed.
                </span>
              )}
              <Button
                variant="primary"
                size="large"
                xstyle={[styles.action, styles.draw]}
                disabled={!canDraw}
                title={agentMode}
                onClick={() => void draw()}
              >
                {starting ? "Starting…" : "Draw whiteboard"}
                <Shortcut xstyle={styles.shortcut}>⌘↵</Shortcut>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetRow({
  target,
  selected,
  onSelect,
}: {
  target: ReviewOnboardingTarget;
  selected: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      {...stylex.props(styles.target, selected && styles.targetSelected)}
      onClick={onSelect}
    >
      <span {...stylex.props(styles.kind, selected && styles.kindSelected)}>
        {target.kind === "pr" ? `PR #${target.number}` : target.kind}
      </span>
      <span {...stylex.props(styles.targetTitle)}>
        {target.kind === "pr" ? target.title : target.branch}
      </span>
      <span
        {...stylex.props(styles.targetMeta, selected && styles.targetMetaOn)}
      >
        {target.kind === "pr"
          ? [target.author && `@${target.author}`, target.branch]
              .filter(Boolean)
              .join(" · ")
          : target.kind === "branch"
            ? "current checkout"
            : target.path}
      </span>
      <span {...stylex.props(styles.diff)}>
        {target.kind === "pr" ? (
          <>
            <span {...stylex.props(styles.added)}>+{target.additions}</span>
            <span {...stylex.props(styles.removed)}>−{target.deletions}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3.2l1.6 1.8h6.2A1.5 1.5 0 0 1 16 7.3v6.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 13.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const styles = stylex.create({
  composer: {
    flex: "0 1 auto",
    minHeight: 0,
    padding: "8px",
  },
  project: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    paddingBlock: "10px",
    paddingInline: "12px 6px",
    color: tokens.inkMuted,
  },
  projectName: {
    color: tokens.ink,
    fontSize: fontSize.reading,
    fontWeight: fontWeight.medium,
  },
  projectPath: {
    flex: 1,
    overflow: "hidden",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  projectPlaceholder: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    gap: "14px",
  },
  // Text held by a pulsing block while it loads; sized to a line of detail.
  bar: {
    display: "block",
    flexShrink: 0,
    maxWidth: "100%",
    height: "10px",
    marginBlock: "3px",
    borderRadius: radius.control,
    backgroundColor: tokens.ruleSoft,
    animationName: { default: breathe, [reducedMotion]: "none" },
    animationDuration: motion.pulse,
    animationTimingFunction: motion.ease,
    animationIterationCount: "infinite",
  },
  barTitle: { height: "12px" },
  barWidth: (width: string) => ({ width }),
  card: {
    display: "flex",
    flex: "0 1 auto",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBlock: "16px 8px",
    paddingInline: "20px",
  },
  label: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.semibold,
    letterSpacing: tracking.caps,
    textTransform: "uppercase",
  },
  source: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  empty: {
    margin: 0,
    paddingBlock: "12px 20px",
    paddingInline: "20px",
    color: tokens.inkMuted,
    fontSize: fontSize.ui,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    paddingBlock: "8px",
    paddingInline: "20px 10px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
  },
  searchIcon: { width: "14px", height: "14px", color: tokens.inkFaint },
  filter: {
    flex: 1,
    minWidth: 0,
    height: "28px",
    padding: 0,
    borderWidth: 0,
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.ui,
    "::placeholder": { color: tokens.inkFaint },
  },
  kinds: {
    display: "flex",
    flexShrink: 0,
    gap: "2px",
    padding: "2px",
    borderRadius: radius.control,
    backgroundColor: tokens.well,
  },
  kindTab: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    height: "24px",
    paddingInline: "10px",
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": tokens.chromeHoverBg },
    color: tokens.inkMuted,
    cursor: "pointer",
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  kindTabOn: {
    backgroundColor: { default: tokens.surface, ":hover": tokens.surface },
    boxShadow: elevation.raised,
    color: tokens.ink,
  },
  kindCount: { color: tokens.inkFaint },
  target: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: "14px",
    width: "100%",
    height: "36px",
    paddingInline: "18px 20px",
    borderWidth: 0,
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: "transparent",
    color: "inherit",
    backgroundColor: { default: "transparent", ":hover": tokens.markerTint },
    cursor: "pointer",
    font: "inherit",
    textAlign: "left",
  },
  targetSelected: {
    borderLeftColor: tokens.accent,
    backgroundColor: tokens.accentSoft,
  },
  kind: {
    width: "64px",
    flexShrink: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.semibold,
    letterSpacing: tracking.caps,
    textTransform: "uppercase",
  },
  kindSelected: { color: tokens.accent },
  // The name keeps its room; the detail after it gives way first.
  targetTitle: {
    flex: "0 1 auto",
    minWidth: 0,
    maxWidth: "60%",
    overflow: "hidden",
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  targetMeta: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  targetMetaOn: { color: tokens.inkMuted },
  diff: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    width: "88px",
    flexShrink: 0,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  added: { color: tokens.changeAdded },
  removed: { color: tokens.changeRemoved },
  // As tall as the window leaves it, then it scrolls.
  targets: {
    display: "flex",
    flex: "0 1 auto",
    flexDirection: "column",
    paddingBlock: "6px",
    overflowY: "auto",
  },
  // Never fewer than four rows on screen, or all of them when there are less.
  targetsMin: (rows: number) => ({ minHeight: `${rows * 36 + 12}px` }),
  // Fits the window, down to a size the composer still works at.
  fit: { minWidth: "600px", minHeight: "640px" },
  // In Home, the composer takes the room under the header; Home scrolls
  // once the window is shorter than that.
  fitEmbedded: { flex: "1 1 0", minHeight: "460px" },
  prompt: {
    display: "flex",
    flexDirection: "column",
    paddingBottom: "18px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  promptHeader: { paddingBottom: "10px" },
  promptField: {
    marginInline: "20px",
  },
  alert: { paddingInline: "12px" },
  footer: {
    display: "flex",
    alignItems: "stretch",
    flexShrink: 0,
    paddingBlock: "16px 8px",
    paddingInline: "12px",
  },
  choice: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    minWidth: 0,
  },
  // Draw it here takes the rest of the row and sits at its end.
  choiceHere: { flex: 1, alignItems: "flex-end" },
  choiceRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  // The picker and both buttons share one height, so the row reads as one.
  picker: {
    gap: "8px",
    height: "42px",
    paddingInline: "12px",
    borderRadius: radius.surface,
  },
  action: {
    gap: "10px",
    height: "42px",
    paddingBlock: 0,
    paddingInline: "20px 18px",
    borderRadius: radius.surface,
    fontSize: fontSize.ui,
  },
  // Only Draw is raised: it is the step the screen leads to.
  draw: {
    boxShadow: { default: elevation.popover, ":disabled": "none" },
  },
  noAgent: { alignSelf: "center" },
  // A quiet "or" on a hairline, between the two ways.
  or: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    width: "56px",
    flexShrink: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.body,
    fontStyle: "italic",
  },
  orRule: {
    width: "1px",
    flexGrow: 1,
    backgroundColor: tokens.rule,
  },
  agentDot: {
    width: "8px",
    height: "8px",
    borderRadius: radius.round,
    backgroundColor: tokens.changeAdded,
  },
  shortcut: { opacity: 0.7 },
});
