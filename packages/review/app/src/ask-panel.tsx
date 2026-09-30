import type { AgentSelection } from "@review/agent-selection";
import {
  type AskAgentId,
  type AskChoiceKind,
  type AskChoices,
  type AskEntry,
  type AskPicks,
  type AskSelect,
  type AskThreadState,
  applyAskChange,
  askAgentIds,
  askChoiceKinds,
  askChoicesSchema,
  askUpdateSchema,
} from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { AgentChatUserMessage } from "./agent-chat";
import { ClaudeCodeLogo, CodexLogo } from "./agent-logos";
import { AskDeleteButton, useShowOpenThread } from "./ask-delete";
import { useAskHistory } from "./ask-history";
import {
  AskArrowIcon,
  AskCheckIcon,
  AskChevronIcon,
  AskCopyIcon,
  AskHistoryIcon,
  AskIcon,
  AskLockIcon,
  askIconSizes,
} from "./ask-icons";
import { AskAgentTurn, AskWorking, permissionSubject, turns } from "./ask-turn";
import { controlStyles } from "./controls-styles";
import { copyAgentContext } from "./copy-agent-context";
import { CopyButton } from "./copy-text";
import { type ReviewSession, useReviewSession } from "./host/review-session";
import { formatRelativeTime } from "./review-home-view";
import { useOptionalReviewPanelStore } from "./review-panel";
import type { AskView } from "./review-panel-model";
import {
  fontSize,
  fontWeight,
  layer,
  motion,
  radius,
  tracking,
} from "./scale.stylex";
import { shellStyles } from "./shell-styles";
import { useToast } from "./toast";
import { tokens } from "./tokens.stylex";
import { IconButton } from "./ui/button";
import { Chip } from "./ui/chip";
import { surfaceStyles } from "./ui/surface";
import { textStyles } from "./ui/text";
import { useFollowLatest } from "./use-follow-latest";

const agentsSchema = z.object({
  agents: z.array(
    z.object({
      id: z.enum(askAgentIds),
      name: z.string(),
      available: z.boolean(),
    }),
  ),
});

export type AskAgent = z.infer<typeof agentsSchema>["agents"][number];

const logos: Record<
  AskAgentId,
  (props: { xstyle?: stylex.StyleXStyles }) => ReactElement
> = {
  claude: ClaudeCodeLogo,
  codex: CodexLogo,
};

const agentsBySession = new WeakMap<
  ReviewSession,
  Promise<AskAgent[] | null>
>();

/** Which local agents can answer, or null where this host has no Ask. Read
 * once per canvas session: installing an agent means reopening the review. */
export function useAskAgents(session: ReviewSession | null): AskAgent[] | null {
  const [agents, setAgents] = useState<AskAgent[] | null>(null);

  useEffect(() => {
    if (!session) return;
    let current = true;

    let request = agentsBySession.get(session);

    if (!request) {
      request = session
        .fetch("/ask/agents")
        .then(async (response) =>
          response.ok ? agentsSchema.parse(await response.json()).agents : null,
        )
        .catch(() => null);
      agentsBySession.set(session, request);
    }

    void request.then((value) => {
      if (current) setAgents(value);
    });

    return () => {
      current = false;
    };
  }, [session]);

  return agents;
}

const offeredSchema = z.object({ choices: askChoicesSchema });

/** What the agent offers to choose, for a question not yet asked. Asked
 * again each time: a conversation can teach the server something newer. */
function useOfferedChoices(
  session: ReviewSession,
  agent: AskAgentId | undefined,
  wanted: boolean,
): AskChoices | undefined {
  const [offered, setOffered] = useState<{
    agent: AskAgentId;
    choices: AskChoices;
  }>();

  useEffect(() => {
    if (!agent || !wanted) return;
    let current = true;

    void session
      .fetch(`/ask/agents/${agent}/choices`)
      .then(async (response) => {
        if (!response.ok) return;
        const { choices } = offeredSchema.parse(await response.json());

        if (current) setOffered({ agent, choices });
      })
      // Without them the agent answers with its own defaults.
      .catch(() => {});

    return () => {
      current = false;
    };
  }, [session, agent, wanted]);

  return offered && offered.agent === agent ? offered.choices : undefined;
}

const preferredAgentKey = (session: ReviewSession) =>
  session.storageKey("ask-agent");

/** The installed agent the reviewer asked last, else the first installed. */
export function preferredAskAgent(
  session: ReviewSession,
  agents: AskAgent[],
): AskAgent | undefined {
  let stored: string | null = null;

  try {
    stored = localStorage.getItem(preferredAgentKey(session));
  } catch {
    /* Storage can be unavailable; fall back to the first installed agent. */
  }

  return (
    agents.find((agent) => agent.available && agent.id === stored) ??
    agents.find((agent) => agent.available)
  );
}

export function rememberAskAgent(session: ReviewSession, agent: AskAgentId) {
  try {
    localStorage.setItem(preferredAgentKey(session), agent);
  } catch {
    /* The choice is a convenience; forgetting it is harmless. */
  }
}

const choiceKey = (
  session: ReviewSession,
  agent: AskAgentId,
  kind: AskChoiceKind,
) => session.storageKey(`ask-${kind}-${agent}`);

