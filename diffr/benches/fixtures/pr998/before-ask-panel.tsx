import type { AgentSelection } from "@review/agent-selection";
import {
  type AskAgentId,
  type AskChoiceKind,
  type AskEntry,
  type AskPicks,
  type AskQuestion,
  type AskThreadState,
  askChoiceKinds,
  askThreadStateSchema,
} from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactElement,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
import { AskSelectionQuote } from "./ask-panel-shared";
import { AskPermission } from "./ask-permission";
import { AskSetup, AskSignIn } from "./ask-setup";
import { askPanelStyles } from "./ask-styles";
import { useLatest, useThread } from "./ask-thread-stream";
import { AskAgentTurn, AskWorking, turns } from "./ask-turn";
import { canvasQueryKeys } from "./canvas-query";
import { controlStyles } from "./controls-styles";
import { useReviewSession } from "./host/review-session";
import { ArrowUpIcon, ImageIcon, LockIcon } from "./icons";
import { formatRelativeTime } from "./review-home-view";
import { useAskKey, useOptionalReviewPanelStore } from "./review-panel";
import type { AskPresence, AskReport } from "./review-panel-model";
import { fontSize, radius } from "./scale.stylex";
import type { StyleArg } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { IconButton } from "./ui/button";
import { Chip } from "./ui/chip";
import { StatusBanner } from "./ui/status-banner";
import { surfaceStyles } from "./ui/surface";
import { useFollowLatest } from "./use-follow-latest";
import { useTooltip } from "./use-tooltip";

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
  onReport,
  header,
}: {
  selection: AgentSelection;
  agent?: AskAgentId;
  header?: HTMLElement | null;
  /** A saved conversation to reopen instead of asking a new question. */
  savedThreadId?: string;
  /** What the conversation is doing, for the pill to say while it is out
   * of sight and for closing to warn while its agent works. */
  onReport?: (report: AskReport) => void;
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

  const loadingConversation =
    savedThreadId !== undefined &&
    !requestError &&
    !lost &&
    (!thread || (thread.status === "starting" && !thread.entries.length));

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
  const askKey = useAskKey();

  useEffect(() => {
    if (agents && !agent) setAgent(preferredAskAgent(session, agents)?.id);
  }, [agents, agent, session]);

  const latestSession = useLatest(session);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  // A thread opened after the panel closed has nobody to close it.
  const closeLate = useCallback(
    (id: string) =>
      void latestSession.current
        .fetch(`/ask/${id}/close`, { method: "POST", keepalive: true })
        .catch(() => {}),
    [latestSession],
  );

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
        if (!current) {
          if (response.ok && !mounted.current) closeLate(savedThreadId);

          return;
        }

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
  }, [latestSession, savedThreadId, requestedAgent, closeLate]);

  useEffect(() => composer.current?.focus(), [agent, loadingConversation]);

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

        if (!mounted.current) {
          closeLate(id);

          return false;
        }

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
          panels.getState().openAskView(
            {
              type: "saved",
              threadId,
              selection,
              agent: thread?.agent ?? agent ?? "claude",
            },
            { from: askKey, replace: true },
          )
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
      ? () =>
          panels.getState().openAsk(selection, thread?.agent ?? agent, {
            from: askKey,
            replace: true,
          })
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
                ? answeringStatus(thread)
                : thread
                  ? "Answered"
                  : "New question",
            tone: "quiet",
          };

  const presenceAgent = thread?.agent ?? agent;
  const reportedThreadId = threadId ?? savedThreadId ?? null;

  // Reopening a saved conversation loses nothing if it stops; an answer
  // under way does.
  const working =
    sending ||
    thread?.status === "running" ||
    thread?.status === "waiting" ||
    (thread?.status === "starting" && !connecting);

  useEffect(() => {
    onReport?.({
      threadId: reportedThreadId,
      busy: working,
      presence: {
        agent: presenceAgent,
        agentName: presence.agentName,
        status: presence.status,
        tone: presence.tone,
      },
    });
  }, [
    onReport,
    reportedThreadId,
    working,
    presenceAgent,
    presence.agentName,
    presence.status,
    presence.tone,
  ]);

  if (agents && !agents.some((candidate) => candidate.available))
    return <AskSetup agents={agents} selection={selection} />;

  if (loadingConversation)
    return <div {...stylex.props(askPanelStyles.body)} aria-busy="true" />;

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
  const canBypass = chosen?.bypass && (thread || savedThreadId === undefined);

  const permissions = canBypass ? (
    <AskChoicePicker
      label="Permissions"
      select={permissionsSelect(bypass)}
      current={bypass ? "bypass" : "ask"}
      disabled={settingsDisabled}
      quiet
      icon={readOnly ? <LockIcon xstyle={controlStyles.inlineIcon} /> : null}
      onPick={(value) => permit(value === "bypass")}
    />
  ) : (
    <TooltipLabel
      tooltip={modeTitle}
      xstyle={[styles.mode, styles.settingsLabel]}
    >
      {readOnly ? (
        <>
          <LockIcon xstyle={controlStyles.inlineIcon} />
          Read-only
        </>
      ) : (
        "Not read-only"
      )}
    </TooltipLabel>
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

  const agentPicker = (
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
  );

  return (
    <div {...stylex.props(askPanelStyles.body)}>
      {header ? createPortal(agentPicker, header) : agentPicker}

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
            <ToLatestButton onClick={() => latest.jump()} />
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
        connecting={thread?.status === "starting"}
        status={
          connecting
            ? // Without the saved copy, the thread itself says it is loading.
              thread?.entries.length
              ? `Connecting to ${agentName}…`
              : ""
            : // The thread itself says what the agent is doing while it answers.
              thread?.status === "waiting"
              ? "Waiting for your approval"
              : ""
        }
        commands={thread?.commands ?? offered?.commands}
        acceptsImages={(thread?.accepts ?? offered?.accepts)?.image === true}
        findFiles={findFiles}
        permissions={permissions}
        onCyclePermissions={
          canBypass && !settingsDisabled ? () => permit(!bypass) : undefined
        }
        settings={settings}
        onAsk={ask}
        usage={thread?.usage}
      />
    </div>
  );
}

