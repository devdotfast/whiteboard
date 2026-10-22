import { iconStyles } from "@canvas/ui/icon-styles";
import { ChatIcon, ChevronDownIcon, CopyIcon } from "@canvas/ui/icons";
import type { AgentSelection } from "@review/agent-selection";
import type { AskAgentId } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  AskAgentMenu,
  preferredAskAgent,
  rememberAskAgent,
  useAskAgents,
} from "./ask-agent-picker";
import { askAnchor } from "./ask-anchor";
import { copyAgentContext } from "./copy-agent-context";
import { useReviewDebugSettings } from "./debug-settings";
import { useReviewSession } from "./host/review-session";
import { useNotify } from "./notify";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { useOptionalReviewPanelStore } from "./review-panel";
import { fontSize, layer, motion, space } from "./scale.stylex";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";
import { Shortcut } from "./ui/kbd";
import { surfaceStyles } from "./ui/surface";

type Selection = Omit<AgentSelection, "revision"> & {
  anchor?: { x: number; y: number; right?: number };
  anchorElement?: Element;
  anchorContainer?: HTMLElement;
  /** The selected document text, read for its context only when asked. */
  range?: Range;
  /** Clears the editor selection represented by these actions. */
  onDismiss?: () => void;
  /** Hides the toolbar; the shortcuts still work. */
  quiet?: boolean;
};

type Select = (selection: Selection | null) => void;

function payloadOf({
  anchor: _anchor,
  anchorElement: _anchorElement,
  anchorContainer: _anchorContainer,
  range: _range,
  onDismiss: _onDismiss,
  quiet: _quiet,
  ...payload
}: Selection) {
  return payload;
}

const selectionKey = (selection: Selection) =>
  JSON.stringify([
    selection.target,
    selection.selectedDiff,
    selection.apiSource,
  ]);

const SelectionContext = createContext<Select>(() => {});

export function useAgentSelection() {
  return useContext(SelectionContext);
}

