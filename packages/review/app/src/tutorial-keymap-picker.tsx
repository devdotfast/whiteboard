import type { ReviewKeymapChoice } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { useTutorial } from "./tutorial-context";
import { SegmentedControl } from "./ui/segmented";

const choices: readonly { value: ReviewKeymapChoice; label: string }[] = [
  { value: "none", label: "VS Code default" },
  { value: "vim", label: "Vim" },
  { value: "emacs", label: "Emacs" },
  { value: "sublime", label: "Sublime Text" },
];

export function TutorialKeymapPicker() {
  const tutorial = useTutorial();
  const [pending, setPending] = useState<ReviewKeymapChoice | null>(null);

  return (
    <SegmentedControl
      label="Keybindings"
      className="tutorial-keymap-picker"
      data-tour-target="keymap-picker"
      value={tutorial?.content.keymap}
      options={choices.map((choice) => ({
        value: choice.value,
        label: pending === choice.value ? "Applying…" : choice.label,
      }))}
      onChange={(value) => {
        if (!tutorial) return;
        setPending(value);
        void tutorial.selectKeymap(value).finally(() => setPending(null));
      }}
      size="large"
      disabled={!tutorial || pending !== null}
      xstyle={styles.group}
    />
  );
}

// Inline-flex so the tutorial ring hugs the group.
const styles = stylex.create({
  group: {
    display: "inline-flex",
    margin: "6px 0 12px",
  },
});
