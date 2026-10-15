import { documentType } from "@canvas/document-type.stylex";
import { fontSize, fontWeight } from "@canvas/scale.stylex";
import { Button, IconButton, buttonStyles } from "@canvas/ui/button";
import { DisclosureChevron } from "@canvas/ui/disclosure";
import { iconStyles } from "@canvas/ui/icon-styles";
import {
  ChevronDownIcon,
  CloseIcon,
  ExternalLinkIcon,
  MapPinIcon,
  MinusIcon,
  PopOutIcon,
} from "@canvas/ui/icons";
import {
  OverlayScrollbar,
  overlayScrollbarStyles,
} from "@canvas/ui/overlay-scrollbar";
import { textStyles } from "@canvas/ui/text";
import { extractTraceEventText } from "@dev.fast/trace-protocol";
import * as stylex from "@stylexjs/stylex";
import type {
  CSSProperties,
  ComponentPropsWithoutRef,
  ReactElement,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";

import { AskCloseWarning } from "./ask-close";
import { AskDeleteThreadButton, AskOpenThreadProvider } from "./ask-delete";
import { AskDock, InRightColumn, useAskPanelHost } from "./ask-dock";
import { AskHistoryButton, AskHistoryList } from "./ask-history-list";
import {
  AskProjectContext,
  openHandedOffAsks,
  syncOpenAsks,
} from "./ask-open-state";
import { AskPanelContent, AskReadOnlyThread } from "./ask-panel";
import {
  AskThreadsWatchContext,
  useAskThreadsWatch,
  useLatest,
} from "./ask-thread-stream";
import { useMarkThreadViewed } from "./ask-viewed";
import { AskSlot, AskWindow } from "./ask-window";
import { AuthoredCodeSurface } from "./authored-code-surface";
import { SourceCodePeek } from "./CodePeek";
import { documentStyles } from "./document-styles";
import { drawStyles } from "./draw-styles";
import { findWhitespaceNormalizedSpan } from "./highlighted-text";
import {
  useOptionalReviewSession,
  useReviewSession,
} from "./host/review-session";
import { newTabLinkProps } from "./link-props";
import { chevronMarker, documentMarker } from "./markers.stylex";
import { useReviewActions } from "./review-context";
import { useReviewDiffFiles } from "./review-diff-files-context";
import {
  AskKeyContext,
  useOptionalReviewPanelStore,
  useReviewPanel,
  useReviewPanelStore,
} from "./review-panel";
import type {
  AskReport,
  GuidedTour,
  GuidedTourStop,
  PeekAnchor,
  ReviewPeekContent,
  SourcePeekAnchor,
} from "./review-panel-model";
import { askShown, peekShown } from "./review-panel-store";
import { useReviewRoots } from "./review-root-context";
import type { ReviewSectionSummary } from "./review-section-summary";
import { useReviewUiState } from "./review-ui-state";
import {
  activeTargetForScroll,
  scrollTailHeight,
} from "./scroll-active-tracking";
import { shellStyles } from "./shell-styles";
import { useBottomSheetResize } from "./side-panel-resizer";
import { panelStyles, tourStyles } from "./side-panel-styles";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { TraceDocument } from "./trace-document";
import { traceStyles } from "./trace-styles";
import { captureUiEvent } from "./ui-telemetry";
import { useAgentTrace } from "./use-agent-trace";
import { useTooltip } from "./use-tooltip";

const TOUR_ACTIVE_TOP_SLACK_PX = 18;

/**
 * Shared shell for everything that docks into the right panel slot: side
 * peeks, commit diffs, and guided tours. Provides the uniform header (kicker,
 * title, close button), closes on Escape, and slides in with
 * the same animation everywhere. The panel occupies a grid column, so the
 * document reflows next to it instead of being overlaid.
 */
function ReviewPanelFrame({
  label,
  title,
  onClose,
  onEscape = onClose,
  closeLabel,
  closeRef,
  titleAccessory,
  headerActions,
  floatingFooter,
  bodyRef,
  onBodyScroll,
  tour = false,
  docked = false,
  tray = false,
  children,
}: {
  label: string;
  title?: string;
  onClose: () => void;
  /** What Escape does; closing, unless the panel says otherwise. */
  onEscape?: () => void;
  closeLabel: string;
  closeRef?: Ref<HTMLButtonElement>;
  titleAccessory?: ReactNode;
  /** Buttons beside the close button. */
  headerActions?: ReactNode;
  floatingFooter?: ReactNode;
  bodyRef?: RefObject<HTMLDivElement | null>;
  onBodyScroll?: () => void;
  tour?: boolean;
  docked?: boolean;
  /** On the tray, as a conversation is, with a quieter kicker. */
  tray?: boolean;
  children: ReactNode;
}) {
  const appRef = useReviewRoots()?.appRef;
  const panelMotion = useReviewPanel((state) => state.motion);
  const [body, setBody] = useState<HTMLDivElement | null>(null);

  const attachBody = useCallback(
    (node: HTMLDivElement | null) => {
      setBody(node);

      if (bodyRef) bodyRef.current = node;

      return () => {
        setBody(null);

        if (bodyRef) bodyRef.current = null;
      };
    },
    [bodyRef],
  );

  // In Desktop's right column, the header sits level with the window controls.
  const nativeFrame = useContext(InRightColumn);

  const sheet = useBottomSheetResize({
    stateKey: "bottomSheetFraction",
    label: "Resize panel height",
    containerRef: appRef,
  });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !appRef?.current) return;
      event.preventDefault();
      onEscape();
    };

    document.addEventListener("keydown", closeOnEscape);

    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [appRef, onEscape]);

  // SAFETY: `--side-panel-bottom-fraction` is a CSS custom property, which
  // React forwards to style.setProperty; the CSSProperties typings only omit
  // custom names.
  const panelStyle = {
    "--side-panel-bottom-fraction": sheet.fraction,
  } as CSSProperties;

  return (
    <aside
      {...withClass(
        "side-panel",
        panelStyles.panel,
        panelMotion === "restored" && panelStyles.restored,
        (docked || nativeFrame) && panelStyles.docked,
        (tray || nativeFrame) && panelStyles.tray,
      )}
      role="complementary"
      aria-label={title ?? label}
      style={panelStyle}
    >
      <div
        {...stylex.props(buttonStyles.reset, shellStyles.sheetResizer)}
        {...sheet.separatorProps}
      />
      <header
        {...withClass(
          nativeFrame ? "review-ask-chrome" : undefined,
          panelStyles.header,
          (tray || nativeFrame) && panelStyles.tray,
          nativeFrame && panelStyles.nativeHeader,
        )}
      >
        <div {...stylex.props(panelStyles.title)}>
          <span
            {...stylex.props(
              textStyles.eyebrow,
              panelStyles.kicker,
              tray && panelStyles.trayKicker,
            )}
          >
            {label}
          </span>
          {title && (
            <h2 {...stylex.props(textStyles.truncate, panelStyles.heading)}>
              {title}
            </h2>
          )}
          {titleAccessory}
        </div>
        <div {...stylex.props(panelStyles.actions)}>
          {headerActions}
          <IconButton
            ref={closeRef}
            size="large"
            xstyle={panelStyles.close}
            onClick={onClose}
            aria-label={closeLabel}
            data-tour-target={tour ? "tour-close" : undefined}
          >
            <CloseIcon xstyle={iconStyles.inert} />
          </IconButton>
        </div>
      </header>
      <div
        ref={attachBody}
        {...stylex.props(
          panelStyles.body,
          overlayScrollbarStyles.scroller,
          tray && panelStyles.trayBody,
        )}
        onScroll={onBodyScroll}
      >
        {children}
      </div>
      <OverlayScrollbar scroller={body} />
      {floatingFooter}
    </aside>
  );
}

