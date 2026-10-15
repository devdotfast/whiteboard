import { OptionMenu } from "@canvas/option-menu";
import {
  elevation,
  fontSize,
  fontWeight,
  leading,
  motion,
  radius,
  space,
} from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { AgentLogo } from "@canvas/ui/brand-icons";
import { Button, IconButton, buttonStyles } from "@canvas/ui/button";
import { dividerStyles } from "@canvas/ui/divider";
import { EmptyState } from "@canvas/ui/empty-state";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import {
  CopyIcon,
  FolderIcon,
  RefreshIcon,
  SearchIcon,
} from "@canvas/ui/icons";
import { Shortcut } from "@canvas/ui/kbd";
import { SegmentedControl } from "@canvas/ui/segmented";
import { textStyles } from "@canvas/ui/text";
import { TextArea, fieldStyles } from "@canvas/ui/text-field";
import { useTooltip } from "@canvas/ui/tooltip";
import type {
  ReviewCanvasSetupActions,
  ReviewOnboardingProject,
  ReviewOnboardingTarget,
  ReviewOnboardingTargetsResponse,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OnboardingClient, OnboardingRunAgent } from "./onboarding-client";
import { type BackLink, ScreenHeader } from "./onboarding-parts";
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

/** A folder's own name, on any platform's separators. */
function folderName(folder: string) {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
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
  onStarted?(reviewId: string, agent: OnboardingRunAgent["id"]): void;
  onCopy(prompt: string): void;
}) {
  const [projects, setProjects] = useState<ReviewOnboardingProject[]>([]);

  const [discovered, setDiscovered] =
    useState<ReviewOnboardingTargetsResponse>();

  // The project being drawn from, shown as soon as it is chosen; its targets
  // follow in `discovered`.
  const [project, setProject] = useState<ReviewOnboardingProject>();
  const opening = useRef(0);

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
  const [refreshing, setRefreshing] = useState(false);

  const open = useCallback(
    async (chosen: ReviewOnboardingProject) => {
      // Only the latest choice lands, however the answers arrive.
      const attempt = ++opening.current;

      setProject(chosen);
      setDiscovered(undefined);
      setLoading(true);
      setError(undefined);

      try {
        const next = await client.targets(chosen.path);

        if (attempt !== opening.current) return;

        // A checkout of the base branch has nothing to draw against it;
        // start from the first target that has.
        const first =
          next.targets.find(
            (target) => target.kind !== "branch" || target.branch !== next.base,
          ) ?? next.targets[0];

        setProject(next.project);
        setDiscovered(next);
        setSelected(first ? targetKey(first) : undefined);
        setQuery("");
        setKind(undefined);
        setEdited(false);
        setPrompt(first ? defaultPrompt(first) : "");
      } catch (cause) {
        if (attempt !== opening.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }

      if (attempt === opening.current) setLoading(false);
    },
    [client],
  );

  // The list only changes when asked: it holds still under the pointer while
  // agents move branches and worktrees. The choice, filter and prompt stay.
  const refresh = useCallback(async () => {
    if (!discovered) return;
    // A project chosen meanwhile wins over this answer.
    const attempt = opening.current;

    setRefreshing(true);
    setError(undefined);

    try {
      const next = await client.targets(discovered.project.path);

      if (attempt !== opening.current) return;
      setDiscovered(next);
      setSelected((current) =>
        next.targets.some((candidate) => targetKey(candidate) === current)
          ? current
          : undefined,
      );
    } catch (cause) {
      if (attempt === opening.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  }, [client, discovered]);

  const pickFolder = useCallback(async () => {
    const folder = await setupActions.pickFolder();

    if (folder) await open({ path: folder, name: folderName(folder) });
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

        if (known[0]) void open(known[0]);
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
  const canChooseAgent = agents.length > 1;

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

      onStarted?.(reviewId, agent);
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

  const filterTooltip = useTooltip<HTMLInputElement>(
    "From git worktree list and gh pr list",
  );

  const refreshTooltip = useTooltip("Refresh branches, worktrees and PRs");
  const drawTooltip = useTooltip(agentMode ?? "");

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
          <FolderIcon xstyle={styles.folderIcon} />
          {loading && !project ? (
            <span
              aria-label="Looking for your projects"
              {...stylex.props(styles.projectPlaceholder)}
            >
              <span {...stylex.props(styles.bar, styles.barWidth("96px"))} />
              <span {...stylex.props(styles.bar, styles.barWidth("240px"))} />
            </span>
          ) : (
            <>
              {projects.length ? (
                <OptionMenu
                  ariaLabel="Project"
                  align="start"
                  triggerStyle={[
                    focusStyles.ringInset,
                    buttonStyles.reset,
                    buttonStyles.base,
                    styles.projectTrigger,
                  ]}
                  value={project?.path}
                  options={projectOptions}
                  onChange={(value) => {
                    if (value === PICK_FOLDER) return void pickFolder();

                    const known = projects.find(
                      (candidate) => candidate.path === value,
                    );

                    if (known) void open(known);
                  }}
                >
                  {project?.name ?? "Choose a project"}
                </OptionMenu>
              ) : project ? (
                <span {...stylex.props(styles.projectName)}>
                  {project.name}
                </span>
              ) : null}
              <span
                {...stylex.props(
                  textStyles.truncate,
                  styles.projectPath,
                  project && styles.projectPathEnd,
                )}
              >
                {project
                  ? project.path
                  : projects.length
                    ? null
                    : "Choose a project to draw from"}
              </span>
              {projects.length ? null : (
                <Button onClick={() => void pickFolder()}>
                  Choose a folder…
                </Button>
              )}
            </>
          )}
        </div>
        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.toolbar)}>
            <SearchIcon xstyle={[iconStyles.chrome, styles.searchIcon]} />
            <input
              ref={filterTooltip}
              type="search"
              aria-label="Filter what to draw"
              placeholder={
                targets.length
                  ? `Filter ${targets.length} branches, worktrees and PRs`
                  : "Filter branches, worktrees and PRs"
              }
              disabled={!targets.length}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              {...stylex.props(fieldStyles.bare, styles.filter)}
            />
            {discovered && !loading ? (
              <IconButton
                ref={refreshTooltip}
                disabled={refreshing}
                aria-busy={refreshing || undefined}
                onClick={() => void refresh()}
                aria-label="Refresh branches, worktrees and PRs"
              >
                <RefreshIcon spinning={refreshing} />
              </IconButton>
            ) : null}
            {kinds.length > 1 ? (
              <SegmentedControl
                label="Kind"
                value={kind ?? "all"}
                options={[
                  { kind: "all" as const, label: "All", count: 0 },
                  ...kinds,
                ].map((option) => ({
                  value: option.kind,
                  label: option.label,
                  count: option.count || undefined,
                }))}
                onChange={(next) => setKind(next === "all" ? undefined : next)}
              />
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
            <EmptyState
              xstyle={styles.empty}
              message={
                discovered
                  ? "Nothing to draw here yet: check out a branch, then choose the folder again."
                  : "Choose a project folder above."
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState
              xstyle={styles.empty}
              message={`Nothing matches “${query.trim()}”.`}
            />
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
          <div {...stylex.props(styles.prompt)}>
            <span {...stylex.props(styles.sectionHeader, styles.promptHeader)}>
              <span {...stylex.props(textStyles.eyebrow, styles.mono)}>
                Prompt
              </span>
              {/* The copy sits by what it copies. */}
              <Button
                variant="ghost"
                aria-label="Copy prompt"
                disabled={!canCopy}
                onClick={copy}
                xstyle={styles.copy}
              >
                <CopyIcon xstyle={iconStyles.inline} />
                Copy
              </Button>
            </span>
            <TextArea
              aria-label="Prompt"
              xstyle={styles.promptField}
              value={prompt}
              rows={3}
              disabled={!target}
              onChange={(event) => {
                setPrompt(event.target.value);
                setEdited(true);
              }}
            />
          </div>
        </div>
        {error ? (
          <p
            role="alert"
            {...stylex.props(
              textStyles.error,
              onboardingStyles.error,
              styles.alert,
            )}
          >
            {error}
          </p>
        ) : null}
        {/* One sentence: copy the prompt for the reader's own agent, or draw
            with the chip's agent, whose menu is the only thing to toggle. */}
        <div {...stylex.props(styles.footer)}>
          {agents.length ? (
            <>
              <span {...stylex.props(styles.lead)}>
                Copy for your agent, or use
              </span>
              <span {...stylex.props(styles.chip)}>
                <Button
                  ref={drawTooltip}
                  variant="ghost"
                  aria-label={`Draw with ${agentName}`}
                  aria-keyshortcuts="Meta+Enter"
                  disabled={!canDraw}
                  onClick={() => void draw()}
                  xstyle={styles.chipDraw}
                >
                  {agent ? <AgentLogo agent={agent} /> : null}
                  {starting ? "Starting…" : agentName}
                  <Shortcut aria-hidden="true" xstyle={styles.shortcut}>
                    ⌘↵
                  </Shortcut>
                </Button>
                {canChooseAgent ? (
                  <span
                    aria-hidden="true"
                    {...stylex.props(dividerStyles.vertical)}
                  />
                ) : null}
                {canChooseAgent ? (
                  <OptionMenu
                    ariaLabel="Draw with another agent"
                    triggerStyle={[
                      focusStyles.ringInset,
                      buttonStyles.reset,
                      buttonStyles.base,
                      styles.chipMenu,
                    ]}
                    value={agent}
                    options={agents.map((candidate) => ({
                      value: candidate.id,
                      label: candidate.name,
                      icon: <AgentLogo agent={candidate.id} />,
                    }))}
                    onChange={(next: OnboardingRunAgent["id"]) =>
                      setAgent(next)
                    }
                  >
                    {null}
                  </OptionMenu>
                ) : null}
              </span>
            </>
          ) : loading ? null : (
            <span {...stylex.props(styles.source)}>
              Copy for your agent; none Whiteboard can run is installed here.
            </span>
          )}
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
      <span
        {...stylex.props(
          textStyles.eyebrow,
          styles.kind,
          selected && styles.kindSelected,
        )}
      >
        {target.kind === "pr" ? `PR #${target.number}` : target.kind}
      </span>
      <span {...stylex.props(textStyles.truncate, styles.targetTitle)}>
        {target.kind === "pr" ? target.title : target.branch}
      </span>
      <span
        {...stylex.props(
          textStyles.truncate,
          styles.targetMeta,
          selected && styles.targetMetaOn,
        )}
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

const styles = stylex.create({
  composer: {
    flex: "0 1 auto",
    minHeight: 0,
    padding: space.s8,
  },
  project: {
    display: "flex",
    alignItems: "center",
    gap: space.s14,
    paddingBlock: space.s10,
    paddingInline: space.s12,
    color: tokens.inkMuted,
  },
  projectName: {
    color: tokens.ink,
    fontSize: fontSize.reading,
    fontWeight: fontWeight.medium,
  },
  // The name is the project menu; it reads as the name until hovered.
  projectTrigger: {
    marginInline: `-${space.s8} -${space.s6}`,
    paddingInline: space.s8,
    color: tokens.ink,
    fontFamily: "inherit",
    fontSize: fontSize.reading,
  },
  // The path sits at the row's end, after the name's menu.
  projectPathEnd: { textAlign: "end" },
  projectPath: {
    flex: 1,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
  },
  projectPlaceholder: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    gap: space.s14,
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
    animationName: { default: breathe, [stylex.env.reducedMotion]: "none" },
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
    paddingBlock: `${space.s16} ${space.s8}`,
    paddingInline: space.s20,
  },
  mono: { fontFamily: tokens.fontMono },
  folderIcon: { width: "18px", height: "18px" },
  source: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  empty: {
    paddingInline: space.s20,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: space.s12,
    paddingBlock: space.s8,
    paddingInline: `${space.s20} ${space.s10}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
  },
  searchIcon: { color: tokens.inkFaint },
  filter: {
    flex: 1,
    height: "28px",
    fontFamily: tokens.fontMono,
    fontSize: fontSize.ui,
  },
  target: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: space.s14,
    width: "100%",
    height: "36px",
    paddingInline: `${space.s18} ${space.s20}`,
    borderWidth: 0,
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.transparent,
    color: "inherit",
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.markerTint,
    },
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
    fontFamily: tokens.fontMono,
  },
  kindSelected: { color: tokens.accent },
  // The name keeps its room; the detail after it gives way first.
  targetTitle: {
    flex: "0 1 auto",
    minWidth: 0,
    maxWidth: "60%",
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
  },
  targetMeta: {
    flex: 1,
    minWidth: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  targetMetaOn: { color: tokens.inkMuted },
  diff: {
    display: "flex",
    justifyContent: "flex-end",
    gap: space.s8,
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
    paddingBlock: space.s6,
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
    paddingBottom: space.s18,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  promptHeader: { paddingBottom: space.s10 },
  promptField: {
    marginInline: space.s20,
  },
  alert: { paddingInline: space.s12 },
  // A quiet text control in the prompt's header.
  copy: {
    marginBlock: `-${space.s4}`,
    marginInlineEnd: `-${space.s10}`,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  // The sentence ends at the row's end, under the prompt's Copy.
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.s10,
    flexShrink: 0,
    paddingBlock: `${space.s18} ${space.s10}`,
    paddingInline: space.s12,
  },
  lead: {
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.heading,
    lineHeight: leading.px22,
  },
  // One small chip: the agent draws; past a hairline, its caret opens the
  // agent menu.
  chip: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: radius.control,
    backgroundColor: tokens.surface,
    boxShadow: `${elevation.raised}, 0 0 0 1px ${tokens.rule}`,
  },
  chipDraw: {
    gap: space.s8,
    height: "28px",
    paddingInline: space.s8,
    color: { default: tokens.ink, ":hover:not(:disabled)": tokens.ink },
    fontFamily: tokens.fontMono,
    fontSize: fontSize.ui,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  chipMenu: {
    height: "28px",
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    paddingInline: space.s8,
    color: tokens.inkMuted,
  },
  shortcut: { color: tokens.inkFaint },
});
