import type { AgentSelection } from "@review/agent-selection";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { askPanelStyles } from "./ask-styles";
import { textStyles } from "./ui/text";

export function AskSelectionQuote({
  selection,
}: {
  selection: AgentSelection;
}): ReactElement {
  const target = selection.target;

  return (
    <figure {...stylex.props(askPanelStyles.selection)}>
      <figcaption
        {...stylex.props(
          textStyles.eyebrow,
          askPanelStyles.caps,
          askPanelStyles.selectionCaption,
        )}
      >
        {target.kind === "text" ? "Selection" : "Code"}
      </figcaption>
      <blockquote {...stylex.props(askPanelStyles.selectionQuote)}>
        {target.kind === "text" ? target.quote : selection.title}
      </blockquote>
    </figure>
  );
}
