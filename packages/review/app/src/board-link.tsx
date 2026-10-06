import * as stylex from "@stylexjs/stylex";
import type { MouseEvent, ReactNode } from "react";

import { useOptionalReviewSession } from "./host/review-session";
import { tokens } from "./tokens.stylex";

/** What a board link points at now. Missing if the board or block was deleted. */
export interface BoardLinkTarget {
  title?: string;
  missing: boolean;
  /** Set when this host recorded the board's deletion. */
  deletedAt?: string;
  pullRequestNumber?: number;
  updatedAt?: string;
}

function missingLabel(
  target: BoardLinkTarget | undefined,
  blockId: string | undefined,
): string {
  if (target?.deletedAt) {
    const day = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(target.deletedAt));

    return `Board deleted · ${day}`;
  }

  // The board still exists, so the block was deleted.
  if (target?.title && blockId !== undefined) return "Block deleted";

  return "Board deleted";
}

/** Inline board link; deleted targets are struck through. */
export function BoardLink({
  reviewId,
  blockId,
  target,
  children,
}: {
  reviewId: string;
  /** Block to scroll to when the board opens. */
  blockId?: string;
  /** Undefined if unknown, e.g. the links failed to load. Renders as a normal link. */
  target: BoardLinkTarget | undefined;
  children?: ReactNode;
}) {
  const session = useOptionalReviewSession();

  if (target?.missing)
    return (
      <span
        data-unavailable="board"
        title={missingLabel(target, blockId)}
        {...stylex.props(styles.link, styles.missing)}
      >
        {children}
      </span>
    );

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void session?.surface.post({
      name: "openReview",
      args: {
        reviewUuid: reviewId,
        active: !(event.metaKey || event.ctrlKey || event.shiftKey),
        ...(blockId !== undefined && { blockId }),
      },
    });
  };

  return (
    <a
      href={`#board-${reviewId}`}
      onClick={open}
      {...stylex.props(styles.link)}
    >
      {children}
    </a>
  );
}

const styles = stylex.create({
  link: {
    display: "inline",
    color: tokens.accent,
    textDecoration: "none",
    cursor: "pointer",
  },
  missing: {
    color: tokens.inkFaint,
    textDecoration: "line-through",
    cursor: "default",
  },
});
