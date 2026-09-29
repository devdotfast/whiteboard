import type { ReviewComponentProps } from "@review/review-document-data";
import type { ReactElement } from "react";

export function TutorialAuthoringConversation({
  conversation,
}: ReviewComponentProps<"TutorialAuthoringConversation">): ReactElement {
  return (
    <details className="tutorial-authoring-conversation">
      <summary>
        <span>{conversation.title}</span>
        <span>Representative authoring conversation</span>
      </summary>
      <ol>
        {conversation.messages.map((message, index) => (
          <li key={`${message.role}-${index}`} data-role={message.role}>
            <span>{message.role === "user" ? "You" : "Agent"}</span>
            <p>{message.body}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
