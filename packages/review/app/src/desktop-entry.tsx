import { fontSize, leading, space } from "@canvas/scale.stylex";
import { EmptyState } from "@canvas/ui/empty-state";
import { textStyles } from "@canvas/ui/text";
import type {
  ReviewCanvasContent,
  ReviewCanvasHandle,
  ReviewCanvasHomeData,
  ReviewCanvasHomeHost,
  ReviewCanvasInstallActions,
  ReviewCanvasInstallContent,
  ReviewCanvasNewWhiteboardRequest,
  ReviewCanvasUi,
  ReviewCliInstallStatus,
  ReviewDisposable,
  ReviewSidebarSectionHandle,
  ReviewSidebarSectionProps,
  ReviewTheme,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  createRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import { ApiCanvas } from "./api-canvas";
import {
  SharedCanvasQueryClient,
  createCanvasQueryClient,
} from "./canvas-query";
import { type DiffFilePicker, DiffFilePickerContext } from "./diff-file-picker";
import { FeedbackDialog } from "./feedback-dialog";
import { CanvasUiContext } from "./host/canvas-ui";
import { loadKatex } from "./markdown-math";
import { FirstRun, readOnboardingSkipped } from "./onboarding/first-run";
import { NewWhiteboard } from "./onboarding/new-whiteboard";
import { type ReviewFindHost, createReviewFindHost } from "./review-find";
import { ReviewHome } from "./review-home-view";
import { ReviewContainerProvider } from "./review-root-context";
import { ReviewTopBar } from "./review-top-bar";
import { SettingsPage } from "./settings-page";
import { shellStyles } from "./shell-styles";
import { ReviewSidebarSection } from "./sidebar-sections";
import { themeClass, themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { Whiteboard, preloadBoardEditor } from "./whiteboard";

import "./styles.css";

void preloadBoardEditor();

void loadKatex();

export { clearPersistedReviewViewState as clearReviewViewState } from "./review-view-state";

function ReviewCanvas({
  content,
  findHost,
}: {
  content: ReviewCanvasContent;
  findHost: ReviewFindHost;
}) {
  if (content.kind === "api")
    return (
      <div data-review-api="" {...stylex.props(shellStyles.apiCanvas)}>
        <ApiCanvas key={content.reviewId} content={content} findHost={findHost}>
          <ReviewTopBar />
          <Whiteboard />
        </ApiCanvas>
      </div>
    );

  if (content.kind === "home")
    return <Home data={content.data} host={content.host} findHost={findHost} />;

  if (content.kind === "source") {
    if (content.error) {
      return (
        <EmptyState
          xstyle={styles.sourceEmpty}
          title="Worktree unavailable"
          message={content.error}
        />
      );
    }

    return (
      <EmptyState
        xstyle={styles.sourceEmpty}
        title="No file open"
        message="Open one from a quote or a link on the board."
      />
    );
  }

  if (content.kind === "welcome") return <Welcome {...content} />;

  if (content.kind === "settings") {
    return <SettingsPage settings={content.settings} />;
  }

  if (content.kind === "error") {
    return (
      <CanvasShell title="Session unavailable">
        <p {...stylex.props(styles.shellText)}>{content.message}</p>
      </CanvasShell>
    );
  }

  return null;
}

/** Status with the host's stable actions, rebuilt only when the status is. */
function useInstall(
  status: ReviewCliInstallStatus | undefined,
  actions: ReviewCanvasInstallActions | undefined,
): ReviewCanvasInstallContent | undefined {
  return useMemo(
    () => (status && actions ? { ...actions, status } : undefined),
    [status, actions],
  );
}

function Welcome({
  data,
  host,
}: Extract<ReviewCanvasContent, { kind: "welcome" }>) {
  const install = useInstall(data.installStatus, host.install);

  return (
    <FirstRun
      install={install}
      setupActions={host.setupActions}
      onSkip={() => host.close?.()}
      onClose={host.close}
      onboarding={data.onboarding}
    />
  );
}

function Home({
  data,
  host,
  findHost,
}: {
  data: ReviewCanvasHomeData;
  host: ReviewCanvasHomeHost;
  findHost: ReviewFindHost;
}) {
  const {
    trashReview,
    deleteReview,
    restoreReview,
    markReviewRead,
    setupActions,
    createWhiteboard,
  } = host;

  const install = useInstall(data.installStatus, host.install);
  const [skipped, setSkipped] = useState(readOnboardingSkipped);

  const [creating, setCreating] = useState<{
    via: "button" | ReviewCanvasNewWhiteboardRequest["via"];
    projectPath?: string;
  }>();

  // Drawing here closes New whiteboard once the run starts. A copied prompt
  // is drawn by the reader's own agent, so the screen closes when the next
  // whiteboard appears; an agent elsewhere publishing first doesn't.
  const copied = useRef(false);
  const listed = useRef(data.reviews.length);

  useEffect(() => {
    if (copied.current && data.reviews.length > listed.current) {
      copied.current = false;
      setCreating(undefined);
    }

    listed.current = data.reviews.length;
  }, [data.reviews.length]);

  // Until the first whiteboard is published, Home is first run, unless the
  // reader skipped it.
  const firstRun =
    data.view !== "trash" && data.onboarding?.published === false && !skipped;

  // ⌘N and the sidebar's +: wherever the New button would show.
  const request = data.newWhiteboard;
  const handled = useRef<ReviewCanvasNewWhiteboardRequest>(undefined);
  const canCreate = setupActions !== undefined && data.view !== "trash";

  useEffect(() => {
    if (!request || request === handled.current || !canCreate || firstRun)
      return;

    handled.current = request;

    if (creating) return;
    copied.current = false;
    setCreating(request);
  }, [request, canCreate, firstRun, creating]);

  if (firstRun)
    return (
      <FirstRun
        install={install}
        setupActions={setupActions}
        onboarding={data.onboarding}
        onSkip={() => setSkipped(true)}
        onDismissUpdate={() => setSkipped(true)}
      />
    );

  if (creating && setupActions)
    return (
      <NewWhiteboard
        setupActions={setupActions}
        via={creating.via}
        projectPath={creating.projectPath}
        onCreate={createWhiteboard}
        onClose={() => setCreating(undefined)}
        onCopied={() => {
          copied.current = true;
        }}
      />
    );

  return (
    <ReviewHome
      findHost={findHost}
      view={data.view}
      onViewChange={host.navigate}
      reviews={data.reviews}
      onOpen={(review) => host.openReview(review.reviewId)}
      onTrash={
        trashReview ? (review) => trashReview(review.reviewId) : undefined
      }
      onMarkRead={
        markReviewRead ? (review) => markReviewRead(review.reviewId) : undefined
      }
      onDelete={
        deleteReview ? (review) => deleteReview(review.reviewId) : undefined
      }
      onRestore={
        restoreReview ? (review) => restoreReview(review.reviewId) : undefined
      }
      onNewChildWhiteboard={host.createChildWhiteboard}
      remoteHosts={host.remoteHosts}
      onboarding={data.onboarding}
      onOpenSettings={host.openSettings}
      onOpenSetup={host.openSetup}
      onNewWhiteboard={
        setupActions
          ? () => {
              copied.current = false;
              setCreating({ via: "button" });
            }
          : undefined
      }
      emptyState={
        setupActions ? (
          <NewWhiteboard
            setupActions={setupActions}
            embedded
            onCreate={createWhiteboard}
          />
        ) : undefined
      }
    />
  );
}

function CanvasShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main {...stylex.props(styles.shell)}>
      <div {...stylex.props(textStyles.eyebrow, styles.brand)}>
        /dev/fast Whiteboard
      </div>
      <h1 {...stylex.props(styles.shellTitle)}>{title}</h1>
      {children}
    </main>
  );
}

