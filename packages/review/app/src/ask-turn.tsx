import type { AskEntry, AskThreadState } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { ClaudeCodeLogo, CodexLogo } from "./agent-logos";
import { AgentMarkdown } from "./agent-markdown";
import {
  AskCheckIcon,
  AskChevronIcon,
  AskCrossIcon,
  askIconSizes,
} from "./ask-icons";
import { askMotion } from "./ask-motion.stylex";
import { CourierFigure } from "./courier-figure";
import { fontSize, motion, radius } from "./scale.stylex";
import { settleStreamingMarkdown } from "./streaming-markdown";
import { tokens } from "./tokens.stylex";

type ToolEntry = Extract<AskEntry, { kind: "tool" }>;

type PermissionEntry = Extract<AskEntry, { kind: "permission" }>;

export type Turn =
  | { kind: "user"; entry: Extract<AskEntry, { kind: "user" }> }
  | { kind: "agent"; entries: Exclude<AskEntry, { kind: "user" }>[] };

/** Each question, then everything the agent did and said until the next. */
export function turns(entries: AskEntry[]): Turn[] {
  const result: Turn[] = [];

  for (const entry of entries) {
    const last = result.at(-1);

    if (entry.kind === "user") result.push({ kind: "user", entry });
    else if (last?.kind === "agent") last.entries.push(entry);
    else result.push({ kind: "agent", entries: [entry] });
  }

  return result;
}

type ActivityStatus = ToolEntry["status"] | "waiting";

/** One thing the agent did, as its row shows it. */
interface Activity {
  id: string;
  /** What the group's summary counts it as. */
  category: string;
  label: string;
  status: ActivityStatus;
  /** The command it ran, shown when the row opens. */
  command?: string;
  output?: string;
}

const verbs = new Map([
  ["read", "Read"],
  ["edit", "Edit"],
  ["delete", "Delete"],
  ["move", "Move"],
  ["search", "Search"],
  ["execute", "Run"],
  ["think", "Think"],
  ["fetch", "Fetch"],
]);

/** A tool title without the verb the row adds, the backticks agents wrap
 * commands in, or the checkout prefix on paths. */
function toolSubject(title: string, verb: string | undefined, cwd: string) {
  const subject = title.replaceAll("`", "").replaceAll(`${cwd}/`, "");

  return verb && subject.toLowerCase().startsWith(`${verb.toLowerCase()} `)
    ? subject.slice(verb.length + 1)
    : subject;
}

/** Whether the reviewer let a request go ahead. */
function allowed(entry: PermissionEntry) {
  return Boolean(
    entry.options
      .find((option) => option.optionId === entry.outcome)
      ?.kind.startsWith("allow"),
  );
}

/** Whether the reviewer said no; a request stopped with its turn was not
 * answered at all. */
function denied(entry: PermissionEntry) {
  return (
    entry.outcome !== undefined &&
    entry.outcome !== "cancelled" &&
    !allowed(entry)
  );
}

/** `/bin/zsh -lc "sed -n 1,9p a.ts"`, as Codex runs commands, reads as
 * the command it runs. */
const shellWrapper =
  /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^"'][\s\S]*))$/;

