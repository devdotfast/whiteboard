import { AgentLogo } from "@canvas/ui/brand-icons";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "@canvas/ui/icons";
import { useTooltip } from "@canvas/ui/tooltip";
import {
  type AskAgentId,
  type AskChoiceKind,
  type AskOffer,
  type AskPermissions,
  type AskPicks,
  type AskSelect,
  askAgentIds,
  askChoiceKinds,
  askOfferSchema,
  askPermissionsSchema,
} from "@review/ask/thread-state";
import { fuzzyRank } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { canvasQueryKeys } from "./canvas-query";
import type { ReviewSession } from "./host/review-session";
import { fontSize, leading, space } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { menuStyles } from "./ui/menu";
import { Popover } from "./ui/popover";
import { textStyles } from "./ui/text";
import { fieldStyles } from "./ui/text-field";

const agentsSchema = z.object({
  agents: z.array(
    z.object({
      id: z.enum(askAgentIds),
      name: z.string(),
      available: z.boolean(),
      /** Whether it has a mode that keeps the checkout as it is. */
      readOnly: z.boolean().default(true),
      /** Whether it can decide for itself what is safe to run. */
      auto: z.boolean().default(false),
      /** Whether it can edit and run commands without asking. */
      bypass: z.boolean().default(false),
    }),
  ),
});

export type AskAgent = z.infer<typeof agentsSchema>["agents"][number];

const hostOf = (session: ReviewSession) =>
  [session.config.serverUrl, session.review?.host ?? ""].join("\0");

/** Which local agents can answer, or null where this host has no Ask. The
 * agents are the host's, so boards share the answer: asked when Ask opens
 * unless the host answered in the last 30 seconds, each time the review
 * comes back into focus and each time its host changes state, so an agent
 * installed during the review shows up. A host that cannot answer now keeps
 * the last answer. */
export function useAskAgents(session: ReviewSession | null): AskAgent[] | null {
  // The session changes with each snapshot; the host's agents do not.
  const sessionRef = useRef(session);

  sessionRef.current = session;

  const { data, refetch } = useQuery({
    queryKey: canvasQueryKeys.askAgents(session ? hostOf(session) : ""),
    queryFn: async () => {
      const response = await sessionRef.current!.fetch("/ask/agents");

      // A host without Ask refuses the request; one that is down fails it.
      if (response.status >= 500) throw new Error(response.statusText);

      return response.ok
        ? agentsSchema.parse(await response.json()).agents
        : null;
    },
    enabled: session !== null,
    staleTime: 30_000,
  });

  const active = session !== null;
  const hostState = session?.review?.hostState;
  const asked = useRef(hostState);

  // A host that changes state is asked again; a failed read keeps the last
  // answer.
  useEffect(() => {
    if (asked.current === hostState) return;
    asked.current = hostState;

    if (active) void refetch();
  }, [active, hostState, refetch]);

  useEffect(() => {
    if (!active) return;
    const refresh = () => void refetch();

    const refreshIfShown = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshIfShown);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshIfShown);
    };
  }, [active, refetch]);

  return data ?? null;
}

const offeredSchema = z.object({ offer: askOfferSchema });

/** What the agent offers, for a question not yet asked: its choices, its
 * commands and whether it reads images. Asked again each time: a
 * conversation can teach the server something newer. And again for each
 * model picked: the efforts on offer depend on it. */
export function useOffer(
  session: ReviewSession,
  agent: AskAgentId | undefined,
  wanted: boolean,
  model?: string,
): AskOffer | undefined {
  const [offered, setOffered] = useState<{
    agent: AskAgentId;
    offer: AskOffer;
  }>();

  useEffect(() => {
    if (!agent || !wanted) return;
    let current = true;

    void session
      .fetch(
        `/ask/agents/${agent}/offer${model ? `?${new URLSearchParams({ model })}` : ""}`,
      )
      .then(async (response) => {
        if (!response.ok) return;
        const { offer } = offeredSchema.parse(await response.json());

        if (current) setOffered({ agent, offer });
      })
      // Without them the agent answers with its own defaults.
      .catch(() => {});

    return () => {
      current = false;
    };
  }, [session, agent, wanted, model]);

  return offered && offered.agent === agent ? offered.offer : undefined;
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
  kind: AskChoiceKind | "permissions",
) => session.storageKey(`ask-${kind}-${agent}`);

