import {
  fontSize,
  fontWeight,
  layer,
  leading,
  space,
} from "@canvas/scale.stylex";
import { IconButton } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from "@canvas/ui/icons";
import { surfaceStyles } from "@canvas/ui/surface";
import { fieldStyles } from "@canvas/ui/text-field";
import { useTooltip } from "@canvas/ui/tooltip";
import type { ReviewFindQuery } from "@dev.fast/review-protocol";
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

import { setCssHighlight } from "./css-highlights";
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

/** The tab a search runs over: the Review document, or a diff. */
export type ReviewFindSurface = "review" | "diff";

export interface ReviewInlineFindRegistration {
  /** Defaults to the Review document. */
  surface?: ReviewFindSurface;
  container: HTMLElement;
  setFindQuery(query: ReviewFindQuery): Promise<{ matchCount: number }>;
  revealFindMatch(index: number): Promise<void>;
  clearFind(): void;
  clearActiveFindMatch(): void;
  expand(): void;
}

interface FindContextValue {
  register(registration: ReviewInlineFindRegistration): () => void;
  /** null closes find and refuses to open it. */
  setSurface(surface: ReviewFindSurface | null): void;
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
  let surface: ReviewFindSurface | null = "review";
  let priorFocus: HTMLElement | null = null;
  let searchScheduled = false;

  const clearHighlights = () => {
    setCssHighlight(articleRef.current, ALL_HIGHLIGHT, []);
    setCssHighlight(articleRef.current, ACTIVE_HIGHLIGHT, []);

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
    setCssHighlight(articleRef.current, ACTIVE_HIGHLIGHT, []);

    for (const registration of registrations) {
      registration.clearActiveFindMatch();
    }

    // A frame later the search may have closed or moved on.
    const current = () => store.getState().matches.includes(match);

    if (match.kind === "mdx") {
      expandReviewSection(match.node);
      requestAnimationFrame(() => {
        if (!current()) return;
        setCssHighlight(articleRef.current, ACTIVE_HIGHLIGHT, [match.range]);
        rangeElement(match.range)?.scrollIntoView?.({ block: "center" });
        inputRef.current?.focus();
      });
    } else {
      match.registration.expand();
      requestAnimationFrame(async () => {
        if (!current()) return;

        // A diff view fills its column and scrolls itself.
        if ((match.registration.surface ?? "review") === "review")
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
    const article = surface === "review" ? articleRef.current : null;

    const ranges = article ? reviewFindRanges(article, expression) : [];

    const orderedRegistrations = [...registrations]
      .filter((registration) => (registration.surface ?? "review") === surface)
      .sort((left, right) =>
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
      setCssHighlight(article, ALL_HIGHLIGHT, ranges);

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
      if (surface === null) return false;

      if (!store.getState().open) {
        const active = articleRef.current?.ownerDocument.activeElement;
        priorFocus = active instanceof HTMLElement ? active : null;
        store
          .getState()
          .show(
            seed ??
              (surface === "review"
                ? selectedMdxText(articleRef.current)
                : undefined),
          );
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
    setSurface(next: ReviewFindSurface | null) {
      if (next === surface) return;
      surface = next;

      if (store.getState().open) close(false);
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
          {...stylex.props(fieldStyles.bare, styles.input)}
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
          <FindToggle
            label="Skip Folded"
            description="Skip Folded: leave out matches in folded files and regions."
            active={query.skipFolded ?? false}
            onClick={() => toggleOption("skipFolded")}
          >
            ⊟
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
  const tooltip = useTooltip(description, { instant: true });

  return (
    <IconButton
      ref={tooltip}
      size="small"
      xstyle={[styles.toggle, xstyle]}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </IconButton>
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
      {icon === "previous" ? (
        <ArrowUpIcon xstyle={iconStyles.chrome} />
      ) : icon === "next" ? (
        <ArrowDownIcon xstyle={iconStyles.chrome} />
      ) : (
        <CloseIcon xstyle={iconStyles.chrome} />
      )}
    </IconButton>
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

const compact = "@media (max-width: 620px)";

const styles = stylex.create({
  widget: {
    position: "absolute",
    zIndex: layer.popover,
    top: space.s48,
    right: { default: space.s16, [compact]: space.s8 },
    left: { default: null, [compact]: space.s8 },
    display: "flex",
    alignItems: "center",
    minWidth: { default: "490px", [compact]: 0 },
    maxWidth: { default: "calc(100vw - 32px)", [compact]: "none" },
    height: "34px",
    gap: space.s4,
    padding: `${space.s4} ${space.s4} ${space.s4} ${space.s6}`,
  },
  inputShell: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: "160px",
    gap: "1px",
    padding: `0 ${space.s2} 0 ${space.s6}`,
  },
  inputShellInvalid: {
    borderColor: tokens.changeRemoved,
  },
  input: {
    flex: 1,
    height: "100%",
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
    marginLeft: space.s4,
    padding: `0 ${space.s4}`,
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  toggle: {
    fontWeight: fontWeight.regular,
  },
  wholeWord: {
    textDecorationLine: "underline",
    textUnderlineOffset: "2px",
  },
  regex: {
    fontFamily: tokens.fontMono,
  },
});
