import type {
  ReviewCanvasContent,
  ReviewCanvasHandle,
  ReviewCanvasUi,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { createRoot } from "react-dom/client";

import { ApiCanvas } from "./api-canvas";
import { CanvasUiContext } from "./host/canvas-ui";
import { type ReviewFindHost, createReviewFindHost } from "./review-find";
import { ReviewHome } from "./review-home-view";
import { ReviewContainerProvider } from "./review-root-context";
import { SettingsPage } from "./settings-page";
import { shellStyles } from "./shell-styles";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { WelcomePage } from "./welcome-page";

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

  if (content.kind === "home") return <Home content={content} />;

  if (content.kind === "source") {
    if (content.error) {
      return (
        <div {...stylex.props(styles.sourceEmpty)}>
          <p {...stylex.props(styles.sourceEmptyLine)}>Worktree unavailable</p>
          <p {...stylex.props(styles.sourceEmptyLine, styles.sourceEmptyHint)}>
            {content.error}
          </p>
        </div>
      );
    }

    return (
      <div {...stylex.props(styles.sourceEmpty)}>
        <p {...stylex.props(styles.sourceEmptyLine)}>
          Select a file in the source tree
        </p>
        <p {...stylex.props(styles.sourceEmptyLine, styles.sourceEmptyHint)}>
          ⌘B toggles the tree
        </p>
      </div>
    );
  }

  if (content.kind === "welcome") {
    return (
      <WelcomePage
        install={content.install}
        setupActions={content.setupActions}
        onClose={content.close}
        onboarding={content.onboarding}
        onOpenTutorial={content.openTutorial}
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
}: {
  content: Extract<ReviewCanvasContent, { kind: "home" }>;
}) {
  const deleteReview = content.deleteReview;
  const dismissReview = content.dismissReview;
  const restoreReview = content.restoreReview;

  return (
    <ReviewHome
      reviews={content.reviews}
      onOpen={(review) => content.openReview(review.reviewId)}
      onDelete={
        deleteReview ? (review) => deleteReview(review.reviewId) : undefined
      }
      onDismiss={
        dismissReview ? (review) => dismissReview(review.reviewId) : undefined
      }
      onRestore={
        restoreReview ? (review) => restoreReview(review.reviewId) : undefined
      }
      install={content.install}
      setupActions={content.setupActions}
      onboarding={content.onboarding}
      onOpenTutorial={content.openTutorial}
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
      <div {...stylex.props(styles.brand)}>/dev/fast Whiteboard</div>
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
  themeHost.className = stylex.props(styles.themeHost).className ?? "";

  const lightClasses = [
    "review-app--theme-light",
    ...(stylex.props(themeStyles.light).className ?? "")
      .split(" ")
      .filter(Boolean),
  ];

  container.appendChild(themeHost);
  const root = createRoot(themeHost);

  const applyTheme = (theme: "dark" | "light") => {
    container.dataset.reviewTheme = theme;

    for (const name of lightClasses)
      themeHost.classList.toggle(name, theme === "light");
  };

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
      return content.kind === "api" && findHost.showFind(seed);
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
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: "100%",
    color: tokens.inkFaint,
    font: `13px/1.55 ${tokens.fontDisplay}`,
    userSelect: "none",
  },
  sourceEmptyLine: {
    margin: 0,
  },
  sourceEmptyHint: {
    fontSize: "11px",
  },
  shell: {
    width: "min(760px, 100%)",
    margin: "0 auto",
    padding: "32px",
    color: tokens.ink,
    font: `13px/1.55 ${tokens.fontDisplay}`,
  },
  shellTitle: {
    margin: "10px 0 6px",
    fontSize: "26px",
  },
  shellText: {
    color: tokens.inkMuted,
  },
  brand: {
    color: tokens.inkMuted,
    fontSize: "12px",
    fontWeight: 650,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
});
