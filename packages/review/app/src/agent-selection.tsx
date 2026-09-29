import type { AgentSelection } from "@review/agent-selection";
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
import { z } from "zod";

import { copyText } from "./copy-text";
import { useReviewSession } from "./host/review-session";
import { useToast } from "./toast";

type Selection = Omit<AgentSelection, "revision"> & {
  anchor?: { x: number; y: number };
  anchorElement?: Element;
  anchorContainer?: HTMLElement;
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
      ...payload
    } = selection;

    try {
      const response = await session.fetch("/copy-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, revision }),
      });

      if (!response.ok) throw new Error("Context unavailable");

      const { text } = z
        .object({ text: z.string() })
        .parse(await response.json());

      if (!(await copyText(text))) throw new Error("Clipboard unavailable");
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

      if (event.key === "Escape") select(null);
    };

    window.addEventListener("keydown", keydown, true);

    return () => window.removeEventListener("keydown", keydown, true);
  }, [selection, copy, select]);

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
                <button
                  type="button"
                  {...stylex.props(styles.popover)}
                  aria-keyshortcuts="Meta+Shift+C"
                  aria-label="Copy for Agent"
                  disabled={busy}
                  style={{
                    position: "absolute",
                    left: selection.anchor?.x,
                    top: selection.anchor?.y,
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void copy()}
                >
                  <span>{busy ? "Copying…" : "Copy for Agent"}</span>
                  <kbd aria-hidden="true" {...stylex.props(styles.keys)}>
                    <span {...stylex.props(styles.key)}>⇧</span>
                    <span {...stylex.props(styles.key)}>⌘</span>
                    <span {...stylex.props(styles.key)}>C</span>
                  </kbd>
                </button>,
                selection.anchorContainer ?? overlayHost,
              )}
            {toast}
          </>,
          overlayHost,
        )}
    </SelectionContext.Provider>
  );
}

const systemFont = "-apple-system, BlinkMacSystemFont, sans-serif";

// Rendered in the workbench document so native Monaco and prose use one
// affordance, so it takes the workbench's widget colors.
const styles = stylex.create({
  popover: {
    position: "fixed",
    zIndex: 10002,
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 9px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--vscode-editorWidget-border, #3b3b3b)",
    borderRadius: "6px",
    backgroundColor: {
      default: "var(--vscode-editorWidget-background, #202020)",
      ":hover":
        "color-mix(in srgb, var(--vscode-editorWidget-background, #202020) 90%, var(--vscode-editor-foreground, #eee) 10%)",
    },
    color: "var(--vscode-editor-foreground, #eee)",
    boxShadow: "0 3px 12px #0004",
    font: `13px/20px ${systemFont}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: {
      default: null,
      ":focus-visible": "2px solid var(--vscode-focusBorder, #87baff)",
    },
  },
  keys: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "0 5px",
    borderRadius: "4px",
    backgroundColor: "#8882",
    color: "var(--vscode-descriptionForeground, #aaa)",
    font: `500 13px/20px ${systemFont}`,
    letterSpacing: 0,
  },
  key: {
    display: "inline-block",
  },
});
