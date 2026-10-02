import { fontSize, layer } from "@canvas/scale.stylex";
import { IconButton } from "@canvas/ui/button";
import { surfaceStyles } from "@canvas/ui/surface";
import { fieldStyles } from "@canvas/ui/text-field";
import type {
  ReviewFindQuery,
  ReviewInlineEditorHandle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  type RefObject,
  createContext,
  createRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";

import { setHighlightStyle } from "./highlight-styles";
import type { ReviewClientConfig } from "./host/review-client";
import { useOptionalReviewSession } from "./host/review-session";
import { compileReviewFindQuery } from "./review-find-query";
import {
  type ReviewFindMatch,
  createReviewFindStore,
} from "./review-find-store";
import { reviewFindRanges } from "./review-find-text";
import { useReviewRoots } from "./review-root-context";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

const ALL_HIGHLIGHT = "review-find-match";

const ACTIVE_HIGHLIGHT = "review-find-match-active";

const SEARCH_DELAY_MS = 150;

interface FindController {
  showFind(seed?: string): boolean;
  hideFind(): void;
}

export interface ReviewFindHost extends FindController {
  attach(controller: FindController | null): void;
}

export function createReviewFindHost(): ReviewFindHost {
  let controller: FindController | null = null;

  return {
    attach(next) {
      controller = next;
    },
    showFind(seed) {
      return controller?.showFind(seed) ?? false;
    },
    hideFind() {
      controller?.hideFind();
    },
  };
}

export interface ReviewInlineFindRegistration {
  container: HTMLElement;
  setFindQuery(query: ReviewFindQuery): Promise<{ matchCount: number }>;
  revealFindMatch(index: number): Promise<void>;
  clearFind(): void;
  getHandle(): ReviewInlineEditorHandle | null;
  expand(): void;
}

interface FindContextValue {
  register(registration: ReviewInlineFindRegistration): () => void;
  setReviewActive(active: boolean): void;
}

const ReviewFindContext = createContext<FindContextValue | null>(null);

export function useReviewFindRegistration(): FindContextValue | null {
  return useContext(ReviewFindContext);
}

export function ReviewFindProvider({
  articleRef,
  documentKey,
  host,
  children,
}: {
  /** Read through for the provider's lifetime; pass a stable ref. */
  articleRef: RefObject<HTMLElement | null>;
  documentKey: string;
  host?: ReviewFindHost;
  children: ReactNode;
}) {
  const session = useOptionalReviewSession();

  const [controller] = useState(() =>
    createFindController(articleRef, session?.config),
  );

  const previousDocument = useRef(documentKey);

  useEffect(() => controller.connect(), [controller]);

  useEffect(() => {
    host?.attach(controller);

    return () => host?.attach(null);
  }, [controller, host]);

  // Layout, so a new document's editors never see the old query: their
  // registrations queue a search that runs after this closes.
  useLayoutEffect(() => {
    if (previousDocument.current === documentKey) return;
    previousDocument.current = documentKey;
    controller.resetForDocument();
  }, [controller, documentKey]);

  return (
    <ReviewFindContext.Provider value={controller}>
      {children}
      <ReviewFindWidget controller={controller} />
    </ReviewFindContext.Provider>
  );
}

type ReviewFindController = ReturnType<typeof createFindController>;

/** Owns everything find touches outside React state: editor registrations,
 * highlights, focus, and scrolling. */
function createFindController(
  articleRef: RefObject<HTMLElement | null>,
  config?: ReviewClientConfig,
) {
  const store = createReviewFindStore(config);
  const registrations = new Set<ReviewInlineFindRegistration>();
  const inputRef = createRef<HTMLInputElement>();
  let reviewActive = true;
  let priorFocus: HTMLElement | null = null;
  let searchScheduled = false;

  const clearHighlights = () => {
    clearCssHighlights(articleRef.current?.ownerDocument);

    for (const registration of registrations) {
      registration.clearFind();
    }
  };

  const close = (restoreFocus: boolean, clearQuery = false) => {
    clearHighlights();
    store.getState().close({ clearQuery });
    const target = priorFocus;
    priorFocus = null;

    if (restoreFocus && target?.isConnected) target.focus();
  };

  const reveal = (index: number) => {
    const { matches, setActiveIndex } = store.getState();

    if (matches.length === 0) return;
    const wrapped = (index + matches.length) % matches.length;
    const match = matches[wrapped]!;
    setActiveIndex(wrapped);
    clearActiveCssHighlight(articleRef.current?.ownerDocument);

    for (const registration of registrations) {
      registration.getHandle()?.clearActiveFindMatch();
    }

    // A frame later the search may have closed or moved on.
    const current = () => store.getState().matches.includes(match);

    if (match.kind === "mdx") {
      expandReviewSection(match.node);
      requestAnimationFrame(() => {
        if (!current()) return;
        setActiveCssHighlight(match.range);
        rangeElement(match.range)?.scrollIntoView?.({ block: "center" });
        inputRef.current?.focus();
      });
    } else {
      match.registration.expand();
      requestAnimationFrame(async () => {
        if (!current()) return;
        match.registration.container.scrollIntoView?.({ block: "center" });
        await match.registration.revealFindMatch(match.localIndex);
        inputRef.current?.focus();
      });
    }
  };

  const search = () => {
    const { open, query } = store.getState();

    if (!open) return;

    if (!query.text) {
      clearHighlights();
      store.getState().clearResults();

      return;
    }

    const compiled = compileReviewFindQuery(query);

    if ("error" in compiled) {
      store.getState().rejectQuery(compiled.error);

      return;
    }

    clearHighlights();
    const generation = store.getState().startSearch();
    // Editor searches are expensive; only a query the reader pauses on runs.
    setTimeout(() => {
      if (store.getState().generation === generation) {
        run(generation, query, compiled.expression);
      }
    }, SEARCH_DELAY_MS);
  };

  const run = (
    generation: number,
    query: ReviewFindQuery,
    expression: RegExp,
  ) => {
    const article = articleRef.current;

    const ranges = article ? reviewFindRanges(article, expression) : [];

    const orderedRegistrations = [...registrations].sort((left, right) =>
      compareDocumentOrder(left.container, right.container),
    );

    void Promise.all(
      orderedRegistrations.map(async (registration) => {
        try {
          const result = await registration.setFindQuery({
            ...query,
            text: expression.source,
            wholeWord: false,
            isRegex: true,
          });

          return { registration, matchCount: result.matchCount };
        } catch {
          return { registration, matchCount: 0 };
        }
      }),
    ).then((editorResults) => {
      const matches: ReviewFindMatch[] = [
        ...ranges.map((range) => ({
          kind: "mdx" as const,
          range,
          node: range.startContainer,
        })),
        ...editorResults.flatMap(({ registration, matchCount }) =>
          Array.from({ length: matchCount }, (_, localIndex) => ({
            kind: "editor" as const,
            registration,
            localIndex,
            node: registration.container,
          })),
        ),
      ].sort((left, right) => compareDocumentOrder(left.node, right.node));

      if (!store.getState().completeSearch(generation, matches)) return;
      setAllCssHighlights(article?.ownerDocument, ranges);

      if (matches.length > 0) reveal(0);
    });
  };

  // Registrations arrive in bursts as a document mounts; search once.
  const scheduleSearch = () => {
    if (searchScheduled) return;
    searchScheduled = true;
    queueMicrotask(() => {
      searchScheduled = false;
      search();
    });
  };

  return {
    store,
    inputRef,
    connect() {
      const unsubscribe = store.subscribe((state, previous) => {
        if (state.open !== previous.open || state.query !== previous.query) {
          search();
        }
      });

      return () => {
        unsubscribe();
        clearHighlights();
        store.getState().close();
      };
    },
    showFind(seed?: string) {
      if (!reviewActive) return false;

      if (!store.getState().open) {
        const active = articleRef.current?.ownerDocument.activeElement;
        priorFocus = active instanceof HTMLElement ? active : null;
        store.getState().show(seed ?? selectedMdxText(articleRef.current));
      }

      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });

      return true;
    },
    hideFind() {
      close(true);
    },
    navigate(delta: number) {
      const { searching, matches, activeIndex } = store.getState();

      if (!searching && matches.length > 0) reveal(activeIndex + delta);
    },
    resetForDocument() {
      close(true, true);
    },
    register(registration: ReviewInlineFindRegistration) {
      registrations.add(registration);
      scheduleSearch();

      return () => {
        registration.clearFind();
        registrations.delete(registration);
        store.getState().forgetRegistration(registration);
        scheduleSearch();
      };
    },
    setReviewActive(active: boolean) {
      reviewActive = active;

      if (!active && store.getState().open) close(false);
    },
  };
}

