import {
  fontSize,
  fontWeight,
  leading,
  radius,
  space,
} from "@canvas/scale.stylex";
import { PullRequestStateIcon } from "@canvas/ui/board-icons";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { BranchIcon, ChevronDownIcon, PullRequestIcon } from "@canvas/ui/icons";
import { listRowStyles } from "@canvas/ui/list-row";
import { focusMenuStart, menuStyles, moveMenuFocus } from "@canvas/ui/menu";
import { pillStyles } from "@canvas/ui/pill";
import { Popover } from "@canvas/ui/popover";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import {
  type ReviewStackLayer,
  type ReviewStackResponse,
  boardTitle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type MouseEvent,
  type ReactElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { BoardPaintedContext } from "./board-painted";
import { canvasQueryKeys } from "./canvas-query";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { useReviewSession } from "./host/review-session";
import { useOptionalReviewPanel } from "./review-panel";
import { tokens } from "./tokens.stylex";

type OpenEvent = Pick<
  MouseEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "button"
>;

export function useReviewStack(): ReviewStackResponse {
  const review = useReviewSession().review;
  const version = useContext(DisplayedReviewVersionContext);
  const inStack = Boolean(review?.pullRequestNumber || review?.headBranch);
  // A slow read; the board paints without it.
  const painted = useContext(BoardPaintedContext);

  const queryClient = useQueryClient();

  // Optional context: a failed read shows none.
  const { data } = useQuery({
    queryKey: canvasQueryKeys.stack(review?.reviewId ?? "", version),
    queryFn: ({ signal }) => review!.stack(signal),
    enabled: inStack && painted,
    staleTime: Infinity,
    placeholderData: (previous) =>
      previous ?? (review && cachedStack(queryClient, review.reviewId)),
  });

  return (inStack && data) || NO_STACK;
}

/** A board's stack before it is read: its own from another version, else
 * one read for another board in it, seen from this board. */
function cachedStack(
  queryClient: QueryClient,
  board: string,
): ReviewStackResponse | undefined {
  const stacks = queryClient
    .getQueriesData<ReviewStackResponse>({
      queryKey: ["place"],
      predicate: (query) => query.queryKey[2] === "stack",
    })
    .flatMap(([key, stack]) =>
      stack ? [{ own: key[1] === board, stack }] : [],
    );

  const own = stacks.findLast((entry) => entry.own);

  if (own) return own.stack;

  for (const { stack } of stacks) {
    const at = stack.layers.findIndex((layer) => layer.reviewUuid === board);

    if (at >= 0)
      return {
        ...stack,
        layers: stack.layers.map((layer, index) => ({
          ...layer,
          relation: index < at ? "earlier" : index === at ? "current" : "later",
        })),
      };
  }
}

const NO_STACK: ReviewStackResponse = { layers: [] };

/** Opens a layer's whiteboard, creating it if needed. */
export function useOpenStackLayer(): (
  layer: ReviewStackLayer,
  active: boolean,
) => Promise<void> {
  const session = useReviewSession();
  const view = useOptionalReviewPanel((state) => state.view);

  return async (layer, active) => {
    if (!openable(layer)) return;

    const reviewUuid =
      layer.reviewUuid ??
      (await session.review!.createBranchReview(
        layer.branch,
        layer.base!,
        layer.subject ?? layer.branch,
      ));

    void session.surface.post({
      name: "openReview",
      args: { reviewUuid, active, ...(view && { view }) },
    });
  };
}

export function ReviewStackSelector(): ReactElement | null {
  const stack = useReviewStack();
  const openLayer = useOpenStackLayer();

  return (
    <StackPill
      stack={stack}
      onOpen={(layer, active) => void openLayer(layer, active)}
    />
  );
}

/**
 * "[stack] Stack 3 of 5 ⌄", for a board in a branch stack: its GitHub
 * stack, else the reviews chained through the bases they name. The menu
 * lists the stack newest first down to its base; a branch nobody reviewed
 * yet gets a new whiteboard. Apart from the board's place among boards,
 * which the page bar shows.
 */
export function StackPill({
  stack: { layers, base },
  onOpen,
  size = "small",
}: {
  stack: ReviewStackResponse;
  onOpen(layer: ReviewStackLayer, active: boolean): void;
  /** "bar" matches the Commits pill beside it. */
  size?: "small" | "bar";
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) focusMenuStart(popover.current, "[aria-current]");
  }, [open]);

  if (layers.length < 2) return null;

  const index = Math.max(
    0,
    layers.findIndex((layer) => layer.relation === "current"),
  );

  const openLayer = (layer: ReviewStackLayer, event: OpenEvent) => {
    if (!openable(layer)) return;
    setOpen(false);
    onOpen(
      layer,
      !(event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1),
    );
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
          size === "bar" && styles.pillBar,
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
          ref={popover}
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
              {layers.some((layer) => layer.pullRequestUrl)
                ? "from GitHub"
                : "from branch bases"}
            </span>
          </div>
          {[...layers].reverse().map((layer) => (
            <LayerRow key={layer.branch} layer={layer} onOpen={openLayer} />
          ))}
          {base ? (
            <>
              <div
                role="separator"
                {...stylex.props(menuStyles.separator, styles.rule)}
              />
              <div {...stylex.props(styles.baseRow)}>
                <span {...stylex.props(styles.slot)} />
                <span
                  {...stylex.props(
                    textStyles.truncate,
                    styles.branch,
                    styles.faint,
                  )}
                >
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

  const tooltip = useTooltip(
    current
      ? ""
      : disabled
        ? "No whiteboard of this pull request yet"
        : reviewed
          ? "Open whiteboard (Cmd/Ctrl-click to open in the background)"
          : "Create a whiteboard of this branch (Cmd/Ctrl-click to open in the background)",
  );

  const open = (event: OpenEvent) => {
    if (!current) onOpen(layer, event);
  };

  return (
    <button
      ref={tooltip}
      type="button"
      role="menuitem"
      aria-current={current || undefined}
      data-relation={layer.relation}
      disabled={disabled}
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
      <span
        {...stylex.props(
          textStyles.truncate,
          styles.branch,
          current && styles.branchCurrent,
        )}
      >
        {layer.branch}
      </span>
      <span
        {...stylex.props(
          textStyles.truncate,
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
    paddingInline: space.s8,
    fontSize: fontSize.ui,
    lineHeight: leading.px16,
    cursor: "pointer",
  },
  pillBar: {
    height: "26px",
    paddingInline: space.s10,
    fontSize: fontSize.body,
  },
  pillIcon: { width: "13px", height: "13px" },
  pillName: { fontWeight: fontWeight.medium },
  pillCount: { color: tokens.inkMuted },
  pillChevron: { width: "10px", height: "10px" },
  menu: { width: "min(500px, calc(100vw - 16px))", padding: space.s6 },
  heading: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    padding: `${space.s6} ${space.s10} ${space.s8}`,
    color: tokens.inkFaint,
    fontSize: fontSize.small,
  },
  row: { gap: space.s10, minHeight: "34px", paddingInline: space.s10 },
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
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
  },
  branchCurrent: { color: tokens.ink },
  title: {
    flex: "1 1 0",
    minWidth: 0,
    color: tokens.ink,
    fontSize: fontSize.ui,
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
  rule: { marginInline: space.s6 },
  baseRow: {
    display: "flex",
    flex: "none",
    alignItems: "center",
    gap: space.s10,
    minHeight: "30px",
    paddingInline: space.s10,
    color: tokens.inkFaint,
    fontSize: fontSize.body,
  },
});
