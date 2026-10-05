import { fontSize, fontWeight, radius, tracking } from "@canvas/scale.stylex";
import type { TutorialAuthoringConversation as Conversation } from "@review/tutorial-conversation";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { tokens } from "./tokens.stylex";

export function TutorialAuthoringConversation({
  conversation,
}: {
  conversation: Conversation;
}): ReactElement {
  return (
    <details {...stylex.props(styles.conversation)}>
      <summary {...stylex.props(styles.summary)}>
        <span>{conversation.title}</span>
        <span {...stylex.props(styles.summaryNote)}>
          Representative authoring conversation
        </span>
      </summary>
      <ol {...stylex.props(styles.messages)}>
        {conversation.messages.map((message, index) => (
          <li
            key={`${message.role}-${index}`}
            data-role={message.role}
            {...stylex.props(styles.message, index > 0 && styles.later)}
          >
            <span
              {...stylex.props(
                styles.role,
                message.role === "assistant" && styles.assistant,
              )}
            >
              {message.role === "user" ? "You" : "Agent"}
            </span>
            <p {...stylex.props(styles.body)}>{message.body}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

const styles = stylex.create({
  conversation: {
    margin: "18px 0 24px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.reviewHomeRuleSoft,
    borderRadius: radius.surface,
    backgroundColor: `color-mix(in srgb, ${tokens.surfaceRaised} 76%, transparent)`,
  },
  summary: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "16px",
    padding: "12px 14px",
    cursor: "pointer",
    fontWeight: fontWeight.semibold,
  },
  summaryNote: {
    color: tokens.reviewHomeMeta,
    fontSize: fontSize.small,
    fontWeight: fontWeight.regular,
  },
  messages: {
    display: "grid",
    gap: "12px",
    margin: 0,
    padding: "0 14px 14px",
    listStyle: "none",
  },
  message: {
    display: "grid",
    gridTemplateColumns: "48px minmax(0, 1fr)",
    gap: "10px",
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: 1.72,
    textAlign: "left",
  },
  later: {
    marginTop: "8px",
  },
  role: {
    color: tokens.reviewHomeMeta,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
    letterSpacing: tracking.chrome,
    textTransform: "uppercase",
  },
  assistant: {
    color: tokens.accent,
  },
  body: {
    margin: "14px 0 0",
  },
});
