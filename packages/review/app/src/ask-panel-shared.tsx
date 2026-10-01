import type { AgentSelection } from "@review/agent-selection";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { fontSize, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
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

const noBorder = {
  borderWidth: 0,
  borderStyle: "none",
} as const;

const hairline = {
  borderWidth: "1px",
  borderStyle: "solid",
} as const;

// What the Ask panel's pages share: their layout, lists, errors and the
// quote of the selection asked about.
export const askPanelStyles = stylex.create({
  body: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minHeight: 0,
  },
  // A page of the panel that scrolls on its own: the history or the setup.
  page: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    gap: "14px",
    minHeight: 0,
    padding: "20px 16px 16px",
    overflowY: "auto",
  },
  caps: {
    fontFamily: tokens.fontMono,
    lineHeight: "14px",
  },
  selection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    margin: 0,
  },
  selectionCaption: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  selectionQuote: {
    display: "-webkit-box",
    margin: 0,
    paddingLeft: "12px",
    overflow: "hidden",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.accent,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    fontStyle: "italic",
    lineHeight: "22px",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  error: {
    margin: 0,
    color: tokens.changeRemoved,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "18px",
    whiteSpace: "pre-wrap",
  },
  errorAction: {
    padding: 0,
    ...noBorder,
    backgroundColor: tokens.transparent,
    color: tokens.ink,
    font: "inherit",
    textDecorationLine: "underline",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  // A bordered list of rows: the saved conversations, or the agents to set up.
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    overflow: "hidden",
    ...hairline,
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    listStyle: "none",
  },
  listItem: {
    borderTopWidth: { default: 0, ":not(:first-child)": "1px" },
    borderTopStyle: { default: "none", ":not(:first-child)": "solid" },
    borderTopColor: tokens.rule,
  },
});
