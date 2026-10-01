import type { AgentSelection } from "@review/agent-selection";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { type AskAgent, logos } from "./ask-agent-picker";
import { AskCopyIcon, askIconSizes } from "./ask-icons";
import { AskSelectionQuote, askPanelStyles } from "./ask-panel-shared";
import { copyAgentContext } from "./copy-agent-context";
import { CopyButton } from "./copy-text";
import { useReviewSession } from "./host/review-session";
import { fontSize, fontWeight, radius, tracking } from "./scale.stylex";
import { useToast } from "./toast";
import { tokens } from "./tokens.stylex";

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
        <div {...stylex.props(setupStyles.message)}>
          <h3 {...stylex.props(setupStyles.heading)}>
            No agent is ready to answer
          </h3>
          <p {...stylex.props(setupStyles.text)}>
            Whiteboard runs a coding agent on your machine, against the pinned
            checkout. Install one and sign in to it once in a terminal, then
            reopen this review.
          </p>
        </div>
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
        <button
          type="button"
          {...stylex.props(setupStyles.copy)}
          onClick={() => void copy()}
        >
          <AskCopyIcon xstyle={[askIconSizes.toolbar, setupStyles.copyIcon]} />
          Copy selection for your agent
        </button>
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
          iconStyle={signInStyles.copyIcon}
        />
      </div>
      <button
        type="button"
        {...stylex.props(signInStyles.retry)}
        onClick={onRetry}
      >
        Try again
      </button>
    </section>
  );
}

const hairline = {
  borderWidth: "1px",
  borderStyle: "solid",
} as const;

const setupStyles = stylex.create({
  page: {
    gap: "36px",
  },
  message: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingInline: "4px",
  },
  heading: {
    margin: 0,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.display,
    fontWeight: fontWeight.medium,
    lineHeight: "32px",
    letterSpacing: tracking.tight,
  },
  text: {
    margin: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
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
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    padding: "9px 12px",
    ...hairline,
    borderColor: {
      default: tokens.ruleSoft,
      ":hover": tokens.accentOutline,
    },
    borderRadius: radius.surface,
    backgroundColor: tokens.surfaceRaised,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
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
    ...hairline,
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
    ...hairline,
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
  copyIcon: {
    width: "12px",
    height: "12px",
  },
  retry: {
    padding: "6px 12px",
    ...hairline,
    borderColor: tokens.accent,
    borderRadius: radius.surface,
    backgroundColor: tokens.accent,
    color: tokens.onAccent,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
  },
});
