import { BoardIcon } from "@canvas/ui/board-icons";
import { Button } from "@canvas/ui/button";
import { boardTitle } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useEffect, useState } from "react";
import { z } from "zod";

import { countLabel } from "./format";
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
      <span>Edited {countLabel(boards.length, "board")}</span>
      {boards.map((board) => (
        <Button
          key={board.reviewId}
          variant="link"
          tone="accent"
          xstyle={styles.board}
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
        </Button>
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
  board: { gap: "4px", whiteSpace: "normal" },
  icon: { width: "12px", height: "12px" },
});