// The canvas shares the workbench DOM, so outside a session (which carries its
// own theme bridge) the workbench root is the theme authority.
function workbenchColorTheme(container: HTMLElement): "dark" | "light" {
  const workbench = container.ownerDocument.querySelector(".monaco-workbench");

  if (!workbench) return "dark";

  return workbench.classList.contains("vs-dark") ||
    workbench.classList.contains("hc-black")
    ? "dark"
    : "light";
}

interface ThemedRoot {
  render(element: ReactElement): void;
  dispose(): void;
}

/** @scope matches its root only via :scope, so the theme class sits on an
 * inner host. */
function themedRoot(container: HTMLElement) {
  container.classList.add("review-canvas-root");
  const themeHost = container.ownerDocument.createElement("div");

  // Recomposed on every change so StyleX settles vars against light.
  const applyTheme = (theme: ReviewTheme) => {
    themeHost.className = [
      theme === "light" && "review-app--theme-light",
      stylex.props(themeStyles.vars, styles.themeHost, themeClass(theme))
        .className,
    ]
      .filter(Boolean)
      .join(" ");
  };

  container.appendChild(themeHost);
  const root = createRoot(themeHost);

  return {
    root,
    applyTheme,
    dispose() {
      root.unmount();
      themeHost.remove();
      container.classList.remove("review-canvas-root");
    },
  };
}

