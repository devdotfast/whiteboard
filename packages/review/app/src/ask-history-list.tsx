import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useEffect } from "react";

import { logos, useAskAgents } from "./ask-agent-picker";
import { AskDeleteButton } from "./ask-delete";
import { useAskHistory } from "./ask-history";
import { AskHistoryIcon, AskIcon, askIconSizes } from "./ask-icons";
import { askPanelStyles } from "./ask-panel-shared";
import { controlStyles } from "./controls-styles";
import { useReviewSession } from "./host/review-session";
import { formatRelativeTime } from "./review-home-view";
import { useOptionalReviewPanelStore } from "./review-panel";
import type { AskView } from "./review-panel-model";
import { fontSize } from "./scale.stylex";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { IconButton } from "./ui/button";
import { Chip } from "./ui/chip";
import { textStyles } from "./ui/text";

/** Opens the list of this review's saved conversations. */
function useOpenAskHistory() {
  const panels = useOptionalReviewPanelStore();

  return panels
    ? () => panels.getState().openAskView({ type: "history" })
    : undefined;
}

function OutdatedTag({
  xstyle,
}: {
  xstyle?: stylex.StyleXStyles;
}): ReactElement {
  return <Chip xstyle={[styles.outdatedTag, xstyle]}>Outdated</Chip>;
}

/** A conversation whose passage changed in the version on screen. */
export function AskOutdatedNote({
  threadId,
}: {
  threadId: string | null;
}): ReactElement | null {
  const history = useAskHistory();

  if (threadId === null || !history?.outdated.has(threadId)) return null;

  return (
    <p {...stylex.props(styles.outdated)}>
      <OutdatedTag />
      <span>The passage changed in this version of the review.</span>
    </p>
  );
}

/** The Ask panel's header button for its history. */
export function AskHistoryButton({ view }: { view: AskView }): ReactElement {
  const openHistory = useOpenAskHistory();
  // One passage's conversations are a step away from all of them.
  const allShown = view.type === "history" && !view.passage;

  return (
    <IconButton
      size="large"
      xstyle={allShown && styles.historyButtonOn}
      aria-label="Saved conversations"
      title="Saved conversations"
      aria-pressed={allShown}
      disabled={!openHistory || allShown}
      onClick={openHistory}
    >
      <AskHistoryIcon xstyle={[controlStyles.inertIcon, askIconSizes.header]} />
    </IconButton>
  );
}

/** The review toolbar's way back to saved conversations, where Ask runs. */
export function AskHistoryControl(): ReactElement | null {
  const session = useReviewSession();
  const openHistory = useOpenAskHistory();
  const agents = useAskAgents(openHistory ? session : null);

  if (!openHistory || !agents) return null;

  return (
    <IconButton
      xstyle={shellStyles.topbarItem}
      aria-label="Saved conversations"
      title="Saved conversations"
      onClick={openHistory}
    >
      <AskIcon xstyle={[controlStyles.chromeIcon, askIconSizes.chrome]} />
    </IconButton>
  );
}