function ReviewFindWidget({
  controller,
}: {
  controller: ReviewFindController;
}) {
  const { store, inputRef } = controller;
  const shellRef = useReviewRoots()?.shellRef;
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const open = useStore(store, (state) => state.open);
  const query = useStore(store, (state) => state.query);
  const searching = useStore(store, (state) => state.searching);
  const invalid = useStore(store, (state) => state.error);
  const matchCount = useStore(store, (state) => state.matches.length);
  const activeIndex = useStore(store, (state) => state.activeIndex);

  // Passive, not layout: a descendant's layout effect runs before the ancestor
  // host ref attaches, so the shell is not there yet; no deps because the shell
  // remounts under this provider on route change.
  useEffect(() => {
    setOverlayHost(shellRef?.current ?? null);
  });

  if (!open || !overlayHost) return null;

  const { setText, toggleOption } = store.getState();

  return createPortal(
    <div
      {...withClass("review-find-widget", surfaceStyles.popover, styles.widget)}
      role="search"
      aria-label="Find in session"
    >
      <div
        {...stylex.props(
          fieldStyles.box,
          fieldStyles.shell,
          styles.inputShell,
          invalid ? styles.inputShellInvalid : null,
        )}
      >
        <input
          ref={inputRef}
          {...stylex.props(styles.input)}
          aria-label="Find"
          aria-invalid={invalid ? "true" : undefined}
          title={invalid ?? undefined}
          value={query.text}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              controller.hideFind();
            } else if (event.key === "Enter") {
              event.preventDefault();
              controller.navigate(event.shiftKey ? -1 : 1);
            }
          }}
        />
        <div {...stylex.props(styles.options)} aria-label="Search options">
          <FindToggle
            label="Match Case"
            description="Match Case: use the same uppercase and lowercase letters."
            active={query.matchCase}
            onClick={() => toggleOption("matchCase")}
          >
            Aa
          </FindToggle>
          <FindToggle
            label="Match Whole Word"
            description="Match Whole Word: find complete words only."
            xstyle={styles.wholeWord}
            active={query.wholeWord}
            onClick={() => toggleOption("wholeWord")}
          >
            ab
          </FindToggle>
          <FindToggle
            label="Use Regular Expression"
            description="Use Regular Expression: search with a regular expression."
            xstyle={styles.regex}
            active={query.isRegex}
            onClick={() => toggleOption("isRegex")}
          >
            .*
          </FindToggle>
        </div>
      </div>
      <span {...stylex.props(styles.count)} aria-live="polite">
        {invalid
          ? "Invalid expression"
          : searching
            ? "Searching…"
            : matchCount === 0
              ? "No results"
              : `${activeIndex + 1} of ${matchCount}`}
      </span>
      <FindActionButton
        label="Previous Match"
        description="Previous Match (Shift+Enter)"
        disabled={searching || matchCount === 0}
        onClick={() => controller.navigate(-1)}
        icon="previous"
      />
      <FindActionButton
        label="Next Match"
        description="Next Match (Enter)"
        disabled={searching || matchCount === 0}
        onClick={() => controller.navigate(1)}
        icon="next"
      />
      <FindActionButton
        label="Close Find"
        description="Close Find (Escape)"
        onClick={controller.hideFind}
        icon="close"
      />
    </div>,
    overlayHost,
  );
}