function followWorkbenchTheme(
  container: HTMLElement,
  applyTheme: (theme: ReviewTheme) => void,
) {
  applyTheme(workbenchColorTheme(container));
  const workbench = container.ownerDocument.querySelector(".monaco-workbench");

  const observer = new MutationObserver(() =>
    applyTheme(workbenchColorTheme(container)),
  );

  if (workbench)
    observer.observe(workbench, {
      attributes: true,
      attributeFilter: ["class"],
    });

  return { dispose: () => observer.disconnect() };
}

/** A React root in workbench DOM that follows the workbench theme. */
function mountThemed(container: HTMLElement): ThemedRoot {
  let disposed = false;
  const themed = themedRoot(container);
  const theme = followWorkbenchTheme(container, themed.applyTheme);

  return {
    render(element) {
      if (!disposed) themed.root.render(element);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      theme.dispose();
      themed.dispose();
    },
  };
}

/** Mounts one section's list in Desktop's sidebar. */
export function mountReviewSidebarSection(
  container: HTMLElement,
  props: ReviewSidebarSectionProps,
): ReviewSidebarSectionHandle {
  const mounted = mountThemed(container);

  mounted.render(<ReviewSidebarSection {...props} />);

  return {
    update: (next) => mounted.render(<ReviewSidebarSection {...next} />),
    dispose: () => mounted.dispose(),
  };
}

export function mountReviewCanvas(
  container: HTMLElement,
  initialContent: ReviewCanvasContent,
  ui?: ReviewCanvasUi,
): ReviewCanvasHandle {
  let content = initialContent;
  let feedbackOpen = false;

  let disposed = false;
  let themeSubscription: { dispose(): void } | null = null;
  const findHost = createReviewFindHost();
  const diffFilePicker = createRef<DiffFilePicker>();
  // Boards shown in turn share their reads.
  const queryClient = createCanvasQueryClient();
  const themed = themedRoot(container);

  const render = () => {
    themeSubscription?.dispose();
    themeSubscription = null;

    resetSessionDiagnostics(container);

    if (content.kind === "api") {
      themed.applyTheme(content.bridge.currentTheme());
      themeSubscription = content.bridge.onDidChangeTheme(themed.applyTheme);
    } else
      themeSubscription = followWorkbenchTheme(container, themed.applyTheme);

    themed.root.render(
      <ReviewContainerProvider container={container}>
        <CanvasUiContext.Provider value={ui}>
          <DiffFilePickerContext.Provider value={diffFilePicker}>
            <SharedCanvasQueryClient.Provider value={queryClient}>
              <ReviewCanvas content={content} findHost={findHost} />
            </SharedCanvasQueryClient.Provider>
            {feedbackOpen && ui?.feedback && (
              <FeedbackDialog
                host={ui.feedback}
                onClose={() => {
                  feedbackOpen = false;
                  render();
                }}
              />
            )}
          </DiffFilePickerContext.Provider>
        </CanvasUiContext.Provider>
      </ReviewContainerProvider>,
    );
  };

  render();

  return {
    update(next) {
      if (disposed) return;
      content = next;
      render();
    },
    focus() {
      container.focus();
    },
    showFind(seed) {
      return (
        (content.kind === "api" || content.kind === "home") &&
        findHost.showFind(seed)
      );
    },
    diffFiles() {
      return diffFilePicker.current?.files();
    },
    revealDiffFile(path) {
      diffFilePicker.current?.reveal(path);
    },
    showFeedback() {
      if (disposed || !ui?.feedback) return;
      feedbackOpen = true;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      themeSubscription?.dispose();
      themeSubscription = null;
      themed.dispose();
      queryClient.clear();
    },
  };
}

function resetSessionDiagnostics(container: HTMLElement): void {
  delete container.dataset.reviewDiffSummaryRequestCount;
  delete container.dataset.reviewDiffSummaryReadyCount;
  delete container.dataset.reviewDiffSummaryStartedAfterMount;
  delete container.dataset.reviewDiffSummaryIncludePatch;
}

const styles = stylex.create({
  // Layout-neutral: it only carries the theme inside the scope boundary.
  themeHost: {
    display: "contents",
    // Match native form controls to the canvas. themeStyles.light overrides it.
    colorScheme: "dark",
  },
  // The Source tab's VS Code-like watermark: quiet text centered in the
  // empty editor area, next to the native file tree.
  sourceEmpty: {
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    textAlign: "center",
    userSelect: "none",
  },
  shell: {
    width: "min(760px, 100%)",
    margin: "0 auto",
    padding: space.s32,
    color: tokens.ink,
    font: `${fontSize.ui}/${leading.normal} ${tokens.chromeFont}`,
  },
  shellTitle: {
    margin: `${space.s10} 0 ${space.s6}`,
    fontSize: fontSize.display,
  },
  shellText: {
    color: tokens.inkMuted,
  },
  brand: {
    color: tokens.inkMuted,
  },
});