/** The model or effort the reviewer chose last for this agent. */
function storedChoice(
  session: ReviewSession,
  agent: AskAgentId,
  kind: AskChoiceKind,
) {
  try {
    return localStorage.getItem(choiceKey(session, agent, kind)) ?? undefined;
  } catch {
    /* Storage can be unavailable; the agent's own default applies. */
    return undefined;
  }
}

function rememberChoice(
  session: ReviewSession,
  agent: AskAgentId,
  kind: AskChoiceKind,
  value: string,
) {
  try {
    localStorage.setItem(choiceKey(session, agent, kind), value);
  } catch {
    /* The choice is a convenience; forgetting it is harmless. */
  }
}

/** Everything chosen last for this agent. The agent keeps its own default
 * for a choice it no longer offers. */
function storedPicks(session: ReviewSession, agent: AskAgentId): AskPicks {
  const picks: AskPicks = {};

  for (const kind of askChoiceKinds) {
    const value = storedChoice(session, agent, kind);

    if (value) picks[kind] = value;
  }

  return picks;
}

const choiceLabels = new Map<AskChoiceKind, string>([
  ["model", "Model"],
  ["effort", "Effort"],
]);

/** "Answer with": every agent Ask knows, with the uninstalled ones disabled.
 * Closes on a pointer down outside `within` or on Escape. */
