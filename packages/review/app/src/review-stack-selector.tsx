import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { PullRequestStateIcon } from "@canvas/ui/board-icons";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { BranchIcon, ChevronDownIcon, PullRequestIcon } from "@canvas/ui/icons";
import { listRowStyles } from "@canvas/ui/list-row";
import { menuStyles, moveMenuFocus } from "@canvas/ui/menu";
import { pillStyles } from "@canvas/ui/pill";
import { Popover } from "@canvas/ui/popover";
import { textStyles } from "@canvas/ui/text";
import {
  PULL_REQUEST_STATE_LABELS,
  type ReviewStackLayer,
  type ReviewStackResponse,
  boardTitle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type MouseEvent,
  type ReactElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { useReviewSession } from "./host/review-session";
import { tokens } from "./tokens.stylex";

type OpenEvent = Pick<
  MouseEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "button"
>;

/** The displayed version's branch stack; empty until read,
 * and a read for a version left behind never lands. */
function useStack(): ReviewStackResponse {
  const review = useReviewSession().review!;
  const displayedVersion = useContext(DisplayedReviewVersionContext);
  const [stack, setStack] = useState<ReviewStackResponse>(NO_STACK);
  const inStack = Boolean(review.pullRequestNumber || review.headBranch);

  useEffect(() => {
    setStack(NO_STACK);

    if (!inStack) return;

    const abort = new AbortController();

    // Optional context: a failed read shows none.
    review
      .stack()
      .then((read) => {
        if (!abort.signal.aborted) setStack(read);
      })
      .catch(() => {});

    return () => abort.abort();
  }, [review, displayedVersion, inStack]);

  return stack;
}

const NO_STACK: ReviewStackResponse = { layers: [] };

/**
 * "[stack] Stack 3 of 5 ⌄" at the start of the board's meta line, for a
 * board in a branch stack: its GitHub stack, else the reviews chained
 * through the bases they name. The menu lists the stack newest first down
 * to its base; a branch nobody reviewed yet gets a new whiteboard. Apart
 * from the board's place among boards, which the page bar shows.
 */
export function ReviewStackSelector(): ReactElement | null {
  const session = useReviewSession();
  const review = session.review!;
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const { layers, base } = useStack();

  if (layers.length < 2) return null;

  const index = Math.max(
    0,
    layers.findIndex((layer) => layer.relation === "current"),
  );

  const openLayer = async (layer: ReviewStackLayer, event: OpenEvent) => {
    if (!openable(layer)) return;
    setOpen(false);

    const active = !(
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button === 1
    );

    const reviewUuid =
      layer.reviewUuid ??
      (await review.createBranchReview(
        layer.branch,
        layer.base!,
        layer.subject ?? layer.branch,
      ));

    void session.surface.post({
      name: "openReview",
      args: { reviewUuid, active },
    });
  };

  return (
    <span ref={container} {...stylex.props(styles.control)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Stack, ${index + 1} of ${layers.length}`}
        {...stylex.props(
          focusStyles.ring,
          buttonStyles.reset,
          pillStyles.pill,
          pillStyles.accent,
          styles.pill,
        )}
        onClick={() => setOpen(!open)}
      >
        <PullRequestIcon xstyle={styles.pillIcon} />
        <span {...stylex.props(styles.pillName)}>Stack</span>
        <span {...stylex.props(textStyles.count, styles.pillCount)}>
          {index + 1} of {layers.length}
        </span>
        <ChevronDownIcon xstyle={styles.pillChevron} />
      </button>
      {open ? (
        <Popover
          anchor={container}
          onDismiss={() => setOpen(false)}
          role="menu"
          tabIndex={-1}
          aria-label="Stack"
          xstyle={[menuStyles.popover, styles.menu]}
          onKeyDown={(event) => moveMenuFocus(event)}
        >
          <div {...stylex.props(menuStyles.label, styles.heading)}>
            <span {...stylex.props(textStyles.sectionTitle)}>Stack</span>
            <span>
              {layers.some((layer) => layer.base)
                ? "from branch bases"
                : "from GitHub"}{" "}
              · newest first
            </span>
          </div>
          {[...layers].reverse().map((layer) => (
            <LayerRow
              key={layer.branch}
              layer={layer}
              onOpen={(layer, event) => void openLayer(layer, event)}
            />
          ))}
          {base ? (
            <>
              <div
                role="separator"
                {...stylex.props(menuStyles.separator, styles.rule)}
              />
              <div {...stylex.props(styles.baseRow)}>
                <span {...stylex.props(styles.slot)} />
                <span {...stylex.props(styles.branch, styles.faint)}>
                  {base}
                </span>
                <span>base</span>
              </div>
            </>
          ) : null}
        </Popover>
      ) : null}
    </span>
  );
}

/** A pull request opens only its existing review; a local branch can get one. */
const openable = (layer: ReviewStackLayer) =>
  Boolean(layer.reviewUuid || layer.base);

function LayerRow({
  layer,
  onOpen,
}: {
  layer: ReviewStackLayer;
  onOpen: (layer: ReviewStackLayer, event: OpenEvent) => void;
}): ReactElement {
  const current = layer.relation === "current";
  const reviewed = Boolean(layer.reviewUuid);
  const disabled = !current && !openable(layer);

  const open = (event: OpenEvent) => {
    if (!current) onOpen(layer, event);
  };

  return (
    <button
      type="button"
      role="menuitem"
      aria-current={current || undefined}
      data-relation={layer.relation}
      disabled={disabled}
      title={
        current
          ? undefined
          : disabled
            ? "No whiteboard of this pull request yet"
            : reviewed
              ? "Open whiteboard (Cmd/Ctrl-click to open in the background)"
              : "Create a whiteboard of this branch (Cmd/Ctrl-click to open in the background)"
      }
      {...stylex.props(
        focusStyles.ringInset,
        buttonStyles.reset,
        menuStyles.item,
        styles.row,
        current && [listRowStyles.current, styles.rowCurrent],
      )}
      onClick={open}
      onAuxClick={(event) => {
        if (event.button === 1) open(event);
      }}
    >
      {layer.pullRequestNumber ? (
        <PullRequestStateIcon
          number={layer.pullRequestNumber}
          state={layer.pullRequestState}
        />
      ) : reviewed ? (
        <BranchIcon xstyle={styles.branchIcon} />
      ) : (
        <span aria-hidden="true" {...stylex.props(styles.unreviewed)} />
      )}
      <span {...stylex.props(styles.branch, current && styles.branchCurrent)}>
        {layer.branch}
      </span>
      <span
        {...stylex.props(
          styles.title,
          current && styles.titleCurrent,
          !reviewed && styles.faint,
        )}
      >
        {reviewed
          ? boardTitle(layer.reviewTitle ?? layer.subject ?? layer.branch)
          : "No whiteboard"}
      </span>
      {layer.pullRequestNumber ? (
        <span
          {...stylex.props(styles.trailing, current && styles.trailingCurrent)}
        >
          #{layer.pullRequestNumber}
          {layer.pullRequestState
            ? ` ${PULL_REQUEST_STATE_LABELS[layer.pullRequestState].toLowerCase()}`
            : ""}
        </span>
      ) : !reviewed && !disabled ? (
        <span {...stylex.props(styles.create)}>Create</span>
      ) : null}
    </button>
  );
}

const styles = stylex.create({
  control: { display: "inline-flex", flexShrink: 0 },
  pill: {
    height: "24px",
    paddingBlock: 0,
    paddingInline: "9px",
    fontSize: fontSize.ui,
    lineHeight: "16px",
    cursor: "pointer",
  },
  pillIcon: { width: "13px", height: "13px" },
  pillName: { fontWeight: fontWeight.medium },
  pillCount: { color: tokens.inkMuted },
  pillChevron: { width: "10px", height: "10px" },
  menu: { width: "min(500px, calc(100vw - 16px))", padding: "6px" },
  heading: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    padding: "6px 10px 8px",
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
  },
  row: { gap: "10px", minHeight: "34px", paddingInline: "10px" },
  rowCurrent: { cursor: "default" },
  branchIcon: { width: "14px", height: "14px", color: tokens.inkMuted },
  // A branch with no whiteboard: an empty, dashed place.
  unreviewed: {
    flexShrink: 0,
    width: "14px",
    height: "14px",
    boxSizing: "border-box",
    borderWidth: "1.3px",
    borderStyle: "dashed",
    borderColor: tokens.inkFaint,
    borderRadius: radius.round,
  },
  slot: { flexShrink: 0, width: "14px" },
  branch: {
    flexShrink: 0,
    width: "136px",
    overflow: "hidden",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  branchCurrent: { color: tokens.ink },
  title: {
    flex: "1 1 0",
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    fontSize: fontSize.ui,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  titleCurrent: { fontWeight: fontWeight.medium },
  faint: { color: tokens.inkFaint },
  trailing: {
    flexShrink: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  trailingCurrent: { color: tokens.inkMuted },
  create: {
    flexShrink: 0,
    color: tokens.accent,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  rule: { marginInline: "6px" },
  baseRow: {
    display: "flex",
    flex: "none",
    alignItems: "center",
    gap: "10px",
    minHeight: "30px",
    paddingInline: "10px",
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
  },
});
