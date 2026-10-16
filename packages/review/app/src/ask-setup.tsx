import { AgentLogo } from "@canvas/ui/brand-icons";
import { CopyButton } from "@canvas/ui/copy";
import { iconStyles } from "@canvas/ui/icon-styles";
import { CopyIcon } from "@canvas/ui/icons";
import type { AgentSelection } from "@review/agent-selection";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import type { AskAgent } from "./ask-agent-picker";
import { AskSelectionQuote } from "./ask-panel-shared";
import { askPanelStyles } from "./ask-styles";
import { copyAgentContext } from "./copy-agent-context";
import { useReviewSession } from "./host/review-session";
import { useNotify } from "./notify";
import { fontSize, leading, radius, space } from "./scale.stylex";
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
  const host = session.review?.host;
  const notify = useNotify();

  const copy = async () => {
    try {
      await copyAgentContext(session, selection);
      notify({
        kind: "success",
        text: "Selection copied to clipboard. Paste into your agent to chat about it.",
      });
    } catch {
      notify({
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
          message={
            host
              ? `Whiteboard runs a coding agent on ${host}, against the review's checkout there. Install one and sign in to it once over ssh; it shows up here when you come back.`
              : "Whiteboard runs a coding agent on your machine, against the pinned checkout. Install one and sign in to it once in a terminal; it shows up here when you come back."
          }
          xstyle={setupStyles.message}
        />
        <ul {...stylex.props(askPanelStyles.list)}>
          {agents.map((candidate) => (
            <li
              key={candidate.id}
              {...stylex.props(askPanelStyles.listItem, setupStyles.agent)}
            >
              <AgentLogo agent={candidate.id} xstyle={setupStyles.logo} />
              <span {...stylex.props(setupStyles.name)}>
                <span>{candidate.name}</span>
                <span {...stylex.props(setupStyles.status)}>
                  {host ? `Not installed on ${host}` : "Not installed"}
                </span>
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
          <CopyIcon xstyle={[iconStyles.inline, setupStyles.copyIcon]} />
          Copy selection for your agent
        </Button>
      </div>
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
  const host = useReviewSession().review?.host;

  return (
    <section
      {...stylex.props(signInStyles.card)}
      role="alert"
      aria-label="Sign in"
    >
      <p {...stylex.props(signInStyles.text)}>
        {agentName} is signed out. Sign in again in a terminal, then try again;
        the question is still here.{host ? ` Run it on ${host}.` : null}
      </p>
      <div {...stylex.props(signInStyles.command)}>
        <code {...stylex.props(signInStyles.code)}>$ {command}</code>
        <CopyButton
          text={command}
          label="Copy the sign-in command"
          iconStyle={iconStyles.chrome}
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
    gap: space.s36,
  },
  // The page pads it already.
  message: {
    paddingBlock: 0,
    paddingInline: space.s4,
  },
  agent: {
    display: "flex",
    alignItems: "center",
    gap: space.s12,
    padding: `${space.s12} ${space.s14}`,
  },
  logo: {
    opacity: 0.45,
  },
  name: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
  },
  status: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    lineHeight: leading.px14,
  },
  fallback: {
    display: "flex",
    flex: "0 0 auto",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s10,
    padding: `${space.s16} ${space.s16} ${space.s20}`,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: leading.px14,
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
    gap: space.s12,
    padding: space.s16,
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
    lineHeight: leading.px24,
  },
  command: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: space.s8,
    padding: `${space.s4} ${space.s4} ${space.s4} ${space.s12}`,
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
    lineHeight: leading.px16,
    overflowWrap: "anywhere",
  },
});
