import type { ReviewKeymapChoice } from "@dev.fast/review-protocol";
import type { ReviewComponentProps } from "@review/review-document-data";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { useTutorial } from "./tutorial-context";

const choices: readonly { value: ReviewKeymapChoice; label: string }[] = [
  { value: "none", label: "VS Code default" },
  { value: "vim", label: "Vim" },
  { value: "emacs", label: "Emacs" },
  { value: "sublime", label: "Sublime Text" },
];

export function TutorialKeymapPicker(
  _props: ReviewComponentProps<"TutorialKeymapPicker">,
) {
  const tutorial = useTutorial();
  const [pending, setPending] = useState<ReviewKeymapChoice | null>(null);

  return (
    // The class is the tutorial's target.
    <div
      {...withClass("tutorial-keymap-picker", styles.group)}
      role="group"
      aria-label="Keybindings"
    >
      {choices.map((choice) => {
        const pressed = tutorial?.content.keymap === choice.value;
        const disabled = !tutorial || pending !== null;

        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            {...stylex.props(
              styles.button,
              pressed && styles.pressed,
              disabled && styles.disabled,
            )}
            onClick={() => {
              if (!tutorial) return;
              setPending(choice.value);
              void tutorial
                .selectKeymap(choice.value)
                .finally(() => setPending(null));
            }}
          >
            {pending === choice.value ? "Applying…" : choice.label}
          </button>
        );
      })}
    </div>
  );
}

// The same segmented control as the view switcher in the top bar: same
// tokens for the group, the resting and hover text, and the raised active
// segment. Inline-flex so the tutorial ring hugs the group. Prose sits larger
// than chrome, so the buttons grow a step: 28px tall, 13px type, wider
// padding.
const styles = stylex.create({
  group: {
    display: "inline-flex",
    gap: "2px",
    margin: "6px 0 12px",
    padding: "2px",
    borderRadius: `calc(${tokens.chromeControlRadius} + 2px)`,
    backgroundColor: tokens.chromeHoverBg,
  },
  button: {
    height: "28px",
    padding: "0 14px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: tokens.chromeControlRadius,
    backgroundColor: {
      default: tokens.transparent,
      ":hover:not(:disabled)": tokens.surface,
    },
    color: {
      default: tokens.chromeFgMuted,
      ":hover:not(:disabled)": tokens.chromeFg,
    },
    cursor: "pointer",
    font: `${tokens.chromeFontWeight} 13px ${tokens.chromeFont}`,
    whiteSpace: "nowrap",
  },
  pressed: {
    backgroundColor: tokens.surfaceRaised,
    color: tokens.chromeFg,
    boxShadow: `0 0 0 1px ${tokens.ruleSoft}`,
  },
  disabled: {
    cursor: "default",
    opacity: 0.6,
  },
});
