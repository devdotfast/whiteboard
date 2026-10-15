import { focusStyles } from "@canvas/ui/focus";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useEffect } from "react";

import { logos, useAskAgents } from "./ask-agent-picker";
import { resolveAskAnchor } from "./ask-anchor";
import { AskDeleteButton } from "./ask-delete";
import { useShowThreads } from "./ask-dock";
import { useAskHistory } from "./ask-history";
import { askPanelStyles } from "./ask-styles";
import { controlStyles } from "./controls-styles";
import { formatRelativeTime } from "./format";
import { useReviewSession } from "./host/review-session";
import { ChatIcon, HistoryIcon } from "./icons";
import { useAskKey, useOptionalReviewPanelStore } from "./review-panel";
import type { AskPassage, AskView } from "./review-panel-model";
import { useReviewRoots } from "./review-root-context";
import { fontSize } from "./scale.stylex";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { Button, IconButton } from "./ui/button";
import { Chip } from "./ui/chip";
import { EmptyState } from "./ui/empty-state";
import { textStyles } from "./ui/text";
import { useTooltip } from "./use-tooltip";

/** Opens the list of this review's saved conversations. */
function useOpenAskHistory() {
  const panels = useOptionalReviewPanelStore();
  const from = useAskKey();

  return panels
    ? () => panels.getState().openAskView({ type: "history" }, { from })
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

  const entry = history?.entries?.find((entry) => entry.id === threadId);

  const unavailable =
    entry?.selection.target.kind === "text" &&
    (!entry.selection.target.anchor || history?.outdated.has(entry.id));

  if (!entry || !unavailable) return null;

  return (
    <p {...stylex.props(styles.outdated)}>
      {history?.outdated.has(entry.id) ? <OutdatedTag /> : null}
      <span>Original passage unavailable in this version of the review.</span>
    </p>
  );
}

/** The Ask panel's header button for its history: in Desktop, the
 * sidebar's Threads tab. */
export function AskHistoryButton({ view }: { view: AskView }): ReactElement {
  const openHistory = useOpenAskHistory();
  const showThreads = useShowThreads();
  // One passage's conversations are a step away from all of them.
  const allShown = !showThreads && view.type === "history" && !view.passage;
  const tooltip = useTooltip("Saved conversations");

  return (
    <IconButton
      ref={tooltip}
      size="large"
      xstyle={allShown && styles.historyButtonOn}
      aria-label="Saved conversations"
      aria-pressed={allShown}
      disabled={!(showThreads ?? openHistory) || allShown}
      onClick={showThreads ?? openHistory}
    >
      <HistoryIcon
        xstyle={[controlStyles.inertIcon, controlStyles.chromeIcon]}
      />
    </IconButton>
  );
}

