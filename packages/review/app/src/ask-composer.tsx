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

const FIND_DELAY_MS = 80;

/** What the caret is completing: a slash command at the start of the
 * question, or a file after an @. */
type Completion =
  | { kind: "command"; query: string }
  | { kind: "file"; query: string; start: number; end: number };

function completionAt(draft: string, caret: number): Completion | null {
  const command = /^\/(\S*)$/.exec(draft);

  if (command) return { kind: "command", query: command[1]! };

  const before = draft.slice(0, caret);
  const file = /(?:^|\s)@([^\s@]*)$/.exec(before);

  if (!file) return null;

  return {
    kind: "file",
    query: file[1]!,
    start: caret - file[1]!.length - 1,
    end: caret,
  };
}

/** The checkout's files matching a query, asked for as the reviewer types. */
function useFiles(
  completion: Completion | null,
  findFiles: (query: string, signal: AbortSignal) => Promise<string[]>,
) {
  const [found, setFound] = useState<{ query: string; paths: string[] }>();
  const query = completion?.kind === "file" ? completion.query : null;

  useEffect(() => {
    if (query === null) return;
    const abort = new AbortController();

    const timer = setTimeout(() => {
      findFiles(query, abort.signal)
        .then((paths) => setFound({ query, paths }))
        // Without them the @ is just text.
        .catch(() => {});
    }, FIND_DELAY_MS);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, findFiles]);

  // The last answer stands until the next arrives, so the list does not
  // flicker while typing.
  return query === null ? [] : (found?.paths ?? []);
}

/** Where a question is written: `/` lists the agent's commands, and `@`
 * finds a file in the checkout. */
export function AskComposer({
  inputRef,
  placeholder,
  disabled,
  canAsk,
  stop,
  status,
  commands,
  findFiles,
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
  findFiles: (query: string, signal: AbortSignal) => Promise<string[]>;
  /** Resolves true once the question is sent, to clear it. */
  onAsk: (question: AskQuestion) => Promise<boolean>;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentions, setMentions] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  // Escape hides the list until the question changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listId = useId();

  const completion = dismissed === draft ? null : completionAt(draft, caret);
  const paths = useFiles(completion, findFiles);

  const options: { key: string; label: string; detail?: string }[] =
    completion?.kind === "command"
      ? fuzzyRank(completion.query, commands ?? [], (command) => [
          command.name,
        ]).map((command) => ({
          key: command.name,
          label: `/${command.name}`,
          detail: command.hint
            ? `${command.description} · ${command.hint}`
            : command.description,
        }))
      : completion?.kind === "file"
        ? paths.map((path) => {
            const slash = path.lastIndexOf("/");

            // The name first: a deep path would otherwise show only its
            // folders.
            return slash === -1
              ? { key: path, label: path }
              : {
                  key: path,
                  label: path.slice(slash + 1),
                  detail: path.slice(0, slash),
                };
          })
        : [];

  const open = options.length > 0;
  const shown = Math.min(active, options.length - 1);

  useEffect(() => setActive(0), [completion?.kind, completion?.query]);

  const place = (text: string, at: number) => {
    setDraft(text);
    setCaret(at);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at, at);
    });
  };

  const pick = (index: number) => {
    const option = options[index];

    if (!option || !completion) return;

    if (completion.kind === "command") {
      const text = `${option.label} `;

      place(text, text.length);

      return;
    }

    const inserted = `@${option.key} `;

    place(
      draft.slice(0, completion.start) + inserted + draft.slice(completion.end),
      completion.start + inserted.length,
    );
    setMentions((current) =>
      current.includes(option.key) ? current : [...current, option.key],
    );
  };

  const submit = async () => {
    const text = draft.trim();

    if (!text || !canAsk) return;

    // A file stays mentioned while its @ does.
    const mentioned = mentions.filter((path) => draft.includes(`@${path}`));

    const question: AskQuestion = { text };

    if (mentioned.length) question.mentions = mentioned;

    const sent = await onAsk(question);

    if (!sent) return;
    setDraft("");
    setCaret(0);
    setMentions([]);
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
          aria-label={completion?.kind === "command" ? "Commands" : "Files"}
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
        onChange={(event) => {
          setDraft(event.target.value);
          setCaret(event.target.selectionStart);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
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
