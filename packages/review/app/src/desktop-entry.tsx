import { fontSize } from "@canvas/scale.stylex";
import { EmptyState } from "@canvas/ui/empty-state";
import { textStyles } from "@canvas/ui/text";
import type {
  ReviewCanvasContent,
  ReviewCanvasHandle,
  ReviewCanvasUi,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { ApiCanvas } from "./api-canvas";
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

import "./styles.css";

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
        <ApiCanvas
          key={content.reviewId}
          content={content}
          findHost={findHost}
        />
      </div>
    );

  if (content.kind === "home")
    return <Home content={content} findHost={findHost} />;

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

  if (content.kind === "welcome") {
    return (
      <FirstRun
        install={content.install}
        setupActions={content.setupActions}
        onSkip={() => content.close?.()}
        onClose={content.close}
        onboarding={content.onboarding}
      />
    );
  }

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

function Home({
  content,
  findHost,
}: {
  content: Extract<ReviewCanvasContent, { kind: "home" }>;
  findHost: ReviewFindHost;
}) {
  const trashReview = content.trashReview;
  const deleteReview = content.deleteReview;
  const restoreReview = content.restoreReview;
  const markReviewRead = content.markReviewRead;

  const [skipped, setSkipped] = useState(readOnboardingSkipped);
  const [creating, setCreating] = useState(false);
  const setupActions = content.setupActions;

  // A new whiteboard opens in its own tab; Home is back to its list after.
  const listed = useRef(content.reviews.length);

  useEffect(() => {
    if (content.reviews.length > listed.current) setCreating(false);
    listed.current = content.reviews.length;
  }, [content.reviews.length]);

  // Until the first whiteboard is published, Home is first run, unless the
  // reader skipped it.
  if (
    content.view !== "trash" &&
    content.onboarding?.published === false &&
    !skipped
  )
    return (
      <FirstRun
        install={content.install}
        setupActions={content.setupActions}
        onboarding={content.onboarding}
        onSkip={() => setSkipped(true)}
        onDismissUpdate={() => setSkipped(true)}
      />
    );

  if (creating && setupActions)
    return (
      <NewWhiteboard
        setupActions={setupActions}
        onClose={() => setCreating(false)}
      />
    );

  return (
    <ReviewHome
      findHost={findHost}
      view={content.view}
      onViewChange={content.navigate}
      reviews={content.reviews}
      onOpen={(review) => content.openReview(review.reviewId)}
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
      remoteHosts={content.remoteHosts}
      onboarding={content.onboarding}
      onOpenSettings={content.openSettings}
      onOpenSetup={content.openSetup}
      onNewWhiteboard={setupActions ? () => setCreating(true) : undefined}
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

  let disposed = false;
  let themeSubscription: { dispose(): void } | null = null;
  const findHost = createReviewFindHost();
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
          <ReviewCanvas content={content} findHost={findHost} />
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
