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
import {
  AskChevronIcon,
  AskCopyIcon,
  AskIcon,
  askIconSizes,
} from "./ask-icons";
import { copyAgentContext } from "./copy-agent-context";
import { useReviewSession } from "./host/review-session";
import { useOptionalReviewPanelStore } from "./review-panel";
import { fontSize, layer, radius } from "./scale.stylex";
import { useToast } from "./toast";
import { tokens } from "./tokens.stylex";
import { surfaceStyles } from "./ui/surface";

type Selection = Omit<AgentSelection, "revision"> & {
  anchor?: { x: number; y: number };
  anchorElement?: Element;
  anchorContainer?: HTMLElement;
  /** The selected document text, read for its context only when asked. */
  range?: Range;
};

type Select = (selection: Selection | null) => void;

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
  const panels = useOptionalReviewPanelStore();
  // Ask needs a panel to answer in and a host that runs agents (Desktop).
  const askAgents = useAskAgents(panels ? session : null);
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);

  const bindOverlay = useCallback((node: HTMLSpanElement | null) => {
    setOverlayHost(
      node?.closest<HTMLElement>(".review-canvas-root") ??
        node?.parentElement ??
        null,
    );
  }, []);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [copiedSelection, setCopiedSelection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const { toast, showToast: setToast } = useToast(4_000);

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
          element?.closest<HTMLElement>(".review-document") ?? overlayHost;

        const rect = container?.getBoundingClientRect();
        value = {
          ...value,
          anchorContainer: container ?? undefined,
          anchor: {
            x: Math.max(
              8,
              Math.min(
                anchor.x - (rect?.left ?? 0),
                (rect?.width || window.innerWidth) - 220,
              ),
            ),
            y: anchor.y - (rect?.top ?? 0) - 38,
          },
        };
      }

      if (!value) setCopiedSelection(null);
      setChoosing(false);
      setSelection(value);
    },
    [overlayHost],
  );

  useEffect(() => {
    setSelection(null);
  }, [revision]);
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
    setBusy(true);

    const {
      anchor: _anchor,
      anchorElement: _anchorElement,
      anchorContainer: _anchorContainer,
      range: _range,
      ...payload
    } = selection;

    try {
      await copyAgentContext(session, { ...payload, revision });
      setCopiedSelection(
        JSON.stringify([
          selection.target,
          selection.selectedDiff,
          selection.apiSource,
        ]),
      );
      setToast({
        kind: "success",
        text: "Selection copied to clipboard. Paste into your agent to chat about it.",
      });
    } catch {
      setToast({
        kind: "error",
        text: "Could not copy selection. Please try again.",
      });
    } finally {
      copying.current = false;
      setBusy(false);
    }
  }, [selection, session, revision]);

  const askAgent = askAgents && preferredAskAgent(session, askAgents);

  const ask = useCallback(
    (agent?: AskAgentId) => {
      if (!selection || !panels) return;

      const {
        anchor: _anchor,
        anchorElement: _anchorElement,
        anchorContainer: _anchorContainer,
        range,
        ...payload
      } = selection;

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

      if (event.key === "Escape") select(null);
    };

    window.addEventListener("keydown", keydown, true);

    return () => window.removeEventListener("keydown", keydown, true);
  }, [selection, copy, select, askAgent, ask]);

  return (
    <SelectionContext.Provider value={select}>
      {children}
      <span hidden ref={bindOverlay} />
      {overlayHost &&
        createPortal(
          <>
            {selection &&
              copiedSelection !==
                JSON.stringify([
                  selection.target,
                  selection.selectedDiff,
                  selection.apiSource,
                ]) &&
              createPortal(
                <div
                  ref={actions}
                  {...stylex.props(surfaceStyles.popover, styles.actions)}
                  style={{
                    position: "absolute",
                    left: selection.anchor?.x,
                    top: selection.anchor?.y,
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {askAgents && askAgent ? (
                    <>
                      <button
                        type="button"
                        {...stylex.props(styles.action, styles.ask)}
                        aria-keyshortcuts="Meta+L"
                        onClick={() => ask()}
                      >
                        <AskIcon xstyle={askIconSizes.toolbar} />
                        <span>Ask {askAgent.name}</span>
                        <kbd
                          aria-hidden="true"
                          {...stylex.props(styles.askKey)}
                        >
                          ⌘L
                        </kbd>
                      </button>
                      <button
                        type="button"
                        {...stylex.props(
                          styles.action,
                          styles.quiet,
                          styles.switch,
                          choosing && styles.quietOpen,
                        )}
                        aria-label="Ask another agent"
                        aria-haspopup="menu"
                        aria-expanded={choosing}
                        onClick={() => setChoosing((value) => !value)}
                      >
                        <AskChevronIcon />
                      </button>
                      <span
                        {...stylex.props(styles.divider)}
                        aria-hidden="true"
                      />
                      {choosing ? (
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
                  <button
                    type="button"
                    {...stylex.props(styles.action, styles.quiet, styles.copy)}
                    aria-keyshortcuts="Meta+Shift+C"
                    aria-label="Copy for Agent"
                    title="Copy for agent (⇧⌘C)"
                    disabled={busy}
                    onClick={() => void copy()}
                  >
                    <AskCopyIcon xstyle={askIconSizes.toolbar} />
                    <span>{busy ? "Copying…" : "Copy for agent"}</span>
                  </button>
                </div>,
                selection.anchorContainer ?? overlayHost,
              )}
            {toast}
          </>,
          overlayHost,
        )}
    </SelectionContext.Provider>
  );
}

// The selection's agent actions, beside the selected text: Ask the preferred
// agent (or pick another), or copy the selection for an agent elsewhere.
const styles = stylex.create({
  actions: {
    zIndex: layer.agentSelection,
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    padding: "4px",
    whiteSpace: "nowrap",
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: radius.small,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
    cursor: "pointer",
    outline: {
      default: null,
      ":focus-visible": `2px solid ${tokens.accentOutline}`,
    },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  ask: {
    gap: "7px",
    padding: "5px 8px 5px 7px",
    backgroundColor: {
      default: tokens.accent,
      ":hover": `color-mix(in srgb, ${tokens.accent} 88%, white)`,
    },
    color: tokens.onAccent,
  },
  askKey: {
    color: `color-mix(in srgb, ${tokens.onAccent} 65%, transparent)`,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  quiet: {
    backgroundColor: { default: tokens.transparent, ":hover": tokens.tray },
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
  },
  quietOpen: {
    backgroundColor: tokens.tray,
    color: tokens.ink,
  },
  switch: {
    justifyContent: "center",
    width: "24px",
    height: "26px",
  },
  divider: {
    flex: "0 0 auto",
    width: "1px",
    height: "16px",
    backgroundColor: tokens.ruleSoft,
  },
  copy: {
    gap: "6px",
    padding: "5px 8px",
  },
});
