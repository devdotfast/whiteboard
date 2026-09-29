import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";

import { controlStyles } from "./controls-styles";
import { CopyIcon, copyText } from "./copy-text";
import { promptStyles } from "./prompt-styles";

/** What the review covers. This is the only choice the reader makes. */
export type PromptKind = "change" | "architecture";

export const REVIEW_HOME_PROMPT_KIND_STORAGE_KEY =
  "dev.fast.review.homePromptKind";

const PROMPT_KINDS: ReadonlyArray<{ kind: PromptKind; label: string }> = [
  { kind: "change", label: "Review a change" },
  { kind: "architecture", label: "Architecture review" },
];

/**
 * Prompts name the subject and stop there: Whiteboard's server gives the agent
 * the authoring instructions, so every agent gets the same wording.
 */
export const PROMPTS: Record<PromptKind, string> = {
  change:
    "Create a Whiteboard of my current branch against up to date main, then open it in Whiteboard.",
  architecture:
    "Create a Whiteboard that sketches out the main data flows, access patterns, and code paths in this repo, so I can do a full architecture review of it. Open it in Whiteboard when you're done.",
};

const COPIED_RESET_MS = 2000;

/**
 * The copy-a-prompt card. Only the user's agent can write a review of their
 * own repo, so both the Welcome rail and the Home zero state end here.
 *
 * The tabs choose what the review covers.
 */
export function PromptCard() {
  const [kind, setKind] = useState<PromptKind>(readStoredPromptKind);
  const [copied, setCopied] = useState(false);

  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const selectKind = (next: PromptKind) => {
    setKind(next);
    setCopied(false);
    clearTimeout(resetTimer.current);

    try {
      globalThis.localStorage?.setItem(
        REVIEW_HOME_PROMPT_KIND_STORAGE_KEY,
        next,
      );
    } catch {
      // The desktop can disable DOM storage; the in-memory selection still works.
    }
  };

  const copyPrompt = () => {
    void copyText(PROMPTS[kind]).then((ok) => {
      if (!ok) {
        return;
      }

      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  };

  return (
    <section {...stylex.props(styles.card)} aria-label="Whiteboard prompt">
      <div
        {...stylex.props(controlStyles.segmented, promptStyles.tabs)}
        role="group"
        aria-label="What to review"
      >
        {PROMPT_KINDS.map(({ kind: tab, label }) => (
          <button
            key={tab}
            type="button"
            {...stylex.props(
              controlStyles.segment,
              controlStyles.segmentLarge,
              kind === tab && controlStyles.segmentActive,
            )}
            aria-pressed={kind === tab}
            onClick={() => selectKind(tab)}
          >
            {label}
          </button>
        ))}
      </div>
      <pre {...stylex.props(promptStyles.body)}>{PROMPTS[kind]}</pre>
      <div {...stylex.props(promptStyles.actions)}>
        <button
          type="button"
          {...stylex.props(promptStyles.copy)}
          aria-live="polite"
          aria-label={copied ? "Prompt copied" : "Copy prompt"}
          onClick={copyPrompt}
        >
          <CopyIcon />
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>
    </section>
  );
}

function readStoredPromptKind(): PromptKind {
  try {
    const stored = globalThis.localStorage?.getItem(
      REVIEW_HOME_PROMPT_KIND_STORAGE_KEY,
    );

    if (stored === "change" || stored === "architecture") {
      return stored;
    }
  } catch {
    // Fall through to the default when DOM storage is unavailable.
  }

  return "change";
}

const styles = stylex.create({
  // It sits inside an accordion step, which already draws the surface, so it
  // adds no frame of its own.
  card: {
    display: "flex",
    flexDirection: "column",
    width: "min(720px, 100%)",
    margin: 0,
  },
});