function FindToggle({
  label,
  description,
  xstyle,
  active,
  onClick,
  children,
}: {
  label: string;
  description: string;
  xstyle?: stylex.StyleXStyles;
  active: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...stylex.props(styles.toggle, active && styles.togglePressed, xstyle)}
      aria-label={label}
      aria-pressed={active}
      title={description}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FindActionButton({
  label,
  description,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  description: string;
  disabled?: boolean;
  onClick(): void;
  icon: "previous" | "next" | "close";
}) {
  return (
    <IconButton
      aria-label={label}
      title={description}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <FindActionIcon icon={icon} />
    </IconButton>
  );
}

function FindActionIcon({ icon }: { icon: "previous" | "next" | "close" }) {
  const path =
    icon === "previous"
      ? "M3 7.5 8 2.5l5 5M8 3v10.5"
      : icon === "next"
        ? "m3 8.5 5 5 5-5M8 13V2.5"
        : "m3 3 10 10M13 3 3 13";

  return (
    <svg
      {...stylex.props(styles.actionIcon)}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function selectedMdxText(article: HTMLElement | null): string | undefined {
  const selection = article?.ownerDocument.getSelection();

  if (!article || !selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);

  if (!article.contains(range.commonAncestorContainer)) return undefined;

  return selection.toString().trim() || undefined;
}

function expandReviewSection(node: Node): void {
  const element = node instanceof Element ? node : node.parentElement;
  element
    ?.closest(".review-section--collapsed")
    ?.dispatchEvent(new CustomEvent("review-section-expand"));
}

function rangeElement(range: Range): Element | null {
  return range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
}

function compareDocumentOrder(left: Node, right: Node): number {
  if (left === right) return 0;
  const position = left.compareDocumentPosition(right);

  return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function highlightApi(document: Document | null | undefined): {
  registry: HighlightRegistry;
  Highlight: typeof Highlight;
} | null {
  // SAFETY: lib.dom only declares the CSS Custom Highlight API on globalThis;
  // it is read off the document's own window, and both members stay optional
  // because jsdom does not implement it.
  const view = document?.defaultView as
    | (Window & {
        CSS?: { highlights?: HighlightRegistry };
        Highlight?: typeof Highlight;
      })
    | null;

  const registry = view?.CSS?.highlights;

  return registry && view?.Highlight
    ? { registry, Highlight: view.Highlight }
    : null;
}

function setAllCssHighlights(
  document: Document | undefined,
  ranges: Range[],
): void {
  const api = highlightApi(document);

  if (!api) return;
  api.registry.set(ALL_HIGHLIGHT, new api.Highlight(...ranges));
  setHighlightStyle(document, ALL_HIGHLIGHT, ranges.length > 0);
}

function setActiveCssHighlight(range: Range): void {
  const api = highlightApi(range.startContainer.ownerDocument);

  if (!api) return;
  api.registry.set(ACTIVE_HIGHLIGHT, new api.Highlight(range));
  setHighlightStyle(
    range.startContainer.ownerDocument ?? undefined,
    ACTIVE_HIGHLIGHT,
    true,
  );
}

function clearActiveCssHighlight(document: Document | undefined): void {
  highlightApi(document)?.registry.delete(ACTIVE_HIGHLIGHT);
  setHighlightStyle(document, ACTIVE_HIGHLIGHT, false);
}

function clearCssHighlights(document: Document | undefined): void {
  const registry = highlightApi(document)?.registry;
  registry?.delete(ALL_HIGHLIGHT);
  registry?.delete(ACTIVE_HIGHLIGHT);
  setHighlightStyle(document, ALL_HIGHLIGHT, false);
  setHighlightStyle(document, ACTIVE_HIGHLIGHT, false);
}

const compact = "@media (max-width: 620px)";

const hoverBackground = "var(--vscode-toolbar-hoverBackground, var(--tray))";

const button = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderWidth: "1px",
  borderStyle: "solid",
  borderRadius: "3px",
  cursor: "pointer",
  outline: {
    default: null,
    ":focus-visible": `1px solid ${tokens.accent}`,
  },
  outlineOffset: { default: null, ":focus-visible": "1px" },
} as const;

const styles = stylex.create({
  widget: {
    position: "absolute",
    zIndex: layer.popover,
    top: "48px",
    right: { default: "16px", [compact]: "8px" },
    left: { default: null, [compact]: "8px" },
    display: "flex",
    alignItems: "center",
    minWidth: { default: "490px", [compact]: 0 },
    maxWidth: { default: "calc(100vw - 32px)", [compact]: "none" },
    height: "34px",
    gap: "3px",
    padding: "3px 4px 3px 6px",
  },
  inputShell: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: "160px",
    gap: "1px",
    padding: "0 2px 0 6px",
  },
  inputShellInvalid: {
    borderColor: tokens.changeRemoved,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: "transparent",
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    outline: "none",
  },
  options: {
    display: "flex",
    alignItems: "center",
    flex: "0 0 auto",
    gap: "1px",
  },
  count: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: { default: "auto", [compact]: "56px" },
    minWidth: "64px",
    marginLeft: "4px",
    padding: "0 3px",
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  toggle: {
    ...button,
    flex: "0 0 22px",
    width: "22px",
    height: "20px",
    padding: 0,
    borderColor: "transparent",
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": hoverBackground,
    },
    color: { default: tokens.inkMuted, ":hover:not(:disabled)": tokens.ink },
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
  },
  togglePressed: {
    borderColor: tokens.accent,
    backgroundColor: {
      default: "var(--vscode-inputOption-activeBackground, var(--tray))",
      ":hover:not(:disabled)": hoverBackground,
    },
    color: {
      default: "var(--vscode-inputOption-activeForeground, var(--ink))",
      ":hover:not(:disabled)": tokens.ink,
    },
  },
  wholeWord: {
    textDecorationLine: "underline",
    textUnderlineOffset: "2px",
  },
  regex: {
    fontFamily: tokens.fontMono,
  },
  actionIcon: {
    width: "14px",
    height: "14px",
    fill: "none",
    stroke: "currentcolor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.35",
  },
});
