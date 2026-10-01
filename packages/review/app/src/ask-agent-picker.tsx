import {
  type AskAgentId,
  type AskChoiceKind,
  type AskOffer,
  type AskPicks,
  type AskSelect,
  askAgentIds,
  askChoiceKinds,
  askOfferSchema,
} from "@review/ask/thread-state";
import { fuzzyRank } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { AGENT_LOGOS } from "./agent-logos";
import { AskCheckIcon, AskChevronIcon, AskSearchIcon } from "./ask-icons";
import type { ReviewSession } from "./host/review-session";
import { fontSize, layer, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { surfaceStyles } from "./ui/surface";
import { textStyles } from "./ui/text";

const agentsSchema = z.object({
  agents: z.array(
    z.object({
      id: z.enum(askAgentIds),
      name: z.string(),
      available: z.boolean(),
      /** Whether it has a mode that keeps the checkout as it is. */
      readOnly: z.boolean().default(true),
      /** Whether it can edit and run commands without asking. */
      bypass: z.boolean().default(false),
    }),
  ),
});

export type AskAgent = z.infer<typeof agentsSchema>["agents"][number];

export const logos: Record<
  AskAgentId,
  (props: { xstyle?: stylex.StyleXStyles }) => ReactElement
> = AGENT_LOGOS;

// The last answer per canvas session, shown while the next is asked; and the
// request under way, which the toolbar and the panel share.
const knownAgents = new WeakMap<ReviewSession, AskAgent[] | null>();

const askingAgents = new WeakMap<ReviewSession, Promise<AskAgent[] | null>>();

function askAgentsOf(session: ReviewSession): Promise<AskAgent[] | null> {
  let request = askingAgents.get(session);

  if (!request) {
    request = session
      .fetch("/ask/agents")
      .then(async (response) =>
        response.ok ? agentsSchema.parse(await response.json()).agents : null,
      )
      // A check that fails keeps the last answer; a host without Ask refuses
      // the request instead.
      .catch(() => knownAgents.get(session) ?? null)
      .then((agents) => {
        knownAgents.set(session, agents);
        askingAgents.delete(session);

        return agents;
      });
    askingAgents.set(session, request);
  }

  return request;
}

/** Which local agents can answer, or null where this host has no Ask. Asked
 * again each time Ask opens and each time the review comes back into focus,
 * so an agent installed during the review shows up. */
export function useAskAgents(session: ReviewSession | null): AskAgent[] | null {
  const [agents, setAgents] = useState<AskAgent[] | null>(() =>
    session ? (knownAgents.get(session) ?? null) : null,
  );

  useEffect(() => {
    if (!session) return;
    let current = true;

    const refresh = () => {
      void askAgentsOf(session).then((value) => {
        if (current) setAgents(value);
      });
    };

    const refreshIfShown = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshIfShown);

    return () => {
      current = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshIfShown);
    };
  }, [session]);

  return agents;
}

const offeredSchema = z.object({ offer: askOfferSchema });

/** What the agent offers, for a question not yet asked: its choices, its
 * commands and whether it reads images. Asked again each time: a
 * conversation can teach the server something newer. */
export function useOffer(
  session: ReviewSession,
  agent: AskAgentId | undefined,
  wanted: boolean,
): AskOffer | undefined {
  const [offered, setOffered] = useState<{
    agent: AskAgentId;
    offer: AskOffer;
  }>();

  useEffect(() => {
    if (!agent || !wanted) return;
    let current = true;

    void session
      .fetch(`/ask/agents/${agent}/offer`)
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
  }, [session, agent, wanted]);

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
  kind: AskChoiceKind | "bypass",
) => session.storageKey(`ask-${kind}-${agent}`);

/** Whether the reviewer last had this agent bypass permissions. */
export function storedBypass(session: ReviewSession, agent: AskAgentId) {
  try {
    return localStorage.getItem(choiceKey(session, agent, "bypass")) === "on";
  } catch {
    /* Storage can be unavailable; the agent asks first. */
    return false;
  }
}

export function rememberBypass(
  session: ReviewSession,
  agent: AskAgentId,
  bypass: boolean,
) {
  try {
    localStorage.setItem(
      choiceKey(session, agent, "bypass"),
      bypass ? "on" : "off",
    );
  } catch {
    /* The choice is a convenience; forgetting it is harmless. */
  }
}

/** The permissions a conversation can have. */
export const permissionsSelect = (bypass: boolean): AskSelect => ({
  current: bypass ? "bypass" : "ask",
  options: [
    {
      value: "ask",
      name: "Read-only",
      description: "Cannot change the checkout; asks before running commands.",
    },
    {
      value: "bypass",
      name: "Bypass permissions",
      description: "Edits the checkout and runs commands without asking.",
    },
  ],
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

/** Closes a menu; focus that went with it returns to its button. */
function useMenuClose(
  setOpen: (open: boolean) => void,
  trigger: RefObject<HTMLButtonElement | null>,
) {
  return useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      const focused = document.activeElement;

      if (!focused || focused === document.body) trigger.current?.focus();
    });
  }, [setOpen, trigger]);
}

