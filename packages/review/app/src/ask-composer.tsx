import type { AskQuestion } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useState,
} from "react";

import { AskArrowIcon, askIconSizes } from "./ask-icons";
import { fontSize, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

/** Where a question is written. */
export function AskComposer({
  inputRef,
  placeholder,
  disabled,
  canAsk,
  stop,
  status,
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
  /** Resolves true once the question is sent, to clear it. */
  onAsk: (question: AskQuestion) => Promise<boolean>;
}): ReactElement {
  const [draft, setDraft] = useState("");

  const submit = async () => {
    const text = draft.trim();

    if (!text || !canAsk) return;

    if (await onAsk({ text })) setDraft("");
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

  return (
    <form
      {...stylex.props(styles.composer)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={inputRef}
        {...stylex.props(styles.question)}
        value={draft}
        rows={2}
        placeholder={placeholder}
        aria-label="Question"
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