export function AskAgentMenu({
  agents,
  current,
  within,
  autoFocus = false,
  onPick,
  onDismiss,
}: {
  agents: AskAgent[];
  current: AskAgentId | undefined;
  within: RefObject<HTMLElement | null>;
  autoFocus?: boolean;
  onPick: (agent: AskAgentId) => void;
  onDismiss: () => void;
}): ReactElement {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const inside = within.current ?? menu.current;

      if (!inside || !event.composedPath().includes(inside)) onDismiss();
    };

    window.addEventListener("pointerdown", dismiss, true);

    return () => window.removeEventListener("pointerdown", dismiss, true);
  }, [within, onDismiss]);

  useEffect(() => {
    if (!autoFocus) return;
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')
      ?.focus();
  }, [autoFocus]);

  return (
    <div
      ref={menu}
      role="menu"
      tabIndex={-1}
      aria-label="Answer with"
      {...stylex.props(surfaceStyles.popover, menuStyles.menu)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Escape closes the menu, not the panel behind it.
        event.stopPropagation();
        onDismiss();
      }}
    >
      <div
        {...stylex.props(textStyles.eyebrow, menuStyles.label)}
        aria-hidden="true"
      >
        Answer with
      </div>
      {agents.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          role="menuitemradio"
          aria-checked={candidate.id === current}
          {...stylex.props(
            menuStyles.item,
            candidate.id === current && menuStyles.itemChecked,
          )}
          disabled={!candidate.available}
          onClick={() => onPick(candidate.id)}
        >
          <span
            {...stylex.props(
              menuStyles.logo,
              !candidate.available && menuStyles.logoUnavailable,
            )}
          >
            {logos[candidate.id]({})}
          </span>
          <span {...stylex.props(menuStyles.name)}>{candidate.name}</span>
          <span {...stylex.props(menuStyles.trail)}>
            {candidate.id === current ? (
              <AskCheckIcon xstyle={menuStyles.check} />
            ) : candidate.available ? null : (
              "Not installed"
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

/** What the panel sends: a first question, a follow-up, or a decision. */
type AskRequest =
  | {
      agent: AskAgentId;
      question: string;
      selection: AgentSelection;
      picks: AskPicks;
    }
  | { question: string }
  | { kind: AskChoiceKind; value: string }
  | { permissionId: string; optionId: string }
  | Record<string, never>;

async function readError(response: Response) {
  const body = await response.json().catch(() => null);

  return z.object({ error: z.string() }).safeParse(body).data?.error;
}

/**
 * Reads one watch stream: a snapshot, then changes in `seq` order. Returns
 * "ended" when the server closes it, or "gap" when a change is missing and a
 * new stream has to start over from a snapshot.
 */
async function followThread(
  session: ReviewSession,
  threadId: string,
  signal: AbortSignal,
  onState: (state: AskThreadState) => void,
): Promise<"ended" | "gap"> {
  const response = await session.fetch(`/ask/${threadId}/watch`, { signal });

  if (!response.ok || !response.body) throw new Error("Unavailable");

  const lines = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let state: AskThreadState | null = null;
  let seq = 0;

  try {
    for (;;) {
      const { done, value } = await lines.read();

      if (done) return "ended";
      buffer += value;
      const complete = buffer.split("\n");
      buffer = complete.pop() ?? "";
      const before: AskThreadState | null = state;

      for (const line of complete) {
        if (!line.trim()) continue;
        const update = askUpdateSchema.parse(JSON.parse(line));

        if ("snapshot" in update) state = update.snapshot;
        else if (state && update.seq === seq + 1)
          state = applyAskChange(state, update.change);
        else return "gap";
        seq = update.seq;
      }

      // One render per read, however many changes it carried.
      if (state && state !== before) onState(state);
    }
  } finally {
    void lines.cancel().catch(() => {});
  }
}

/** Follows one thread until the panel lets go of it. */
function useThread(session: ReviewSession, threadId: string | null) {
  const [thread, setThread] = useState<AskThreadState | null>(null);
  const [lost, setLost] = useState(false);
  // Each new version of the review is a new session object; the agent
  // belongs to the panel, so only the panel closing ends it.
  const current = useLatest(session);

  useEffect(() => {
    if (!threadId) return;
    const session = current.current;
    const abort = new AbortController();

    setLost(false);

    // Set once the thread is gone from the server, which then has nothing
    // to close; a late close could end the same thread reopened.
    let gone = false;

    void (async () => {
      try {
        // A gap means this panel missed a change; a new stream resyncs it.
        // Give up if that keeps happening rather than reconnect forever.
        for (let resyncs = 0; resyncs <= 3; resyncs++) {
          const outcome = await followThread(
            session,
            threadId,
            abort.signal,
            setThread,
          );

          if (outcome === "ended") break;
        }
      } catch {
        /* An unreachable thread reads as a lost conversation below. */
      }

      if (abort.signal.aborted) return;
      gone = true;
      setLost(true);
    })();

    return () => {
      abort.abort();

      if (gone) return;
      // The agent process belongs to this panel; closing the panel ends it.
      // The conversation stays saved, to reopen from the history.
      void current.current
        .fetch(`/ask/${threadId}/close`, { method: "POST", keepalive: true })
        .catch(() => {});
    };
  }, [current, threadId]);

  // A thread the panel lost is not running any more, whatever it last said.
  return {
    thread: lost && thread ? { ...thread, status: "failed" as const } : thread,
    lost,
  };
}

/** The latest value, for effects that must not restart when it changes. */
function useLatest<Value>(value: Value) {
  const ref = useRef(value);

  ref.current = value;

  return ref;
}

function AskSelectionQuote({
  selection,
}: {
  selection: AgentSelection;
}): ReactElement {
  const target = selection.target;

  return (
    <figure {...stylex.props(styles.selection)}>
      <figcaption
        {...stylex.props(
          textStyles.eyebrow,
          styles.caps,
          styles.selectionCaption,
        )}
      >
        {target.kind === "text"
          ? "Selection"
          : `Selection · ${selection.title}`}
      </figcaption>
      <blockquote {...stylex.props(styles.selectionQuote)}>
        {target.kind === "text" ? target.quote : selection.title}
      </blockquote>
    </figure>
  );
}

export function AskPanelContent({
  selection,
  agent: requestedAgent,
  savedThreadId,
}: {
  selection: AgentSelection;
  agent?: AskAgentId;
  /** A saved conversation to reopen instead of asking a new question. */
  savedThreadId?: string;
}): ReactElement {
  const session = useReviewSession();
  const agents = useAskAgents(session);
  const [agent, setAgent] = useState<AskAgentId | undefined>(requestedAgent);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Choices for a question not yet asked; a thread says its own.
  const [picks, setPicks] = useState<AskPicks>({});
  const { thread, lost } = useThread(session, threadId);

  useShowOpenThread(threadId ?? savedThreadId ?? null);

  const offered = useOfferedChoices(
    session,
    agent,
    threadId === null && savedThreadId === undefined,
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
  const refreshHistory = useAskHistory()?.refresh;
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

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const question = draft.trim();

    if (!question || !agent || busy || thread?.status === "failed") return;
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
        });

        const { threadId: id } = z
          .object({ threadId: z.string() })
          .parse(await response.json());

        rememberAskAgent(session, agent);
        setThreadId(id);
      }

      setDraft("");
      // Asking returns to the newest, where the answer will be.
      latest.jump("instant");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  const keydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

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
  const choices = thread?.choices ?? offered;

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

  const chosenName = chosen?.name ?? "the agent";

  const error =
    requestError ??
    thread?.error ??
    (lost
      ? `Whiteboard lost its connection to ${thread?.agentName ?? chosenName}.`
      : null);

  // The conversation is saved, so a lost one reopens where it stopped.
  const reconnect =
    lost && threadId && panels
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

  // Reopening starts the agent and loads its session. Whiteboard's saved
  // copy shows meanwhile; one saved before that copy waits for the replay.
  const connecting =
    savedThreadId !== undefined &&
    !requestError &&
    (!thread || thread.status === "starting");

  const agentName = thread?.agentName ?? chosenName;

  return (
    <div {...stylex.props(styles.body)}>
      <div {...stylex.props(styles.agentBar)}>
        <AskAgentPicker
          agents={agents}
          agent={agent}
          locked={threadId !== null || savedThreadId !== undefined}
          onPick={(picked) => {
            setAgent(picked);
            setPicks({});
          }}
        />
        {askChoiceKinds.map((kind) => {
          const select = choices?.[kind];
          const current = currentChoice(kind);

          return select && current ? (
            <AskChoicePicker
              key={kind}
              label={choiceLabels.get(kind) ?? kind}
              select={select}
              current={current}
              disabled={busy && threadId !== null}
              onPick={(value) => choose(kind, value)}
            />
          ) : null;
        })}
        <span
          {...stylex.props(styles.mode)}
          title={
            !thread || thread.readOnly
              ? "The agent cannot change files in the checkout, and asks before running commands. It can edit this review."
              : "This agent has no mode that asks first; Whiteboard still refuses file changes."
          }
        >
          <AskLockIcon />
          {!thread || thread.readOnly ? "Read-only" : "No changes"}
          {thread ? ` · ${thread.head.slice(0, 7)}` : null}
        </span>
      </div>

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
            <p {...stylex.props(styles.error)} role="alert">
              {error}
              {reconnect || retry ? (
                <>
                  {" "}
                  <button
                    type="button"
                    {...stylex.props(styles.errorAction)}
                    onClick={reconnect ?? retry}
                  >
                    {reconnect ? "Reconnect" : "Try again"}
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
            <AskArrowIcon xstyle={[askIconSizes.small, styles.toLatestIcon]} />
          </button>
        )}
      </div>

      <form
        {...stylex.props(styles.composer)}
        onSubmit={(event) => void submit(event)}
      >
        <textarea
          ref={composer}
          {...stylex.props(styles.question)}
          value={draft}
          rows={2}
          placeholder={
            threadId || savedThreadId
              ? "Ask a follow-up…"
              : `Ask ${chosen?.name ?? "an agent"} about this selection…`
          }
          aria-label="Question"
          disabled={thread?.status === "failed"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keydown}
        />
        <div {...stylex.props(styles.composerFooter)}>
          <span>
            {connecting
              ? thread?.entries.length
                ? `Connecting to ${agentName}…`
                : "Loading the conversation…"
              : composerStatus(thread, busy)}
          </span>
          {busy && threadId && !connecting ? (
            <button
              type="button"
              {...stylex.props(styles.send, styles.stop)}
              onClick={stop}
            >
              <span aria-hidden="true" {...stylex.props(styles.stopMark)} />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              {...stylex.props(styles.send, styles.submit)}
              disabled={!draft.trim() || !agent || busy}
            >
              Ask
              <AskArrowIcon xstyle={[askIconSizes.small, styles.submitIcon]} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function composerStatus(thread: AskThreadState | null, busy: boolean) {
  if (thread?.status === "waiting") return "Waiting for your approval";

  if (!busy) return "↵ to ask · ⇧↵ new line";

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

function AskAgentPicker({
  agents,
  agent,
  locked,
  onPick,
}: {
  agents: AskAgent[] | null;
  agent: AskAgentId | undefined;
  locked: boolean;
  onPick: (agent: AskAgentId) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => setOpen(false), []);
  const chosen = agents?.find((candidate) => candidate.id === agent);

  return (
    <div ref={anchor} {...stylex.props(pickerStyles.anchor)}>
      <button
        type="button"
        {...stylex.props(pickerStyles.picker, open && pickerStyles.open)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!agents || locked}
        title={locked ? "Each conversation stays with one agent." : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {agent ? logos[agent]({}) : null}
        <span>{chosen?.name ?? "Choose an agent"}</span>
        {locked ? null : <AskChevronIcon xstyle={pickerStyles.chevron} />}
      </button>
      {open && agents ? (
        <AskAgentMenu
          agents={agents}
          current={agent}
          within={anchor}
          autoFocus
          onPick={(picked) => {
            onPick(picked);
            setOpen(false);
          }}
          onDismiss={dismiss}
        />
      ) : null}
    </div>
  );
}

/** One of the agent's settings, a model or an effort; the choice holds
 * from the next answer. */
function AskChoicePicker({
  label,
  select,
  current,
  disabled,
  onPick,
}: {
  label: string;
  select: AskSelect;
  current: string;
  disabled: boolean;
  onPick: (value: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => setOpen(false), []);
  const chosen = select.options.find((option) => option.value === current);

  useEffect(() => {
    if (!open) return;

    const outside = (event: PointerEvent) => {
      if (anchor.current && !event.composedPath().includes(anchor.current))
        dismiss();
    };

    window.addEventListener("pointerdown", outside, true);
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')
      ?.focus();

    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open, dismiss]);

  return (
    <div ref={anchor} {...stylex.props(pickerStyles.anchor)}>
      <button
        type="button"
        {...stylex.props(
          pickerStyles.picker,
          pickerStyles.choice,
          open && pickerStyles.open,
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${chosen?.name ?? current}`}
        title={
          disabled ? `${label} can change once the agent finishes.` : label
        }
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span {...stylex.props(pickerStyles.choiceName)}>
          {chosen?.name ?? current}
        </span>
        <AskChevronIcon xstyle={pickerStyles.chevron} />
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          {...stylex.props(
            surfaceStyles.popover,
            menuStyles.menu,
            menuStyles.choices,
          )}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Escape closes the menu, not the panel behind it.
            event.stopPropagation();
            dismiss();
          }}
        >
          <div
            {...stylex.props(textStyles.eyebrow, menuStyles.label)}
            aria-hidden="true"
          >
            {label}
          </div>
          {select.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === current}
              {...stylex.props(
                menuStyles.item,
                option.value === current && menuStyles.itemChecked,
              )}
              onClick={() => {
                dismiss();

                if (option.value !== current) onPick(option.value);
              }}
            >
              <span {...stylex.props(menuStyles.choiceText)}>
                <span {...stylex.props(menuStyles.name)}>{option.name}</span>
                {option.description ? (
                  <span {...stylex.props(menuStyles.description)}>
                    {option.description}
                  </span>
                ) : null}
              </span>
              <span {...stylex.props(menuStyles.trail)}>
                {option.value === current ? (
                  <AskCheckIcon xstyle={menuStyles.check} />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const actions = new Map([
  ["execute", "run a command"],
  ["read", "read a file"],
  ["edit", "edit a file"],
  ["fetch", "fetch a page"],
  ["search", "search"],
]);

const optionLabels = {
  allow_once: "Allow once",
  allow_always: "Allow for thread",
  reject_once: "Deny",
  reject_always: "Always deny",
} as const;

const optionOrder = Object.keys(optionLabels);

/** The last two folders of the checkout, which is enough to recognize it. */
function shortPath(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);

  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
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

function AskPermission({
  entry,
  thread,
  onDecide,
}: {
  entry: Extract<AskEntry, { kind: "permission" }>;
  thread: AskThreadState;
  onDecide: (permissionId: string, optionId: string) => void;
}): ReactElement {
  const command = entry.toolKind === "execute";

  const options = entry.options.toSorted(
    (left, right) =>
      optionOrder.indexOf(left.kind) - optionOrder.indexOf(right.kind),
  );

  // Two options of one kind differ in what the agent does next, which only
  // its own names say.
  const named = options.some(
    (option, index) =>
      options.findIndex((other) => other.kind === option.kind) !== index,
  );

  return (
    <section
      {...stylex.props(permissionStyles.card)}
      aria-label="Permission request"
    >
      <div {...stylex.props(permissionStyles.copy)}>
        <h3 {...stylex.props(textStyles.eyebrow, permissionStyles.heading)}>
          {thread.agentName} wants to{" "}
          {actions.get(entry.toolKind) ?? "use a tool"}
        </h3>
        <p {...stylex.props(permissionStyles.text)}>
          Whiteboard keeps this session read-only, so{" "}
          {command ? "commands need" : "this needs"} your OK.
        </p>
      </div>
      <div {...stylex.props(permissionStyles.target)}>
        <code {...stylex.props(permissionStyles.targetCode)}>
          {command ? "$ " : null}
          {permissionSubject(entry, thread.cwd)}
        </code>
        <span
          {...stylex.props(permissionStyles.targetPlace)}
          title={thread.cwd}
        >
          in {shortPath(thread.cwd)}@{thread.head.slice(0, 7)}
        </span>
      </div>
      <div {...stylex.props(permissionStyles.options)}>
        {options.map((option, index) => (
          <button
            key={option.optionId}
            type="button"
            title={option.name}
            {...stylex.props(
              permissionStyles.option,
              option.kind === "allow_once" && permissionStyles.allowOnce,
              option.kind.startsWith("reject") && permissionStyles.reject,
              // Denials sit apart, at the far end.
              option.kind.startsWith("reject") &&
                options[index - 1]?.kind.startsWith("allow") &&
                permissionStyles.apart,
            )}
            onClick={() => onDecide(entry.id, option.optionId)}
          >
            {named ? option.name : optionLabels[option.kind]}
          </button>
        ))}
      </div>
    </section>
  );
}

function AskSetup({
  agents,
  selection,
}: {
  agents: AskAgent[];
  selection: AgentSelection;
}): ReactElement {
  const session = useReviewSession();
  const { toast, showToast } = useToast(4_000);

  const copy = async () => {
    try {
      await copyAgentContext(session, selection);
      showToast({
        kind: "success",
        text: "Selection copied to clipboard. Paste into your agent to chat about it.",
      });
    } catch {
      showToast({
        kind: "error",
        text: "Could not copy selection. Please try again.",
      });
    }
  };

  return (
    <div {...stylex.props(styles.body)}>
      <div {...stylex.props(styles.page, setupStyles.page)}>
        <AskSelectionQuote selection={selection} />
        <div {...stylex.props(setupStyles.message)}>
          <h3 {...stylex.props(setupStyles.heading)}>
            No agent is ready to answer
          </h3>
          <p {...stylex.props(setupStyles.text)}>
            Whiteboard runs a coding agent on your machine, against the pinned
            checkout. Install one and sign in to it once in a terminal, then
            reopen this review.
          </p>
        </div>
        <ul {...stylex.props(styles.list)}>
          {agents.map((candidate) => (
            <li
              key={candidate.id}
              {...stylex.props(styles.listItem, setupStyles.agent)}
            >
              <span {...stylex.props(setupStyles.logo)}>
                {logos[candidate.id]({ xstyle: setupStyles.logoMark })}
              </span>
              <span {...stylex.props(setupStyles.name)}>
                <span>{candidate.name}</span>
                <span {...stylex.props(setupStyles.status)}>Not installed</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div {...stylex.props(setupStyles.fallback)}>
        <span>Or take the selection to an agent yourself</span>
        <button
          type="button"
          {...stylex.props(setupStyles.copy)}
          onClick={() => void copy()}
        >
          <AskCopyIcon xstyle={[askIconSizes.toolbar, setupStyles.copyIcon]} />
          Copy selection for your agent
        </button>
      </div>
      {toast}
    </div>
  );
}

/** Opens the list of this review's saved conversations. */
function useOpenAskHistory() {
  const panels = useOptionalReviewPanelStore();

  return panels
    ? () => panels.getState().openAskView({ type: "history" })
    : undefined;
}

/** The agent's login lapsed: how to sign it in again, and a way to carry on
 * once it is. */
function AskSignIn({
  agentName,
  command,
  onRetry,
}: {
  agentName: string;
  command: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <section
      {...stylex.props(signInStyles.card)}
      role="alert"
      aria-label="Sign in"
    >
      <p {...stylex.props(signInStyles.text)}>
        {agentName} is signed out. Sign in again in a terminal, then try again;
        the question is still here.
      </p>
      <div {...stylex.props(signInStyles.command)}>
        <code {...stylex.props(signInStyles.code)}>$ {command}</code>
        <CopyButton
          text={command}
          label="Copy the sign-in command"
          iconStyle={signInStyles.copyIcon}
        />
      </div>
      <button
        type="button"
        {...stylex.props(signInStyles.retry)}
        onClick={onRetry}
      >
        Try again
      </button>
    </section>
  );
}

function OutdatedTag({
  xstyle,
}: {
  xstyle?: stylex.StyleXStyles;
}): ReactElement {
  return <Chip xstyle={[styles.outdatedTag, xstyle]}>Outdated</Chip>;
}

/** A conversation whose passage changed in the version on screen. */
function AskOutdatedNote({
  threadId,
}: {
  threadId: string | null;
}): ReactElement | null {
  const history = useAskHistory();

  if (threadId === null || !history?.outdated.has(threadId)) return null;

  return (
    <p {...stylex.props(styles.outdated)}>
      <OutdatedTag />
      <span>The passage changed in this version of the review.</span>
    </p>
  );
}

/** The Ask panel's header button for its history. */
export function AskHistoryButton({ view }: { view: AskView }): ReactElement {
  const openHistory = useOpenAskHistory();

  return (
    <IconButton
      size="large"
      xstyle={view.type === "history" && styles.historyButtonOn}
      aria-label="Saved conversations"
      title="Saved conversations"
      aria-pressed={view.type === "history"}
      disabled={!openHistory || view.type === "history"}
      onClick={openHistory}
    >
      <AskHistoryIcon xstyle={[controlStyles.inertIcon, askIconSizes.header]} />
    </IconButton>
  );
}

/** The review toolbar's way back to saved conversations, where Ask runs. */
export function AskHistoryControl(): ReactElement | null {
  const session = useReviewSession();
  const openHistory = useOpenAskHistory();
  const agents = useAskAgents(openHistory ? session : null);

  if (!openHistory || !agents) return null;

  return (
    <IconButton
      xstyle={shellStyles.topbarItem}
      aria-label="Ask conversations"
      title="Ask conversations"
      onClick={openHistory}
    >
      <AskIcon xstyle={[controlStyles.chromeIcon, askIconSizes.chrome]} />
    </IconButton>
  );
}

/** This review's saved conversations, newest first. */
export function AskHistoryList(): ReactElement {
  const history = useAskHistory();
  const panels = useOptionalReviewPanelStore();
  const entries = history?.entries ?? null;

  const error = history
    ? history.error
    : "Saved conversations are not available here.";

  const refresh = history?.refresh;

  // The list may be older than a conversation this panel just had.
  useEffect(() => refresh?.(), [refresh]);

  return (
    <div {...stylex.props(styles.body)}>
      <div {...stylex.props(styles.page)}>
        <h3
          {...stylex.props(
            textStyles.eyebrow,
            styles.caps,
            styles.historyHeading,
          )}
        >
          Saved conversations
        </h3>
        {error ? (
          <p {...stylex.props(styles.error)} role="alert">
            {error}
          </p>
        ) : null}
        {entries === null && !error ? (
          <p {...stylex.props(styles.historyEmpty)}>Loading…</p>
        ) : entries?.length === 0 ? (
          <p {...stylex.props(styles.historyEmpty)}>
            Nothing yet. Select text or code in the review and choose Ask; the
            conversation is saved here.
          </p>
        ) : (
          <ul {...stylex.props(styles.list)}>
            {entries?.map((entry) => {
              const target = entry.selection.target;

              return (
                <li
                  key={entry.id}
                  {...stylex.props(
                    stylex.defaultMarker(),
                    styles.listItem,
                    styles.historyRow,
                  )}
                >
                  <button
                    type="button"
                    {...stylex.props(styles.historyOpen)}
                    onClick={() =>
                      panels?.getState().openAskView({
                        type: "saved",
                        threadId: entry.id,
                        selection: entry.selection,
                        agent: entry.agent,
                      })
                    }
                  >
                    <span {...stylex.props(styles.historyLogo)}>
                      {logos[entry.agent]({})}
                    </span>
                    <span {...stylex.props(styles.historyText)}>
                      <span {...stylex.props(styles.historyTitle)}>
                        {entry.title}
                      </span>
                      <span {...stylex.props(styles.historyQuote)}>
                        {target.kind === "text"
                          ? target.quote
                          : entry.selection.title}
                      </span>
                      <span {...stylex.props(styles.historyMeta)}>
                        {formatRelativeTime(entry.updatedAt)} ·{" "}
                        {entry.head.slice(0, 7)}
                        {history?.outdated.has(entry.id) ? (
                          <OutdatedTag xstyle={styles.outdatedInline} />
                        ) : null}
                      </span>
                    </span>
                  </button>
                  <AskDeleteButton
                    xstyle={styles.historyForget}
                    label={`Delete “${entry.title}”`}
                    onDelete={() => void history?.forget(entry.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const loadingSweep = stylex.keyframes({
  from: { backgroundPosition: "100% 0" },
  to: { backgroundPosition: "-100% 0" },
});

// Raised off the panel's tray in either theme; --surface-raised is the
// workbench's widget color, which matches the tray in light themes.
const offTray = `color-mix(in srgb, ${tokens.ink} 6%, ${tokens.tray})`;

const noBorder = {
  borderWidth: 0,
  borderStyle: "none",
} as const;

const hairline = {
  borderWidth: "1px",
  borderStyle: "solid",
} as const;

// Ask: one conversation with a local agent about a selection. The thread
// scrolls; the composer stays at the bottom.
const styles = stylex.create({
  body: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minHeight: 0,
  },
  // A page of the panel that scrolls on its own: the history or the setup.
  page: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    gap: "14px",
    minHeight: 0,
    padding: "20px 16px 16px",
    overflowY: "auto",
  },
  caps: {
    fontFamily: tokens.fontMono,
    lineHeight: "14px",
  },
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
  mode: {
    display: "inline-flex",
    flex: "0 1 auto",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    marginLeft: "auto",
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
  selection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    margin: 0,
  },
  selectionCaption: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  selectionQuote: {
    display: "-webkit-box",
    margin: 0,
    paddingLeft: "12px",
    overflow: "hidden",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.accent,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    fontStyle: "italic",
    lineHeight: "22px",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
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
  error: {
    margin: 0,
    color: tokens.changeRemoved,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "18px",
    whiteSpace: "pre-wrap",
  },
  errorAction: {
    padding: 0,
    ...noBorder,
    backgroundColor: tokens.transparent,
    color: tokens.ink,
    font: "inherit",
    textDecorationLine: "underline",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  composer: {
    display: "flex",
    flex: "0 0 auto",
    flexDirection: "column",
    gap: "10px",
    margin: "12px 16px 16px",
    padding: "12px 12px 10px 14px",
    ...hairline,
    borderColor: {
      default: tokens.ruleSoft,
      ":focus-within": tokens.accentOutline,
    },
    borderRadius: radius.surface,
    backgroundColor: tokens.raised,
  },
  question: {
    minHeight: "44px",
    maxHeight: "160px",
    padding: 0,
    ...noBorder,
    resize: "none",
    backgroundColor: tokens.transparent,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "22px",
    fieldSizing: "content",
    outline: { default: null, ":focus": "none" },
    "::placeholder": {
      color: tokens.inkFaint,
    },
  },
  composerFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  send: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    ...hairline,
    borderRadius: radius.surface,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
  },
  submit: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    color: tokens.onAccent,
    opacity: { default: null, ":disabled": 0.45 },
    cursor: { default: "pointer", ":disabled": "default" },
  },
  submitIcon: {
    strokeWidth: "1.4px",
  },
  stop: {
    paddingLeft: "8px",
    borderColor: tokens.ruleSoft,
    backgroundColor: tokens.transparent,
    color: tokens.ink,
  },
  stopMark: {
    width: "8px",
    height: "8px",
    borderRadius: radius.hairline,
    backgroundColor: "currentColor",
  },
  // Showing the list it opens: pressed, not dimmed as disabled.
  historyButtonOn: {
    color: tokens.ink,
    opacity: 1,
  },
  historyHeading: {
    margin: 0,
  },
  historyEmpty: {
    margin: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
  },
  // A bordered list of rows: the saved conversations, or the agents to set up.
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    overflow: "hidden",
    ...hairline,
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    listStyle: "none",
  },
  listItem: {
    borderTopWidth: { default: 0, ":not(:first-child)": "1px" },
    borderTopStyle: { default: "none", ":not(:first-child)": "solid" },
    borderTopColor: tokens.rule,
  },
  historyRow: {
    position: "relative",
    display: "flex",
  },
  historyOpen: {
    display: "flex",
    flex: "1 1 auto",
    gap: "12px",
    minWidth: 0,
    padding: "12px 40px 12px 14px",
    ...noBorder,
    backgroundColor: {
      default: tokens.transparent,
      ":hover": `color-mix(in srgb, ${tokens.ink} 4%, ${tokens.tray})`,
      ":focus-visible": `color-mix(in srgb, ${tokens.ink} 4%, ${tokens.tray})`,
    },
    color: tokens.ink,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
  },
  historyLogo: {
    display: "flex",
    flex: "0 0 16px",
    justifyContent: "center",
    paddingTop: "3px",
  },
  historyText: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
  historyTitle: {
    display: "-webkit-box",
    overflow: "hidden",
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "22px",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  historyQuote: {
    overflow: "hidden",
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.ui,
    fontStyle: "italic",
    lineHeight: "20px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  historyMeta: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  // Shown with its row, or once it has focus or is armed.
  historyForget: {
    position: "absolute",
    top: "10px",
    right: "8px",
    opacity: {
      default: 0,
      ":focus-visible": 1,
      [stylex.when.ancestor(":hover")]: 1,
    },
  },
  // A conversation whose passage changed in the version on screen.
  outdatedTag: {
    ...hairline,
    borderColor: tokens.warningFocus,
    backgroundColor: tokens.warningWash,
    fontFamily: tokens.fontMono,
  },
  outdatedInline: {
    marginLeft: "6px",
  },
  outdated: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "4px 8px",
    margin: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "16px",
  },
});

// "Answer with", and the model and effort menus: shared by the selection
// toolbar and the panel's pickers.
const menuStyles = stylex.create({
  menu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    zIndex: layer.popover,
    display: "flex",
    flexDirection: "column",
    width: "300px",
    padding: "4px",
    whiteSpace: "normal",
  },
  choices: {
    width: "max-content",
    minWidth: "160px",
    maxWidth: "260px",
  },
  label: {
    padding: "8px 10px 6px",
    fontFamily: tokens.fontMono,
    lineHeight: "14px",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "7px 10px",
    ...noBorder,
    borderRadius: radius.small,
    backgroundColor: {
      default: tokens.transparent,
      ":not(:disabled):hover": tokens.accentWash,
      ":focus-visible": tokens.accentWash,
    },
    color: { default: tokens.ink, ":disabled": tokens.inkFaint },
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    textAlign: "left",
    cursor: { default: "pointer", ":disabled": "default" },
    outline: { default: null, ":focus-visible": "none" },
  },
  itemChecked: {
    backgroundColor: tokens.accentWash,
  },
  logo: {
    display: "flex",
    flex: "0 0 16px",
    justifyContent: "center",
  },
  logoUnavailable: {
    opacity: 0.45,
  },
  name: {
    flex: "1 1 0",
    minWidth: 0,
  },
  choiceText: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  description: {
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  trail: {
    display: "flex",
    flex: "0 0 auto",
    justifyContent: "flex-end",
    minWidth: "84px",
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  check: {
    color: tokens.accent,
  },
});

// The agent, model and effort pickers above the thread.
const pickerStyles = stylex.create({
  anchor: {
    position: "relative",
    minWidth: 0,
  },
  picker: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "5px 8px 5px 6px",
    ...hairline,
    borderColor: {
      default: tokens.ruleSoft,
      ":not(:disabled):hover": tokens.accentOutline,
    },
    borderRadius: radius.surface,
    backgroundColor: tokens.raised,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    cursor: { default: "pointer", ":disabled": "default" },
    outline: {
      default: null,
      ":focus-visible": `2px solid ${tokens.accentOutline}`,
    },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  open: {
    borderColor: tokens.accentOutline,
  },
  choice: {
    maxWidth: "150px",
    paddingLeft: "8px",
  },
  choiceName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chevron: {
    color: tokens.inkMuted,
  },
});

const permissionStyles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "16px",
    ...hairline,
    borderColor: tokens.warningFocus,
    borderRadius: radius.surface,
    backgroundColor: tokens.warningWash,
  },
  copy: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  heading: {
    margin: 0,
    color: tokens.changeModified,
    fontFamily: tokens.fontMono,
    lineHeight: "14px",
  },
  text: {
    margin: 0,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
  },
  target: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    ...hairline,
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.bg,
  },
  targetCode: {
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  targetPlace: {
    overflow: "hidden",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  options: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
  },
  option: {
    padding: "6px 12px",
    ...hairline,
    borderColor: tokens.ruleSoft,
    borderRadius: radius.surface,
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.surfaceRaised,
    },
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
  },
  allowOnce: {
    borderColor: tokens.changeModified,
    backgroundColor: {
      default: tokens.changeModified,
      ":hover": `color-mix(in srgb, ${tokens.changeModified} 88%, white)`,
    },
    color: tokens.onWarning,
  },
  reject: {
    paddingInline: "4px",
    borderColor: tokens.transparent,
    backgroundColor: tokens.transparent,
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
  },
  apart: {
    marginLeft: "auto",
  },
});

const setupStyles = stylex.create({
  page: {
    gap: "36px",
  },
  message: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingInline: "4px",
  },
  heading: {
    margin: 0,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.display,
    fontWeight: fontWeight.medium,
    lineHeight: "32px",
    letterSpacing: tracking.tight,
  },
  text: {
    margin: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
  },
  agent: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 14px",
  },
  logo: {
    display: "flex",
    flex: "0 0 18px",
    justifyContent: "center",
    opacity: 0.45,
  },
  logoMark: {
    width: "18px",
    height: "18px",
  },
  name: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
  },
  status: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  fallback: {
    display: "flex",
    flex: "0 0 auto",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    padding: "16px 16px 20px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  copy: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    padding: "9px 12px",
    ...hairline,
    borderColor: {
      default: tokens.ruleSoft,
      ":hover": tokens.accentOutline,
    },
    borderRadius: radius.surface,
    backgroundColor: tokens.surfaceRaised,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
  },
  copyIcon: {
    color: tokens.inkMuted,
  },
});

const signInStyles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "12px",
    padding: "16px",
    ...hairline,
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.raised,
  },
  text: {
    margin: 0,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
  },
  command: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: "8px",
    padding: "4px 4px 4px 12px",
    ...hairline,
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.bg,
  },
  code: {
    flex: "1 1 auto",
    minWidth: 0,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    overflowWrap: "anywhere",
  },
  copyIcon: {
    width: "12px",
    height: "12px",
  },
  retry: {
    padding: "6px 12px",
    ...hairline,
    borderColor: tokens.accent,
    borderRadius: radius.surface,
    backgroundColor: tokens.accent,
    color: tokens.onAccent,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
  },
});