/** What the reviewer last let this agent do, when they chose. */
export function storedPermissions(
  session: ReviewSession,
  agent: AskAgentId,
): AskPermissions | undefined {
  try {
    const stored = askPermissionsSchema.safeParse(
      localStorage.getItem(choiceKey(session, agent, "permissions")),
    );

    return stored.success ? stored.data : undefined;
  } catch {
    /* Storage can be unavailable; the agent's default applies. */
    return undefined;
  }
}

export function rememberPermissions(
  session: ReviewSession,
  agent: AskAgentId,
  permissions: AskPermissions,
) {
  try {
    localStorage.setItem(choiceKey(session, agent, "permissions"), permissions);
  } catch {
    /* The choice is a convenience; forgetting it is harmless. */
  }
}

const permissionNames: Record<AskPermissions, string> = {
  "read-only": "Read-only",
  auto: "Auto",
  bypass: "Bypass permissions",
};

/** What an agent can be let do, in the order the reviewer cycles them. */
export const permissionsOffered = (agent: AskAgent | undefined) =>
  askPermissionsSchema.options.filter(
    (permissions) => permissions === "read-only" || agent?.[permissions],
  );

/** The permissions a conversation can have. */
export const permissionsSelect = (
  offered: AskPermissions[],
  current: AskPermissions,
): AskSelect => ({
  current,
  options: offered.map((value) => ({ value, name: permissionNames[value] })),
});

/** The model or effort the reviewer chose last for this agent. */
export function storedChoice(
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

export function rememberChoice(
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
export function storedPicks(
  session: ReviewSession,
  agent: AskAgentId,
): AskPicks {
  const picks: AskPicks = {};

  for (const kind of askChoiceKinds) {
    const value = storedChoice(session, agent, kind);

    if (value) picks[kind] = value;
  }

  return picks;
}

export const choiceLabels = new Map<AskChoiceKind, string>([
  ["model", "Model"],
  ["effort", "Effort"],
]);

/** "Answer with": the agents installed on this machine. Opens under `within`
 * and closes on a pointer down outside it or on Escape. */
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
    if (!autoFocus) return;
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')
      ?.focus();
  }, [autoFocus, menu]);

  return (
    <Popover
      ref={menu}
      anchor={within}
      onDismiss={onDismiss}
      role="menu"
      tabIndex={-1}
      aria-label="Answer with"
      xstyle={[menuStyles.popover, styles.agentMenu]}
    >
      <div
        {...stylex.props(textStyles.eyebrow, menuStyles.label)}
        aria-hidden="true"
      >
        Answer with
      </div>
      {agents
        .filter((candidate) => candidate.available)
        .map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="menuitemradio"
            aria-checked={candidate.id === current}
            {...stylex.props(
              focusStyles.ringInset,
              buttonStyles.reset,
              menuStyles.item,
              candidate.id === current && menuStyles.itemCurrent,
            )}
            onClick={() => onPick(candidate.id)}
          >
            <AgentLogo agent={candidate.id} />
            <span {...stylex.props(styles.name)}>{candidate.name}</span>
            {candidate.id === current ? (
              <CheckIcon xstyle={[iconStyles.inline, menuStyles.check]} />
            ) : null}
          </button>
        ))}
    </Popover>
  );
}

