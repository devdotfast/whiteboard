import type { AskCommand, AskQuestion } from "@review/ask/thread-state";
import { fuzzyRank } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useState,
} from "react";

import { AskArrowIcon, askIconSizes } from "./ask-icons";
import { fontSize, layer, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { surfaceStyles } from "./ui/surface";

/** The slash command being typed: a question that is only `/` and a name
 * so far. */
function commandAt(draft: string): string | null {
  return /^\/(\S*)$/.exec(draft)?.[1] ?? null;
}

/** Where a question is written; `/` lists the agent's commands. */
export function AskComposer({
  inputRef,
  placeholder,
  disabled,
  canAsk,
  stop,
  status,
  commands,
  onAsk,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  disabled: boolean;
  /** Whether a question can go now: an agent is chosen and none is busy. */
  canAsk: boolean;
  /** Stops the turn under way; a Stop button replaces Ask while set. */
  stop?: () => void;
  status: ReactNode;
  commands: AskCommand[] | undefined;
  /** Resolves true once the question is sent, to clear it. */
  onAsk: (question: AskQuestion) => Promise<boolean>;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(0);
  // Escape hides the list until the question changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listId = useId();

  const query = dismissed === draft ? null : commandAt(draft);

  const options: { key: string; label: string; detail?: string }[] =
    query === null
      ? []
      : fuzzyRank(query, commands ?? [], (command) => [command.name]).map(
          (command) => ({
            key: command.name,
            label: `/${command.name}`,
            detail: command.hint
              ? `${command.description} · ${command.hint}`
              : command.description,
          }),
        );

  const open = options.length > 0;
  const shown = Math.min(active, options.length - 1);

  useEffect(() => setActive(0), [query]);

  const pick = (index: number) => {
    const option = options[index];

    if (!option) return;
    const text = `${option.label} `;

    setDraft(text);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(text.length, text.length);
    });
  };

  const submit = async () => {
    const text = draft.trim();

    if (!text || !canAsk) return;

    if (await onAsk({ text })) setDraft("");
  };

  const keydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;

        setActive((shown + step + options.length) % options.length);

        return;
      }

      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        pick(shown);

        return;
      }

      if (event.key === "Escape") {
        // Escape closes the list, not the panel behind it.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(draft);

        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      {...stylex.props(styles.composer)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Commands"
          {...stylex.props(surfaceStyles.popover, styles.list)}
        >
          {options.map((option, index) => (
            <div
              key={option.key}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === shown}
              {...stylex.props(
                styles.option,
                index === shown && styles.optionActive,
              )}
              // Picking keeps the question focused.
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => pick(index)}
            >
              <span {...stylex.props(styles.optionLabel)}>{option.label}</span>
              {option.detail ? (
                <span {...stylex.props(styles.optionDetail)}>
                  {option.detail}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        ref={inputRef}
        {...stylex.props(styles.question)}
        value={draft}
        rows={2}
        placeholder={placeholder}
        aria-label="Question"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${shown}` : undefined}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={keydown}
      />

      <div {...stylex.props(styles.footer)}>
        <span {...stylex.props(styles.status)}>{status}</span>
        {stop ? (
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
            disabled={!draft.trim() || !canAsk}
          >
            Ask
            <AskArrowIcon xstyle={[askIconSizes.small, styles.submitIcon]} />
          </button>
        )}
      </div>
    </form>
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

const styles = stylex.create({
  composer: {
    position: "relative",
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
  // Opens upward, over the thread.
  list: {
    position: "absolute",
    right: 0,
    bottom: "calc(100% + 6px)",
    left: 0,
    zIndex: layer.popover,
    display: "flex",
    flexDirection: "column",
    maxHeight: "min(280px, 40vh)",
    padding: "4px",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  option: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "6px 10px",
    borderRadius: radius.small,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    cursor: "pointer",
  },
  optionActive: {
    backgroundColor: tokens.accentWash,
  },
  optionLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  optionDetail: {
    overflow: "hidden",
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    lineHeight: "14px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  status: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
});