/** A saved conversation whose checkout is gone, read-only. */
export function AskReadOnlyThread({
  selection,
  threadId,
  onReport,
}: {
  selection: AgentSelection;
  threadId: string;
  onReport?: (report: AskReport) => void;
}): ReactElement {
  const session = useReviewSession();

  const { data: thread, error } = useQuery({
    queryKey: canvasQueryKeys.askThread(threadId),
    queryFn: async () => {
      const response = await session.fetch(`/ask/${threadId}`);

      if (!response.ok)
        throw new Error(
          (await readError(response)) ??
            "Whiteboard could not load this conversation.",
        );

      return askThreadStateSchema.parse(await response.json());
    },
  });

  useShowOpenThread(threadId);

  const agentName = thread?.agentName ?? "Ask";

  // Nothing runs on a read-only conversation, and it opens no thread to
  // close.
  useEffect(() => {
    onReport?.({
      threadId: null,
      busy: false,
      presence: {
        agent: thread?.agent,
        agentName,
        status: "Read-only",
        tone: "quiet",
      },
    });
  }, [onReport, thread?.agent, agentName]);

  return (
    <div {...stylex.props(askPanelStyles.body)}>
      <div {...stylex.props(styles.thread)}>
        <AskSelectionQuote selection={selection} />
        {thread ? <AskTurns thread={thread} onDecide={() => {}} /> : null}
        {error ? (
          <p {...stylex.props(askPanelStyles.error)} role="alert">
            {error.message}
          </p>
        ) : null}
      </div>
      <StatusBanner xstyle={styles.readOnlyBanner}>
        Read-only history
      </StatusBanner>
    </div>
  );
}

function ToLatestButton({ onClick }: { onClick: () => void }): ReactElement {
  const label = "Scroll to the latest";

  return (
    <IconButton
      ref={useTooltip(label)}
      size="large"
      xstyle={[surfaceStyles.popover, styles.toLatest]}
      aria-label={label}
      onClick={onClick}
    >
      <ArrowUpIcon xstyle={[controlStyles.chromeIcon, styles.toLatestIcon]} />
    </IconButton>
  );
}

function TooltipLabel({
  tooltip,
  xstyle,
  children,
}: {
  tooltip: string;
  xstyle: StyleArg;
  children: ReactNode;
}): ReactElement {
  return (
    <span ref={useTooltip<HTMLSpanElement>(tooltip)} {...stylex.props(xstyle)}>
      {children}
    </span>
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

/** What a busy agent is doing, for where the thread is out of sight. */
function answeringStatus(thread: AskThreadState | null) {
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
        <AskImageChip key={index} name={name} />
      ))}
    </span>
  );
}

function AskImageChip({ name }: { name: string }): ReactElement {
  return (
    <Chip
      ref={useTooltip<HTMLSpanElement>(name)}
      variant="pill"
      xstyle={styles.attachment}
    >
      <ImageIcon xstyle={controlStyles.inlineIcon} />
      {name}
    </Chip>
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

// Ask: one conversation with a local agent about a selection. The thread
// scrolls; the composer stays at the bottom.
const styles = stylex.create({
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
    borderRadius: radius.round,
    color: {
      default: tokens.chromeIconFg,
      ":hover": tokens.chromeFg,
      ":focus-visible": tokens.chromeFg,
    },
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
  readOnlyBanner: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.ruleSoft,
    borderBottomWidth: 0,
  },
  userMessage: {
    maxWidth: "88%",
    marginTop: 0,
  },
  userBubble: {
    padding: "10px 14px",
    backgroundColor: tokens.trayRaised,
  },
  attachments: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "8px",
  },
  // Outlined: the pill's well would vanish on the bubble.
  attachment: {
    gap: "4px",
    maxWidth: "100%",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    backgroundColor: tokens.transparent,
    fontFamily: tokens.fontMono,
    textOverflow: "ellipsis",
  },
});