function unwrapShell(command: string) {
  const match = shellWrapper.exec(command.trim());

  return (
    match?.[1]?.replace(/\\(["\\$`])/g, "$1") ??
    match?.[2] ??
    match?.[3] ??
    command
  );
}

/** What a request is about: what it would run or open, else its title
 * without the verb. */
export function permissionSubject(entry: PermissionEntry, cwd: string) {
  const subject = entry.input
    ? toolSubject(entry.input, undefined, cwd)
    : toolSubject(entry.title, verbs.get(entry.toolKind), cwd);

  return entry.toolKind === "execute" ? unwrapShell(subject) : subject;
}

/** Whiteboard's MCP tools that read or edit the review. */
const reviewTools = new Set([
  "session_get",
  "session_get_instructions",
  "session_list",
  "session_meta",
  "session_edit",
]);

/** `mcp__whiteboard__session_get` (Claude) or `mcp.whiteboard.session_get` (Codex). */
const mcpToolTitle = /^mcp(?:__|\.)(.+?)(?:__|\.)(.+)$/;

function toolActivity(
  entry: ToolEntry,
  permission: PermissionEntry | undefined,
  cwd: string,
): Activity {
  const status: ActivityStatus =
    permission && !permission.outcome ? "waiting" : entry.status;

  const mcp = mcpToolTitle.exec(entry.title);
  const shared = { id: entry.id, status, output: entry.output };

  // Whiteboard's own tools read the review, or change it.
  if (mcp?.[1] === "whiteboard" && reviewTools.has(mcp[2]!)) {
    const edit = mcp[2] === "session_edit";

    return {
      ...shared,
      category: edit ? "review edit" : "review",
      label: entry.summary ?? (edit ? "Edit the review" : "Read the review"),
    };
  }

  // fff searches Whiteboard's copy of agents' traces.
  if (mcp?.[1] === "fff")
    return {
      ...shared,
      category: "traces",
      label:
        entry.summary ??
        (entry.input ? `Search traces for ${entry.input}` : "Search traces"),
    };

  if (mcp)
    return {
      ...shared,
      category: `mcp:${mcp[1]}`,
      label:
        entry.summary ??
        `${mcp[1]} ${mcp[2]}${entry.input ? `: ${entry.input}` : ""}`,
    };

  // Claude Code loading the definitions of tools it holds back until needed.
  if (entry.title === "ToolSearch")
    return { ...shared, category: "tools", label: "Load tools" };

  const verb = verbs.get(entry.toolKind);
  const subject = toolSubject(entry.input ?? entry.title, verb ?? "", cwd);

  if (entry.toolKind === "execute") {
    const command = unwrapShell(subject);

    return {
      ...shared,
      category: "execute",
      label: entry.summary ?? command,
      command,
    };
  }

  return {
    ...shared,
    category: verb ? entry.toolKind : "other",
    label: entry.summary ?? (verb ? `${verb} ${subject}` : subject),
  };
}

/** How a group of activity reads while collapsed. */
const counted = new Map<string, [one: string, many: (count: number) => string]>(
  [
    ["execute", ["ran a command", (count) => `ran ${count} commands`]],
    ["read", ["read a file", (count) => `read ${count} files`]],
    ["search", ["searched once", (count) => `searched ${count} times`]],
    [
      "traces",
      ["searched the traces", (count) => `searched the traces ${count} times`],
    ],
    ["tools", ["loaded tools", (count) => `loaded tools ${count} times`]],
    [
      "review",
      ["read the review", (count) => `read the review ${count} times`],
    ],
    [
      "review edit",
      ["edited the review", (count) => `edited the review ${count} times`],
    ],
    ["fetch", ["fetched a page", (count) => `fetched ${count} pages`]],
    ["think", ["thought", (count) => `thought ${count} times`]],
    ["refused", ["refused a change", (count) => `refused ${count} changes`]],
    [
      "allowed",
      ["you allowed a request", (count) => `you allowed ${count} requests`],
    ],
    [
      "denied",
      ["you denied a request", (count) => `you denied ${count} requests`],
    ],
    [
      "stopped",
      ["stopped at a request", (count) => `stopped at ${count} requests`],
    ],
  ],
);

/** "Ran 2 commands, read 3 files", in the order the agent did them. */
export function summarize(activities: readonly Activity[]) {
  const counts = new Map<string, number>();

  for (const { category } of activities)
    counts.set(category, (counts.get(category) ?? 0) + 1);

  const text = [...counts]
    .map(([category, count]) => {
      const server = category.startsWith("mcp:") ? category.slice(4) : null;

      if (server)
        return count === 1
          ? `called ${server}`
          : `called ${server} ${count} times`;

      const [one, many] = counted.get(category) ?? [
        "used a tool",
        (total: number) => `used ${total} tools`,
      ];

      return count === 1 ? one : many(count);
    })
    .join(", ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ActivityStatusIcon({ status }: { status: ActivityStatus }) {
  return (
    <span
      {...stylex.props(styles.status, status === "failed" && styles.failed)}
      aria-label={status}
    >
      {status === "completed" ? (
        <AskCheckIcon xstyle={askIconSizes.small} />
      ) : status === "failed" ? (
        <AskCrossIcon xstyle={askIconSizes.small} />
      ) : status === "in_progress" ? (
        <span {...stylex.props(styles.spinner)} />
      ) : (
        <span
          {...stylex.props(styles.dot, status === "waiting" && styles.waiting)}
        />
      )}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <AskChevronIcon
      xstyle={[askIconSizes.small, styles.chevron, open && styles.chevronOpen]}
    />
  );
}

/** A row that opens to what it ran and what came back. */
function AskToolItem({ activity }: { activity: Activity }): ReactElement {
  const [open, setOpen] = useState(false);
  const detail = activity.command !== undefined || Boolean(activity.output);

  const head = (
    <>
      <ActivityStatusIcon status={activity.status} />
      <span {...stylex.props(styles.toolLabel)} title={activity.label}>
        {activity.label}
      </span>
    </>
  );

  return (
    <li {...stylex.props(styles.tool)}>
      {detail ? (
        <button
          type="button"
          {...stylex.props(styles.toolHead, styles.toolHeadButton)}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {head}
          <Chevron open={open} />
        </button>
      ) : (
        <div {...stylex.props(styles.toolHead)}>{head}</div>
      )}
      {open ? (
        <div {...stylex.props(styles.toolBody)}>
          {activity.command === undefined ? null : (
            <pre {...stylex.props(styles.pre, styles.command)}>
              <span aria-hidden="true" {...stylex.props(styles.prompt)}>
                ${" "}
              </span>
              {activity.command}
            </pre>
          )}
          {activity.output ? (
            <pre {...stylex.props(styles.pre, styles.output)}>
              {activity.output}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Consecutive activity, collapsed to what it adds up to. */
function AskToolGroup({
  activities,
}: {
  activities: Activity[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const failed = activities.every(({ status }) => status === "failed");

  return (
    <div {...stylex.props(styles.tools)}>
      <button
        type="button"
        {...stylex.props(styles.summary, failed && styles.summaryFailed)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{summarize(activities)}</span>
        <Chevron open={open} />
      </button>
      {open ? (
        <ul {...stylex.props(styles.toolList)}>
          {activities.map((activity) => (
            <AskToolItem key={activity.id} activity={activity} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Everything the agent did and said for one question. */
export function AskAgentTurn({
  thread,
  entries,
  renderPermission,
}: {
  thread: AskThreadState;
  entries: Exclude<AskEntry, { kind: "user" }>[];
  /** A request still waiting on the reviewer. */
  renderPermission: (entry: PermissionEntry) => ReactNode;
}): ReactElement {
  const permissions = new Map(
    thread.entries.flatMap((entry) =>
      entry.kind === "permission" ? [[entry.id, entry] as const] : [],
    ),
  );

  const tools = new Set(
    thread.entries.flatMap((entry) =>
      entry.kind === "tool" ? [entry.id] : [],
    ),
  );

  // Consecutive activity shares one group; text and requests end it.
  const blocks: (Activity[] | ReactElement)[] = [];

  const add = (activity: Activity) => {
    const last = blocks.at(-1);

    if (Array.isArray(last)) last.push(activity);
    else blocks.push([activity]);
  };

  for (const entry of entries)
    switch (entry.kind) {
      case "agent": {
        // Still arriving: its unfinished end reads as it will, and its files
        // link once it is whole, not for every path half written.
        const streaming =
          thread.status === "running" && thread.entries.at(-1) === entry;

        blocks.push(
          <AgentMarkdown
            key={`answer:${entry.id}`}
            xstyle={styles.answer}
            codeXstyle={styles.answerCode}
            source={
              streaming ? settleStreamingMarkdown(entry.text) : entry.text
            }
          />,
        );
        break;
      }

      case "tool": {
        const permission = permissions.get(entry.id);

        // A refused change reads as the refusal; a request to leave the
        // read-only mode shows as its plan.
        if (permission?.automatic || entry.toolKind === "switch_mode") break;

        // Denied, it never ran: it reads as the denial, not as what it did.
        if (permission && denied(permission)) {
          add({
            ...toolActivity(entry, permission, thread.cwd),
            category: "denied",
            status: "failed",
            label: `Denied ${permissionSubject(permission, thread.cwd)}`,
          });
          break;
        }

        add(toolActivity(entry, permission, thread.cwd));
        break;
      }

      // An aside about the agent itself, set apart from the answer.
      case "notice":
        blocks.push(
          <p
            key={`notice:${entry.id}`}
            role="note"
            {...stylex.props(
              styles.notice,
              entry.severity === "error" && styles.failed,
            )}
          >
            {entry.description
              ? `${entry.title} ${entry.description}`
              : entry.title}
          </p>,
        );
        break;

      case "permission": {
        const subject = permissionSubject(entry, thread.cwd);

        if (entry.automatic) {
          add({
            id: entry.id,
            category: "refused",
            status: "failed",
            label:
              entry.toolKind === "switch_mode"
                ? "Stayed in read-only mode"
                : `Refused ${subject}`,
          });
          break;
        }

        if (!entry.outcome) {
          blocks.push(
            <div key={`permission:${entry.id}`}>{renderPermission(entry)}</div>,
          );
          break;
        }

        // The tool's own row already shows how a decided call went.
        if (tools.has(entry.id)) break;

        add(
          allowed(entry)
            ? {
                id: entry.id,
                category: "allowed",
                status: "completed",
                label: `Allowed ${subject}`,
              }
            : denied(entry)
              ? {
                  id: entry.id,
                  category: "denied",
                  status: "failed",
                  label: `Denied ${subject}`,
                }
              : {
                  id: entry.id,
                  category: "stopped",
                  status: "failed",
                  label: `Stopped before ${subject}`,
                },
        );
      }
    }

  return (
    <div {...stylex.props(styles.turn)}>
      <div {...stylex.props(styles.byline)}>
        <span {...stylex.props(styles.bylineLogo)}>
          {thread.agent === "codex" ? (
            <CodexLogo xstyle={styles.bylineLogoMark} />
          ) : (
            <ClaudeCodeLogo xstyle={styles.bylineLogoMark} />
          )}
        </span>
        <span>{thread.agentName}</span>
      </div>
      {blocks.map((block) =>
        Array.isArray(block) ? (
          <AskToolGroup key={`tools:${block[0]!.id}`} activities={block} />
        ) : (
          block
        ),
      )}
    </div>
  );
}

function elapsed(since: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));

  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** How long after the answer text last grew the agent still reads as
 * writing: a pause between words is not yet thinking. */
const WRITING_MS = 900;

/** Whether the answer is streaming in: its text grew just now. */
function useWriting(text: string | undefined) {
  const [writing, setWriting] = useState(false);
  const seen = useRef(text);

  useEffect(() => {
    if (text === seen.current) return;
    seen.current = text;

    if (!text) {
      setWriting(false);

      return;
    }

    setWriting(true);
    const timer = setTimeout(() => setWriting(false), WRITING_MS);

    return () => clearTimeout(timer);
  }, [text]);

  return writing;
}

/** While the agent works: what it is doing, and for how long. */
export function AskWorking({
  thread,
}: {
  thread: AskThreadState;
}): ReactElement {
  // Timed from the question, when this panel saw it asked.
  const [since] = useState(
    () =>
      thread.entries.findLast((entry) => entry.kind === "user")?.at ??
      Date.now(),
  );

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  const last = thread.entries.at(-1);
  const writing = useWriting(last?.kind === "agent" ? last.text : undefined);

  const doing = writing
    ? "Writing"
    : last?.kind === "tool" &&
        (last.status === "in_progress" || last.status === "pending")
      ? toolActivity(last, undefined, thread.cwd).label
      : "Thinking";

  return (
    <div {...stylex.props(styles.working)} role="status">
      <CourierFigure
        xstyle={styles.courier}
        marching={writing}
        thinking={!writing}
      />
      <span {...stylex.props(styles.workingLabel)}>{doing}…</span>
      <span {...stylex.props(styles.workingTime)}>{elapsed(since, now)}</span>
    </div>
  );
}

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const shimmer = stylex.keyframes({
  from: { backgroundPosition: "100% 0" },
  to: { backgroundPosition: "-150% 0" },
});

// Lifts code off the panel's tray, where the chat's own code sits.
const onTray = `color-mix(in srgb, ${tokens.ink} 6%, ${tokens.tray})`;

const styles = stylex.create({
  turn: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  byline: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "-8px",
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  bylineLogo: {
    display: "flex",
    flex: "0 0 14px",
    justifyContent: "center",
  },
  bylineLogoMark: {
    width: "12px",
    height: "12px",
  },
  answer: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "26px",
  },
  // A long path wraps; each line's piece keeps its padding and corners.
  answerCode: {
    backgroundColor: onTray,
    fontSize: "0.84em",
    boxDecorationBreak: "clone",
  },
  // Consecutive tool calls, collapsed to what they add up to.
  tools: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  summary: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: "6px",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    backgroundColor: tokens.transparent,
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.ink,
      ":focus-visible": tokens.ink,
    },
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "20px",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
  },
  summaryFailed: {
    color: tokens.inkFaint,
  },
  chevron: {
    transition: `transform ${motion.fast} ${motion.ease}`,
  },
  chevronOpen: {
    transform: "rotate(180deg)",
  },
  toolList: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: "4px 0",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    listStyle: "none",
  },
  tool: {
    borderTopWidth: { default: 0, ":not(:first-child)": "1px" },
    borderTopStyle: { default: "none", ":not(:first-child)": "solid" },
    borderTopColor: tokens.rule,
  },
  toolHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minWidth: 0,
    padding: "7px 12px",
    borderWidth: 0,
    borderStyle: "none",
    backgroundColor: tokens.transparent,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.ui,
    lineHeight: "18px",
    textAlign: "left",
  },
  toolHeadButton: {
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.ink,
      ":focus-visible": tokens.ink,
    },
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
  },
  toolLabel: {
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  status: {
    display: "flex",
    flex: "0 0 14px",
    justifyContent: "center",
    color: tokens.inkFaint,
  },
  failed: {
    color: tokens.changeRemoved,
  },
  notice: {
    margin: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: 1.5,
  },
  spinner: {
    width: "8px",
    height: "8px",
    borderWidth: "1.4px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderTopColor: tokens.accent,
    borderRadius: radius.round,
    animationName: spin,
    animationDuration: askMotion.spin,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  dot: {
    width: "6px",
    height: "6px",
    borderRadius: radius.round,
    backgroundColor: tokens.inkFaint,
  },
  waiting: {
    backgroundColor: tokens.changeModified,
  },
  toolBody: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "0 12px 10px 34px",
  },
  pre: {
    maxHeight: "240px",
    margin: 0,
    padding: "8px 10px",
    overflow: "auto",
    borderRadius: radius.control,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "17px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  command: {
    backgroundColor: onTray,
    color: tokens.ink,
  },
  prompt: {
    color: tokens.inkFaint,
  },
  output: {
    color: tokens.inkMuted,
  },
  // While the agent works: what it is doing, shimmering, and for how long.
  working: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    minWidth: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "20px",
  },

  // The board's courier, working on the answer, standing on the text's
  // baseline: his drawing leaves room above his head to jump, so centering
  // his box floats him off the words.
  courier: {
    flexShrink: 0,
    width: "14px",
    height: "17px",
    // His feet end a pixel above his box.
    position: "relative",
    top: "1px",
    overflow: "visible",
    color: tokens.accent,
  },
  workingLabel: {
    minWidth: 0,
    overflow: "hidden",
    backgroundImage: {
      default: `linear-gradient(90deg, ${tokens.inkMuted} 0%, ${tokens.inkMuted} 40%, ${tokens.ink} 50%, ${tokens.inkMuted} 60%, ${tokens.inkMuted} 100%)`,
      [reducedMotion]: "none",
    },
    backgroundPosition: "0 0",
    backgroundSize: "250% 100%",
    backgroundClip: { default: "text", [reducedMotion]: "border-box" },
    color: { default: tokens.transparent, [reducedMotion]: tokens.inkMuted },
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    animationName: { default: shimmer, [reducedMotion]: "none" },
    animationDuration: motion.pulse,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  workingTime: {
    flex: "0 0 auto",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
});