/** A selection is local UI state. Only an explicit copy requests its Markdown. */
export function AgentSelectionProvider({
  revision,
  children,
}: {
  revision: string;
  children: ReactNode;
}) {
  const session = useReviewSession();
  const { theme } = useReviewDebugSettings();
  const panels = useOptionalReviewPanelStore();
  // Ask needs a panel to answer in and a host that runs agents (Desktop).
  const askAgents = useAskAgents(panels ? session : null);
  const checkoutGone = useReviewDiffFiles().status === "unavailable";
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);

  const bindOverlay = useCallback((node: HTMLSpanElement | null) => {
    setOverlayHost(
      node?.closest<HTMLElement>(".review-canvas-root") ??
        node?.parentElement ??
        null,
    );
  }, []);

  const [selection, setSelection] = useState<Selection | null>(null);
  const currentSelection = useRef<Selection | null>(null);
  const [copiedSelection, setCopiedSelection] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const actions = useRef<HTMLDivElement>(null);
  const copying = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const pointerElement = useRef<Element | null>(null);
  useEffect(() => {
    const remember = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      const target = event.composedPath()[0];
      pointerElement.current = target instanceof Element ? target : null;
    };

    window.addEventListener("pointerdown", remember, true);

    return () => window.removeEventListener("pointerdown", remember, true);
  }, []);

  const notify = useNotify();

  const select = useCallback<Select>(
    (value) => {
      if (value) {
        const root = overlayHost?.getRootNode();
        const surface = root instanceof ShadowRoot ? root : document;

        const anchor = value.anchor ??
          pointer.current ?? {
            x: window.innerWidth / 2,
            y: window.innerHeight - 70,
          };

        const element =
          value.anchorElement ??
          surface.elementFromPoint?.(anchor.x, anchor.y) ??
          pointerElement.current;

        // Like the old comment chip, live inside the document's positioning
        // context so browser scrolling moves both the text and its action.
        const container =
          element?.closest<HTMLElement>(
            ".review-document, .diagram-tour-overlay",
          ) ?? overlayHost;

        const rect = container?.getBoundingClientRect();
        value = {
          ...value,
          anchorContainer: container ?? undefined,
          anchor: {
            x: Math.max(8, anchor.x - (rect?.left ?? 0)),
            // Above the selection: the toolbar's 34px and a 2px gap.
            y: anchor.y - (rect?.top ?? 0) - 36,
            right:
              value.anchor?.right === undefined
                ? undefined
                : Math.max(
                    8,
                    (rect?.right ?? window.innerWidth) - value.anchor.right,
                  ),
          },
        };
      }

      const previous = currentSelection.current;

      const sameBlock =
        previous?.target.kind === "block" &&
        value?.target.kind === "block" &&
        previous.target.blockId === value.target.blockId;

      if (previous?.onDismiss && !sameBlock) {
        currentSelection.current = null;
        previous.onDismiss();
      }

      currentSelection.current = value;

      if (!value || sameBlock) setCopiedSelection(null);

      setChoosing(false);
      setSelection(value);
    },
    [overlayHost],
  );

  useEffect(() => {
    select(null);
  }, [revision, select]);
  useEffect(
    () =>
      session.surface.subscribe((event) => {
        if (
          event.event !== "editorSelectionChanged" ||
          event.reviewId !== session.config.reviewId ||
          event.isEmpty === undefined ||
          !event.sideContext
        )
          return;

        if (event.isEmpty) {
          // A caret inside a selected block does not replace its selection.
          // Monaco takes ownership only once it has a real text range.
          if (currentSelection.current?.target.kind === "block") return;

          select(null);

          return;
        }

        select({
          target: {
            kind: "code",
            path: event.path,
            side: event.sideContext,
            startLine: event.range.fromLine,
            endLine: event.range.toLine,
          },
          selectedDiff: event.selectedDiff,
          apiSource: event.apiSource,
          title: `${event.path}:${event.range.fromLine}–${event.range.toLine}`,
          anchor: event.anchor,
        });
      }),
    [session, select],
  );

  const copy = useCallback(async () => {
    if (!selection || copying.current) return;
    copying.current = true;
    setCopiedSelection(selectionKey(selection));

    try {
      await copyAgentContext(session, { ...payloadOf(selection), revision });
      notify({
        kind: "success",
        text: "Selection copied to clipboard. Paste into your agent to chat about it.",
      });
    } catch {
      setCopiedSelection(null);
      notify({
        kind: "error",
        text: "Could not copy selection. Please try again.",
      });
    } finally {
      copying.current = false;
    }
  }, [selection, session, revision]);

  const askAgent =
    !checkoutGone && askAgents && preferredAskAgent(session, askAgents);

  const canChooseAgent =
    (askAgents?.filter((candidate) => candidate.available).length ?? 0) > 1;

  const ask = useCallback(
    (agent?: AskAgentId) => {
      if (!selection || !panels) return;

      const payload = payloadOf(selection);
      const { range } = selection;

      // The saved conversation marks this passage by its place in its
      // block, so its pin finds it again in later versions.
      const anchor =
        payload.target.kind === "text" && range && askAnchor(range);

      if (payload.target.kind === "text" && anchor)
        payload.target = { ...payload.target, anchor };

      if (agent) rememberAskAgent(session, agent);
      panels.getState().openAsk({ ...payload, revision }, agent);
      select(null);
    },
    [selection, panels, revision, select, session],
  );

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        selection &&
        event.metaKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void copy();
      }

      if (
        selection &&
        askAgent &&
        event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        event.key.toLowerCase() === "l"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        ask();
      }

      if (event.key === "Escape") {
        if (
          selection?.target.kind === "block" &&
          actions.current?.contains(document.activeElement)
        )
          selection.anchorElement
            ?.closest<HTMLElement>(".review-board-editor")
            ?.focus({ preventScroll: true });

        select(null);
      }
    };

    window.addEventListener("keydown", keydown, true);

    return () => window.removeEventListener("keydown", keydown, true);
  }, [selection, copy, select, askAgent, ask]);

  useEffect(() => {
    if (!selection) return;

    const dismiss = (event: Event) => {
      const path = event.composedPath();

      if (actions.current && path.includes(actions.current)) return;

      if (
        event.type === "pointerdown" &&
        selection.target.kind === "block" &&
        selection.anchorElement &&
        path.includes(selection.anchorElement)
      )
        return;

      select(null);
    };

    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("wheel", dismiss, true);

    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("wheel", dismiss, true);
    };
  }, [selection, select]);

  return (
    <SelectionContext.Provider value={select}>
      {children}
      <span hidden ref={bindOverlay} />
      {overlayHost &&
        selection &&
        !selection.quiet &&
        copiedSelection !== selectionKey(selection) &&
        createPortal(
          // The toolbar starts at the selection, after a lead that
          // gives way so it never runs past the container's edge.
          <div
            {...stylex.props(
              themeStyles.vars,
              theme === "light" && themeStyles.light,
              styles.lane,
            )}
            style={{
              top: selection.anchor?.y,
              right: selection.anchor?.right,
            }}
          >
            <span
              {...stylex.props(styles.lead)}
              style={{ flexBasis: selection.anchor?.x }}
            />
            <div
              ref={actions}
              {...stylex.props(surfaceStyles.popover, styles.actions)}
              onMouseDown={(event) => event.preventDefault()}
            >
              {askAgents && askAgent ? (
                <>
                  <span {...stylex.props(styles.split)}>
                    <Button
                      variant="primary"
                      aria-keyshortcuts="Meta+L"
                      onClick={() => ask()}
                      xstyle={canChooseAgent && styles.splitMain}
                    >
                      <ChatIcon xstyle={iconStyles.inline} />
                      <span>Ask {askAgent.name}</span>
                      <Shortcut aria-hidden="true" xstyle={styles.key}>
                        ⌘L
                      </Shortcut>
                    </Button>
                    {canChooseAgent ? (
                      <Button
                        variant="primary"
                        aria-label="Ask another agent"
                        aria-haspopup="menu"
                        aria-expanded={choosing}
                        onClick={() => setChoosing((value) => !value)}
                        xstyle={styles.splitMenu}
                      >
                        <ChevronDownIcon
                          xstyle={[
                            styles.chevron,
                            choosing && styles.chevronOpen,
                          ]}
                        />
                      </Button>
                    ) : null}
                  </span>
                  {canChooseAgent && choosing ? (
                    <AskAgentMenu
                      agents={askAgents}
                      current={askAgent.id}
                      within={actions}
                      onPick={ask}
                      onDismiss={() => setChoosing(false)}
                    />
                  ) : null}
                </>
              ) : null}
              <Button
                variant="ghost"
                aria-keyshortcuts="Meta+Shift+C"
                aria-label="Copy ref"
                onClick={() => void copy()}
              >
                <CopyIcon xstyle={iconStyles.inline} />
                <span>Copy ref</span>
                <Shortcut aria-hidden="true" xstyle={styles.key}>
                  ⇧⌘C
                </Shortcut>
              </Button>
            </div>
          </div>,
          selection.anchorContainer ?? overlayHost,
        )}
    </SelectionContext.Provider>
  );
}

// The selection's agent actions, beside the selected text: Ask the preferred
// agent (or pick another), or copy the selection for an agent elsewhere.
const styles = stylex.create({
  // Spans its container, short of the right edge; only the toolbar takes
  // the pointer. Outside .review-app it brings the chrome tokens.
  lane: {
    position: "absolute",
    left: 0,
    right: space.s8,
    zIndex: layer.agentSelection,
    display: "flex",
    pointerEvents: "none",
  },
  lead: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  actions: {
    position: "relative",
    flex: "none",
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s4,
    padding: space.s4,
    whiteSpace: "nowrap",
  },
  // Ask and its agent menu are one split button; the fill sets it apart from
  // Copy, so the toolbar needs no divider with or without the menu.
  split: {
    display: "inline-flex",
  },
  splitMain: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  splitMenu: {
    width: "22px",
    padding: 0,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    boxShadow: `inset 1px 0 0 color-mix(in srgb, ${tokens.onAccent} 28%, transparent)`,
  },
  chevron: {
    transition: {
      default: `transform ${motion.medium} ${motion.enter}`,
      [stylex.env.reducedMotion]: "none",
    },
  },
  chevronOpen: {
    transform: "rotate(180deg)",
  },
  key: {
    opacity: 0.65,
  },
});