export function AskAgentPicker({
  agents,
  agent,
  locked,
  unavailable,
  onPick,
}: {
  agents: AskAgent[] | null;
  agent: AskAgentId | undefined;
  locked: boolean;
  unavailable?: string;
  onPick: (agent: AskAgentId) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const dismiss = () => setOpen(false);
  const hint = useTooltip<HTMLSpanElement>(unavailable ?? "");
  const chosen = agents?.find((candidate) => candidate.id === agent);

  if (
    locked ||
    unavailable !== undefined ||
    agents?.filter((candidate) => candidate.available).length === 1
  ) {
    return (
      <span
        ref={unavailable === undefined ? undefined : hint}
        {...stylex.props(styles.inline)}
      >
        {agent ? <AgentLogo agent={agent} /> : null}
        <span>{chosen?.name ?? agent ?? "Agent"}</span>
      </span>
    );
  }

  return (
    <div ref={anchor} {...stylex.props(styles.anchor, styles.whole)}>
      <Button
        variant="secondary"
        size="large"
        xstyle={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!agents}
        onClick={() => setOpen((value) => !value)}
      >
        {agent ? <AgentLogo agent={agent} /> : null}
        <span>{chosen?.name ?? "Choose an agent"}</span>
        <ChevronDownIcon />
      </Button>
      {open && agents ? (
        <AskAgentMenu
          agents={agents}
          current={agent}
          within={anchor}
          autoFocus
          onPick={(picked) => {
            onPick(picked);
            dismiss();
          }}
          onDismiss={dismiss}
        />
      ) : null}
    </div>
  );
}

/** One of the agent's settings, a model or an effort; the choice holds
 * from the next answer. */
export function AskChoicePicker({
  label,
  select,
  current,
  disabled,
  quiet = false,
  end = false,
  icon,
  onPick,
}: {
  label: string;
  select: AskSelect;
  current: string;
  disabled: boolean;
  /** Plain text under the composer, its menu opening upward. */
  quiet?: boolean;
  /** Its menu lines up with its right edge, at the row's end. */
  end?: boolean;
  icon?: ReactNode;
  onPick: (value: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dismiss = () => setOpen(false);
  const chosen = select.options.find((option) => option.value === current);

  useEffect(() => {
    if (!open) return;
    (
      menu.current?.querySelector<HTMLElement>("input") ??
      menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu.current?.querySelector<HTMLElement>("button")
    )?.focus();
  }, [open, menu]);

  const searchable = select.options.length > SEARCH_FROM;

  const pick = (value: string) => {
    dismiss();

    if (value !== current) onPick(value);
  };

  return (
    <div ref={anchor} {...stylex.props(styles.anchor)}>
      <Button
        variant={quiet ? "ghost" : "secondary"}
        size={quiet ? "default" : "large"}
        xstyle={[styles.trigger, styles.choice, quiet && styles.quiet]}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${chosen?.name ?? current}`}
        title={
          disabled ? `${label} can change once the agent finishes.` : label
        }
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span {...stylex.props(textStyles.truncate, styles.choiceName)}>
          {chosen?.name ?? current}
        </span>
        {/* Under the composer it reads as text; pointing at it shows it
            opens. */}
        {quiet ? null : <ChevronDownIcon />}
      </Button>
      {open ? (
        <Popover
          ref={menu}
          anchor={anchor}
          onDismiss={dismiss}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          xstyle={[
            menuStyles.popover,
            quiet && menuStyles.above,
            end && menuStyles.end,
            searchable ? styles.searchMenu : styles.choiceMenu,
          ]}
        >
          {searchable ? (
            <AskChoiceSearch
              label={label}
              options={select.options}
              current={current}
              onPick={pick}
            />
          ) : (
            <>
              <div
                {...stylex.props(textStyles.eyebrow, menuStyles.label)}
                aria-hidden="true"
              >
                {label}
              </div>
              {select.options.map((option) => (
                <AskChoiceItem
                  key={option.value}
                  option={option}
                  checked={option.value === current}
                  onPick={pick}
                />
              ))}
            </>
          )}
        </Popover>
      ) : null}
    </div>
  );
}

// A list longer than this opens with a search field: OpenCode and Pi offer
// every model of every provider, an effort list stays as it is.
const SEARCH_FROM = 8;

type AskOption = AskSelect["options"][number];

function AskChoiceItem({
  option,
  checked,
  highlighted = false,
  id,
  onPick,
  onPoint,
}: {
  option: AskOption;
  checked: boolean;
  highlighted?: boolean;
  id?: string;
  onPick: (value: string) => void;
  onPoint?: () => void;
}): ReactElement {
  return (
    <button
      id={id}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      data-highlighted={highlighted || undefined}
      {...stylex.props(
        focusStyles.ringInset,
        buttonStyles.reset,
        menuStyles.item,
        checked && menuStyles.itemCurrent,
        highlighted && menuStyles.itemHighlighted,
      )}
      onPointerMove={onPoint}
      onClick={() => onPick(option.value)}
    >
      <span {...stylex.props(styles.name)}>{option.name}</span>
      {checked ? (
        <CheckIcon xstyle={[iconStyles.inline, menuStyles.check]} />
      ) : null}
    </button>
  );
}

/**
 * A long list of choices, filtered as the reviewer types, best match first.
 * The highlight starts on the current choice and moves with ↑ and ↓; ↵ picks
 * it, and Escape clears the search before it closes the menu.
 */
function AskChoiceSearch({
  label,
  options,
  current,
  onPick,
}: {
  label: string;
  options: readonly AskOption[];
  current: string;
  onPick: (value: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");

  const results = fuzzyRank(query, options, (option) => [
    option.name,
    option.value,
  ]);

  const [highlight, setHighlight] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === current),
    ),
  );

  const list = useRef<HTMLDivElement>(null);
  const ids = useId();
  const highlightIndex = Math.min(highlight, results.length - 1);
  const highlighted = results[highlightIndex];
  const noun = label.toLowerCase();

  useLayoutEffect(() => {
    list.current
      ?.querySelector(`[data-highlighted="true"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, query]);

  return (
    <>
      <label
        {...stylex.props(fieldStyles.box, fieldStyles.shell, styles.search)}
      >
        <SearchIcon xstyle={[iconStyles.inline, styles.searchIcon]} />
        <input
          {...stylex.props(fieldStyles.bare, styles.searchInput)}
          value={query}
          placeholder={`Search ${noun}s`}
          aria-label={`Search ${noun}s`}
          aria-controls={`${ids}-results`}
          aria-activedescendant={
            highlighted ? `${ids}-${highlightIndex}` : undefined
          }
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;

              setHighlight((index) =>
                Math.max(0, Math.min(index + step, results.length - 1)),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();

              if (highlighted) onPick(highlighted.value);
            } else if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
              setHighlight(
                Math.max(
                  0,
                  options.findIndex((option) => option.value === current),
                ),
              );
            }
          }}
        />
        <span {...stylex.props(textStyles.count, styles.count)}>
          {query ? `${results.length} of ${options.length}` : options.length}
        </span>
      </label>
      <div ref={list} id={`${ids}-results`} {...stylex.props(styles.results)}>
        {results.length ? (
          results.map((option, index) => (
            <AskChoiceItem
              key={option.value}
              id={`${ids}-${index}`}
              option={option}
              checked={option.value === current}
              highlighted={option === highlighted}
              onPick={onPick}
              onPoint={() => setHighlight(index)}
            />
          ))
        ) : (
          <EmptyState
            message={`No ${noun} matches “${query.trim()}”`}
            xstyle={styles.empty}
          />
        )}
      </div>
    </>
  );
}

