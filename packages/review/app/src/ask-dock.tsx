import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  createContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";

import { useAskHistory } from "./ask-history";
import { useReviewDebugSettings } from "./debug-settings";
import { useOptionalReviewSession } from "./host/review-session";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import { askDockedShown } from "./review-panel-store";
import { withClass } from "./stylex-props";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";

/** Desktop's right-column host; undefined in other hosts. */
export function useAskPanelHost(): HTMLElement | undefined {
  const bridge = useOptionalReviewSession()?.bridge;

  return useMemo(() => bridge?.askPanelHost?.(), [bridge]);
}

/** Inside Desktop's right column: frames there sit level with the window
 * controls. */
export const InRightColumn = createContext(false);

/** Opens Desktop's Threads tab, where there is one. */
export function useShowThreads(): (() => void) | undefined {
  const bridge = useOptionalReviewSession()?.bridge;

  return bridge?.showThreads ? () => bridge.showThreads?.() : undefined;
}

/** Portals children into Desktop's column with the canvas theme. */
export function AskDock({
  host,
  children,
}: {
  host: HTMLElement | undefined;
  children: ReactNode;
}) {
  const { theme } = useReviewDebugSettings();

  if (!host) return children;

  return createPortal(
    <InRightColumn.Provider value>
      <div
        {...withClass(
          `review-app--theme-${theme}`,
          themeStyles.vars,
          theme === "light" && themeStyles.light,
          styles.panel,
        )}
      >
        {children}
      </div>
    </InRightColumn.Provider>,
    host,
  );
}

/** Tells Desktop whether the right column is open and which thread it
 * shows; opens threads the Threads tab asks for. */
export function AskDesktopSync(): null {
  const session = useOptionalReviewSession();
  const store = useReviewPanelStore();
  const history = useAskHistory();

  // The column shows while Ask is docked open or a peek is up.
  const docked = useReviewPanel(
    (state) => askDockedShown(state) || state.active !== null,
  );

  const threadId = useReviewPanel(
    (state) =>
      state.asks.find((ask) => ask.key === state.askDocked)?.threadId ??
      undefined,
  );

  const bridge = session?.bridge;

  useEffect(() => {
    bridge?.reportAsk?.({ docked, ...(threadId && { threadId }) });
  }, [bridge, docked, threadId]);

  useEffect(() => () => bridge?.reportAsk?.({ docked: false }), [bridge]);

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

  useEffect(
    () =>
      session?.surface.subscribe((event) => {
        if (event.event === "openAskThread") open(event.threadId);
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
});