export function AskAgentPicker({
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
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = useMenuClose(setOpen, trigger);
  const chosen = agents?.find((candidate) => candidate.id === agent);

  return (
    <div
      ref={anchor}
      {...stylex.props(pickerStyles.anchor, pickerStyles.whole)}
    >
      <button
        ref={trigger}
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
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = useMenuClose(setOpen, trigger);
  const chosen = select.options.find((option) => option.value === current);

  useEffect(() => {
    if (!open) return;

    const outside = (event: PointerEvent) => {
      if (anchor.current && !event.composedPath().includes(anchor.current))
        dismiss();
    };

    window.addEventListener("pointerdown", outside, true);
    (
      menu.current?.querySelector<HTMLElement>("input") ??
      menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu.current?.querySelector<HTMLElement>("button")
    )?.focus();

    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open, dismiss]);

  const searchable = select.options.length > SEARCH_FROM;

  const pick = (value: string) => {
    dismiss();

    if (value !== current) onPick(value);
  };

  return (
    <div ref={anchor} {...stylex.props(pickerStyles.anchor)}>
      <button
        ref={trigger}
        type="button"
        {...stylex.props(
          pickerStyles.picker,
          pickerStyles.choice,
          quiet && pickerStyles.quiet,
          open && (quiet ? pickerStyles.quietOpen : pickerStyles.open),
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
        {icon}
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
            searchable && menuStyles.searchable,
            quiet && menuStyles.up,
            end && menuStyles.end,
          )}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Escape closes the menu, not the panel behind it.
            event.stopPropagation();
            dismiss();
          }}
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
                  highlighted={option.value === current}
                  onPick={pick}
                />
              ))}
            </>
          )}
        </div>
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
  highlighted,
  id,
  onPick,
  onPoint,
}: {
  option: AskOption;
  checked: boolean;
  highlighted: boolean;
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
      {...stylex.props(menuStyles.item, highlighted && menuStyles.itemChecked)}
      onPointerMove={onPoint}
      onClick={() => onPick(option.value)}
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
        {checked ? <AskCheckIcon xstyle={menuStyles.check} /> : null}
      </span>
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
      <label {...stylex.props(menuStyles.search)}>
        <AskSearchIcon xstyle={menuStyles.searchIcon} />
        <input
          {...stylex.props(menuStyles.searchInput)}
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
        <span {...stylex.props(menuStyles.count)}>
          {query ? `${results.length} of ${options.length}` : options.length}
        </span>
      </label>
      <div
        ref={list}
        id={`${ids}-results`}
        {...stylex.props(menuStyles.results)}
      >
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
          <p {...stylex.props(menuStyles.empty)}>
            No {noun} matches “{query.trim()}”
          </p>
        )}
      </div>
    </>
  );
}

const noBorder = {
  borderWidth: 0,
  borderStyle: "none",
} as const;

const hairline = {
  borderWidth: "1px",
  borderStyle: "solid",
} as const;

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
    // OpenCode offers every model of every provider: a long list scrolls
    // in the menu rather than stretching the panel.
    maxHeight: "min(420px, 60vh)",
    padding: "4px",
    overflowY: "auto",
    overscrollBehavior: "contain",
    whiteSpace: "normal",
  },
  choices: {
    width: "max-content",
    minWidth: "160px",
    maxWidth: "260px",
  },
  // A field above results that scroll beneath it, at one width so the menu
  // does not jump as they change.
  searchable: {
    width: "320px",
    minWidth: "320px",
    maxWidth: "320px",
    padding: 0,
    overflowY: "hidden",
  },
  search: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    cursor: "text",
  },
  searchIcon: {
    width: "12px",
    height: "12px",
    color: tokens.inkFaint,
  },
  searchInput: {
    flex: "1 1 auto",
    minWidth: 0,
    padding: 0,
    ...noBorder,
    backgroundColor: tokens.transparent,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    outline: { default: null, ":focus": "none" },
    "::placeholder": {
      color: tokens.inkFaint,
    },
  },
  count: {
    flex: "0 0 auto",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    whiteSpace: "nowrap",
  },
  results: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minHeight: 0,
    padding: "4px",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  empty: {
    margin: 0,
    padding: "12px 10px 14px",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
  },
  up: {
    top: "auto",
    bottom: "calc(100% + 6px)",
  },
  end: {
    left: "auto",
    right: 0,
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
  // The agent's name stays whole; its settings give way first.
  whole: {
    flexShrink: 0,
  },
  picker: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    maxWidth: "100%",
    whiteSpace: "nowrap",
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
    maxWidth: "min(150px, 100%)",
    paddingLeft: "8px",
  },
  // Like text, until pointed at. Under the composer the row has room, so
  // it truncates only once the row is full.
  quiet: {
    maxWidth: "100%",
    gap: "6px",
    padding: "4px 6px",
    borderColor: tokens.transparent,
    backgroundColor: {
      default: tokens.transparent,
      ":not(:disabled):hover": tokens.tray,
    },
    color: { default: tokens.inkMuted, ":not(:disabled):hover": tokens.ink },
    fontSize: fontSize.ui,
    lineHeight: "16px",
  },
  quietOpen: {
    backgroundColor: tokens.tray,
    color: tokens.ink,
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
