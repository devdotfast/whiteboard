import type {
  ReviewFindQuery,
  ReviewInlineEditorHandle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { act, useLayoutEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { scopeReviewCanvasCss } from "../desktop-css-scope";
import { documentStyles } from "./document-styles";
import { ReviewSessionProvider } from "./host/review-session";
import {
  appMarker,
  documentMarker,
  topbarActionsMarker,
  topbarTabsMarker,
} from "./markers.stylex";
import {
  type ReviewFindHost,
  ReviewFindProvider,
  createReviewFindHost,
  useReviewFindRegistration,
} from "./review-find";
import { ReviewRootsProvider } from "./review-root-context";
import { testReviewSession } from "./review-session-test-utils";
import { shellStyles } from "./shell-styles";
import { withClass } from "./stylex-props";

import canvasCss from "./styles.css?inline";

let root: ReturnType<typeof createRoot> | undefined;

const cx = (...styles: stylex.StyleXArray<stylex.CompiledStyles | false>[]) =>
  stylex.props(...styles).className;

const findCount = (container: HTMLElement) =>
  container.querySelector('[role="search"] [aria-live]');

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it("orders duplicate editors with MDX and wraps navigation", async () => {
  const first = findHandle();
  const second = findHandle();
  const focusTarget = document.createElement("button");
  const container = document.createElement("div");
  document.body.append(focusTarget, container);
  focusTarget.focus();
  container.style.setProperty(
    "--review-find-match-background",
    "rgb(10, 20, 30)",
  );
  container.style.setProperty(
    "--review-find-match-active-background",
    "rgb(40, 50, 60)",
  );
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[first, second]} />);
  });

  await act(async () => {
    expect(host.showFind("Alpha")).toBe(true);
  });
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 4");
  });
  expect(
    getComputedStyle(container, "::highlight(review-find-match)")
      .backgroundColor,
  ).toBe("rgb(10, 20, 30)");
  expect(
    getComputedStyle(container, "::highlight(review-find-match-active)")
      .backgroundColor,
  ).toBe("rgb(40, 50, 60)");
  // The shell is the widget's containing block.
  expect(
    container.querySelector(".review-find-widget")?.parentElement,
  ).toHaveClass("review-document-shell");
  const next = button(container, "Next Match");
  await act(async () => next.click());
  await vi.waitFor(() => {
    expect(first.revealFindMatch).toHaveBeenCalledWith(0);
  });
  expect(findCount(container)?.textContent).toBe("2 of 4");
  await act(async () => next.click());
  expect(findCount(container)?.textContent).toBe("3 of 4");
  expect(first.clearActiveFindMatch).toHaveBeenCalled();
  await act(async () => next.click());
  await vi.waitFor(() => {
    expect(second.revealFindMatch).toHaveBeenCalledWith(0);
  });
  await act(async () => next.click());
  expect(findCount(container)?.textContent).toBe("1 of 4");

  await act(async () => button(container, "Close Find").click());
  expect(document.activeElement).toBe(focusTarget);
  expect(first.clearFind).toHaveBeenCalled();
  expect(second.clearFind).toHaveBeenCalled();
  expect(
    getComputedStyle(container, "::highlight(review-find-match)")
      .backgroundColor,
  ).toBe("rgba(0, 0, 0, 0)");
  expect(
    getComputedStyle(container, "::highlight(review-find-match-active)")
      .backgroundColor,
  ).toBe("rgba(0, 0, 0, 0)");
});

it("ignores results from an older query generation", async () => {
  let resolveSlow!: (value: { matchCount: number }) => void;

  const slow = new Promise<{ matchCount: number }>((resolve) => {
    resolveSlow = resolve;
  });

  const handle = findHandle(async (query) =>
    query.text.includes("slow") ? slow : { matchCount: 1 },
  );

  const container = document.createElement("div");
  document.body.append(container);
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[handle]} />);
  });
  await act(async () => {
    expect(host.showFind("slow")).toBe(true);
  });
  await vi.waitFor(() => {
    expect(
      container.querySelector('.review-find-widget input[aria-label="Find"]'),
    ).not.toBeNull();
  });
  await setInput(container, "Alpha");
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 3");
  });
  resolveSlow({ matchCount: 9 });
  await act(async () => Promise.resolve());
  expect(findCount(container)?.textContent).toBe("1 of 3");
});

it("searches editors once for a query typed in quick succession", async () => {
  const first = findHandle();
  const second = findHandle();
  const container = document.createElement("div");
  document.body.append(container);
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[first, second]} />);
  });
  await act(async () => {
    host.showFind();
  });

  for (const text of ["A", "Al", "Alp", "Alph", "Alpha"]) {
    await setInput(container, text);
  }

  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 4");
  });

  for (const handle of [first, second]) {
    expect(handle.setFindQuery.mock.calls.map(([query]) => query.text)).toEqual(
      ["Alpha"],
    );
  }
});

