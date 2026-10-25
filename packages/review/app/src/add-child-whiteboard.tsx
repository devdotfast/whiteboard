import { type ReviewApiSummary, boardTitle } from "@dev.fast/review-protocol";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";

import { boardControlStyles } from "./ui/board-disclosure";
import { IconButton } from "./ui/button";
import { iconStyles } from "./ui/icon-styles";
import { PlusIcon } from "./ui/icons";
import { useTooltip } from "./ui/tooltip";
import { useWhiteboardExpansion } from "./whiteboard-expansion";

/** Shared mutation: keep focus while pending and retry inline on failure. */
export function AddChildWhiteboard({
  board,
  onCreate,
  onError,
  xstyle,
}: {
  board: ReviewApiSummary;
  onCreate(parentId: string): Promise<void>;
  onError(message: string): void;
  xstyle?: StyleXStyles;
}) {
  const pending = useRef(false);
  const { setExpanded } = useWhiteboardExpansion();

  const create = useMutation({
    mutationFn: () => onCreate(board.reviewId),
    onSuccess: () => setExpanded(board.project?.id, board.reviewId, true),
    onError: (error) => onError(error.message),
    onSettled: () => {
      pending.current = false;
    },
  });

  const tooltip = useTooltip("Add child whiteboard");

  return (
    <IconButton
      ref={tooltip}
      size="small"
      aria-label={`Add child whiteboard to ${boardTitle(board.title)}`}
      aria-busy={create.isPending}
      xstyle={[boardControlStyles.reveal, xstyle]}
      onClick={(event) => {
        event.stopPropagation();

        if (pending.current) return;
        pending.current = true;
        onError("");
        create.mutate();
      }}
    >
      <PlusIcon xstyle={iconStyles.inline} />
    </IconButton>
  );
}
