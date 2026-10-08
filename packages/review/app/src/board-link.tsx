import * as stylex from "@stylexjs/stylex";
import type { MouseEvent, ReactNode } from "react";

import { useOptionalReviewSession } from "./host/review-session";
import { tokens } from "./tokens.stylex";

/** Inline board link. */
export function BoardLink({
  reviewId,
  blockId,
  children,
}: {
  reviewId: string;
  /** Block to scroll to when the board opens. */
  blockId?: string;
  children?: ReactNode;
}) {
  const session = useOptionalReviewSession();

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
});
