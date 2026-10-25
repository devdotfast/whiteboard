import type { AgentSelection } from "@review/agent-selection";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { askPanelStyles } from "./ask-styles";
import { textStyles } from "./ui/text";

export function AskSelectionQuote({
  selection,
}: {
  selection: AgentSelection;
}): ReactElement | null {
  const target = selection.target;

  // A question about the whole review quotes nothing.
  if (target.kind === "review") return null;

  return (
    <figure {...stylex.props(askPanelStyles.selection)}>
      <figcaption
        {...stylex.props(
          textStyles.eyebrow,
          askPanelStyles.caps,
          textStyles.truncate,
        )}
      >
        {target.kind === "text"
          ? "Selection"
          : target.kind === "code"
            ? "Code"
            : "Whiteboard"}
      </figcaption>
      <blockquote
        {...stylex.props(textStyles.clamp2, askPanelStyles.selectionQuote)}
      >
        {target.kind === "text" ? target.quote : selection.title}
      </blockquote>
    </figure>
  );
}