it("keeps late editor results from reviving a closed search", async () => {
  const slow = deferred<{ matchCount: number }>();
  const handle = findHandle(() => slow.promise);
  const container = document.createElement("div");
  document.body.append(container);
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[handle]} />);
  });
  await act(async () => {
    host.showFind("Alpha");
  });
  expect(findCount(container)?.textContent).toBe("Searching…");

  await act(async () => button(container, "Close Find").click());
  await act(async () => slow.resolve({ matchCount: 3 }));

  expect(container.querySelector(".review-find-widget")).toBeNull();
  expect(handle.revealFindMatch).not.toHaveBeenCalled();
  expect(CSS.highlights.has("review-find-match")).toBe(false);
});

it("keeps late editor results from highlighting an unmounted canvas", async () => {
  const slow = deferred<{ matchCount: number }>();
  const handle = findHandle(() => slow.promise);
  const container = document.createElement("div");
  document.body.append(container);
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[handle]} />);
  });
  await act(async () => {
    host.showFind("Alpha");
  });

  await act(async () => root?.unmount());
  root = undefined;
  await act(async () => slow.resolve({ matchCount: 3 }));

  expect(CSS.highlights.has("review-find-match")).toBe(false);
  expect(handle.revealFindMatch).not.toHaveBeenCalled();
});

it("drops a removed editor's matches", async () => {
  const first = findHandle();
  const second = findHandle();
  const container = document.createElement("div");
  document.body.append(container);
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[first, second]} />);
  });
  await act(async () => {
    host.showFind("Alpha");
  });
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 4");
  });

  await act(async () => {
    root?.render(<FindHarness host={host} handles={[first]} />);
  });
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 3");
  });
  expect(second.clearFind).toHaveBeenCalled();
});

it("reports an invalid expression and recovers when it becomes valid", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[findHandle()]} />);
  });
  await act(async () => {
    host.showFind("Alpha");
  });
  await act(async () => button(container, "Use Regular Expression").click());
  await setInput(container, "Alpha(");

  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Find"]',
  )!;

  expect(findCount(container)?.textContent).toBe("Invalid expression");
  expect(input.getAttribute("aria-invalid")).toBe("true");

  await setInput(container, "Alpha (first|second)");
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 3");
  });
  expect(input.getAttribute("aria-invalid")).toBeNull();
});

it("closes and forgets the query when the document changes", async () => {
  const focusTarget = document.createElement("button");
  const container = document.createElement("div");
  document.body.append(focusTarget, container);
  focusTarget.focus();
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[findHandle()]} />);
  });
  await act(async () => {
    host.showFind("Alpha");
  });
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 3");
  });

  await act(async () => {
    root?.render(
      <FindHarness host={host} handles={[findHandle()]} documentKey="next" />,
    );
  });
  expect(container.querySelector(".review-find-widget")).toBeNull();
  expect(CSS.highlights.has("review-find-match")).toBe(false);
  expect(document.activeElement).toBe(focusTarget);

  await act(async () => {
    host.showFind();
  });
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Find"]')
      ?.value,
  ).toBe("");
});

it("restores the review's find inputs after a fresh mount and recomputes matches", async () => {
  localStorage.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const session = testReviewSession({ reviewId: "find-resume" });
  const host = createReviewFindHost();
  root = createRoot(container);

  const render = () =>
    root?.render(
      <ReviewSessionProvider session={session}>
        <FindHarness host={host} handles={[findHandle()]} />
      </ReviewSessionProvider>,
    );

  await act(async () => render());
  await act(async () => host.showFind("Alpha"));
  await act(async () => button(container, "Match Case").click());
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 3");
  });
  await act(async () => root?.render(null));
  await act(async () => render());
  expect(container.querySelector(".review-find-widget")).toBeNull();

  await act(async () => host.showFind());
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Find"]')
      ?.value,
  ).toBe("Alpha");
  expect(button(container, "Match Case").getAttribute("aria-pressed")).toBe(
    "true",
  );
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 3");
  });
});

it("does not re-render the document while the reader searches", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const host = createReviewFindHost();
  let documentRenders = 0;
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <FindHarness
        host={host}
        handles={[findHandle()]}
        onDocumentRender={() => {
          documentRenders += 1;
        }}
      />,
    );
  });
  const rendersBeforeFind = documentRenders;

  await act(async () => {
    host.showFind("Al");
  });
  await setInput(container, "Alp");
  await setInput(container, "Alpha");
  await vi.waitFor(() => {
    expect(findCount(container)?.textContent).toBe("1 of 3");
  });
  await act(async () => button(container, "Next Match").click());
  await act(async () => button(container, "Close Find").click());

  expect(documentRenders).toBe(rendersBeforeFind);
});

