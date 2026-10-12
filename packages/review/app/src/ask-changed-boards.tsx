import { boardTitle } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useEffect, useState } from "react";
import { z } from "zod";

import { BoardIcon } from "./board-icons";
import { useReviewSession } from "./host/review-session";
import { fontSize } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

const boardsSchema = z.object({
  boards: z.array(
    z.object({
      reviewId: z.string(),
      title: z.string(),
      icon: z.enum(["board", "code"]).optional().catch(undefined),
      blockId: z.string().optional(),
    }),
  ),
});

/** Boards this thread's agent has edited, newest first. Refetched after each turn. */
export function AskChangedBoards({
  threadId,
  turns,
}: {
  threadId: string | null;
  turns: number;
}): ReactElement | null {
  const session = useReviewSession();

  const [boards, setBoards] = useState<z.infer<typeof boardsSchema>["boards"]>(
    [],
  );

  useEffect(() => {
    if (threadId === null) return setBoards([]);
    let current = true;

    void session
      .fetch(`/ask/${threadId}/boards`)
      .then(async (response) =>
        response.ok ? boardsSchema.parse(await response.json()).boards : [],
      )
      .catch(() => [])
      .then((read) => {
        if (current) setBoards(read);
      });

    return () => {
      current = false;
    };
  }, [session, threadId, turns]);

  if (!boards.length) return null;

  return (
    <nav
      aria-label="Boards this conversation changed"
      {...stylex.props(styles.list)}
    >
      <span>
        Edited {boards.length} {boards.length === 1 ? "board" : "boards"}
      </span>
      {boards.map((board) => (
        <button
          key={board.reviewId}
          type="button"
          {...stylex.props(styles.board)}
          onClick={(event) =>
            void session.surface.post({
              name: "openReview",
              args: {
                reviewUuid: board.reviewId,
                active: !(event.metaKey || event.ctrlKey || event.shiftKey),
                ...(board.blockId && { blockId: board.blockId }),
              },
            })
          }
        >
          <BoardIcon icon={board.icon} xstyle={styles.icon} />
          {boardTitle(board.title)}
        </button>
      ))}
    </nav>
  );
}

const styles = stylex.create({
  list: {
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
  board: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.accent,
    font: "inherit",
    cursor: "pointer",
  },
  icon: { width: "12px", height: "12px" },
});
