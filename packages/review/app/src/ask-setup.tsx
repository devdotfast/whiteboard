import type { AgentSelection } from "@review/agent-selection";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { type AskAgent, logos } from "./ask-agent-picker";
import { AskSelectionQuote } from "./ask-panel-shared";
import { askPanelStyles } from "./ask-styles";
import { controlStyles } from "./controls-styles";
import { copyAgentContext } from "./copy-agent-context";
import { CopyButton } from "./copy-text";
import { useReviewSession } from "./host/review-session";
import { CopyIcon } from "./icons";
import { fontSize, radius } from "./scale.stylex";
import { useToast } from "./toast";
import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";

export function AskSetup({
  agents,
  selection,
}: {
  agents: AskAgent[];
  selection: AgentSelection;
}): ReactElement {
  const session = useReviewSession();
  const { toast, showToast } = useToast(4_000);

  const copy = async () => {
    try {
      await copyAgentContext(session, selection);
      showToast({
        kind: "success",
        text: "Selection copied to clipboard. Paste into your agent to chat about it.",
      });
    } catch {
      showToast({
        kind: "error",
        text: "Could not copy selection. Please try again.",
      });
    }
  };

  return (
    <div {...stylex.props(askPanelStyles.body)}>
      <div {...stylex.props(askPanelStyles.page, setupStyles.page)}>
        <AskSelectionQuote selection={selection} />
        <EmptyState
          title="No agent is ready to answer"
          message="Whiteboard runs a coding agent on your machine, against the pinned checkout. Install one and sign in to it once in a terminal; it shows up here when you come back."
          xstyle={setupStyles.message}
        />
        <ul {...stylex.props(askPanelStyles.list)}>
          {agents.map((candidate) => (
            <li
              key={candidate.id}
              {...stylex.props(askPanelStyles.listItem, setupStyles.agent)}
            >
              <span {...stylex.props(setupStyles.logo)}>
                {logos[candidate.id]({ xstyle: setupStyles.logoMark })}
              </span>
              <span {...stylex.props(setupStyles.name)}>
                <span>{candidate.name}</span>
                <span {...stylex.props(setupStyles.status)}>Not installed</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div {...stylex.props(setupStyles.fallback)}>
        <span>Or take the selection to an agent yourself</span>
        <Button
          size="large"
          xstyle={setupStyles.copy}
          onClick={() => void copy()}
        >
          <CopyIcon xstyle={[controlStyles.inlineIcon, setupStyles.copyIcon]} />
          Copy selection for your agent
        </Button>
      </div>
      {toast}
    </div>
  );
}

/** The agent's login lapsed: how to sign it in again, and a way to carry on
 * once it is. */
export function AskSignIn({
  agentName,
  command,
  onRetry,
}: {
  agentName: string;
  command: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <section
      {...stylex.props(signInStyles.card)}
      role="alert"
      aria-label="Sign in"
    >
      <p {...stylex.props(signInStyles.text)}>
        {agentName} is signed out. Sign in again in a terminal, then try again;
        the question is still here.
      </p>
      <div {...stylex.props(signInStyles.command)}>
        <code {...stylex.props(signInStyles.code)}>$ {command}</code>
        <CopyButton
          text={command}
          label="Copy the sign-in command"
          iconStyle={controlStyles.chromeIcon}
        />
      </div>
      <Button variant="primary" size="large" onClick={onRetry}>
        Try again
      </Button>
    </section>
  );
}

const setupStyles = stylex.create({
  page: {
    gap: "36px",
  },
  // The page pads it already.
  message: {
    paddingBlock: 0,
    paddingInline: "4px",
  },
  agent: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 14px",
  },
  logo: {
    display: "flex",
    flex: "0 0 18px",
    justifyContent: "center",
    opacity: 0.45,
  },
  logoMark: {
    width: "18px",
    height: "18px",
  },
  name: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
  },
  status: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  fallback: {
    display: "flex",
    flex: "0 0 auto",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    padding: "16px 16px 20px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  copy: {
    width: "100%",
  },
  copyIcon: {
    color: tokens.inkMuted,
  },
});

const signInStyles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "12px",
    padding: "16px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.raised,
  },
  text: {
    margin: 0,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
  },
  command: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: "8px",
    padding: "4px 4px 4px 12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.bg,
  },
  code: {
    flex: "1 1 auto",
    minWidth: 0,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "16px",
    overflowWrap: "anywhere",
  },
});
