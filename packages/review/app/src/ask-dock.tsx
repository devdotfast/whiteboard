import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";

import { useAskHistory } from "./ask-history";
import { AskBoardTitleContext } from "./ask-open-state";
import { useReviewDebugSettings } from "./debug-settings";
import { useOptionalReviewSession } from "./host/review-session";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import type { AskView } from "./review-panel-model";
import { askColumnShown, peekShown } from "./review-panel-store";
import { withClass } from "./stylex-props";
import { themeClass, themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";

/** Desktop's right-column host; undefined in other hosts. */
export function useAskPanelHost(): HTMLElement | undefined {
  const bridge = useOptionalReviewSession()?.bridge;

  return useMemo(() => bridge?.askPanelHost?.(), [bridge]);
}

/** Inside Desktop's right column: frames there sit level with the window
 * controls. */
export const InRightColumn = createContext(false);

export const DockHidden = createContext(false);

/** Opens Desktop's Threads tab, where there is one. */
export function useShowThreads(): (() => void) | undefined {
  const bridge = useOptionalReviewSession()?.bridge;

  return bridge?.showThreads ? () => bridge.showThreads?.() : undefined;
}

/** Portals children into Desktop's column with the canvas theme. */
export function AskDock({
  host,
  hidden = false,
  children,
}: {
  host: HTMLElement | undefined;
  /** Kept mounted but out of sight, as in a column put away. */
  hidden?: boolean;
  children: ReactNode;
}) {
  const { theme } = useReviewDebugSettings();

  const content = (
    <DockHidden.Provider value={hidden}>{children}</DockHidden.Provider>
  );

  if (!host) return hidden ? <div hidden>{content}</div> : content;

  return createPortal(
    <InRightColumn.Provider value>
      <div
        {...withClass(
          `review-app--theme-${theme}`,
          themeStyles.vars,
          themeClass(theme),
          styles.panel,
          hidden && styles.hidden,
        )}
      >
        {content}
      </div>
    </InRightColumn.Provider>,
    host,
  );
}

/** Tells Desktop whether the right column is open and which thread it
 * shows; opens threads the Threads tab asks for, and puts the column away
 * or brings it back. */
export function AskDesktopSync(): null {
  const session = useOptionalReviewSession();
  const store = useReviewPanelStore();
  const history = useAskHistory();
  const title = useContext(AskBoardTitleContext);

  // The column shows while Ask is docked open or a peek is up.
  const docked = useReviewPanel(
    (state) => askColumnShown(state) || peekShown(state),
  );

  const threadIds = useReviewPanel(
    useShallow((state) =>
      [state.askColumn, state.askWindow].flatMap(
        (key) => state.asks.find((ask) => ask.key === key)?.threadId ?? [],
      ),
    ),
  );

  const bridge = session?.bridge;

  useEffect(() => {
    bridge?.reportAsk?.({ docked, threadIds });
  }, [bridge, docked, threadIds]);

  useEffect(
    () => () => bridge?.reportAsk?.({ docked: false, threadIds: [] }),
    [bridge],
  );

  // A thread requested before the history listed it.
  const pending = useRef<string | null>(null);
  const entries = history?.entries;

  const open = useEffectEvent((id: string) => {
    const entry = entries?.find((entry) => entry.id === id);

    // Not listed yet: refresh once, and open it when the list has it.
    if (!entry) {
      if (pending.current === id) pending.current = null;
      else {
        pending.current = id;
        history?.refresh();
      }

      return;
    }

    pending.current = null;
    history?.reveal(entry);
    store.getState().openAskView({
      type: "saved",
      threadId: entry.id,
      selection: entry.selection,
      agent: entry.agent,
    });
  });

  useEffect(() => {
    if (pending.current) open(pending.current);
  }, [entries]);

  // Brought back with nothing in it, the column shows the board's latest
  // thread, else a question about the whole board; neither starts a thread.
  const toggle = useEffectEvent(() => {
    const latest = entries?.find(
      (entry) => history?.board && entry.anchor?.board === history.board,
    );

    const fallback: AskView = latest
      ? {
          type: "saved",
          threadId: latest.id,
          selection: latest.selection,
          agent: latest.agent,
        }
      : { type: "new", selection: { target: { kind: "review" }, title } };

    store.getState().toggleColumn(fallback);
  });

  useEffect(
    () =>
      session?.surface.subscribe((event) => {
        if (event.event === "openAskThread") open(event.threadId);
        else if (event.event === "toggleAskColumn") toggle();
      }),
    [session],
  );

  return null;
}

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    color: tokens.ink,
    backgroundColor: tokens.tray,
    fontFamily: tokens.chromeFont,
  },
  hidden: {
    display: "none",
  },
});
