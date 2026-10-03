import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAskHistory } from "./ask-history";
import { controlStyles } from "./controls-styles";
import { TrashIcon } from "./icons";
import { useAskKey, useOptionalReviewPanelStore } from "./review-panel";
import { fontSize, radius } from "./scale.stylex";
import type { StyleArg } from "./stylex-props";
import { useToast } from "./toast";
import { tokens } from "./tokens.stylex";
import { IconButton } from "./ui/button";
import { useTooltip } from "./use-tooltip";

/** How long a first click keeps a delete armed. */
const ARMED_MS = 4_000;

interface OpenThread {
  threadId: string | null;
  show: (threadId: string | null) => void;
}

/** The conversation the Ask panel shows, for its header to act on. */
const OpenThreadContext = createContext<OpenThread | null>(null);

export function AskOpenThreadProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [threadId, show] = useState<string | null>(null);
  const value = useMemo(() => ({ threadId, show }), [threadId]);

  return (
    <OpenThreadContext.Provider value={value}>
      {children}
    </OpenThreadContext.Provider>
  );
}

/** Tells the panel's header which conversation is open. */
export function useShowOpenThread(threadId: string | null) {
  const show = useContext(OpenThreadContext)?.show;

  useEffect(() => {
    show?.(threadId);

    return () => show?.(null);
  }, [show, threadId]);
}

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
      <TrashIcon xstyle={[controlStyles.inertIcon, controlStyles.chromeIcon]} />
      {armed ? <span>Delete</span> : null}
    </IconButton>
  );
}

/** The header's delete for the open conversation, once it is saved: it
 * leaves Whiteboard, and the panel returns to the saved conversations. The
 * agent keeps its own transcript. */
export function AskDeleteThreadButton(): ReactElement | null {
  const threadId = useContext(OpenThreadContext)?.threadId;
  const history = useAskHistory();
  const panels = useOptionalReviewPanelStore();
  const askKey = useAskKey();
  const { showToast, toast } = useToast();

  if (!threadId || !history?.entries?.some((entry) => entry.id === threadId))
    return null;

  return (
    <>
      <AskDeleteButton
        label="Delete this conversation"
        onDelete={() =>
          void history.forget(threadId).then((deleted) => {
            if (deleted)
              panels
                ?.getState()
                .openAskView(
                  { type: "history" },
                  { from: askKey, replace: true },
                );
            else
              showToast({
                kind: "error",
                text: "Whiteboard could not delete this conversation.",
              });
          })
        }
      />
      {toast}
    </>
  );
}

const styles = stylex.create({
  // A delete armed by its first click reads as the question it is.
  armed: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    width: "auto",
    padding: "0 8px",
    borderRadius: radius.control,
    backgroundColor: tokens.diffRemovedBg,
    color: tokens.changeRemoved,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    opacity: 1,
  },
});
