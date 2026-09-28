import type {
  ReviewFindQuery,
  ReviewInlineEditorHandle,
} from "@dev.fast/review-protocol";
import { act, useLayoutEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  type ReviewFindHost,
  ReviewFindProvider,
  createReviewFindHost,
  useReviewFindRegistration,
} from "./review-find";
import { ReviewRootsProvider } from "./review-root-context";

let root: ReturnType<typeof createRoot> | undefined;

beforeEach(() => {});

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
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[first, second]} />);
  });

  await act(async () => {
    expect(host.showFind("Alpha")).toBe(true);
  });
  await vi.waitFor(() => {
    expect(container.querySelector(".review-find-count")?.textContent).toBe(
      "1 of 4",
    );
  });
  // The shell is the widget's containing block.
  expect(
    container.querySelector(".review-find-widget")?.parentElement,
  ).toHaveClass("review-document-shell");
  const next = button(container, "Next Match");
  await act(async () => next.click());
  await vi.waitFor(() => {
    expect(first.revealFindMatch).toHaveBeenCalledWith(0);
  });
  expect(container.querySelector(".review-find-count")?.textContent).toBe(
    "2 of 4",
  );
  await act(async () => next.click());
  expect(container.querySelector(".review-find-count")?.textContent).toBe(
    "3 of 4",
  );
  expect(first.clearActiveFindMatch).toHaveBeenCalled();
  await act(async () => next.click());
  await vi.waitFor(() => {
    expect(second.revealFindMatch).toHaveBeenCalledWith(0);
  });
  await act(async () => next.click());
  expect(container.querySelector(".review-find-count")?.textContent).toBe(
    "1 of 4",
  );

  await act(async () => button(container, "Close Find").click());
  expect(document.activeElement).toBe(focusTarget);
  expect(first.clearFind).toHaveBeenCalled();
  expect(second.clearFind).toHaveBeenCalled();
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
    expect(container.querySelector(".review-find-count")?.textContent).toBe(
      "1 of 3",
    );
  });
  resolveSlow({ matchCount: 9 });
  await act(async () => Promise.resolve());
  expect(container.querySelector(".review-find-count")?.textContent).toBe(
    "1 of 3",
  );
});

it("uses equal action controls and describes every Find option", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const host = createReviewFindHost();
  root = createRoot(container);
  await act(async () => {
    root?.render(<FindHarness host={host} handles={[findHandle()]} />);
  });
  await act(async () => {
    expect(host.showFind()).toBe(true);
  });

  const actions = [
    button(container, "Previous Match"),
    button(container, "Next Match"),
    button(container, "Close Find"),
  ];

  expect(actions.map((action) => action.className)).toEqual([
    "review-find-action",
    "review-find-action",
    "review-find-action",
  ]);
  expect(
    actions.map((action) =>
      action.querySelector("svg")?.getAttribute("viewBox"),
    ),
  ).toEqual(["0 0 16 16", "0 0 16 16", "0 0 16 16"]);
  expect(button(container, "Match Case").title).toContain(
    "uppercase and lowercase",
  );
  expect(button(container, "Match Whole Word").title).toContain(
    "complete words only",
  );
  expect(button(container, "Use Regular Expression").title).toContain(
    "regular expression",
  );
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
  expect(container.querySelector(".review-find-count")?.textContent).toBe(
    "Searching…",
  );

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
    expect(container.querySelector(".review-find-count")?.textContent).toBe(
      "1 of 4",
    );
  });

  await act(async () => {
    root?.render(<FindHarness host={host} handles={[first]} />);
  });
  await vi.waitFor(() => {
    expect(container.querySelector(".review-find-count")?.textContent).toBe(
      "1 of 3",
    );
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

  expect(container.querySelector(".review-find-count")?.textContent).toBe(
    "Invalid expression",
  );
  expect(input.getAttribute("aria-invalid")).toBe("true");

  await setInput(container, "Alpha (first|second)");
  await vi.waitFor(() => {
    expect(container.querySelector(".review-find-count")?.textContent).toBe(
      "1 of 3",
    );
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
    expect(container.querySelector(".review-find-count")?.textContent).toBe(
      "1 of 3",
    );
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
    expect(container.querySelector(".review-find-count")?.textContent).toBe(
      "1 of 3",
    );
  });
  await act(async () => button(container, "Next Match").click());
  await act(async () => button(container, "Close Find").click());

  expect(documentRenders).toBe(rendersBeforeFind);
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
        <main ref={shellRef} className="review-document-shell">
          <section ref={scrollRef}>
            <article ref={articleRef} className="review-document">
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
