import { iconStyles } from "@canvas/ui/icon-styles";
import { TrashIcon } from "@canvas/ui/icons";
import { useTooltip } from "@canvas/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useEffect, useState } from "react";

import { useShowThreads } from "./ask-dock";
import { useAskHistory } from "./ask-history";
import { useNotify } from "./notify";
import {
  useAskKey,
  useOptionalReviewPanel,
  useOptionalReviewPanelStore,
} from "./review-panel";
import { fontSize, leading, radius, space } from "./scale.stylex";
import type { StyleArg } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { IconButton } from "./ui/button";

/** How long a first click keeps a delete armed. */
const ARMED_MS = 4_000;

/** A delete that asks once more: the first click arms it, the second
 * deletes. It disarms after a few seconds, or when focus leaves it. */
export function AskDeleteButton({
  label,
  xstyle,
  onDelete,
}: {
  label: string;
  xstyle?: StyleArg;
  onDelete: () => void;
}): ReactElement {
  const [armed, setArmed] = useState(false);
  const tooltip = useTooltip(armed ? "Click again to delete" : label);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_MS);

    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <IconButton
      ref={tooltip}
      size="large"
      xstyle={[xstyle, armed && styles.armed]}
      aria-label={armed ? `Confirm: ${label}` : label}
      onClick={() => {
        if (!armed) {
          setArmed(true);

          return;
        }

        setArmed(false);
        onDelete();
      }}
      onBlur={() => setArmed(false)}
    >
      <TrashIcon xstyle={[iconStyles.inert, iconStyles.chrome]} />
      {armed ? <span>Delete</span> : null}
    </IconButton>
  );
}

/** Deletes the saved conversation; the agent keeps its own transcript. */
export function AskDeleteThreadButton(): ReactElement | null {
  const askKey = useAskKey();

  const threadId = useOptionalReviewPanel(
    (state) => state.asks.find((ask) => ask.key === askKey)?.threadId,
  );

  const history = useAskHistory();
  const panels = useOptionalReviewPanelStore();
  const notify = useNotify();
  const showThreads = useShowThreads();

  if (!threadId || !history?.entries?.some((entry) => entry.id === threadId))
    return null;

  return (
    <AskDeleteButton
      label="Delete this conversation"
      onDelete={() =>
        void history.forget(threadId).then((deleted) => {
          if (deleted && showThreads) {
            if (askKey !== undefined) panels?.getState().hideAsk(askKey);
            showThreads();
          } else if (deleted)
            panels
              ?.getState()
              .openAskView(
                { type: "history" },
                { from: askKey, replace: true },
              );
          else
            notify({
              kind: "error",
              text: "Whiteboard could not delete this conversation.",
            });
        })
      }
    />
  );
}

const styles = stylex.create({
  // A delete armed by its first click reads as the question it is.
  armed: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s4,
    width: "auto",
    padding: `0 ${space.s8}`,
    borderRadius: radius.control,
    backgroundColor: tokens.diffRemovedBg,
    color: tokens.changeRemoved,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: leading.px14,
    opacity: 1,
  },
});
