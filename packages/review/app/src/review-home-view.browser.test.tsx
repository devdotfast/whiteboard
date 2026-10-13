import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { testCanvasUi } from "./canvas-ui-test-utils";
import { CanvasUiContext } from "./host/canvas-ui";
import { createReviewFindHost } from "./review-find";
import { ReviewHome } from "./review-home-view";

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
    await select("Board");
    expect(onOpen).not.toHaveBeenCalled();
    await click("Open Board");
    expect(onOpen).toHaveBeenCalledWith(review);
    await render([{ ...review, ...read }], { onOpen });
    expect(container.querySelector('section[aria-label="Unread"]')).toBeNull();
    expect(titles("Last 7 days")).toEqual(["Board"]);
    await render([{ ...review, ...read, working: false }], { onOpen });
    expect(titles("Last 7 days")).toEqual(["Board"]);
    await render([
      { ...review, ...read, createdAt: "2026-10-11T12:01:00Z", working: false },
    ]);
    expect(titles("Unread")).toEqual(["Board"]);
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
    await optionSearch("fold");
    await key("Enter", {}, document.activeElement!);
    expect(container.querySelector("[data-home-picker]")).toBeNull();
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
    await optionSearch("beta");
    expect(button("beta")).toBeTruthy();
    expect(titles()).toEqual(["One", "Two"]);
    await key(" ", {}, button("beta"));
    expect(titles()).toEqual(["Two"]);
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
    await key("Escape");
    await click("Remove Repo alpha");
    expect(titles()).toHaveLength(2);
  });
  it("keeps the caret in the menu under the pointer when hover opens or switches submenus", async () => {
    await render(
      ["alpha", "beta"].flatMap((repositoryName) =>
        ["main", "feature"].map((tree) =>
          summary(`${repositoryName} ${tree}`, {
            repositoryName,
            repositoryPath: `/${repositoryName}/${tree}`,
          }),
        ),
      ),
    );
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
    const picker = container.querySelector<HTMLElement>("[data-home-picker]")!;
    const input = picker.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(
      [...picker.querySelectorAll('[role="checkbox"]')].map((row) =>
        row.getAttribute("aria-label"),
      ),
    ).toEqual(["zulu", "middle", "alpha"]);
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
  it("removes the whole selected batch while requests are pending", async () => {
    const pending: Array<() => void> = [];

    const onTrash = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      () => new Promise<void>((resolve) => pending.push(resolve)),
    );

    const boards = Array.from({ length: 20 }, (_, index) =>
      summary(`Board ${index}`),
    );

    await render(boards, { onTrash });
    await key("a", { metaKey: true });
    await key("Backspace", { metaKey: true });
    expect(titles()).toEqual([]);

    for (let index = 0; index < boards.length; index++) {
      await act(async () => pending.shift()!());
      await render(
        boards.map((board, row) =>
          row <= index
            ? { ...board, trashedAt: new Date(now).toISOString() }
            : board,
        ),
        { onTrash },
      );
      expect(titles()).toEqual([]);
    }
  });
  it("restores the Home view through host navigation", async () => {
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
});