/** This review's saved conversations, newest first. */
export function AskHistoryList({
  passage,
}: {
  /** Only the conversations about this passage, or these. */
  passage?: AskPassage;
}): ReactElement {
  const history = useAskHistory();
  const panels = useOptionalReviewPanelStore();
  const from = useAskKey();
  const openHistory = useOpenAskHistory();

  const session = useReviewSession();
  const roots = useReviewRoots();
  const agents = useAskAgents(session);

  const entries =
    history?.entries?.filter(
      (entry) => !passage || passage.threadIds.includes(entry.id),
    ) ?? null;

  const error = history
    ? history.error
    : "Saved conversations are not available here.";

  const refresh = history?.refresh;
  const preview = history?.preview;

  useEffect(() => () => preview?.(null), [preview]);

  // The list may be older than a conversation this panel just had.
  useEffect(() => refresh?.(), [refresh]);

  return (
    <div {...stylex.props(askPanelStyles.body)}>
      <div {...stylex.props(askPanelStyles.page)}>
        <div {...stylex.props(styles.historyHeader)}>
          <h3
            {...stylex.props(
              textStyles.eyebrow,
              askPanelStyles.caps,
              styles.historyHeading,
            )}
          >
            {passage?.several
              ? "About these passages"
              : passage
                ? "About this passage"
                : "Saved conversations"}
          </h3>
          {/* A question needs no selection: one about the whole review. */}
          {passage || !panels ? null : (
            <Button
              onClick={() =>
                panels
                  .getState()
                  .openAsk(
                    { target: { kind: "review" }, title: "Whole review" },
                    undefined,
                    { from },
                  )
              }
            >
              New conversation
            </Button>
          )}
        </div>
        {passage ? (
          <figure {...stylex.props(askPanelStyles.selection)}>
            <blockquote
              {...stylex.props(
                textStyles.clamp2,
                askPanelStyles.selectionQuote,
              )}
            >
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
          <EmptyState xstyle={styles.historyEmpty} message="Loading…" />
        ) : entries?.length === 0 ? (
          <EmptyState
            xstyle={styles.historyEmpty}
            message={
              passage
                ? "No saved conversations about this passage."
                : "Nothing yet. Start a new conversation, or select text or code in the review and choose Ask; conversations are saved here."
            }
          />
        ) : entries?.length ? (
          <ul {...stylex.props(askPanelStyles.list)}>
            {entries.map((entry) => {
              const target = entry.selection.target;
              const title = entry.question ?? entry.title;
              const article = roots?.articleRef.current;

              const range =
                article && target.kind === "text" && target.anchor
                  ? resolveAskAnchor(article, target.anchor)?.range
                  : undefined;

              const heading =
                range && article
                  ? [...article.querySelectorAll("h1, h2, h3, h4, h5, h6")]
                      .filter(
                        (heading) =>
                          heading.contains(range.startContainer) ||
                          Boolean(
                            heading.compareDocumentPosition(
                              range.startContainer,
                            ) & Node.DOCUMENT_POSITION_FOLLOWING,
                          ),
                      )
                      .at(-1)?.textContent
                  : undefined;

              const source =
                target.kind === "code"
                  ? `${target.path}:${target.startLine}${target.endLine === target.startLine ? "" : `–${target.endLine}`}`
                  : heading;

              const unavailable =
                target.kind === "text" &&
                (!target.anchor || history?.outdated.has(entry.id));

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
                    {...stylex.props(focusStyles.ringInset, styles.historyOpen)}
                    onPointerEnter={() => {
                      history?.preview(entry.id);
                      history?.reveal(entry);
                    }}
                    onPointerLeave={() => history?.preview(null)}
                    onFocus={() => {
                      history?.preview(entry.id);
                      history?.reveal(entry);
                    }}
                    onBlur={() => history?.preview(null)}
                    onClick={() => {
                      history?.reveal(entry);
                      history?.preview(null);

                      panels?.getState().openAskView(
                        {
                          type: "saved",
                          threadId: entry.id,
                          selection: entry.selection,
                          agent: entry.agent,
                        },
                        { from },
                      );
                    }}
                  >
                    <span {...stylex.props(styles.historyLogo)}>
                      {logos[entry.agent]({})}
                    </span>
                    <span {...stylex.props(styles.historyText)}>
                      <span
                        {...stylex.props(
                          textStyles.clamp2,
                          styles.historyTitle,
                        )}
                      >
                        {title}
                      </span>
                      {source ? (
                        <span {...stylex.props(styles.historyMeta)}>
                          {source}
                        </span>
                      ) : null}
                      {/* One passage's list quotes it once, above. */}
                      {!passage && target.kind === "text" ? (
                        <span
                          {...stylex.props(
                            textStyles.truncate,
                            styles.historyQuote,
                          )}
                        >
                          {target.quote}
                        </span>
                      ) : null}
                      <span {...stylex.props(styles.historyMeta)}>
                        {agents?.find((agent) => agent.id === entry.agent)
                          ?.name ?? entry.agent}{" "}
                        · {formatRelativeTime(entry.updatedAt)}
                        {unavailable ? " · Original passage unavailable" : null}
                        {history?.outdated.has(entry.id) ? (
                          <OutdatedTag xstyle={styles.outdatedInline} />
                        ) : null}
                      </span>
                    </span>
                  </button>
                  <AskDeleteButton
                    xstyle={styles.historyForget}
                    label={`Delete “${title}”`}
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
              focusStyles.ring,
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

const styles = stylex.create({
  allConversations: {
    alignSelf: "flex-start",
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
  },
  // Showing the list it opens: pressed, not dimmed as disabled.
  historyButtonOn: {
    color: tokens.ink,
    opacity: 1,
  },
  historyHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  historyHeading: {
    margin: 0,
  },
  // The page already spaces its parts.
  historyEmpty: {
    paddingBlock: 0,
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
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.chromeHoverBg,
      ":focus-visible": tokens.chromeHoverBg,
    },
    color: tokens.ink,
    textAlign: "left",
    cursor: "pointer",
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
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "22px",
  },
  historyQuote: {
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.ui,
    fontStyle: "italic",
    lineHeight: "20px",
  },
  historyMeta: {
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
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
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.warningOutline,
    backgroundColor: tokens.warningWash,
    fontFamily: tokens.chromeFont,
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
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: "16px",
  },
});