/** This review's saved conversations, newest first. */
export function AskHistoryList({
  passage,
}: {
  /** Only the conversations about this passage. */
  passage?: { quote: string; threadIds: string[] };
}): ReactElement {
  const history = useAskHistory();
  const panels = useOptionalReviewPanelStore();
  const openHistory = useOpenAskHistory();

  const entries =
    history?.entries?.filter(
      (entry) => !passage || passage.threadIds.includes(entry.id),
    ) ?? null;

  const error = history
    ? history.error
    : "Saved conversations are not available here.";

  const refresh = history?.refresh;

  // The list may be older than a conversation this panel just had.
  useEffect(() => refresh?.(), [refresh]);

  return (
    <div {...stylex.props(askPanelStyles.body)}>
      <div {...stylex.props(askPanelStyles.page)}>
        <h3
          {...stylex.props(
            textStyles.eyebrow,
            askPanelStyles.caps,
            styles.historyHeading,
          )}
        >
          {passage ? "About this passage" : "Saved conversations"}
        </h3>
        {passage ? (
          <figure {...stylex.props(askPanelStyles.selection)}>
            <blockquote {...stylex.props(askPanelStyles.selectionQuote)}>
              {passage.quote}
            </blockquote>
          </figure>
        ) : null}
        {error ? (
          <p {...stylex.props(askPanelStyles.error)} role="alert">
            {error}
          </p>
        ) : null}
        {entries === null && !error ? (
          <p {...stylex.props(styles.historyEmpty)}>Loading…</p>
        ) : entries?.length === 0 ? (
          <p {...stylex.props(styles.historyEmpty)}>
            {passage
              ? "No saved conversations about this passage."
              : "Nothing yet. Select text or code in the review and choose Ask; the conversation is saved here."}
          </p>
        ) : entries?.length ? (
          <ul {...stylex.props(askPanelStyles.list)}>
            {entries.map((entry) => {
              const target = entry.selection.target;

              return (
                <li
                  key={entry.id}
                  {...stylex.props(
                    stylex.defaultMarker(),
                    askPanelStyles.listItem,
                    styles.historyRow,
                  )}
                >
                  <button
                    type="button"
                    {...stylex.props(styles.historyOpen)}
                    onClick={() =>
                      panels?.getState().openAskView({
                        type: "saved",
                        threadId: entry.id,
                        selection: entry.selection,
                        agent: entry.agent,
                      })
                    }
                  >
                    <span {...stylex.props(styles.historyLogo)}>
                      {logos[entry.agent]({})}
                    </span>
                    <span {...stylex.props(styles.historyText)}>
                      <span {...stylex.props(styles.historyTitle)}>
                        {entry.title}
                      </span>
                      {/* One passage's list quotes it once, above. */}
                      {passage ? null : (
                        <span {...stylex.props(styles.historyQuote)}>
                          {target.kind === "text"
                            ? target.quote
                            : entry.selection.title}
                        </span>
                      )}
                      <span {...stylex.props(styles.historyMeta)}>
                        {formatRelativeTime(entry.updatedAt)} ·{" "}
                        {entry.head.slice(0, 7)}
                        {history?.outdated.has(entry.id) ? (
                          <OutdatedTag xstyle={styles.outdatedInline} />
                        ) : null}
                      </span>
                    </span>
                  </button>
                  <AskDeleteButton
                    xstyle={styles.historyForget}
                    label={`Delete “${entry.title}”`}
                    onDelete={() => void history?.forget(entry.id)}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
        {passage && openHistory ? (
          <button
            type="button"
            {...stylex.props(
              askPanelStyles.errorAction,
              styles.allConversations,
            )}
            onClick={openHistory}
          >
            All saved conversations
          </button>
        ) : null}
      </div>
    </div>
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

const styles = stylex.create({
  allConversations: {
    alignSelf: "flex-start",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  // Showing the list it opens: pressed, not dimmed as disabled.
  historyButtonOn: {
    color: tokens.ink,
    opacity: 1,
  },
  historyHeading: {
    margin: 0,
  },
  historyEmpty: {
    margin: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
  },
  historyRow: {
    position: "relative",
    display: "flex",
  },
  historyOpen: {
    display: "flex",
    flex: "1 1 auto",
    gap: "12px",
    minWidth: 0,
    padding: "12px 40px 12px 14px",
    ...noBorder,
    backgroundColor: {
      default: tokens.transparent,
      ":hover": `color-mix(in srgb, ${tokens.ink} 4%, ${tokens.tray})`,
      ":focus-visible": `color-mix(in srgb, ${tokens.ink} 4%, ${tokens.tray})`,
    },
    color: tokens.ink,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
  },
  historyLogo: {
    display: "flex",
    flex: "0 0 16px",
    justifyContent: "center",
    paddingTop: "3px",
  },
  historyText: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
  historyTitle: {
    display: "-webkit-box",
    overflow: "hidden",
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "22px",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  historyQuote: {
    overflow: "hidden",
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.ui,
    fontStyle: "italic",
    lineHeight: "20px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  historyMeta: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  // Shown with its row, or once it has focus or is armed.
  historyForget: {
    position: "absolute",
    top: "10px",
    right: "8px",
    opacity: {
      default: 0,
      ":focus-visible": 1,
      [stylex.when.ancestor(":hover")]: 1,
    },
  },
  // A conversation whose passage changed in the version on screen.
  outdatedTag: {
    ...hairline,
    borderColor: tokens.warningFocus,
    backgroundColor: tokens.warningWash,
    fontFamily: tokens.fontMono,
  },
  outdatedInline: {
    marginLeft: "6px",
  },
  outdated: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "4px 8px",
    margin: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "16px",
  },
});