export function ReviewSection({
  stateKey,
  title,
  defaultCollapsed = false,
  id,
  children,
  summary,
}: {
  title: string;
  defaultCollapsed?: boolean;
  stateKey?: string;
  id?: string;
  summary?: ReviewSectionSummary;
  children?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useReviewUiState(
    stateKey ?? title,
    defaultCollapsed,
    {
      scope: "session",
      namespace: "section",
    },
  );

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const toggleCollapsed = () => setCollapsed((current) => !current);

  // The table of contents (and anchor navigation) expands a collapsed
  // section before scrolling to a heading inside it.
  useEffect(() => {
    const bodyElement = bodyRef.current;
    const sectionElement = bodyElement?.parentElement;

    if (!sectionElement) return;
    const expand = () => setCollapsed(false);
    sectionElement.addEventListener("review-section-expand", expand);

    return () => {
      sectionElement.removeEventListener("review-section-expand", expand);
    };
  }, []);

  // The classes are markers: find, the code view and the section ring look
  // for a (collapsed) section.
  return (
    <section
      {...withClass(
        collapsed
          ? "review-section review-section--collapsed"
          : "review-section",
        sectionStyles.section,
        drawStyles.blockChild,
        drawStyles.sectionRing,
      )}
      data-review-section={title}
    >
      <div {...stylex.props(sectionStyles.header)}>
        <IconButton
          size="small"
          xstyle={[chevronMarker, sectionStyles.toggle]}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          onClick={toggleCollapsed}
        >
          <DisclosureChevron />
        </IconButton>
        <div {...withClass("review-section-heading", sectionStyles.heading)}>
          <h2
            id={id}
            data-review-copy-prose
            {...stylex.props(
              sectionStyles.title,
              collapsed && sectionStyles.titleCollapsed,
              drawStyles.retitledHeading,
            )}
          >
            {title}
          </h2>
        </div>
        {collapsed && summary && (
          <span {...stylex.props(sectionStyles.meta)}>
            {reviewSectionSummaryLabel(summary)}
          </span>
        )}
      </div>
      <div
        ref={bodyRef}
        className="review-section-body"
        data-tour-target="section-body"
        hidden={collapsed || undefined}
      >
        {children}
      </div>
    </section>
  );
}

/** What a collapsed section holds, in a few words; empty when nothing. */
export function reviewSectionSummaryLabel(
  summary: ReviewSectionSummary,
): string {
  const parts: string[] = [];

  if (summary.diagrams > 0) {
    parts.push(
      summary.diagrams === 1 ? "1 diagram" : `${summary.diagrams} diagrams`,
    );
  }

  if (summary.codeRefs > 0) {
    parts.push(
      summary.codeRefs === 1 ? "1 code ref" : `${summary.codeRefs} code refs`,
    );
  }

  if (parts.length === 0 && summary.paragraphs > 0) {
    parts.push(
      summary.paragraphs === 1
        ? "1 paragraph"
        : `${summary.paragraphs} paragraphs`,
    );
  }

  return parts.join(" · ");
}

interface ProsePeekAnchorProps {
  href: string;
  isOpen: boolean;
  onOpen: (text: string) => void;
  onAlreadyOpen?: () => void;
  xstyle?: stylex.StyleXStyles;
  anchorId?: string;
  inertFallback?: ReactNode;
  children: ReactNode;
}

/**
 * Shared prose side-peek anchor primitive for AnchorLink and TraceQuote.
 * Renders an inline anchor with open-state styling, telemetry, and visibility retention.
 */
export function ProsePeekAnchor({
  href,
  isOpen,
  onOpen,
  onAlreadyOpen,
  xstyle,
  anchorId,
  inertFallback,
  children,
}: ProsePeekAnchorProps) {
  const panelStore = useOptionalReviewPanelStore();
  const session = useOptionalReviewSession();

  if (!panelStore && inertFallback !== undefined) {
    return <>{inertFallback}</>;
  }

  return (
    <a
      href={href}
      {...stylex.props(documentStyles.link, xstyle)}
      data-review-anchor-id={anchorId}
      data-review-anchor-open={isOpen ? "true" : undefined}
      onClick={(event) => {
        event.preventDefault();

        if (isOpen && onAlreadyOpen) {
          onAlreadyOpen();

          return;
        }

        if (session) {
          captureUiEvent(session, "peek_opened", { via: "prose_link" });
        }

        onOpen(event.currentTarget.textContent?.trim() ?? "");
        keepAnchorLinkVisible(event.currentTarget);
      }}
    >
      {children}
    </a>
  );
}

export function AnchorLink({
  anchor,
  children,
}: {
  anchor: SourcePeekAnchor;
  children?: ReactNode;
}) {
  const openPeek = useReviewPanel((state) => state.openPeek);

  const peekOpen = useReviewPanel(
    (state) =>
      state.active?.kind === "peek" && state.active.anchor?.id === anchor.id,
  );

  return (
    <ProsePeekAnchor
      href={`#review-anchor-${anchor.id}`}
      anchorId={anchor.id}
      isOpen={peekOpen}
      onOpen={(text) => {
        openPeek({
          kind: "peek",
          anchor: { ...anchor, title: text || anchor.title },
          content: { kind: "source", source: anchor.peek },
        });
      }}
    >
      {children}
    </ProsePeekAnchor>
  );
}

export function a({
  href,
  children,
  target,
  rel,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  const linkProps = newTabLinkProps(href, { ...props, target, rel });

  return (
    <a href={href} target={target} rel={rel} {...props} {...linkProps}>
      {children}
    </a>
  );
}

/**
 * Opening the side panel narrows the document column and reflows the prose,
 * which can push the clicked anchor link out of the viewport. Once the panel
 * has slid in, scroll the link back into view if the reflow moved it away.
 */
function keepAnchorLinkVisible(link: HTMLElement) {
  window.setTimeout(() => {
    const rect = link.getBoundingClientRect();

    const visible =
      rect.top >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.left >= 0 &&
      rect.right <= window.innerWidth;

    if (!visible) {
      link.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, 240);
}

/** The only top-level renderer for Review's side peek. */
export function ReviewPanelHost() {
  const activePanel = useReviewPanel((state) => state.active);
  const close = useReviewPanel((state) => state.close);
  const columnHost = useAskPanelHost();
  // Put away, the peek stays mounted, to come back where it was.
  const hidden = !useReviewPanel(peekShown);

  return (
    <>
      {activePanel ? (
        <AskDock host={columnHost} hidden={hidden}>
          <ReviewPeekPanel
            anchor={activePanel.anchor}
            content={activePanel.content}
            onClose={close}
          />
        </AskDock>
      ) : null}
      <AskHost />
    </>
  );
}

/**
 * The threads on screen, in the column or the window. Each renders once,
 * into an element of its own that moves between them, so popping out or
 * docking never restarts it.
 */
function AskHost() {
  const store = useReviewPanelStore();
  const session = useLatest(useReviewSession());
  const config = session.current.config;
  const projectId = useContext(AskProjectContext);

  useEffect(
    () => syncOpenAsks(store, config, projectId),
    [store, config, projectId],
  );

  useEffect(() => {
    void openHandedOffAsks(store, (endpoint, init) =>
      session.current.fetch(endpoint, init),
    ).catch(() => {});
  }, [store, session]);

  const keys = useReviewPanel(
    useShallow((state) => state.asks.map((ask) => ask.key)),
  );

  // Every thread on screen follows its thread over this one stream.
  const watch = useAskThreadsWatch(useReviewSession());

  return (
    <AskThreadsWatchContext.Provider value={watch}>
      {keys.map((key) => (
        <OpenAsk key={key} askKey={key} />
      ))}
    </AskThreadsWatchContext.Provider>
  );
}

function OpenAsk({ askKey }: { askKey: number }) {
  const store = useReviewPanelStore();
  const session = useReviewSession();

  const view = useReviewPanel(
    (state) => state.asks.find((ask) => ask.key === askKey)?.view,
  );

  const shown = useReviewPanel((state) => askShown(state, askKey));
  const nativeHost = useAskPanelHost();
  const popOutTooltip = useTooltip("Pop out");
  const [node] = useState(() => document.createElement("div"));
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  const checkoutGone = useReviewDiffFiles().status === "unavailable";
  const deleted = Boolean(useReviewSession().review?.trashedAt);
  const [warning, setWarning] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const stopping = useRef(false);

  const report = useCallback(
    (report: AskReport) => store.getState().reportAsk(askKey, report),
    [store, askKey],
  );

  const ask = useReviewPanel((state) =>
    state.asks.find((candidate) => candidate.key === askKey),
  );

  useMarkThreadViewed(ask?.threadId ?? null, shown !== null, ask?.busy);

  if (!view) return null;

  const hide = () => {
    setWarning(false);
    store.getState().hideAsk(askKey);
  };

  // Closing stops the agent, even one whose thread is still starting.
  const stop = () => {
    const threadId = ask?.threadId;

    stopping.current = true;
    hide();

    if (threadId)
      void session
        .fetch(`/ask/${threadId}/close`, { method: "POST", keepalive: true })
        .catch(() => {});
  };

  // While the agent works, closing asks first.
  const close = () => (ask?.busy ? setWarning(true) : stop());

  const closeWarning =
    warning && ask?.busy ? (
      <AskCloseWarning
        anchor={closeButton}
        agentName={ask.presence.agentName}
        onKeepRunning={hide}
        onClose={stop}
        onKeep={() => setWarning(false)}
      />
    ) : null;

  const actions = (
    <>
      <AskDeleteThreadButton />
      <AskHistoryButton view={view} />
    </>
  );

  return (
    <AskKeyContext.Provider value={askKey}>
      <AskOpenThreadProvider>
        {createPortal(
          view.type === "history" ? (
            <AskHistoryList passage={view.passage} />
          ) : view.type === "saved" && (checkoutGone || deleted) ? (
            <AskReadOnlyThread
              selection={view.selection}
              threadId={view.threadId}
              onReport={report}
            />
          ) : (
            <AskPanelContent
              selection={view.selection}
              agent={view.agent}
              savedThreadId={view.type === "saved" ? view.threadId : undefined}
              onReport={report}
              header={header}
              stopping={stopping}
            />
          ),
          node,
        )}
        {shown === "panel" ? (
          <AskDock host={nativeHost}>
            <ReviewPanelFrame
              tray
              label="Ask"
              titleAccessory={
                <div ref={setHeader} {...stylex.props(panelStyles.title)} />
              }
              onClose={close}
              onEscape={warning ? () => setWarning(false) : close}
              closeLabel="Close Ask"
              closeRef={closeButton}
              headerActions={
                <>
                  {actions}
                  <IconButton
                    ref={popOutTooltip}
                    size="large"
                    aria-label="Pop out Ask"
                    onClick={() => store.getState().popOutAsk(askKey)}
                  >
                    <PopOutIcon
                      xstyle={[iconStyles.inert, iconStyles.chrome]}
                    />
                  </IconButton>
                </>
              }
            >
              {closeWarning}
              <AskSlot node={node} />
            </ReviewPanelFrame>
          </AskDock>
        ) : shown === "window" ? (
          <AskWindow
            askKey={askKey}
            actions={actions}
            titleAccessory={
              <div ref={setHeader} {...stylex.props(panelStyles.title)} />
            }
            onHide={hide}
            onClose={close}
            closeRef={closeButton}
          >
            {closeWarning}
            <AskSlot node={node} />
          </AskWindow>
        ) : null}
      </AskOpenThreadProvider>
    </AskKeyContext.Provider>
  );
}

function TraceQuotePeekPanel({
  sessionId,
  trace,
  event,
  quote,
  onClose,
}: {
  sessionId: string;
  trace?: string;
  event?: number;
  quote: string;
  onClose: () => void;
}) {
  const { openTraceSession } = useReviewActions();
  const data = useAgentTrace(sessionId, trace);

  const traceEvents = data.status === "loaded" ? data.trace.events : undefined;

  const targetEventIndex = useMemo(() => {
    if (!traceEvents) return -1;

    if (event !== undefined && event >= 0 && event < traceEvents.length) {
      const e = traceEvents[event];
      const text = extractTraceEventText(e);

      if (findWhitespaceNormalizedSpan(text, quote)) {
        return event;
      }
    }

    for (let i = 0; i < traceEvents.length; i++) {
      const text = extractTraceEventText(traceEvents[i]);

      if (findWhitespaceNormalizedSpan(text, quote)) {
        return i;
      }
    }

    return -1;
  }, [traceEvents, event, quote]);

  const picks = useMemo(() => {
    if (!traceEvents || targetEventIndex === -1) return undefined;
    let turnStart = 0;

    for (let index = targetEventIndex; index >= 0; index -= 1) {
      if (traceEvents[index].kind === "user") {
        turnStart = index;
        break;
      }
    }

    let nextUserIndex = -1;

    for (
      let index = targetEventIndex + 1;
      index < traceEvents.length;
      index += 1
    ) {
      if (traceEvents[index].kind === "user") {
        nextUserIndex = index;
        break;
      }
    }

    const turnEnd =
      nextUserIndex === -1 ? traceEvents.length - 1 : nextUserIndex - 1;

    const events: [number, number] = [turnStart, turnEnd];

    return [{ events }];
  }, [traceEvents, targetEventIndex]);

  if (data.status === "loading" || data.status === "idle") {
    return (
      <ReviewPanelFrame
        label="Agent trace"
        title={
          trace ? `${sessionId.slice(0, 8)} · ${trace}` : sessionId.slice(0, 8)
        }
        onClose={onClose}
        closeLabel="Close side peek"
      >
        <div {...stylex.props(panelStyles.peekBody)}>
          <p {...stylex.props(traceStyles.note)}>Loading trace…</p>
        </div>
      </ReviewPanelFrame>
    );
  }

  if (data.status === "error") {
    return (
      <ReviewPanelFrame
        label="Agent trace"
        title={sessionId.slice(0, 8)}
        onClose={onClose}
        closeLabel="Close side peek"
      >
        <div {...stylex.props(panelStyles.peekBody)}>
          <p {...stylex.props(traceStyles.note, textStyles.error)}>
            {data.error}
          </p>
        </div>
      </ReviewPanelFrame>
    );
  }

  const loadedTrace = data.trace;
  const events = loadedTrace.events;

  const headerAccessory = (
    <Button
      xstyle={traceStyles.peekOpenFull}
      onClick={() => {
        openTraceSession?.({
          sessionId,
          trace,
          eventIndex: targetEventIndex >= 0 ? targetEventIndex : undefined,
        });
        onClose();
      }}
    >
      Full Trace
      <ExternalLinkIcon xstyle={iconStyles.inline} />
    </Button>
  );

  return (
    <ReviewPanelFrame
      label="Agent trace"
      title={
        loadedTrace.title ??
        (trace ? `${sessionId.slice(0, 8)} · ${trace}` : sessionId.slice(0, 8))
      }
      titleAccessory={headerAccessory}
      onClose={onClose}
      closeLabel="Close side peek"
    >
      <div {...stylex.props(panelStyles.peekBody)}>
        {targetEventIndex === -1 ? (
          <p {...stylex.props(traceStyles.note)}>
            Quote not found in this session transcript.
          </p>
        ) : (
          <TraceDocument
            key={`${sessionId}-${trace ?? ""}-${targetEventIndex}-${quote}`}
            events={events}
            targetEventIndex={targetEventIndex}
            highlightQuote={quote}
            picks={picks}
            scoped
          />
        )}
      </div>
    </ReviewPanelFrame>
  );
}

function ReviewPeekPanel({
  anchor,
  content,
  onClose,
}: {
  anchor?: PeekAnchor;
  content: ReviewPeekContent;
  onClose: () => void;
}) {
  if (content.kind === "trace-quote") {
    return (
      <TraceQuotePeekPanel
        sessionId={content.sessionId}
        trace={content.trace}
        event={content.event}
        quote={content.quote}
        onClose={onClose}
      />
    );
  }

  if (!anchor) return null;

  return (
    <CodeReviewPeekPanel anchor={anchor} content={content} onClose={onClose} />
  );
}

function CodeReviewPeekPanel({
  anchor,
  content,
  onClose,
}: {
  anchor: PeekAnchor;
  content: Extract<
    ReviewPeekContent,
    { kind: "source" | "inline-code" | "explanation" }
  >;
  onClose: () => void;
}) {
  const { softwareMapEnabled, openSoftwareMapElement } = useReviewActions();

  return (
    <ReviewPanelFrame
      label="Peek"
      title={anchor.title}
      onClose={onClose}
      closeLabel="Close side peek"
    >
      <div {...stylex.props(panelStyles.peekContent)}>
        {softwareMapEnabled && anchor.softwareMapPath ? (
          <div {...stylex.props(panelStyles.peekActions, panelStyles.inset)}>
            <IconButton
              size="large"
              onClick={() => {
                openSoftwareMapElement(anchor.softwareMapPath!);
                onClose();
              }}
              aria-label={`Show ${anchor.title} in software map`}
            >
              <MapPinIcon xstyle={iconStyles.inert} />
            </IconButton>
          </div>
        ) : null}

        <div {...stylex.props(panelStyles.peekContent)}>
          <ReviewPeekContentView
            anchor={anchor}
            content={content}
            reportOutcome
          />
        </div>
      </div>
    </ReviewPanelFrame>
  );
}

export function GuidedTourPanel({
  tour,
  activeAnchor,
  revealRequest,
  onActiveAnchorChange,
  onClose,
  docked = false,
}: {
  tour: GuidedTour;
  activeAnchor: string;
  revealRequest: number;
  onActiveAnchorChange: (anchor: string, options: { reveal: boolean }) => void;
  onClose: () => void;
  /** Keeps the panel in its column at every width (a diagram tour's pane). */
  docked?: boolean;
}) {
  const session = useReviewSession();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const handledRevealRequestRef = useRef(0);

  const activeIndex = tour.stops.findIndex(
    (stop) => stop.anchor.id === activeAnchor,
  );

  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const previousActiveIndexRef = useRef(activeIndex);
  const completedTourIdRef = useRef<string | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const [tailHeight, setTailHeight] = useState(0);
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    completedTourIdRef.current = null;
    previousActiveIndexRef.current = activeIndexRef.current;
    setHasScrolled(false);
  }, [tour.id]);

  useEffect(() => {
    const previousIndex = previousActiveIndexRef.current;
    previousActiveIndexRef.current = activeIndex;

    if (activeIndex <= previousIndex || activeIndex < 0) return;
    captureUiEvent(session, "tour_step_advanced", {
      step: activeIndex + 1,
      steps: tour.stops.length,
    });
  }, [activeIndex, session, tour.stops.length]);

  const captureAbandoned = useEffectEvent((step: number, steps: number) => {
    captureUiEvent(session, "tour_abandoned", { step, steps });
  });

  useEffect(() => {
    let armed = false;

    const timer = window.setTimeout(() => {
      armed = true;
    }, 0);

    return () => {
      window.clearTimeout(timer);
      const index = activeIndexRef.current;

      if (
        !armed ||
        tour.stops.length === 0 ||
        index >= tour.stops.length - 1 ||
        completedTourIdRef.current === tour.id
      ) {
        return;
      }

      captureAbandoned(Math.max(0, index) + 1, tour.stops.length);
    };
  }, [session.appSessionId, tour.id, tour.stops.length]);

  // Scroll-syncing activates a stop when its top crosses the active line, so
  // the last stop must be able to reach it: the tail spacer grants exactly
  // the missing scroll room. Sized here because a CSS percentage cannot see
  // the scroller's height from inside auto-height feed content.
  useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) return;
    const lastStop = tour.stops[tour.stops.length - 1];

    if (!lastStop) return;

    const measure = () => {
      const section = sectionRefs.current.get(lastStop.anchor.id);
      const tail = tailRef.current;

      if (!section || !tail) return;

      const lastTopInContent =
        section.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;

      setTailHeight(
        scrollTailHeight({
          lastTargetTop: lastTopInContent,
          slack: TOUR_ACTIVE_TOP_SLACK_PX,
          viewportHeight: scroller.clientHeight,
          contentHeightSansTail: scroller.scrollHeight - tail.offsetHeight,
        }),
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    const content = scroller.firstElementChild;

    if (content) observer.observe(content);

    return () => observer.disconnect();
  }, [tour]);

  useEffect(() => {
    if (
      tour.stops.length === 0 ||
      activeIndex < tour.stops.length - 1 ||
      completedTourIdRef.current === tour.id
    ) {
      return;
    }

    completedTourIdRef.current = tour.id;
    captureUiEvent(session, "tour_completed", { steps: tour.stops.length });
  }, [activeIndex, session, tour]);

  useEffect(() => {
    if (handledRevealRequestRef.current === revealRequest) return;
    handledRevealRequestRef.current = revealRequest;
    const scroller = scrollerRef.current;
    const section = sectionRefs.current.get(activeAnchor);

    if (!section || !scroller) return;

    const frame = requestAnimationFrame(() => {
      const scrollerTop = scroller.getBoundingClientRect().top;
      const sectionTop = section.getBoundingClientRect().top;
      // The tail's active line.
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          sectionTop -
          scrollerTop -
          TOUR_ACTIVE_TOP_SLACK_PX,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [activeAnchor, revealRequest]);

  const displayIndex = Math.max(0, activeIndex);
  const lastIndex = tour.stops.length - 1;

  const stepTo = (index: number) => {
    const stop = tour.stops[index];

    if (!stop) return;
    onActiveAnchorChange(stop.anchor.id, { reveal: true });
  };

  const showIntroPill =
    !hasScrolled && displayIndex === 0 && tour.stops.length > 1;

  // The stop being read follows the shared scroll-tracking rule (see
  // scroll-active-tracking.ts), the same one the contents rail uses.
  const syncActiveStopToScroll = () => {
    setHasScrolled(true);
    const scroller = scrollerRef.current;

    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();

    const nextAnchor = activeTargetForScroll(
      tour.stops.flatMap((stop) => {
        const section = sectionRefs.current.get(stop.anchor.id);

        return section
          ? [{ id: stop.anchor.id, top: section.getBoundingClientRect().top }]
          : [];
      }),
      scrollerRect.top,
      scrollerRect.top + scrollerRect.height / 2,
    );

    if (nextAnchor === null || nextAnchor === activeAnchor) return;
    onActiveAnchorChange(nextAnchor, { reveal: false });
  };

  return (
    <ReviewPanelFrame
      tour
      docked={docked}
      label="Tour"
      title={tour.title ?? "Guided tour"}
      onClose={onClose}
      closeLabel="Close guided tour"
      floatingFooter={
        tour.stops.length > 0 ? (
          <div {...stylex.props(tourStyles.floatingFooter)}>
            {showIntroPill ? (
              <Button
                variant="primary"
                size="large"
                xstyle={[tourStyles.pill, tourStyles.pillIntro]}
                data-tour-target="tour-next"
                onClick={() => {
                  setHasScrolled(true);
                  stepTo(1);
                }}
              >
                <span>{tour.stops.length - 1} more steps</span>
                <ChevronDownIcon />
              </Button>
            ) : (
              <div
                {...stylex.props(tourStyles.pill, tourStyles.pillGroup)}
                role="group"
                aria-label="Tour steps"
              >
                <IconButton
                  xstyle={tourStyles.pillButton}
                  aria-label="Previous step"
                  disabled={displayIndex === 0}
                  onClick={() => stepTo(displayIndex - 1)}
                >
                  <ChevronDownIcon xstyle={iconStyles.flip} />
                </IconButton>
                <span className="tour-pill-count" aria-live="polite">
                  {displayIndex + 1}/{tour.stops.length}
                </span>
                <IconButton
                  data-tour-target="tour-next"
                  xstyle={tourStyles.pillButton}
                  aria-label="Next step"
                  disabled={displayIndex === lastIndex}
                  onClick={() => stepTo(displayIndex + 1)}
                >
                  <ChevronDownIcon />
                </IconButton>
              </div>
            )}
          </div>
        ) : null
      }
      bodyRef={scrollerRef}
      onBodyScroll={syncActiveStopToScroll}
    >
      <div {...stylex.props(tourStyles.feedShell)}>
        <div {...stylex.props(panelStyles.peekBody, tourStyles.feed)}>
          {tour.stops.map((stop, index) => {
            const isActive = stop.anchor.id === activeAnchor;

            return (
              <section
                key={stop.anchor.id}
                ref={(node) => {
                  if (node) sectionRefs.current.set(stop.anchor.id, node);
                  else sectionRefs.current.delete(stop.anchor.id);
                }}
                {...stylex.props(tourStyles.stop)}
                data-review-anchor-id={stop.anchor.id}
              >
                <div {...stylex.props(tourStyles.rail)}>
                  <div
                    {...stylex.props(
                      tourStyles.railNumber,
                      isActive && tourStyles.railNumberActive,
                    )}
                  >
                    {index + 1}
                  </div>
                </div>
                <GuidedTourStopMain
                  stop={stop}
                  index={index}
                  total={tour.stops.length}
                  active={isActive}
                  onNativeFocus={() => {
                    if (stop.anchor.id === activeAnchor) return;
                    onActiveAnchorChange(stop.anchor.id, { reveal: false });
                  }}
                  onClose={onClose}
                />
              </section>
            );
          })}
          {tour.stops.length > 0 && (
            <>
              <div {...stylex.props(tourStyles.endCap)}>
                <span>End of tour</span>
                <Button variant="link" tone="accent" onClick={() => stepTo(0)}>
                  <ChevronDownIcon xstyle={iconStyles.flip} />
                  Back to step 1
                </Button>
              </div>
              <div
                ref={tailRef}
                {...stylex.props(tourStyles.scrollTail)}
                style={{ height: tailHeight }}
                aria-hidden="true"
              />
            </>
          )}
        </div>
      </div>
    </ReviewPanelFrame>
  );
}

function GuidedTourStopMain({
  stop,
  index,
  total,
  active,
  onNativeFocus,
  onClose,
}: {
  stop: GuidedTourStop;
  index: number;
  total: number;
  active: boolean;
  onNativeFocus: () => void;
  onClose: () => void;
}): ReactElement {
  const { softwareMapEnabled, openSoftwareMapElement } = useReviewActions();

  return (
    <div {...stylex.props(tourStyles.main, active && tourStyles.mainActive)}>
      <header {...stylex.props(tourStyles.header)}>
        <div>
          <div {...stylex.props(textStyles.eyebrow, textStyles.count)}>
            Step {index + 1} of {total}
          </div>
          <div {...stylex.props(tourStyles.titleRow)}>
            <h3
              {...stylex.props(
                tourStyles.title,
                active && tourStyles.titleActive,
              )}
            >
              {stop.label}
            </h3>
          </div>
          {stop.detail && (
            <p {...stylex.props(tourStyles.detail)}>{stop.detail}</p>
          )}
        </div>
        {softwareMapEnabled && stop.anchor.softwareMapPath ? (
          <div {...stylex.props(panelStyles.peekActions)}>
            <IconButton
              size="large"
              aria-label={`Show ${stop.anchor.title} in software map`}
              onClick={() => {
                openSoftwareMapElement(stop.anchor.softwareMapPath!);
                onClose();
              }}
            >
              <MapPinIcon xstyle={iconStyles.inert} />
            </IconButton>
          </div>
        ) : null}
      </header>

      <div {...stylex.props(panelStyles.peekContent, tourStyles.content)}>
        <ReviewPeekContentView
          anchor={stop.anchor}
          content={stop.content}
          active={active}
          onNativeFocus={onNativeFocus}
        />
      </div>
    </div>
  );
}

function ReviewPeekContentView({
  anchor,
  content,
  active,
  onNativeFocus,
  reportOutcome = false,
}: {
  anchor: PeekAnchor;
  content: ReviewPeekContent;
  active?: boolean;
  onNativeFocus?: () => void;
  reportOutcome?: boolean;
}) {
  if (content.kind === "explanation")
    return content.text ? (
      <p {...stylex.props(panelStyles.peekText)}>{content.text}</p>
    ) : null;

  if (content.kind === "source") {
    return (
      <SourceCodePeek
        sources={[content.source, ...(content.more ?? [])]}
        active={active}
        onNativeFocus={onNativeFocus}
        reportOutcome={reportOutcome}
      />
    );
  }

  if (content.kind === "inline-code") {
    return (
      <AuthoredCodeSurface
        anchor={anchor}
        code={content.text}
        language={content.language}
      />
    );
  }

  return null;
}

const inDocument = () => stylex.when.ancestor(":is(*)", documentMarker);

const sectionStyles = stylex.create({
  section: {
    position: "relative",
    width: "100%",
  },
  header: {
    position: "relative",
    display: "flex",
    alignItems: "baseline",
    gap: "12px",
    width: `min(100%, ${tokens.reviewProseMaxWidth})`,
    maxWidth: `calc(100cqi - 2 * ${tokens.reviewDocumentPaddingInline})`,
    marginBlock: "40px 12px",
    marginInline: "auto",
  },
  // Expanded sections keep a faint chevron so "this collapses" is legible
  // without hovering the header first.
  toggle: {
    position: "absolute",
    top: "4px",
    left: "-29px",
  },
  heading: {
    minWidth: 0,
  },
  title: {
    scrollMarginTop: { default: null, [inDocument()]: "24px" },
    margin: 0,
    color: { default: null, [inDocument()]: tokens.ink },
    fontFamily: { default: null, [inDocument()]: tokens.fontSerif },
    fontSize: { default: null, [inDocument()]: documentType.h2 },
    fontWeight: { default: null, [inDocument()]: fontWeight.medium },
    lineHeight: { default: null, [inDocument()]: "32px" },
  },
  titleCollapsed: {
    color: tokens.ghost,
  },
  meta: {
    flex: "0 0 auto",
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
  },
});
