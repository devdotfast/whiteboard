import {
  type JsonObject,
  type ReviewCanvasTutorialBridge,
} from "@dev.fast/review-protocol";
import { type ReactElement, act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { controlStyles } from "./controls-styles";
import { ReviewDebugSettingsProvider } from "./debug-settings";
import {
  type ReviewSession,
  ReviewSessionProvider,
} from "./host/review-session";
import { ReviewSection } from "./review-components";
import { ReviewProvider } from "./review-context";
import { ReviewPanelProvider, useReviewPanelStore } from "./review-panel";
import type { ReviewPanelStore } from "./review-panel-store";
import { ReviewContainerProvider } from "./review-root-context";
import { testReviewSession } from "./review-session-test-utils";
import { shellStyles } from "./shell-styles";
import { withClass } from "./stylex-props";
import { TutorialProvider } from "./tutorial-context";
import { TutorialExperienceProvider } from "./tutorial-experience";

const CHAPTER_TITLES = [
  "Welcome",
  "Diffs and lenses",
  "Interactive diagrams",
  "Get help",
];

const THROUGH_DIFFS = [
  "chooseKeymap",
  "showHover",
  "openDiff",
  "selectLens",
  "expandFold",
  "backToWhiteboard",
] as const;

let session: ReviewSession;

let root: ReturnType<typeof createRoot> | null = null;

let canvasRoot: HTMLElement;

let panelStore: ReviewPanelStore;

beforeEach(() => {
  session = testReviewSession(
    {},
    { request: async () => jsonResponse({ ok: true }) },
  );
  window.localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn<() => void>(),
  });
  canvasRoot = document.createElement("div");
  canvasRoot.className = "review-canvas-root";
  document.body.append(canvasRoot);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Shell(): ReactElement {
  const shellRef = useRef<HTMLElement | null>(null);
  const regionRef = useRef<HTMLElement | null>(null);

  return (
    <main
      ref={shellRef}
      {...withClass("review-document-shell", shellStyles.documentShell)}
    >
      <TutorialExperienceProvider
        shellRef={shellRef}
        scrollRegionRef={regionRef}
      >
        <button
          type="button"
          {...withClass("review-segment", controlStyles.segment)}
          aria-label="Diff"
        >
          Diff
        </button>
        <button
          type="button"
          className="tutorial-view-button"
          data-tutorial-view="diff"
        >
          Open the diff
        </button>
        <section
          ref={regionRef}
          {...withClass("review-view-region", shellStyles.viewRegion)}
        >
          <div {...withClass("review-document-view", shellStyles.documentView)}>
            {CHAPTER_TITLES.map((title) => (
              <ReviewSection key={title} title={title}>
                <h2>{title}</h2>
                {title === "Welcome" ? (
                  <div className="tutorial-keymap-picker" />
                ) : (
                  <p>{title} body</p>
                )}
              </ReviewSection>
            ))}
          </div>
        </section>
      </TutorialExperienceProvider>
    </main>
  );
}

function render(tutorial: ReviewCanvasTutorialBridge) {
  root = createRoot(canvasRoot);
  act(() => {
    root?.render(
      <ReviewSessionProvider session={session}>
        <ReviewDebugSettingsProvider>
          <ReviewContainerProvider container={canvasRoot}>
            <ReviewProvider>
              <ReviewPanelProvider>
                <PanelStoreProbe />
                <TutorialProvider tutorial={tutorial}>
                  <Shell />
                </TutorialProvider>
              </ReviewPanelProvider>
            </ReviewProvider>
          </ReviewContainerProvider>
        </ReviewDebugSettingsProvider>
      </ReviewSessionProvider>,
    );
  });
}

function PanelStoreProbe(): null {
  panelStore = useReviewPanelStore();

  return null;
}

function section(title: string): HTMLElement {
  const element = canvasRoot.querySelector<HTMLElement>(
    `[data-review-section="${title}"]`,
  );

  if (!element) throw new Error(`Missing section ${title}`);

  return element;
}

function card(): HTMLElement | null {
  return canvasRoot.querySelector('aside[aria-label="Tutorial guide"]');
}

/** Rings drawn in the guide's layer, beside the guide card. */
function layerRings() {
  return card()?.parentElement?.querySelectorAll(":scope > div") ?? [];
}

/** The ring layer inside the scroll region. */
function regionLayer() {
  return canvasRoot.querySelector(".review-view-region > [aria-hidden]");
}

describe("TutorialExperience", () => {
  it("shows one guide card in the shell corner and marks the target", () => {
    const tutorial = tutorialBridge([]);
    render(tutorial);

    expect(card()?.textContent).toContain("Choose your keybindings");
    expect(
      canvasRoot.querySelectorAll('aside[aria-label="Tutorial guide"]'),
    ).toHaveLength(1);
    expect(card()?.parentElement?.parentElement).toHaveClass(
      "review-document-shell",
    );
    expect(section("Welcome").dataset.tutorialChapterState).toBe("active");
    expect(section("Diffs and lenses").dataset.tutorialChapterState).toBe(
      "upcoming",
    );
    expect(
      canvasRoot
        .querySelector(".tutorial-keymap-picker")
        ?.getAttribute("data-tutorial-target"),
    ).toBe("chooseKeymap");
  });

  it("draws target rings in a layer inside the scroll region", () => {
    const tutorial = tutorialBridge([]);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);

      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    try {
      render(tutorial);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(card()).not.toBeNull();
    expect(regionLayer()?.children).toHaveLength(1);
    expect(layerRings()).toHaveLength(0);
  });

  it("draws a toolbar target's ring in the guide's layer", () => {
    const tutorial = tutorialBridge(["chooseKeymap", "showHover"]);

    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);

      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    try {
      render(tutorial);
    } finally {
      vi.unstubAllGlobals();
    }

    // The Diff tab and the prose button both sit outside the region.
    expect(layerRings()).toHaveLength(2);
    expect(regionLayer()).toBeNull();
  });

  it("expands the active chapter without collapsing the others", () => {
    const tutorial = tutorialBridge([]);
    render(tutorial);

    const toggle = (title: string) =>
      section(title).querySelector<HTMLButtonElement>("button[aria-expanded]")!;

    act(() => toggle("Interactive diagrams").click());
    expect(toggle("Interactive diagrams").getAttribute("aria-expanded")).toBe(
      "false",
    );
    act(() => toggle("Welcome").click());
    expect(toggle("Welcome").getAttribute("aria-expanded")).toBe("false");

    act(() => {
      root?.render(
        <ReviewSessionProvider session={session}>
          <ReviewDebugSettingsProvider>
            <ReviewContainerProvider container={canvasRoot}>
              <ReviewProvider>
                <TutorialProvider tutorial={tutorialBridge([...THROUGH_DIFFS])}>
                  <Shell />
                </TutorialProvider>
              </ReviewProvider>
            </ReviewContainerProvider>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>,
      );
    });

    expect(toggle("Interactive diagrams").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(toggle("Welcome").getAttribute("aria-expanded")).toBe("false");
    expect(section("Welcome").dataset.tutorialChapterState).toBe("complete");
    expect(card()?.textContent).toContain("Walk the sequence");
  });

  it("completes a button step from the real target click", () => {
    const tutorial = tutorialBridge(["chooseKeymap", "showHover"]);

    render(tutorial);

    const diff = canvasRoot.querySelector<HTMLButtonElement>(
      '.review-segment[aria-label="Diff"]',
    )!;

    expect(card()?.textContent).toContain("Open the diff");
    expect(diff.dataset.tutorialTarget).toBe("openDiff");
    expect(
      canvasRoot.querySelector<HTMLElement>(".tutorial-view-button")?.dataset
        .tutorialTarget,
    ).toBe("openDiff");
    act(() => diff.click());
    expect(tutorial.setStep).toHaveBeenCalledWith("openDiff", true);
  });

  it("stays above the sequence tour and completes once the tour moves", async () => {
    const tutorial = tutorialBridge([...THROUGH_DIFFS]);

    render(tutorial);

    expect(card()?.textContent).toContain("Walk the sequence");
    await act(async () => {
      panelStore
        .getState()
        .openOverlayTour({ tourId: "t", kind: "sequence" }, "a");
      await Promise.resolve();
    });

    expect(card()?.textContent).toContain("Walk the sequence");
    expect(card()?.closest(".review-document-shell")).toBeNull();
    expect(card()?.parentElement?.parentElement).toBe(canvasRoot);
    expect(tutorial.setStep).not.toHaveBeenCalled();

    await act(async () => {
      panelStore.getState().moveOverlayTour("b", { reveal: true });
      await Promise.resolve();
    });

    expect(tutorial.setStep).toHaveBeenCalledWith("openSequence", true);
  });

  it("completes the database stop from the real database Tour", async () => {
    const tutorial = tutorialBridge([
      ...THROUGH_DIFFS,
      "openSequence",
      "closeSequence",
    ]);

    render(tutorial);

    expect(card()?.textContent).toContain("Inspect the database flow");
    await act(async () => {
      panelStore
        .getState()
        .openOverlayTour({ tourId: "t", kind: "database" }, "a");
      await Promise.resolve();
    });

    expect(card()).not.toBeNull();
    expect(tutorial.setStep).toHaveBeenCalledWith("openDatabase", true);
  });

  it("forces the tour forward with Next", () => {
    const tutorial = tutorialBridge([]);
    render(tutorial);

    const next = [...canvasRoot.querySelectorAll("button")].find(
      (button) => button.textContent === "Next",
    );

    expect(next).toBeDefined();
    act(() => next?.click());
    expect(tutorial.setStep).toHaveBeenCalledWith("chooseKeymap", true);
    expect(tutorial.dismiss).not.toHaveBeenCalled();
  });

  it("steps back to the previous chapter's last step", () => {
    const tutorial = tutorialBridge(["chooseKeymap", "showHover"]);

    render(tutorial);

    const back = [...canvasRoot.querySelectorAll("button")].find(
      (button) => button.textContent === "Back",
    );

    act(() => back?.click());
    expect(tutorial.setStep).toHaveBeenCalledTimes(1);
    expect(tutorial.setStep).toHaveBeenCalledWith("showHover", false);
  });

  it("scrolls an off-screen step target into view once", () => {
    const tutorial = tutorialBridge([]);
    const scrolled = vi.fn<() => void>();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrolled,
    });
    const offScreen = { top: 2000, bottom: 2040 } as DOMRect;
    const viewRect = { top: 0, bottom: 800 } as DOMRect;
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return this.classList.contains("tutorial-keymap-picker")
        ? offScreen
        : viewRect;
    };

    try {
      render(tutorial);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }

    const targetScrolls = scrolled.mock.contexts.filter((element) =>
      (element as HTMLElement).classList.contains("tutorial-keymap-picker"),
    );

    expect(targetScrolls).toHaveLength(1);
  });

  it("finishes from the final Get help stop", () => {
    const tutorial = tutorialBridge([
      ...THROUGH_DIFFS,
      "openSequence",
      "closeSequence",
      "openDatabase",
    ]);

    render(tutorial);

    expect(card()?.textContent).toContain("Know where to get help");

    const finish = [...canvasRoot.querySelectorAll("button")].find(
      (button) => button.textContent === "Finish tour",
    );

    act(() => finish?.click());

    expect(tutorial.setStep).toHaveBeenCalledWith("getHelp", true);
    expect(tutorial.close).toHaveBeenCalledOnce();
  });

  it("renders no card or chapter state when dismissed", () => {
    render(tutorialBridge([], true));

    expect(card()).toBeNull();
    expect(section("Welcome").dataset.tutorialChapterState).toBeUndefined();
    expect(canvasRoot.querySelector("[data-tutorial-target]")).toBeNull();
  });

  it("shrinks to a floating Tutorial button when hidden", () => {
    const tutorial = tutorialBridge([], true);
    render(tutorial);

    const pill = canvasRoot.querySelector<HTMLButtonElement>(
      'button[aria-label="Show tutorial"]',
    );

    expect(pill?.getAttribute("aria-label")).toBe("Show tutorial");
    expect(pill?.querySelector("svg")).not.toBeNull();
    expect(card()).toBeNull();
    act(() => pill?.click());
    expect(tutorial.reopen).toHaveBeenCalledOnce();
  });
});

function tutorialBridge(
  checked: ReviewCanvasTutorialBridge["content"]["progress"]["checked"],
  dismissed = false,
) {
  const setStep = vi.fn<ReviewCanvasTutorialBridge["setStep"]>();

  return {
    content: {
      reviewUuid: "tutorial-review",
      progress: { version: 1, checked, dismissed },
      keymap: "none",
    },
    setStep,
    dismiss: vi.fn<ReviewCanvasTutorialBridge["dismiss"]>(),
    reopen: vi.fn<ReviewCanvasTutorialBridge["reopen"]>(),
    selectKeymap: vi.fn<ReviewCanvasTutorialBridge["selectKeymap"]>(
      async () => {},
    ),
    close: vi.fn<ReviewCanvasTutorialBridge["close"]>(),
  } satisfies ReviewCanvasTutorialBridge;
}

function jsonResponse(body: JsonObject): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
