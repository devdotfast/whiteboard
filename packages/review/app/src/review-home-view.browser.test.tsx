import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { testCanvasUi } from "./canvas-ui-test-utils";
import { CanvasUiContext } from "./host/canvas-ui";
import { createReviewFindHost } from "./review-find";
import { ReviewHome, formatRelativeTime } from "./review-home-view";

const now = Date.parse("2026-10-11T12:00:00Z");

function summary(
  title: string,
  extra: Partial<ReviewApiSummary> = {},
): ReviewApiSummary {
  return {
    reviewId: title,
    title,
    version: 1,
    repositoryName: "whiteboard",
    repositoryGroup: {
      key: extra.repositoryName ?? "whiteboard",
      label: extra.repositoryName ?? "whiteboard",
    },
    repositoryPath: "/repo/main",
    createdAt: "2026-10-10T12:00:00Z",
    viewedAt: null,
    trashedAt: null,
    ...extra,
  };
}

describe("Home interactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let host: ReturnType<typeof testCanvasUi>;
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    host = testCanvasUi();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(
    reviews: ReviewApiSummary[],
    props: Partial<React.ComponentProps<typeof ReviewHome>> = {},
  ) {
    await act(async () =>
      root.render(
        <CanvasUiContext.Provider value={host.ui}>
          <ReviewHome reviews={reviews} onOpen={() => {}} {...props} />
        </CanvasUiContext.Provider>,
      ),
    );
  }

  function button(label: string) {
    const found = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (el) =>
        el.getAttribute("aria-label") === label ||
        el.textContent?.trim() === label,
    );

    if (!found) throw new Error(`Button missing: ${label}`);

    return found;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function settleMenus() {
    await Promise.all(
      [...container.querySelectorAll("[data-home-picker], [data-home-submenu]")]
        .flatMap((element) => element.getAnimations())
        .map((animation) => animation.finished),
    );
  }

  it("copies the support email, announces it without closing help, and dismisses the notice", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();

    const tour = vi.fn<() => void>();
    await render([summary("Board")], { onOpenTutorial: tour });
    await click("Help");
    await click("Need help? Send us an email");
    expect(writeText).toHaveBeenCalledWith("founders@dev.fast");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Copied 'founders@dev.fast' to clipboard",
    );
    expect(
      container.querySelector('[role="menu"][aria-label="Help"]'),
    ).not.toBeNull();
    await click("Dismiss clipboard notification");
    expect(container.querySelector('[role="status"]')).toBeNull();
    await click("Need a refresher? Take the tour");
    expect(tour).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[role="menu"][aria-label="Help"]'),
    ).toBeNull();
  });

  async function select(title: string, shiftKey = false) {
    await act(async () =>
      container
        .querySelector<HTMLInputElement>(`input[aria-label="Select ${title}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey })),
    );
  }

  async function key(
    key: string,
    options: KeyboardEventInit = {},
    target: Element = document.body,
  ) {
    await act(async () =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      ),
    );
  }

  function searchField() {
    return container.querySelector<HTMLInputElement>(
      'input[role="searchbox"]',
    )!;
  }

  async function openFilters() {
    await act(async () => searchField()?.blur());
    await click("Add filters");
  }

  async function search(text: string) {
    if (!searchField()) await key("f", { metaKey: true });

    const input = container.querySelector<HTMLInputElement>(
      'input[role="searchbox"]',
    )!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function titles(group?: string) {
    const parent = group
      ? container.querySelector(`section[aria-label="${group}"]`)!
      : container;

    return [
      ...parent.querySelectorAll("[data-home-row] button span[title]"),
    ].map((el) => el.getAttribute("title"));
  }

  it("focuses title search through the native host Find command and releases the controller", async () => {
    const findHost = createReviewFindHost();
    await render([summary("One"), summary("Two")], { findHost });
    await act(async () => {
      expect(findHost.showFind("Two")).toBe(true);
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Search whiteboards",
    );
    expect(titles()).toEqual(["Two"]);
    await act(async () => findHost.hideFind());
    expect(titles()).toEqual(["Two"]);
    expect(button("Two")).toBeTruthy();
    await act(async () => root.render(null));
    expect(findHost.showFind()).toBe(false);
  });
  const read = { viewedAt: "2026-10-11T12:00:00Z" };
  it("uses unread precedence, persists collapse, and sorts within fixed groups", async () => {
    const reviews = [
      summary("Zulu"),
      summary("Alpha", { createdAt: "2026-09-01T00:00:00Z" }),
      summary("Read", read),
      summary("Old", { ...read, createdAt: "2026-09-01T00:00:00Z" }),
      summary("Scratchpad", { kind: "scratchpad" }),
    ];

    await render(reviews);
    expect(titles("Unread")).toEqual(["Zulu", "Alpha"]);
    expect(titles("Last 7 days")).toEqual(["Read"]);
    expect(titles("Older than 7 days")).toEqual([]);
    expect(container.textContent).not.toContain("Scratchpad");
    await click("Sort whiteboards");
    await click("Title");
    expect(titles("Unread")).toEqual(["Alpha", "Zulu"]);

    const earlier = container.querySelector<HTMLButtonElement>(
      'section[aria-label="Older than 7 days"] button',
    )!;

    await act(async () => earlier.click());
    expect(titles("Older than 7 days")).toEqual(["Old"]);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(reviews);
    expect(titles("Older than 7 days")).toEqual(["Old"]);
  });
  it("opens a row separately from selection and reacts to viewed/update timestamps", async () => {
    const onOpen = vi.fn<(review: ReviewApiSummary) => void>();
    const review = summary("Board", { working: true });
    await render([review], { onOpen });
    expect(
      container.querySelector('[title="Agent writing"]')?.textContent,
    ).toBe("writing");
    await select("Board");
    expect(onOpen).not.toHaveBeenCalled();
    await click("Open Board");
    expect(onOpen).toHaveBeenCalledWith(review);
    await render([{ ...review, ...read }], { onOpen });
    expect(container.querySelector('section[aria-label="Unread"]')).toBeNull();
    expect(titles("Last 7 days")).toEqual(["Board"]);
    await render([{ ...review, ...read, working: false }], { onOpen });
    expect(titles("Last 7 days")).toEqual(["Board"]);
    expect(container.querySelector('[title="Agent writing"]')).toBeNull();
    expect(
      container.querySelector(`[title="${review.createdAt}"]`)?.textContent,
    ).toBe(formatRelativeTime(review.createdAt, now));
    await render([
      { ...review, ...read, createdAt: "2026-10-11T12:01:00Z", working: false },
    ]);
    expect(titles("Unread")).toEqual(["Board"]);
    expect(container.textContent).not.toContain("agent writing");
  });
  it("finds and highlights branch and worktree text while ranking titles first", async () => {
    await render([
      summary("Other board", {
        repositoryPath: "/repo/stack3",
        origin: { branch: "sm/stack3-end" },
      }),
      summary("stack3 title", {
        createdAt: "2020-01-01",
        origin: { branch: "feature" },
      }),
      summary("Unrelated"),
    ]);
    await search("stack3");
    expect(titles()).toEqual(["stack3 title", "Other board"]);

    const metadata = container.querySelector(
      '[data-home-row="Other board"] [data-home-metadata]',
    )!;

    expect(
      [...metadata.querySelectorAll("mark")]
        .map((el) => el.textContent)
        .join(""),
    ).toBe("stack3stack3");
    expect(metadata.textContent).toBe("sm/stack3-endstack3");
    await key("Enter", {}, searchField());
    await search("sm/stack3-end");
    expect(titles()).toEqual(["Other board"]);
  });
  it("adds exact filters from pills without opening the board, and edits the branch facet", async () => {
    const onOpen = vi.fn<(review: ReviewApiSummary) => void>();
    await render(
      [
        summary("One", { origin: { branch: "feature/exact" } }),
        summary("Two", { origin: { branch: "feature/exact-extra" } }),
        summary("Three", {
          repositoryPath: "/repo/other",
          origin: { branch: "feature/exact" },
        }),
      ],
      { onOpen },
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Filter branch: feature/exact"]',
        )!
        .click(),
    );
    expect(onOpen).not.toHaveBeenCalled();
    expect(titles()).toEqual(["One", "Three"]);
    expect(
      container.querySelector('[aria-label="Filter branch: feature/exact"]'),
    ).toBeNull();
    await click("Branch feature/exact");
    expect(container.querySelector('input[aria-label="Branch"]')).toBe(
      document.activeElement,
    );
    await click("feature/exact");
    expect(titles()).toEqual(["One", "Two", "Three"]);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Filter worktree: main"]',
        )!
        .click(),
    );
    expect(titles()).toEqual(["One", "Two"]);
    expect(
      container.querySelector('[aria-label="Filter worktree: main"]'),
    ).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    await click("Remove Worktree main");
    expect(titles()).toHaveLength(3);
  });
  it("searches without opening a picker, keeps AND queries, and moves into results", async () => {
    const onOpen = vi.fn<(review: ReviewApiSummary) => void>();
    await render(
      [
        summary("Fold summaries"),
        summary("Fold rules"),
        summary("Other", { repositoryName: "fold" }),
      ],
      { onOpen },
    );
    await key("f", { metaKey: true });
    await search("fold");
    expect(titles()).toEqual(["Fold summaries", "Fold rules", "Other"]);
    expect(container.querySelector("[data-home-picker]")).toBeNull();
    expect(
      container.querySelector('[aria-label="Matching whiteboards"]')
        ?.textContent,
    ).toBe("3");
    await key("Enter", {}, searchField());
    expect(searchField()).toBeNull();
    expect(button("fold")).toBeTruthy();
    await search("summaries");
    expect(titles()).toEqual(["Fold summaries"]);
    await key("ArrowDown", {}, searchField());
    expect(document.activeElement).toBe(button("Open Fold summaries"));
    await act(async () => userEvent.keyboard("{Enter}"));
    expect(onOpen).toHaveBeenCalledOnce();
    await click("fold");
    expect(searchField().value).toBe("fold");
    await key("Escape", {}, searchField());
    expect(searchField()).toBeNull();
    expect(button("summaries")).toBeTruthy();
  });

  it("settles, re-edits in place, and discards text filters without changing sibling chips", async () => {
    await render([
      summary("Fold summaries"),
      summary("Fold rules"),
      summary("Other"),
    ]);
    expect(searchField()).toBeNull();
    await openFilters();
    expect(
      container.querySelector("[data-home-picker] [data-picker-row]")
        ?.textContent,
    ).toBe("Search…");
    await click("Search…");
    expect(container.querySelector("[data-home-picker]")).toBeNull();
    expect(document.activeElement).toBe(searchField());
    await search("fold");
    await act(async () => searchField().blur());
    expect(searchField()).toBeNull();
    expect(button("fold")).toBeTruthy();
    await openFilters();
    await click("Unread only");
    await key("Escape");
    await click("fold");
    await search("summaries");
    expect(titles()).toEqual(["Fold summaries"]);
    await key("Enter", {}, searchField());
    expect(
      [
        ...container.querySelectorAll(
          '[aria-label="Active filters"] button[aria-label^="Remove "]',
        ),
      ].map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Remove summaries", "Remove Unread only"]);
    await click("summaries");
    await key("Escape", {}, searchField());
    expect(titles()).toHaveLength(3);
    expect(button("Unread only")).toBeTruthy();
    await key("f", { metaKey: true });
    await key("Backspace", {}, searchField());
    expect(searchField()).toBeNull();
    await click("Clear all");
    expect(
      [...container.querySelectorAll("button")].some(
        (el) => el.textContent === "Clear all",
      ),
    ).toBe(false);
  });
  it("appends another text chip with Command-F, including from an open picker", async () => {
    await render([summary("Fold summaries"), summary("Fold rules")]);
    await search("fold");
    await key("f", { metaKey: true }, searchField());
    expect(button("fold")).toBeTruthy();
    expect(searchField().value).toBe("");
    expect(document.activeElement).toBe(searchField());
    await search("rules");
    await openFilters();
    await key("f", { metaKey: true }, document.activeElement!);
    expect(container.querySelector("[data-home-picker]")).toBeNull();
    expect(button("rules")).toBeTruthy();
    expect(document.activeElement).toBe(searchField());
    expect(titles()).toEqual(["Fold rules"]);
  });
  it("anchors to either trigger and follows the plus when picking adds a chip", async () => {
    container.className = "review-canvas-root";
    container.style.cssText = "contain: layout; width: 1100px; height: 700px";
    await render([
      summary("One", { repositoryName: "alpha" }),
      summary("Two", { repositoryName: "beta" }),
    ]);

    const menuRect = () =>
      container.querySelector("[data-home-picker]")!.getBoundingClientRect();

    await key("f", { metaKey: true });
    await search("One");
    await key("Enter", {}, searchField());
    await click("Add filter");
    expect(menuRect().left).toBe(
      button("Add filter").getBoundingClientRect().left,
    );
    await click("Unread only");
    expect(menuRect().left).toBe(
      button("Add filter").getBoundingClientRect().left,
    );
    expect(button("Unread only").getAttribute("role")).not.toBe("checkbox");
    await key("ArrowRight", {}, button("alpha"));

    await settleMenus();

    const sub = container
      .querySelector("[data-home-submenu]")!
      .getBoundingClientRect();

    expect(menuRect().right - sub.left).toBe(4);
    expect(button("main").getBoundingClientRect().top).toBe(
      button("alpha").getBoundingClientRect().top,
    );
    await key("Escape");
    await key("Escape");
    await key("f");
    expect(menuRect().right).toBe(
      button("Add filters").getBoundingClientRect().right,
    );
    await key("Escape");
    await openFilters();
    await act(async () => userEvent.click(container.querySelector("h1")!));
    expect(container.querySelector("[data-home-picker]")).toBeNull();
    expect(button("Unread only")).toBeTruthy();
  });

  async function optionSearch(text: string, label = "Filter options") {
    const field = container.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    )!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("opens all filter sections with F and narrows options without filtering boards", async () => {
    await render([
      summary("One", { repositoryName: "alpha" }),
      summary("Two", { repositoryName: "beta" }),
    ]);
    await key("f");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Filter options",
    );
    expect(container.querySelector("[data-home-filter-panel]")).toBeNull();
    expect(container.textContent).not.toContain("Hide archived");
    await optionSearch("beta");
    expect(button("beta")).toBeTruthy();
    expect(titles()).toEqual(["One", "Two"]);
    await key(" ", {}, button("beta"));
    expect(titles()).toEqual(["Two"]);
    expect(container.textContent).toContain("Showing 1 board");
    expect(button("beta").getAttribute("aria-checked")).toBe("true");
    await click("Remove Repo beta");
    expect(button("beta").getAttribute("aria-checked")).toBe("false");
    expect(titles()).toHaveLength(2);
    await key("Escape");
    expect(container.querySelector("[data-home-picker]")).toBeNull();
  });
  it("separates parent navigation from selection and normalizes broad selections", async () => {
    const reviews = [
      summary("One", {
        repositoryName: "alpha",
        repositoryPath: "/alpha/main",
      }),
      summary("Two", {
        repositoryName: "alpha",
        repositoryPath: "/alpha/feature",
      }),
      summary("Three", {
        repositoryName: "beta",
        repositoryPath: "/beta/main",
      }),
      summary("Four", {
        repositoryName: "gamma",
        repositoryPath: "/gamma/main",
      }),
    ];

    await render(reviews);
    await openFilters();
    await click("alpha");
    expect(titles()).toHaveLength(4);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Filter worktrees",
    );
    await click("main");
    expect(titles()).toEqual(["One"]);
    expect(button("alpha").getAttribute("aria-checked")).toBe("mixed");
    expect(button("feature").textContent).toContain("+1");
    await click("feature");
    expect(button("Repo alpha")).toBeTruthy();
    expect(button("alpha").getAttribute("aria-checked")).toBe("true");
    expect(button("main").getAttribute("aria-checked")).toBe("true");
    await render([
      ...reviews,
      summary("New checkout", {
        repositoryName: "alpha",
        repositoryPath: "/alpha/new",
      }),
    ]);
    expect(titles()).toEqual(["One", "Two", "New checkout"]);
    await click("main");
    expect(titles()).toEqual(["Two", "New checkout"]);
    expect(button("Worktree feature +1")).toBeTruthy();
    await key("Escape");
    await key(" ", {}, button("beta"));
    expect(titles()).toEqual(["Two", "Three", "New checkout"]);
    await key("Escape");
    await click("Worktree feature +1");
    expect(document.activeElement?.getAttribute("placeholder")).toBe(
      "Worktree",
    );
    await key("Escape");
    await click("Repo beta");
    await click("alpha");
    expect(container.querySelector("[data-home-submenu]")).not.toBeNull();
    await key("ArrowLeft", {}, document.activeElement!);
    expect(document.activeElement).toBe(button("alpha"));
    await act(async () =>
      (
        button("alpha").querySelector("[data-picker-check]") as HTMLElement
      ).click(),
    );
    expect(button("Repo beta +1")).toBeTruthy();
    await key(" ", {}, button("gamma"));
    expect(titles()).toHaveLength(5);
    expect(container.querySelector('[aria-label^="Remove Repo"]')).toBeNull();
    expect(container.querySelector("[data-home-picker]")).toBeNull();
    await openFilters();
    expect(button("alpha").getAttribute("aria-checked")).toBe("false");
  });
  it("keeps the submenu aligned when filtering removes an option above its parent", async () => {
    container.className = "review-canvas-root";
    container.style.cssText =
      "contain: layout; margin: 40px 0 0 60px; width: 900px; height: 700px";
    await render([
      summary("Read board", {
        repositoryName: "alpha",
        repositoryPath: "/alpha/main",
        viewedAt: "2026-10-11T12:00:00Z",
      }),
      summary("Unread board", { repositoryName: "beta" }),
    ]);
    await openFilters();
    await settleMenus();
    expect(
      container.querySelector("[data-home-picker]")!.getBoundingClientRect()
        .top,
    ).toBe(button("Add filters").getBoundingClientRect().bottom + 6);
    await key("ArrowRight", {}, button("alpha"));
    await click("main");
    await settleMenus();
    expect(titles()).toEqual(["Read board"]);
    expect(container.querySelector('[aria-label="Unread only"]')).toBeNull();
    const parent = button("alpha").getBoundingClientRect();
    const first = button("main").getBoundingClientRect();

    const menu = container
      .querySelector("[data-home-picker]")!
      .getBoundingClientRect();

    const submenu = container
      .querySelector("[data-home-submenu]")!
      .getBoundingClientRect();

    expect(first.top).toBe(parent.top);
    expect(submenu.right - menu.left).toBe(4);
    expect(menu.right).toBe(
      button("Add filters").getBoundingClientRect().right,
    );
  });
  it("finds nested worktrees from the main box and omits zero-match options", async () => {
    await render([
      summary("Fold one", {
        repositoryName: "alpha",
        repositoryPath: "/alpha/feature",
      }),
      summary("Other", { repositoryName: "beta" }),
      summary("Fold local", {
        repositoryGroup: undefined,
        repositoryPath: "/local/main",
      }),
    ]);
    await search("Fold");
    await openFilters();
    expect(container.querySelector('[data-repository="beta"]')).toBeNull();
    expect(button("Unknown repository")).toBeTruthy();
    await optionSearch("feature");
    await click("alpha › feature");
    expect(titles()).toEqual(["Fold one"]);
    expect(container.textContent).not.toContain("Repository unavailable");
    await key("Escape");
    await click("Remove Repo alpha");
    expect(titles()).toHaveLength(2);
  });
  it("orders chips by application and Backspace removes only the empty text chip", async () => {
    await render([
      summary("Fold one", { repositoryName: "alpha" }),
      summary("Fold two", { repositoryName: "beta" }),
      summary("Other", { repositoryName: "gamma" }),
    ]);
    await key("f", { metaKey: true });
    await search("Fold");
    await key("Enter", {}, searchField());
    await openFilters();
    await key(" ", {}, button("alpha"));
    await key(" ", {}, button("beta"));
    await key("Escape");
    const field = container.querySelector('[aria-label="Active filters"]')!;
    expect(
      [...field.querySelectorAll('button[aria-label^="Remove "]')].map(
        (button) => button.getAttribute("aria-label"),
      ),
    ).toEqual(["Remove Fold", "Remove Repo alpha +1"]);
    await key("f", { metaKey: true });
    await key("Backspace", {}, searchField());
    expect(searchField()).toBeNull();
    expect(button("Repo alpha +1")).toBeTruthy();
    expect(button("Fold")).toBeTruthy();
    await click("Fold");
    await search("");
    await key("Backspace", {}, searchField());
    expect(field.textContent).not.toContain("Fold");
    expect(button("Repo alpha +1")).toBeTruthy();
  });
  it("keeps the caret in the menu under the pointer when hover opens or switches submenus", async () => {
    await render([
      summary("One", { repositoryName: "alpha" }),
      summary("Two", { repositoryName: "beta" }),
    ]);
    await openFilters();

    const mainInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Filter options"]',
    )!;

    async function moveTo(element: Element) {
      await act(async () => {
        element.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            pointerType: "mouse",
          }),
        );
        element.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerType: "mouse",
            movementX: 1,
          }),
        );
      });
    }

    await moveTo(button("alpha"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(button("alpha").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(mainInput);
    const submenu = container.querySelector("[data-home-submenu]")!;
    const subInput = submenu.querySelector<HTMLInputElement>("input")!;

    // Crossing another row on the way to the submenu must not switch it.
    await moveTo(button("beta"));
    await moveTo(submenu);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(button("alpha").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(subInput);
    await act(async () => userEvent.fill(subInput, "main"));
    subInput.setSelectionRange(1, 1);
    await moveTo(submenu);
    expect(subInput.selectionStart).toBe(1);
    await moveTo(button("alpha"));
    expect(document.activeElement).toBe(mainInput);
    await key("ArrowRight", {}, button("alpha"));
    expect(document.activeElement).toBe(subInput);
    await moveTo(button("beta"));
    expect(document.activeElement).toBe(mainInput);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(button("beta").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(mainInput);
  });
  it("keeps picker focus while clicking toggles and closes it on an outside click", async () => {
    await render([summary("Unread"), summary("Read", read)]);
    await openFilters();

    const option = container.querySelector<HTMLButtonElement>(
      '[data-home-picker] [aria-label="Unread only"]',
    )!;

    await act(async () => userEvent.click(option));
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Filter options",
    );
    expect(option.getAttribute("aria-checked")).toBe("true");
    expect(titles()).toEqual(["Unread"]);
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    expect(container.querySelector("[data-home-picker]")).toBeNull();
    expect(button("Unread only")).toBeTruthy();
  });
  it("wraps chips and the add button while the toolbar actions stay on the first line", async () => {
    container.style.width = "600px";
    await render([
      summary("Folding summaries query contract with long searchable words"),
    ]);
    const initialIcon = button("Add filters").getBoundingClientRect();
    await key("f", { metaKey: true });

    for (const term of [
      "Folding",
      "summaries",
      "query",
      "contract",
      "searchable",
    ]) {
      await search(term);
      await key("Enter", {}, searchField());
    }

    const field = container.querySelector<HTMLElement>(
      '[aria-label="Active filters"]',
    )!;

    const last = button("searchable").getBoundingClientRect();
    expect(last.top).toBeGreaterThan(
      button("Folding").getBoundingClientRect().top,
    );
    expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth);
    const icon = button("Add filters").getBoundingClientRect();
    expect(icon.top).toBe(initialIcon.top);
    expect(icon.right).toBe(initialIcon.right);
    expect(
      button("Add filter").getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(last.top - 1);
    expect(searchField()).toBeNull();
    expect(
      Math.abs(
        button("Sort whiteboards").getBoundingClientRect().top -
          initialIcon.top,
      ),
    ).toBeLessThan(2);
  });
  it("keeps long chips within 280px, exposes their full query, and wraps the final plus with its chip", async () => {
    const query =
      "A very long query that must be truncated without hiding its full searchable title";

    container.style.width = "820px";
    await render([summary(query)]);
    await search("very");
    await key("Enter", {}, searchField());
    await search(query);
    await key("Enter", {}, searchField());
    const chip = button(query);
    expect(
      chip.parentElement!.getBoundingClientRect().width,
    ).toBeLessThanOrEqual(280);
    const value = chip.querySelector<HTMLElement>("[data-chip-value]")!;
    expect(value.scrollWidth).toBeGreaterThan(value.clientWidth);
    await act(async () =>
      chip.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      ),
    );
    expect(
      container.querySelector('[aria-label="Search filter details"]')
        ?.textContent,
    ).toContain(query);

    for (const width of [820, 700, 600]) {
      container.style.width = `${width}px`;
      const last = chip.parentElement!.getBoundingClientRect();
      const plus = button("Add filter").getBoundingClientRect();
      expect(Math.abs(plus.top - last.top)).toBeLessThan(2);

      const field = container.querySelector<HTMLElement>(
        '[aria-label="Active filters"]',
      )!;

      expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth);
    }

    await click("Clear all");
    expect(container.querySelector('[aria-label="Add filter"]')).toBeNull();
    await openFilters();
    await click("Search…");
    expect(document.activeElement).toBe(searchField());
  });
  it("keeps chip details reachable across the gap and opens the picker from Click to edit", async () => {
    await render(
      ["main", "feature", "other"].map((tree) =>
        summary(tree, { repositoryPath: `/repo/${tree}` }),
      ),
    );
    await openFilters();
    await click("whiteboard");
    await click("main");
    await click("feature");
    await key("Escape");
    await key("Escape");
    const chip = button("Worktree main +1");
    await act(async () => userEvent.hover(chip));

    const details = container.querySelector<HTMLElement>(
      '[aria-label="Worktree filter details"]',
    )!;

    expect(details.textContent).toContain("main\nfeature");
    const anchor = chip.getBoundingClientRect();
    expect(
      details.contains(
        document.elementFromPoint(anchor.left + 10, anchor.bottom + 3),
      ),
    ).toBe(true);
    await act(async () => userEvent.hover(button("Click to edit")));
    expect(details.isConnected).toBe(true);
    await act(async () => button("Click to edit").focus());
    expect(details.isConnected).toBe(true);
    await act(async () => userEvent.click(button("Click to edit")));
    expect(details.isConnected).toBe(false);
    expect(
      container.querySelector('[aria-label="Worktree filters"]'),
    ).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Worktree");
    expect(button("main").getAttribute("aria-checked")).toBe("true");
    expect(button("feature").getAttribute("aria-checked")).toBe("true");
  });
  it("edits only the chip's facet with selected values first and closes after the final value is unticked", async () => {
    await render(
      ["alpha", "middle", "zulu"].map((tree) =>
        summary(tree, { repositoryPath: `/repo/${tree}` }),
      ),
    );
    await openFilters();
    await click("whiteboard");
    await click("zulu");
    await click("middle");
    await key("Escape");
    await key("Escape");
    await click("Worktree zulu +1");
    const chip = button("Worktree zulu +1");
    const picker = container.querySelector<HTMLElement>("[data-home-picker]")!;
    const input = picker.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.placeholder).toBe("Worktree");
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(picker.querySelector('[aria-label="Hide archived"]')).toBeNull();
    expect(picker.textContent).not.toContain("Search…");
    expect(
      [...picker.querySelectorAll('[role="checkbox"]')].map((row) =>
        row.getAttribute("aria-label"),
      ),
    ).toEqual(["zulu", "middle", "alpha"]);
    const separator = picker.querySelector('[role="separator"]')!;
    expect(
      button("middle").compareDocumentPosition(separator) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      separator.compareDocumentPosition(button("alpha")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      Math.abs(
        picker.getBoundingClientRect().left - chip.getBoundingClientRect().left,
      ),
    ).toBeLessThan(2);
    expect(picker.getBoundingClientRect().top).toBeGreaterThan(
      chip.getBoundingClientRect().bottom,
    );
    await act(async () => userEvent.fill(input, "middle"));
    expect(picker.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
    expect(titles()).toEqual(["middle", "zulu"]);
    await act(async () => userEvent.fill(input, ""));
    await click("middle");
    expect(button("Worktree zulu")).toBeTruthy();
    expect(titles()).toEqual(["zulu"]);
    await click("zulu");
    expect(container.querySelector("[data-home-picker]")).toBeNull();
    expect(container.querySelector('[data-home-facet="worktrees"]')).toBeNull();
    expect(document.activeElement).toBe(button("Add filters"));
    expect(titles()).toEqual(["alpha", "middle", "zulu"]);
  });
  it("selects collapsed groups, reports partial selection, and applies Escape precedence", async () => {
    await render([
      summary("One"),
      summary("Two"),
      summary("Three"),
      summary("Old", { ...read, createdAt: "2026-09-01" }),
    ]);
    await select("One");
    await select("Three", true);
    expect(container.textContent).toContain("3 selected");
    await select("Two");
    expect(container.textContent).toContain("2 of 3 selected");
    expect(
      container.querySelector('input[aria-label="Select Unread"]'),
    ).toBeNull();
    await click("Select all 1");
    expect(container.textContent).toContain("All 1 selected");
    expect(container.textContent).toContain("3 selected");
    await openFilters();
    await key("Escape");
    expect(container.querySelector("[data-home-picker]")).toBeNull();
    expect(container.textContent).toContain("3 selected");
    await key("Escape");
    expect(
      container.querySelector('[aria-label="Selected whiteboards"]'),
    ).toBeNull();
    await key("a", { metaKey: true });
    expect(container.textContent).toContain("4 selected");
  });
  it("lets the Sort menu consume Escape before clearing the selection", async () => {
    await render([summary("One"), summary("Two")]);
    await select("One");
    await click("Sort whiteboards");

    await key("Escape", {}, document.activeElement!);
    expect(button("Sort whiteboards").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Select One"]',
      )!.checked,
    ).toBe(true);
    expect(
      container.querySelector('[aria-label="Selected whiteboards"]'),
    ).not.toBeNull();

    await key("Escape");
    expect(
      container.querySelector('[aria-label="Selected whiteboards"]'),
    ).toBeNull();
  });
  it.each([
    ["MacIntel", { metaKey: true }],
    ["Win32", { ctrlKey: true }],
  ])(
    "selects all filtered boards from a focused checkbox on %s",
    async (platform, modifiers) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await render([
        summary("One"),
        summary("Two"),
        summary("Old", { ...read, createdAt: "2026-09-01" }),
        summary("Archived", { trashedAt: "2026-10-01" }),
      ]);

      const checkbox = container.querySelector<HTMLInputElement>(
        'input[aria-label="Select One"]',
      )!;

      checkbox.focus();
      await select("One");
      await key("a", modifiers, checkbox);
      expect(container.textContent).toContain("3 selected");
      expect(container.textContent).toContain("All 1 selected");
      expect(document.activeElement).toBe(checkbox);
    },
  );
  it("releases checkbox focus on Escape and still allows keyboard selection afterward", async () => {
    await render([summary("One")]);

    const checkbox = container.querySelector<HTMLInputElement>(
      'input[aria-label="Select One"]',
    )!;

    checkbox.focus();
    await select("One");
    expect(checkbox.checked).toBe(true);
    expect(document.activeElement).toBe(checkbox);
    await key("Escape", {}, checkbox);
    expect(checkbox.checked).toBe(false);
    expect(document.activeElement).not.toBe(checkbox);
    expect(
      container.querySelector('[aria-label="Selected whiteboards"]'),
    ).toBeNull();

    checkbox.focus();
    await key("x", {}, checkbox);
    expect(checkbox.checked).toBe(true);
    expect(document.activeElement).toBe(checkbox);
  });
  it("temporarily reveals search matches without overwriting remembered collapse states", async () => {
    await render([
      summary("Fold new"),
      summary("Fold recent", read),
      summary("Fold old", { ...read, createdAt: "2026-09-01" }),
    ]);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'section[aria-label="Last 7 days"] button[aria-expanded]',
        )!
        .click(),
    );
    await key("f", { metaKey: true });
    await search("Fold");
    expect(titles()).toEqual(["Fold new", "Fold recent", "Fold old"]);
    await select("Fold new");
    await select("Fold old", true);
    expect(container.textContent).toContain("3 selected");
    await key("Enter", {}, container.querySelector("input[role=searchbox]")!);
    await key("Escape");
    expect(titles()).toHaveLength(3);
    await click("Remove Fold");
    expect(titles()).toEqual(["Fold new"]);
    expect(
      JSON.parse(localStorage.getItem("review.home.collapsed.v1")!).week,
    ).toBe(true);
  });
  it("group actions select and deselect without changing which rows are expanded", async () => {
    await render([summary("One"), summary("Two")]);
    await select("One");
    expect(container.textContent).toContain("1 of 2 selected");
    await click("Select all");
    expect(container.textContent).toContain("All 2 selected");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'section[aria-label="Unread"] button[aria-expanded]',
        )!
        .click(),
    );
    expect(titles()).toEqual([]);
    await click("Deselect");
    expect(
      container.querySelector('[aria-label="Selected whiteboards"]'),
    ).toBeNull();
    expect(titles()).toEqual([]);
  });
  it("does not select all or delete while editing text, and removes hidden selections", async () => {
    const onTrash = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    await render([summary("One"), summary("Two")], { onTrash });
    await select("One");
    await key("f", { metaKey: true });
    await key("a", { metaKey: true }, document.activeElement!);
    await key("Backspace", { metaKey: true }, document.activeElement!);
    expect(container.textContent).toContain("1 selected");
    expect(onTrash).not.toHaveBeenCalled();
    await search("Two");
    expect(
      container.querySelector('[aria-label="Selected whiteboards"]'),
    ).toBeNull();
  });
  it("deletes in a batch with Undo, and restores a deleted selection", async () => {
    const onTrash = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    const onRestore = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    await render([summary("One"), summary("Two")], { onTrash, onRestore });
    await key("a", { metaKey: true });
    await key("Backspace", { metaKey: true });
    expect(onTrash).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual([]);
    await click("Undo");
    expect(onRestore).toHaveBeenCalledTimes(2);
    expect(titles()).toHaveLength(2);
    await render([summary("Old", { trashedAt: "2026-10-01" })], {
      onTrash,
      onRestore,
    });
    await click("1 in Trash ›");
    await select("Old");
    await key("r");
    expect(onRestore).toHaveBeenCalledTimes(3);
    expect(titles()).toEqual([]);
    await render([summary("Old", { trashedAt: "2026-10-01" })], {
      onTrash,
      onRestore,
      view: "active",
    });
    expect(titles()).toEqual(["Old"]);
  });
  it("keeps setup guidance for a first-time user with no whiteboards", async () => {
    const onOpenSetup = vi.fn<() => void>();
    await render([], {
      onboarding: {
        installed: true,
        tutorialChecked: 0,
        tutorialTotal: 3,
        published: false,
      },
      onOpenSetup,
    });
    expect(container.textContent).toContain("1 of 3 done");
    await click("Continue setup");
    expect(onOpenSetup).toHaveBeenCalledOnce();
  });
  it("removes the whole selected batch immediately while requests are pending, without reviving setup", async () => {
    const pending: Array<() => void> = [];

    const onTrash = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      () => new Promise<void>((resolve) => pending.push(resolve)),
    );

    const boards = Array.from({ length: 20 }, (_, index) =>
      summary(`Board ${index}`),
    );

    const onboarding = {
      installed: true,
      tutorialChecked: 0,
      tutorialTotal: 3,
      published: false,
    };

    await render(boards, { onTrash, onboarding });
    await key("a", { metaKey: true });
    await key("Backspace", { metaKey: true });
    expect(titles()).toEqual([]);
    expect(container.textContent).not.toContain("Finish setting up");
    expect(onTrash).toHaveBeenCalledTimes(1);

    for (let index = 0; index < boards.length; index++) {
      await act(async () => pending.shift()!());
      await render(
        boards.map((board, row) =>
          row <= index
            ? { ...board, trashedAt: new Date(now).toISOString() }
            : board,
        ),
        { onTrash, onboarding },
      );
      expect(titles()).toEqual([]);
    }

    expect(container.textContent).toContain("Moved 20 whiteboards to Trash.");
    await render([], { onTrash, onboarding });
    expect(container.textContent).not.toContain("Finish setting up");
  });
  it("restores the Home view through host navigation without a duplicate back breadcrumb", async () => {
    const boards = [
      summary("Live"),
      summary("Gone", { trashedAt: "2026-10-01" }),
    ];

    const onViewChange = vi.fn<(view: "active" | "trash") => void>();
    await render(boards, { view: "active", onViewChange });
    await click("1 in Trash ›");
    expect(onViewChange).toHaveBeenCalledWith("trash");
    await render(boards, { view: "trash", onViewChange });
    expect(titles()).toEqual(["Gone"]);
    expect(
      container.querySelector('[aria-label="Back to Whiteboards"]'),
    ).toBeNull();
    await render(boards, { view: "active", onViewChange });
    expect(titles()).toEqual(["Live"]);
    await render(boards, { view: "trash", onViewChange });
    expect(titles()).toEqual(["Gone"]);
  });
  it("retains failed delete targets and reports partial failures", async () => {
    const onTrash = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async (r: ReviewApiSummary) => {
        if (r.title === "Two") throw new Error("Offline");
      },
    );

    await render([summary("One"), summary("Two")], { onTrash });
    await key("a", { metaKey: true });
    await key("Backspace", { metaKey: true });
    expect(titles()).toEqual(["Two"]);
    expect(container.textContent).toContain("1 selected");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not move 1 whiteboard to Trash",
    );
  });
  it("selects Trash rows for restoration instead of opening them", async () => {
    const onOpen = vi.fn<(review: ReviewApiSummary) => void>();

    const onRestore = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    await render([summary("Gone", { trashedAt: "2026-10-10" })], {
      onOpen,
      onRestore,
    });
    await click("1 in Trash ›");
    await click("Select Gone");
    expect(container.textContent).toContain("1 selected");
    expect(onOpen).not.toHaveBeenCalled();
    await click("Restore R");
    expect(onRestore).toHaveBeenCalledOnce();
    expect(titles()).toEqual([]);
  });
  it("confirms permanent deletion with Cancel focused, ignores Enter, and has no Undo afterwards", async () => {
    const onDelete = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    await render([summary("Gone", { trashedAt: "2026-10-10" })], {
      onDelete,
    });
    await click("1 in Trash ›");
    await select("Gone");
    await key("Backspace", { metaKey: true });
    expect(document.activeElement).toBe(button("Cancel"));
    await key("Enter", {}, document.activeElement!);
    expect(onDelete).not.toHaveBeenCalled();
    await click("Cancel");
    expect(container.querySelector("dialog")).toBeNull();
    await key("Backspace", { metaKey: true });
    await click("Delete");
    expect(onDelete).toHaveBeenCalledOnce();
    expect(titles()).toEqual([]);
    expect(container.textContent).toContain(
      "Permanently deleted 1 whiteboard.",
    );
    expect(container.querySelector('[aria-label="Undo"]')).toBeNull();
  });
  it("undoes only the toast batch with Cmd+Z, including Restore, and stops after dismissal", async () => {
    const onTrash = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
        async () => {},
      ),
      onRestore = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
        async () => {},
      );

    await render([summary("One"), summary("Two")], { onTrash, onRestore });
    await select("One");
    await key("Backspace", { metaKey: true });
    expect(host.ui.confirmDelete).not.toHaveBeenCalled();
    await key("z", { metaKey: true, shiftKey: true });
    expect(onRestore).not.toHaveBeenCalled();
    await key("f", { metaKey: true });
    await key("z", { metaKey: true }, searchField());
    expect(onRestore).not.toHaveBeenCalled();
    await key("Escape", {}, searchField());
    await key("z", { metaKey: true });
    expect(onRestore.mock.calls.map(([r]) => r.reviewId)).toEqual(["One"]);
    expect(titles()).toEqual(["One", "Two"]);
    await select("One");
    await key("Backspace", { metaKey: true });
    await click("View Trash");
    expect(container.textContent).toContain("30 days left");
    expect(container.textContent).not.toContain("31 days left");
    await select("One");
    await key("r");
    expect(titles()).toEqual([]);
    await key("z", { metaKey: true });
    expect(titles()).toEqual(["One"]);
    await key("a", { metaKey: true });
    await key("r");
    await click("Dismiss notification");
    const count = onTrash.mock.calls.length;
    await key("z", { metaKey: true });
    expect(onTrash).toHaveBeenCalledTimes(count);
  });
  it("stops intercepting Cmd+Z when the toast expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      const onTrash = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
        async () => {},
      );

      const onRestore = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
        async () => {},
      );

      await render([summary("One")], { onTrash, onRestore });
      await key("Backspace", { metaKey: true }, button("Open One"));
      expect(onTrash).toHaveBeenCalledOnce();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8001);
      });
      expect(container.querySelector('[aria-label="Undo"]')).toBeNull();
      await key("z", { metaKey: true });
      expect(onRestore).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("restores failed deletions and keeps successful ones hidden until catalog acknowledgement", async () => {
    const deletion = Promise.withResolvers<void>();

    const onTrash = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      () => deletion.promise,
    );

    const reviews = [summary("One")];
    await render(reviews, { onTrash });
    await select("One");
    await key("Backspace", { metaKey: true });
    expect(titles()).toEqual([]);
    await act(async () => deletion.reject(new Error("Offline")));
    expect(titles()).toEqual(["One"]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not move 1 whiteboard to Trash",
    );

    const success = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    await render(reviews, { onTrash: success });
    await key("Backspace", { metaKey: true });
    expect(titles()).toEqual([]);
    await render([...reviews], { onTrash: success });
    expect(titles()).toEqual([]);
    await render([], { onTrash: success });
    await render(reviews, { onTrash: success });
    expect(titles()).toEqual(["One"]);
  });
  it("shows setup over the returning-user nudge and keeps the refresher reachable", async () => {
    localStorage.setItem(
      "review.home.lastVisit.v1",
      String(now - 15 * 86400000),
    );
    const onOpenSettings = vi.fn<() => void>();
    const onOpenSetup = vi.fn<() => void>();
    await render([summary("One")], { onOpenSettings });
    expect(container.textContent).toContain("It’s been 2 weeks");
    await click("Refresh me");
    expect(container.querySelector("dialog")?.open).toBe(true);
    await click("Close help");
    await click("Close welcome back");
    await key(",", { metaKey: true });
    expect(onOpenSettings).toHaveBeenCalledOnce();
    await render([summary("One")], {
      onboarding: {
        installed: true,
        tutorialChecked: 0,
        tutorialTotal: 10,
        published: true,
      },
      onOpenSetup,
    });
    expect(container.textContent).not.toContain("Finish setting up");
    expect(onOpenSetup).not.toHaveBeenCalled();
  });
});

describe("formatRelativeTime", () => {
  it("uses relative times within a week and dates for older boards", () => {
    expect(formatRelativeTime("2026-10-11T11:54:00Z", now)).toBe("6 min ago");
    expect(formatRelativeTime("2026-10-10T12:00:00Z", now)).toBe("1 day ago");
    expect(formatRelativeTime("2026-09-24T12:00:00Z", now)).toBe("Sep 24");
    expect(formatRelativeTime(null, now)).toBe("unknown");
  });
});