it("keeps the find widget below and above the topbar", async () => {
  const styles = document.createElement("style");
  styles.textContent = scopeReviewCanvasCss(canvasCss);
  const canvas = document.createElement("div");
  canvas.className = "review-canvas-root";
  canvas.style.cssText =
    "position: fixed; inset: 40px 0 0; height: auto; min-height: 0";
  // A recoverable load error renders a status row above .review-app: the
  // height that used to slide the topbar onto the find widget.
  canvas.innerHTML = `
    <div data-review-api class="${cx(shellStyles.apiCanvas)}">
      <p role="status" style="margin: 8px 24px; font-size: 12px">Could not refresh this review.</p>
      <div class="review-app ${stylex.props(appMarker).className}">
        <main class="review-document-shell ${cx(shellStyles.documentShell)}">
          <header class="${cx(shellStyles.topbar)}">
            <div class="${cx(shellStyles.topbarLeft)} ${stylex.props(topbarTabsMarker).className}"></div>
            <div class="${cx(shellStyles.topbarActions)} ${stylex.props(topbarActionsMarker).className}"></div>
          </header>
          <section class="${cx(shellStyles.viewRegion, shellStyles.reviewRegion)}">
            <div class="${cx(shellStyles.documentView)}">
              <article class="review-document ${cx(documentStyles.article)} ${stylex.props(documentMarker).className}">
                <h2 id="rollout">Rollout</h2><p>body</p>
                <h2 id="risks">Risks</h2><p>body</p>
              </article>
            </div>
          </section>
        </main>
      </div>
    </div>`;
  document.body.append(styles, canvas);

  const roots = {
    appRef: { current: null },
    shellRef: {
      current: canvas.querySelector<HTMLElement>(".review-document-shell"),
    },
    scrollRegionRef: { current: null },
    articleRef: {
      current: canvas.querySelector<HTMLElement>(".review-document"),
    },
  };

  const host = createReviewFindHost();
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(
      <ReviewRootsProvider roots={roots}>
        <ReviewFindProvider
          articleRef={roots.articleRef}
          documentKey="layout"
          host={host}
        >
          {null}
        </ReviewFindProvider>
      </ReviewRootsProvider>,
    );
  });
  await act(async () => {
    expect(host.showFind()).toBe(true);
  });

  const topbar = canvas.querySelector("header")!.getBoundingClientRect();

  const widget = canvas.querySelector('[role="search"]')!;
  const wholeWord = button(canvas, "Match Whole Word");

  // The widget starts below the topbar even with a status row above the app.
  expect(widget.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    topbar.bottom,
  );
  // Its toggles keep the pointer rather than handing it to what the topbar
  // stacks above them.
  const rect = wholeWord.getBoundingClientRect();

  expect(
    wholeWord.contains(
      document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      ),
    ),
  ).toBe(true);
});

function deferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

function FindHarness({
  host,
  handles,
  documentKey = "test-document",
  onDocumentRender,
}: {
  host: ReviewFindHost;
  handles: ReviewInlineEditorHandle[];
  documentKey?: string;
  onDocumentRender?: () => void;
}) {
  const articleRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const appRef = useRef<HTMLDivElement | null>(null);

  const roots = useMemo(
    () => ({ appRef, shellRef, scrollRegionRef: scrollRef, articleRef }),
    [],
  );

  return (
    <ReviewRootsProvider roots={roots}>
      <ReviewFindProvider
        articleRef={articleRef}
        documentKey={documentKey}
        host={host}
      >
        <main
          ref={shellRef}
          {...withClass("review-document-shell", shellStyles.documentShell)}
        >
          <section ref={scrollRef}>
            <article
              ref={articleRef}
              {...withClass(
                "review-document",
                documentStyles.article,
                documentMarker,
              )}
            >
              <DocumentProbe onRender={onDocumentRender} />
              <p>Alpha first</p>
              <InlineRegistration handle={handles[0]!} />
              <p>Alpha second</p>
              {handles[1] ? <InlineRegistration handle={handles[1]} /> : null}
            </article>
          </section>
        </main>
      </ReviewFindProvider>
    </ReviewRootsProvider>
  );
}

function DocumentProbe({ onRender }: { onRender?: () => void }) {
  useReviewFindRegistration();
  onRender?.();

  return null;
}

function InlineRegistration({ handle }: { handle: ReviewInlineEditorHandle }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const find = useReviewFindRegistration();
  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container || !find) return;

    return find.register({
      container,
      setFindQuery: (query) => handle.setFindQuery(query),
      async revealFindMatch(index) {
        handle.revealFindMatch(index);
      },
      clearFind: () => handle.clearFind(),
      getHandle: () => handle,
      expand() {},
    });
  }, [find, handle]);

  return <div ref={containerRef} data-review-inline-editor="duplicate.ts" />;
}

function findHandle(
  search: (
    query: ReviewFindQuery,
  ) => Promise<{ matchCount: number }> = async () => ({ matchCount: 1 }),
) {
  const revealFindMatch = vi.fn<(index: number) => void>();
  const clearActiveFindMatch = vi.fn<() => void>();
  const clearFind = vi.fn<() => void>();

  return {
    height: 100,
    setActive() {},
    setCollapsed() {},
    setFindQuery: vi.fn<typeof search>(search),
    revealFindMatch,
    clearActiveFindMatch,
    clearFind,
    onDidChangeHeight: () => ({ dispose() {} }),
    onDidError: () => ({ dispose() {} }),
    dispose() {},
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );

  if (!result) throw new Error(`Missing ${label} button`);

  return result;
}

async function setInput(container: HTMLElement, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(
    '.review-find-widget input[aria-label="Find"]',
  );

  if (!input) throw new Error("Missing Find input");

  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;

  if (!setValue) throw new Error("Missing input value setter");
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