const styles = stylex.create({
  agentMenu: {
    width: "300px",
  },
  choiceMenu: {
    width: "max-content",
    minWidth: "120px",
    maxWidth: "260px",
  },
  // A field above results that scroll beneath it, at one width so the menu
  // does not jump as they change.
  searchMenu: {
    width: "240px",
    overflowY: "hidden",
  },
  search: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: space.s6,
    cursor: "text",
  },
  searchIcon: {
    flex: "none",
    color: tokens.inkFaint,
  },
  searchInput: {
    flex: "1 1 auto",
    alignSelf: "stretch",
  },
  count: {
    flex: "0 0 auto",
    color: tokens.inkFaint,
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
  },
  // Four choices, the rest scrolled: 4 × 28px rows and their gaps.
  results: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    gap: space.s2,
    minHeight: 0,
    maxHeight: "118px",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  empty: {
    paddingBlock: space.s8,
    paddingInline: space.s8,
    fontSize: fontSize.small,
  },
  name: {
    flex: "1 1 0",
    minWidth: 0,
  },
  anchor: {
    minWidth: 0,
  },
  // The agent's name stays whole; its settings give way first.
  whole: {
    flexShrink: 0,
  },
  trigger: {
    maxWidth: "100%",
    padding: `0 ${space.s8}`,
  },
  inline: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s8,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
    whiteSpace: "nowrap",
  },
  choice: {
    maxWidth: "min(150px, 100%)",
  },
  // Like text, until pointed at. Under the composer the row has room, so
  // it truncates only once the row is full.
  quiet: {
    maxWidth: "100%",
    padding: `0 ${space.s6}`,
  },
  choiceName: {
    minWidth: 0,
  },
});
