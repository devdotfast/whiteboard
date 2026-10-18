import { fontSize } from "@canvas/scale.stylex";
import { EmptyState } from "@canvas/ui/empty-state";
import { UiHostProvider } from "@canvas/ui/host";
import { textStyles } from "@canvas/ui/text";
import type {
  ReviewCanvasContent,
  ReviewCanvasHandle,
  ReviewCanvasHomeData,
  ReviewCanvasHomeHost,
  ReviewCanvasInstallActions,
  ReviewCanvasInstallContent,
  ReviewCanvasUi,
  ReviewCliInstallStatus,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type RefObject,
  createRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import { ApiCanvas } from "./api-canvas";
import { type DiffFilePicker, DiffFilePickerContext } from "./diff-file-picker";
import { FeedbackDialog } from "./feedback-dialog";
import { CanvasUiContext } from "./host/canvas-ui";
import { FirstRun, readOnboardingSkipped } from "./onboarding/first-run";
import { NewWhiteboard } from "./onboarding/new-whiteboard";
import { type ReviewFindHost, createReviewFindHost } from "./review-find";
import { ReviewHome } from "./review-home-view";
import { ReviewContainerProvider } from "./review-root-context";
import { SettingsPage } from "./settings-page";
import { shellStyles } from "./shell-styles";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { useTooltip } from "./use-tooltip";

import "./styles.css";

export { clearPersistedReviewViewState as clearReviewViewState } from "./review-view-state";

/** What the workbench can ask of Home through the canvas handle. */
interface HomeCommands {
  newWhiteboard(): boolean;
}

function ReviewCanvas({
  content,
  findHost,
  homeCommands,
}: {
  content: ReviewCanvasContent;
  findHost: ReviewFindHost;
  homeCommands: RefObject<HomeCommands | null>;
}) {
  if (content.kind === "api")
    return (
      <div data-review-api="" {...stylex.props(shellStyles.apiCanvas)}>
        <ApiCanvas
          key={content.reviewId}
          content={content}
          findHost={findHost}
        />
      </div>
    );

  if (content.kind === "home")
    return (
      <Home
        data={content.data}
        host={content.host}
        findHost={findHost}
        commands={homeCommands}
      />
    );

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
        title="Select a file in the source tree"
        message="⌘B toggles the tree"
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
  commands,
}: {
  data: ReviewCanvasHomeData;
  host: ReviewCanvasHomeHost;
  findHost: ReviewFindHost;
  commands: RefObject<HomeCommands | null>;
}) {
  const {
    trashReview,
    deleteReview,
    restoreReview,
    markReviewRead,
    setupActions,
  } = host;

  const install = useInstall(data.installStatus, host.install);
  const [skipped, setSkipped] = useState(readOnboardingSkipped);
  const [creating, setCreating] = useState<"button" | "command">();

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

  const startCreating = (via: "button" | "command") => {
    copied.current = false;
    setCreating(via);
  };

  // Until the first whiteboard is published, Home is first run, unless the
  // reader skipped it.
  const firstRun =
    data.view !== "trash" && data.onboarding?.published === false && !skipped;

  // ⌘N: wherever the New button would show.
  const canCreate = setupActions !== undefined && data.view !== "trash";

  useImperativeHandle(
    commands,
    () => ({
      newWhiteboard() {
        if (!canCreate || firstRun) return false;

        if (!creating) startCreating("command");

        return true;
      },
    }),
    [canCreate, firstRun, creating],
  );

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
        via={creating}
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
      remoteHosts={host.remoteHosts}
      onboarding={data.onboarding}
      onOpenSettings={host.openSettings}
      onOpenSetup={host.openSetup}
      onNewWhiteboard={setupActions ? () => startCreating("button") : undefined}
      emptyState={
        setupActions ? (
          <NewWhiteboard setupActions={setupActions} embedded />
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
  const homeCommands = createRef<HomeCommands>();
  container.classList.add("review-canvas-root");
  // The canvas stylesheet is compiled inside @scope (.review-canvas-root),
  // where the scope root itself is only matched by :scope — a theme class on
  // the container would never match the light token block. The theme class
  // must live on an in-scope descendant, so all content renders inside this
  // host element.
  const themeHost = container.ownerDocument.createElement("div");

  // Recomposed on every change so StyleX settles vars against light.
  const applyTheme = (theme: "dark" | "light") => {
    const light = theme === "light";

    container.dataset.reviewTheme = theme;
    themeHost.className = [
      light && "review-app--theme-light",
      stylex.props(
        themeStyles.vars,
        styles.themeHost,
        light && themeStyles.light,
      ).className,
    ]
      .filter(Boolean)
      .join(" ");
  };

  applyTheme("dark");
  container.appendChild(themeHost);
  const root = createRoot(themeHost);

  const render = () => {
    themeSubscription?.dispose();
    themeSubscription = null;

    resetSessionDiagnostics(container);

    if (content.kind === "api") {
      applyTheme(content.bridge.currentTheme());
      themeSubscription = content.bridge.onDidChangeTheme(applyTheme);
    } else {
      applyTheme(workbenchColorTheme(container));

      const workbench =
        container.ownerDocument.querySelector(".monaco-workbench");

      if (workbench) {
        const observer = new MutationObserver(() => {
          applyTheme(workbenchColorTheme(container));
        });

        observer.observe(workbench, {
          attributes: true,
          attributeFilter: ["class"],
        });
        themeSubscription = { dispose: () => observer.disconnect() };
      }
    }

    root.render(
      <ReviewContainerProvider container={container}>
        <CanvasUiContext.Provider value={ui}>
          <UiHostProvider useTooltip={useTooltip}>
            <DiffFilePickerContext.Provider value={diffFilePicker}>
              <ReviewCanvas
                content={content}
                findHost={findHost}
                homeCommands={homeCommands}
              />
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
          </UiHostProvider>
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
    newWhiteboard() {
      return (
        content.kind === "home" &&
        (homeCommands.current?.newWhiteboard() ?? false)
      );
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
      root.unmount();
      themeHost.remove();
      container.classList.remove("review-canvas-root");
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
    padding: "32px",
    color: tokens.ink,
    font: `${fontSize.ui}/1.55 ${tokens.fontDisplay}`,
  },
  shellTitle: {
    margin: "10px 0 6px",
    fontSize: fontSize.display,
  },
  shellText: {
    color: tokens.inkMuted,
  },
  brand: {
    color: tokens.inkMuted,
  },
});
