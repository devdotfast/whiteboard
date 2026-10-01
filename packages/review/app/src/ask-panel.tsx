import type { AgentSelection } from "@review/agent-selection";
import {
  type AskAgentId,
  type AskChoiceKind,
  type AskEntry,
  type AskPicks,
  type AskQuestion,
  type AskThreadState,
  askChoiceKinds,
} from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { AgentChatUserMessage } from "./agent-chat";
import {
  AskAgentPicker,
  AskChoicePicker,
  choiceLabels,
  permissionsSelect,
  preferredAskAgent,
  rememberAskAgent,
  rememberBypass,
  rememberChoice,
  storedBypass,
  storedChoice,
  storedPicks,
  useAskAgents,
  useOffer,
} from "./ask-agent-picker";
import { AskComposer } from "./ask-composer";
import { useShowOpenThread } from "./ask-delete";
import { AskFilesProvider } from "./ask-files";
import { useAskHistory } from "./ask-history";
import { AskOutdatedNote } from "./ask-history-list";
import {
  AskArrowIcon,
  AskImageIcon,
  AskLockIcon,
  askIconSizes,
} from "./ask-icons";
import { AskSelectionQuote, askPanelStyles } from "./ask-panel-shared";
import { AskPermission } from "./ask-permission";
import { AskSetup, AskSignIn } from "./ask-setup";
import { useLatest, useThread } from "./ask-thread-stream";
import { AskAgentTurn, AskWorking, turns } from "./ask-turn";
import type { AskPresence } from "./ask-window";
import { useReviewSession } from "./host/review-session";
import { formatRelativeTime } from "./review-home-view";
import { useOptionalReviewPanelStore } from "./review-panel";
import { fontSize, motion, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { surfaceStyles } from "./ui/surface";
import { useFollowLatest } from "./use-follow-latest";

/** What the panel sends: a first question, a follow-up, or a decision. */
type AskRequest =
  | {
      agent: AskAgentId;
      question: AskQuestion;
      selection: AgentSelection;
      picks: AskPicks;
      bypass: boolean;
    }
  | { question: AskQuestion }
  | { bypass: boolean }
  | { kind: AskChoiceKind; value: string }
  | { permissionId: string; optionId: string }
  | Record<string, never>;

async function readError(response: Response) {
  const body = await response.json().catch(() => null);

  return z.object({ error: z.string() }).safeParse(body).data?.error;
}

export function AskPanelContent({
  selection,
  agent: requestedAgent,
  savedThreadId,
  onPresence,
}: {
  selection: AgentSelection;
  agent?: AskAgentId;
  /** A saved conversation to reopen instead of asking a new question. */
  savedThreadId?: string;
  /** What the pill says while the conversation is out of sight. */
  onPresence?: (presence: AskPresence) => void;
}): ReactElement {
  const session = useReviewSession();
  const agents = useAskAgents(session);
  const [agent, setAgent] = useState<AskAgentId | undefined>(requestedAgent);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Choices for a question not yet asked; a thread says its own.
  const [picks, setPicks] = useState<AskPicks>({});
  const [bypassPick, setBypassPick] = useState<boolean>();
  const { thread, lost } = useThread(session, threadId);

  useShowOpenThread(threadId ?? savedThreadId ?? null);

  const offered = useOffer(
    session,
    agent,
    threadId === null && savedThreadId === undefined,
    picks.model ?? (agent ? storedChoice(session, agent, "model") : undefined),
  );

  const composer = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const panels = useOptionalReviewPanelStore();

  useEffect(() => {
    if (agents && !agent) setAgent(preferredAskAgent(session, agents)?.id);
  }, [agents, agent, session]);

  const latestSession = useLatest(session);

  // A saved conversation: the server starts its agent and loads it, once
  // per panel, not again for each new version of the review.
  useEffect(() => {
    if (!savedThreadId) return;
    let current = true;

    const opening = latestSession.current;

    void opening
      .fetch(`/ask/${savedThreadId}/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          picks: requestedAgent ? storedPicks(opening, requestedAgent) : {},
        }),
      })
      .then(async (response) => {
        if (!current) return;

        if (response.ok) setThreadId(savedThreadId);
        else
          setRequestError(
            (await readError(response)) ??
              "Whiteboard could not reopen this conversation.",
          );
      })
      .catch(() => {
        if (current)
          setRequestError("Whiteboard could not reopen this conversation.");
      });

    return () => {
      current = false;
    };
  }, [latestSession, savedThreadId, requestedAgent]);

  useEffect(() => composer.current?.focus(), [agent]);

  // The server saves a conversation once the agent starts it and dates it
  // by its last turn, so the document's marks and the history follow.
  const history = useAskHistory();
  const refreshHistory = history?.refresh;
  const status = thread?.status;

  useEffect(() => {
    if (status === "running" || status === "idle") refreshHistory?.();
  }, [status, refreshHistory]);

  // What the thread shows; typing a question changes none of it.
  const latest = useFollowLatest(scroller, [
    thread,
    selection,
    savedThreadId,
    requestError,
  ]);

  const busy =
    sending ||
    (savedThreadId !== undefined && !thread && !requestError) ||
    thread?.status === "starting" ||
    thread?.status === "running" ||
    thread?.status === "waiting";

  const post = useCallback(
    async (endpoint: `/${string}`, body: AskRequest = {}) => {
      const response = await session.fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok)
        throw new Error(
          (await readError(response)) ??
            "Whiteboard could not reach the agent.",
        );

      return response;
    },
    [session],
  );

  const ask = async (question: AskQuestion) => {
    if (!agent || busy || thread?.status === "failed") return false;
    setSending(true);
    setRequestError(null);

    try {
      if (threadId) {
        await post(`/ask/${threadId}/prompt`, { question });
      } else {
        const response = await post("/ask", {
          agent,
          question,
          selection,
          picks: currentPicks(),
          bypass,
        });

        const { threadId: id } = z
          .object({ threadId: z.string() })
          .parse(await response.json());

        rememberAskAgent(session, agent);
        setThreadId(id);
      }

      // Asking returns to the newest, where the answer will be.
      latest.jump("instant");

      return true;
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));

      return false;
    } finally {
      setSending(false);
    }
  };

  const findFiles = useCallback(
    async (query: string, signal: AbortSignal) => {
      const params = new URLSearchParams({ query });

      if (threadId) params.set("thread", threadId);

      const response = await session.fetch(`/ask/mentions?${params}`, {
        signal,
      });

      if (!response.ok) return [];

      return z
        .object({ paths: z.array(z.string()) })
        .parse(await response.json()).paths;
    },
    [session, threadId],
  );

  const decide = useCallback(
    (permissionId: string, optionId: string) =>
      void post(`/ask/${threadId}/permission`, {
        permissionId,
        optionId,
      }).catch((error: Error) => setRequestError(error.message)),
    [post, threadId],
  );

  const stop = () =>
    void post(`/ask/${threadId}/cancel`).catch((error: Error) =>
      setRequestError(error.message),
    );

  if (agents && !agents.some((candidate) => candidate.available))
    return <AskSetup agents={agents} selection={selection} />;

  const chosen = agents?.find((candidate) => candidate.id === agent);
  // A running thread offers its agent's choices; before one, what the
  // agent offers when it starts.
  const choices = thread?.choices ?? offered?.choices;

  const currentChoice = (kind: AskChoiceKind) => {
    const select = choices?.[kind];

    if (!select || thread?.choices) return select?.current;

    const wanted =
      picks[kind] ?? (agent ? storedChoice(session, agent, kind) : undefined);

    return select.options.some((option) => option.value === wanted)
      ? wanted
      : select.current;
  };

  /** What the pickers show, which the new thread starts with. */
  const currentPicks = () => {
    const shown: AskPicks = {};

    for (const kind of askChoiceKinds) {
      const value = currentChoice(kind);

      if (value) shown[kind] = value;
    }

    return shown;
  };

  const choose = (kind: AskChoiceKind, value: string) => {
    if (!agent) return;
    rememberChoice(session, agent, kind, value);

    if (!threadId) {
      setPicks((current) => ({ ...current, [kind]: value }));

      return;
    }

    void post(`/ask/${threadId}/choice`, { kind, value }).catch(
      (error: Error) => setRequestError(error.message),
    );
  };

  // A thread says its own; before a new one, what was chosen last for the
  // agent. A saved one says once it is open.
  const bypass =
    thread?.bypass ??
    (savedThreadId === undefined &&
      chosen?.bypass === true &&
      (bypassPick ?? (agent ? storedBypass(session, agent) : false)));

  const permit = (value: boolean) => {
    if (!agent) return;
    rememberBypass(session, agent, value);

    if (!threadId) {
      setBypassPick(value);

      return;
    }

    void post(`/ask/${threadId}/permissions`, { bypass: value }).catch(
      (error: Error) => setRequestError(error.message),
    );
  };

  const chosenName = chosen?.name ?? "the agent";

  const error =
    requestError ??
    thread?.error ??
    (lost
      ? `Whiteboard lost its connection to ${thread?.agentName ?? chosenName}.`
      : null);

  // Saved once its agent started a session; before that, nothing reopens it.
  const unsaved =
    threadId !== null &&
    history?.entries?.some((entry) => entry.id === threadId) === false;

  // The conversation is saved, so a lost one reopens where it stopped.
  const reconnect =
    lost && threadId && panels && !unsaved
      ? () =>
          panels.getState().openAskView({
            type: "saved",
            threadId,
            selection,
            agent: thread?.agent ?? agent ?? "claude",
          })
      : undefined;

  // A failed agent starts again, once it is signed back in, say, and asks
  // again what it did not answer.
  const retry =
    thread?.status === "failed" && !lost && threadId
      ? () => {
          setRequestError(null);
          void post(`/ask/${threadId}/retry`).catch((error: Error) =>
            setRequestError(error.message),
          );
        }
      : undefined;

  // Nothing to reopen, or it could not be: ask about the selection anew.
  const startOver =
    panels &&
    ((lost && unsaved) ||
      (savedThreadId !== undefined && requestError !== null && !thread))
      ? () => panels.getState().openAsk(selection, thread?.agent ?? agent)
      : undefined;

  // Reopening starts the agent and loads its session. Whiteboard's saved
  // copy shows meanwhile; one saved before that copy waits for the replay.
  const connecting =
    savedThreadId !== undefined &&
    !requestError &&
    (!thread || thread.status === "starting");

  const agentName = thread?.agentName ?? chosenName;

  // Before the agents load, the pill names Ask.
  const pillName = thread?.agentName ?? chosen?.name ?? "Ask";

  const presence: AskPresence =
    thread?.status === "waiting"
      ? { agentName: pillName, status: "Needs your approval", tone: "waiting" }
      : thread?.status === "failed" || error
        ? { agentName: pillName, status: "Stopped", tone: "failed" }
        : {
            agentName: pillName,
            status: connecting
              ? "Connecting…"
              : busy
                ? composerStatus(thread, busy)
                : thread
                  ? "Answered"
                  : "New question",
            tone: "quiet",
          };

  const presenceAgent = thread?.agent ?? agent;

  useEffect(() => {
    onPresence?.({
      agent: presenceAgent,
      agentName: presence.agentName,
      status: presence.status,
      tone: presence.tone,
    });
  }, [
    onPresence,
    presenceAgent,
    presence.agentName,
    presence.status,
    presence.tone,
  ]);

  // Until the agent says, what its kind of agent does: a starting thread
  // has not yet been put in its read-only mode.
  const readOnly =
    thread && thread.status !== "starting"
      ? thread.readOnly
      : !bypass && (chosen?.readOnly ?? true);

  const modeTitle = readOnly
    ? "The agent cannot change files in the checkout, and asks before running commands. It can edit this review."
    : bypass
      ? `${agentName} bypasses permissions: it may change files in the checkout and run commands without asking.`
      : `${agentName} is not in a read-only mode, so it may change files in the checkout.`;

  const settingsDisabled =
    (busy && threadId !== null) || thread?.status === "failed";

  // Below the composer, as in the agents' own apps: what the agent may do,
  // then its model and effort.
  const permissions =
    chosen?.bypass && (thread || savedThreadId === undefined) ? (
      <AskChoicePicker
        label="Permissions"
        select={permissionsSelect(bypass)}
        current={bypass ? "bypass" : "ask"}
        disabled={settingsDisabled}
        quiet
        icon={readOnly ? <AskLockIcon /> : null}
        onPick={(value) => permit(value === "bypass")}
      />
    ) : (
      <span
        {...stylex.props(styles.mode, styles.settingsLabel)}
        title={modeTitle}
      >
        {readOnly ? (
          <>
            <AskLockIcon />
            Read-only
          </>
        ) : (
          "Not read-only"
        )}
      </span>
    );

  const settings = (
    <>
      {askChoiceKinds.map((kind) => {
        const select = choices?.[kind];
        const current = currentChoice(kind);

        return select && current ? (
          <AskChoicePicker
            key={kind}
            label={choiceLabels.get(kind) ?? kind}
            select={select}
            current={current}
            disabled={settingsDisabled}
            quiet
            end
            onPick={(value) => choose(kind, value)}
          />
        ) : null;
      })}
    </>
  );

  return (
    <div {...stylex.props(askPanelStyles.body)}>
      <div {...stylex.props(styles.agentBar)}>
        <AskAgentPicker
          agents={agents}
          agent={agent}
          locked={threadId !== null || savedThreadId !== undefined}
          onPick={(picked) => {
            setAgent(picked);
            setPicks({});
            setBypassPick(undefined);
          }}
        />
        {thread ? (
          <span
            {...stylex.props(styles.mode, styles.head)}
            title={`Commit ${thread.head}`}
          >
            {thread.head.slice(0, 7)}
          </span>
        ) : null}
      </div>

      <AskFilesProvider key={threadId} threadId={threadId}>
        <div {...stylex.props(styles.threadFrame)}>
          <div
            ref={scroller}
            {...stylex.props(styles.thread)}
            aria-live="polite"
            onScroll={latest.onScroll}
            onScrollEnd={latest.onScrollEnd}
          >
            <AskSelectionQuote selection={selection} />
            <AskOutdatedNote threadId={threadId ?? savedThreadId ?? null} />

            {thread ? <AskTurns thread={thread} onDecide={decide} /> : null}

            {thread &&
            (thread.status === "running" ||
              (thread.status === "starting" && !connecting)) ? (
              <AskWorking
                key={
                  thread.entries.findLast((entry) => entry.kind === "user")?.id
                }
                thread={thread}
              />
            ) : null}

            {connecting && !thread?.entries.length ? (
              <div {...stylex.props(styles.loading)} role="status">
                <span {...stylex.props(styles.loadingLabel)}>
                  Loading the conversation from {agentName}…
                </span>
                <span {...stylex.props(styles.loadingLine)} />
                <span
                  {...stylex.props(styles.loadingLine, styles.loadingLineShort)}
                />
              </div>
            ) : null}

            {thread?.signIn && retry && !requestError ? (
              <AskSignIn
                agentName={agentName}
                command={thread.signIn}
                onRetry={retry}
              />
            ) : error ? (
              <p {...stylex.props(askPanelStyles.error)} role="alert">
                {error}
                {reconnect || retry || startOver ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      {...stylex.props(askPanelStyles.errorAction)}
                      onClick={reconnect ?? retry ?? startOver}
                    >
                      {reconnect
                        ? "Reconnect"
                        : retry
                          ? "Try again"
                          : "Start a new conversation"}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {latest.atLatest ? null : (
            <button
              type="button"
              {...stylex.props(surfaceStyles.popover, styles.toLatest)}
              aria-label="Scroll to the latest"
              title="Scroll to the latest"
              onClick={() => latest.jump()}
            >
              <AskArrowIcon
                xstyle={[askIconSizes.small, styles.toLatestIcon]}
              />
            </button>
          )}
        </div>
      </AskFilesProvider>

      <AskComposer
        inputRef={composer}
        placeholders={askPlaceholders(
          Boolean(threadId || savedThreadId),
          chosen?.name ?? "an agent",
          (thread?.commands ?? offered?.commands)?.length
            ? "/ for commands, @ for files"
            : "@ for files",
        )}
        disabled={thread?.status === "failed"}
        canAsk={Boolean(agent) && !busy}
        stop={busy && threadId ? stop : undefined}
        status={
          connecting
            ? // Without the saved copy, the thread itself says it is loading.
              thread?.entries.length
              ? `Connecting to ${agentName}…`
              : ""
            : composerStatus(thread, busy)
        }
        commands={thread?.commands ?? offered?.commands}
        acceptsImages={(thread?.accepts ?? offered?.accepts)?.image === true}
        usage={thread?.usage}
        findFiles={findFiles}
        permissions={permissions}
        settings={settings}
        onAsk={ask}
      />
    </div>
  );
}

/** What the question says before it is written, longest first: a narrow
 * panel or window drops the hint, then shortens the question. */
function askPlaceholders(
  followUp: boolean,
  agentName: string,
  hint: string,
): string[] {
  if (followUp) return [`Ask a follow-up · ${hint}`, "Ask a follow-up…"];

  const lead = `Ask ${agentName} about this selection`;

  return [`${lead} · ${hint}`, `${lead}…`, "Ask about this selection…"];
}

function composerStatus(thread: AskThreadState | null, busy: boolean) {
  if (thread?.status === "waiting") return "Waiting for your approval";

  // Nothing can be asked; the thread says what to do instead.
  if (thread?.status === "failed") return "";

  if (!busy) return "";

  const sinceQuestion = thread?.entries.slice(
    thread.entries.findLastIndex((entry) => entry.kind === "user") + 1,
  );

  const read =
    sinceQuestion?.filter(
      (entry) =>
        entry.kind === "tool" &&
        entry.toolKind === "read" &&
        entry.status === "completed",
    ).length ?? 0;

  return read
    ? `Answering · ${read} ${read === 1 ? "file" : "files"} read`
    : "Answering…";
}

/** The images sent with a question. Its files show as its @ mentions. */
function AskUserImages({
  entry,
}: {
  entry: Extract<AskEntry, { kind: "user" }>;
}): ReactElement | null {
  const names = (entry.attachments ?? []).flatMap((attachment) =>
    attachment.kind === "image" ? [attachment.name] : [],
  );

  if (!names.length) return null;

  return (
    <span {...stylex.props(styles.attachments)}>
      {names.map((name, index) => (
        // An image's name can repeat.
        <span key={index} {...stylex.props(styles.attachment)} title={name}>
          <AskImageIcon xstyle={askIconSizes.small} />
          {name}
        </span>
      ))}
    </span>
  );
}

/** The conversation so far. It changes only with the thread, so typing a
 * question does not render every answer again. */
const AskTurns = memo(function AskTurns({
  thread,
  onDecide,
}: {
  thread: AskThreadState;
  onDecide: (permissionId: string, optionId: string) => void;
}): ReactElement {
  return (
    <>
      {turns(thread.entries).map((turn) =>
        turn.kind === "user" ? (
          <AgentChatUserMessage
            key={turn.entry.id}
            xstyle={styles.userMessage}
            bubbleXstyle={styles.userBubble}
            caption={
              turn.entry.at === undefined
                ? "You"
                : `You · ${formatRelativeTime(new Date(turn.entry.at).toISOString())}`
            }
          >
            {turn.entry.text}
            <AskUserImages entry={turn.entry} />
          </AgentChatUserMessage>
        ) : (
          <AskAgentTurn
            key={turn.entries[0]!.id}
            thread={thread}
            entries={turn.entries}
            renderPermission={(entry) => (
              <AskPermission
                entry={entry}
                thread={thread}
                onDecide={onDecide}
              />
            )}
          />
        ),
      )}
    </>
  );
});

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const loadingSweep = stylex.keyframes({
  from: { backgroundPosition: "100% 0" },
  to: { backgroundPosition: "-100% 0" },
});

// Raised off the panel's tray in either theme; --surface-raised is the
// workbench's widget color, which matches the tray in light themes.
const offTray = `color-mix(in srgb, ${tokens.ink} 6%, ${tokens.tray})`;

const hairline = {
  borderWidth: "1px",
  borderStyle: "solid",
} as const;

// Ask: one conversation with a local agent about a selection. The thread
// scrolls; the composer stays at the bottom.
const styles = stylex.create({
  agentBar: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: "8px",
    padding: "12px 16px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
  },
  // The commit the agent reads, at the bar's end.
  head: {
    marginLeft: "auto",
  },
  // Level with the pickers beside it.
  settingsLabel: {
    padding: "4px 6px",
    fontSize: fontSize.ui,
    lineHeight: "16px",
  },
  mode: {
    display: "inline-flex",
    flex: "0 1 auto",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    whiteSpace: "nowrap",
  },
  // Holds the thread and, over its foot, the way back to the newest.
  threadFrame: {
    position: "relative",
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minHeight: 0,
  },
  toLatest: {
    position: "absolute",
    bottom: "12px",
    left: "50%",
    display: "grid",
    placeItems: "center",
    width: "28px",
    height: "28px",
    padding: 0,
    borderRadius: radius.round,
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
    cursor: "pointer",
    transform: "translateX(-50%)",
  },
  toLatestIcon: {
    transform: "rotate(180deg)",
  },
  thread: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    gap: "18px",
    minHeight: 0,
    padding: "20px 16px 16px",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  userMessage: {
    maxWidth: "88%",
    marginTop: 0,
  },
  userBubble: {
    padding: "10px 14px",
    backgroundColor: offTray,
  },
  loading: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "4px 0",
  },
  loadingLabel: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  loadingLine: {
    height: "12px",
    borderRadius: radius.small,
    backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${tokens.ink} 5%, transparent) 0%, color-mix(in srgb, ${tokens.ink} 10%, transparent) 50%, color-mix(in srgb, ${tokens.ink} 5%, transparent) 100%)`,
    backgroundSize: "200% 100%",
    animationName: { default: loadingSweep, [reducedMotion]: "none" },
    animationDuration: motion.pulse,
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  loadingLineShort: {
    width: "62%",
  },
  attachments: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "8px",
  },
  attachment: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    maxWidth: "100%",
    padding: "2px 6px",
    overflow: "hidden",
    ...hairline,
    borderColor: tokens.ruleSoft,
    borderRadius: radius.small,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
