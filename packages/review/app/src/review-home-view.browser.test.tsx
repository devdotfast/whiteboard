import type {
  ReviewApiSummary,
  ReviewCanvasUi,
  ReviewGatewayHostState,
  ReviewMenuRequest,
} from "@dev.fast/review-protocol";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testCanvasUi } from "./canvas-ui-test-utils";
import { CanvasUiContext } from "./host/canvas-ui";
import { ReviewHome, formatRelativeTime } from "./review-home-view";

describe("ReviewHome", () => {
  let host: ReturnType<typeof testCanvasUi>;

  function renderWithHost(node: ReactNode) {
    root.render(
      <CanvasUiContext.Provider value={host.ui}>
        {node}
      </CanvasUiContext.Provider>,
    );
  }

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    host = testCanvasUi();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(navigator, "clipboard");
    vi.restoreAllMocks();
  });

  it("groups chronologically across repositories and shows origins", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));

    const reviews = [
      summary({
        reviewId: uuid(1),
        title: "Week",
        createdAt: "2026-09-20T12:00:00Z",
      }),
      summary({
        reviewId: uuid(2),
        title: "Recent local",
        createdAt: "2026-09-22T10:00:00Z",
        repositoryPath: "/worktrees/feature-a",
      }),
      summary({
        reviewId: uuid(3),
        title: "Old",
        createdAt: "2026-09-01T12:00:00Z",
      }),
      summary({
        reviewId: uuid(4),
        title: "Newest shared",
        createdAt: "2026-09-22T11:00:00Z",
        repositoryPath: undefined,
        shared: { cloneUrl: "https://github.com/team/other.git" },
      }),
    ];

    await act(async () =>
      renderWithHost(<ReviewHome reviews={reviews} onOpen={() => {}} />),
    );
    expect(
      [...container.querySelectorAll("tbody button > span:first-child")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Newest shared", "Recent local", "Week", "Old"]);
    expect(container.textContent).toContain("team/other");
    expect(
      container.querySelector('[title^="/worktrees/feature-a"]'),
    ).not.toBeNull();
  });

  it("filters repositories and changes sort order without losing review actions", async () => {
    const reviews = [
      summary({
        reviewId: uuid(1),
        title: "Zulu",
        repositoryName: "alpha",
        firstCreatedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-03-01T00:00:00Z",
        origin: { pullRequestNumber: 10 },
      }),
      summary({
        reviewId: uuid(2),
        title: "Alpha",
        repositoryName: "beta",
        firstCreatedAt: "2026-02-01T00:00:00Z",
        createdAt: "2026-02-01T00:00:00Z",
        origin: { pullRequestNumber: 20 },
      }),
    ];

    const onOpen = vi.fn<(review: ReviewApiSummary) => void>();

    const onDismiss = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => undefined,
    );

    const host = testCanvasUi();
    await act(async () =>
      renderWithHost(
        <CanvasUiContext.Provider value={host.ui}>
          <ReviewHome reviews={reviews} onOpen={onOpen} onDismiss={onDismiss} />
        </CanvasUiContext.Provider>,
      ),
    );

    const titles = () =>
      [...container.querySelectorAll("tbody button > span:first-child")].map(
        (element) => element.textContent,
      );

    const select = async (label: string, value: string) => {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
          .click(),
      );

      await act(async () => host.select(value));
    };

    expect(titles()).toEqual(["Alpha", "Zulu"]);
    await select("Sort reviews", "updated");
    expect(titles()).toEqual(["Zulu", "Alpha"]);
    await select("Sort reviews", "oldest");
    expect(titles()).toEqual(["Zulu", "Alpha"]);
    await select("Sort reviews", "pr");
    expect(titles()).toEqual(["Alpha", "Zulu"]);
    await select("Sort reviews", "title");
    expect(titles()).toEqual(["Alpha", "Zulu"]);
    await select("Filter by repository", "alpha");
    expect(titles()).toEqual(["Zulu"]);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Dismiss Zulu"]')!
        .click(),
    );
    expect(onDismiss).toHaveBeenCalledWith(reviews[0]);
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("td:nth-child(2) > button")!
        .click(),
    );
    expect(onOpen).toHaveBeenCalledWith(reviews[0]);
  });

  it("puts the scratchpad first, above the reviews and out of their workspaces", async () => {
    const {
      pins: _pins,
      repositoryPath: _path,
      ...base
    } = summary({
      reviewId: "scratchpad",
      title: "Scratchpad",
      repositoryName: "",
    });

    const pad: ReviewApiSummary = {
      ...base,
      kind: "scratchpad",
      contents: { blocks: 6, diagrams: 2 },
    };

    const review = summary({ reviewId: uuid(1), title: "A review" });
    const onOpen = vi.fn<(review: ReviewApiSummary) => void>();
    await act(async () =>
      renderWithHost(<ReviewHome reviews={[review, pad]} onOpen={onOpen} />),
    );

    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent ?? "",
    );

    const padIndex = labels.findIndex((text) => text.includes("Scratchpad"));
    expect(padIndex).toBeGreaterThanOrEqual(0);
    expect(padIndex).toBeLessThan(
      labels.findIndex((text) => text.includes("A review")),
    );
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.textContent).not.toContain("Dismiss Scratchpad");
    expect(container.textContent).toContain("6 blocks");
    expect(container.textContent).toContain("2 diagrams");

    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Scratchpad"),
    )!;

    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledWith(pad);
  });

  it("opens API reviews grouped by repository without needing a checkout path", async () => {
    const { repositoryPath: _, ...review } = summary({ title: "API review" });
    const item = { ...review, repositoryName: "Review repository" };
    const onOpen = vi.fn<(review: typeof item) => void>();
    await act(async () =>
      renderWithHost(<ReviewHome reviews={[item]} onOpen={onOpen} />),
    );
    expect(container.textContent).toContain("Review repository");

    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("API review"),
    );

    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it.each([false, true])(
    "host deletion waits for confirmation and preserves the original target (confirmed: %s)",
    async (confirmed) => {
      const original = summary({ title: "Original session" });
      const confirmation = Promise.withResolvers<boolean>();
      const deletion = Promise.withResolvers<void>();

      const onDelete = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
        () => deletion.promise,
      );

      const onOpen = vi.fn<(review: ReviewApiSummary) => void>();

      const confirmDelete = vi.fn<(title: string) => Promise<boolean>>(
        () => confirmation.promise,
      );

      let menu!: ReviewMenuRequest;

      const ui: ReviewCanvasUi = Object.freeze<ReviewCanvasUi>({
        confirmDelete,
        showMenu: (request) => {
          menu = request;

          return { dispose() {} };
        },
      });

      const render = async (reviews: ReviewApiSummary[]) =>
        act(async () =>
          renderWithHost(
            <CanvasUiContext.Provider value={ui}>
              <ReviewHome
                reviews={reviews}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            </CanvasUiContext.Provider>,
          ),
        );

      await render([original]);
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Actions for Original session"]',
          )!
          .click(),
      );
      let selected!: Promise<void>;
      await act(async () => {
        menu.onHide();
        selected = Promise.resolve(menu.onSelect("delete"));
      });
      await act(async () => {
        await menu.onSelect("delete");
      });
      expect(confirmDelete).toHaveBeenCalledExactlyOnceWith("Original session");
      expect(onDelete).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Original session");
      const other = summary({ reviewId: uuid(2), title: "Another session" });
      await render([other, original]);
      await act(async () => confirmation.resolve(confirmed));
      expect(onOpen).not.toHaveBeenCalled();

      expect(onDelete).toHaveBeenCalledTimes(confirmed ? 1 : 0);
      expect(onDelete.mock.calls[0]?.[0]).toBe(
        confirmed ? original : undefined,
      );
      expect(container.textContent?.includes("Original session")).toBe(
        !confirmed,
      );

      if (confirmed) {
        await act(async () => {
          deletion.reject(new Error("Offline"));
          await selected;
        });
      }

      await selected;
      expect(container.textContent).toContain("Original session");
      expect(container.textContent?.includes("Could not delete")).toBe(
        confirmed,
      );

      expect(container.textContent).toContain("Another session");
    },
  );

  it("a dismissed session uses a single host confirmation without an arming click", async () => {
    const review = summary({
      title: "Dismissed session",
      dismissedAt: "2026-09-01T00:00:00Z",
    });

    const confirmDelete = vi.fn<(title: string) => Promise<boolean>>(
      async () => false,
    );

    const onDelete = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    const ui: ReviewCanvasUi = Object.freeze<ReviewCanvasUi>({
      confirmDelete,
      showMenu: () => ({ dispose() {} }),
    });

    await act(async () =>
      renderWithHost(
        <CanvasUiContext.Provider value={ui}>
          <ReviewHome
            reviews={[review]}
            onOpen={() => {}}
            onDelete={onDelete}
          />
        </CanvasUiContext.Provider>,
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Dismissed sessions"] > button',
        )!
        .click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Delete Dismissed session"]',
        )!
        .click(),
    );
    expect(confirmDelete).toHaveBeenCalledExactlyOnceWith("Dismissed session");
    expect(onDelete).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Dismissed session");
  });

  it.each([false, true])(
    "optimistically deletes and restores failed deletions (dismissed: %s)",
    async (isDismissed) => {
      const review = summary({
        title: "Pending review",
        dismissedAt: isDismissed ? "2026-08-13T20:00:00.000Z" : null,
      });

      const deletion = Promise.withResolvers<void>();

      const onDelete = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
        () => deletion.promise,
      );

      await act(async () =>
        renderWithHost(
          <ReviewHome
            reviews={[review]}
            onOpen={() => {}}
            onDelete={onDelete}
          />,
        ),
      );
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            isDismissed
              ? '[aria-label="Dismissed sessions"] > button'
              : '[aria-label="Actions for Pending review"]',
          )!
          .click(),
      );

      await act(async () => {
        if (isDismissed)
          container
            .querySelector<HTMLButtonElement>(
              '[aria-label="Delete Pending review"]',
            )!
            .click();
        else void host.select("delete");
      });
      expect(onDelete).toHaveBeenCalledWith(review);
      expect(container.textContent).not.toContain("Pending review");
      expect(container.querySelector('[role="menu"]')).toBeNull();

      await act(async () => deletion.reject(new Error("Offline")));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Could not delete",
      );
      expect(
        container.querySelector(
          isDismissed
            ? '[aria-label="Delete Pending review"]'
            : '[aria-label="Actions for Pending review"]',
        ),
      ).not.toBeNull();
    },
  );

  it("keeps a successful deletion hidden until the catalog catches up, and allows reimport", async () => {
    const review = summary({ title: "Pending review" });
    const deletion = Promise.withResolvers<void>();

    const onDelete = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      () => deletion.promise,
    );

    const render = async (reviews: ReviewApiSummary[]) =>
      act(async () =>
        renderWithHost(
          <ReviewHome
            reviews={reviews}
            onOpen={() => {}}
            onDelete={onDelete}
          />,
        ),
      );

    await render([review]);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Actions for Pending review"]',
        )!
        .click(),
    );

    await act(async () => {
      void host.select("delete");
    });
    expect(container.textContent).not.toContain("Pending review");
    await act(async () => deletion.resolve());
    await render([review]);
    expect(container.textContent).not.toContain("Pending review");
    await render([]);
    await render([review]);
    expect(container.textContent).toContain("Pending review");
  });

  it("keeps attention actions on native summaries", async () => {
    const review = summary({
      title: "Native review",
      version: 0,
      origin: { pullRequestNumber: 320 },
    });

    const onOpen = vi.fn<(review: ReviewApiSummary) => void>();

    const onDismiss = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    const onRestore = vi.fn<(review: ReviewApiSummary) => Promise<void>>(
      async () => {},
    );

    const render = async (item: ReviewApiSummary) =>
      act(async () =>
        renderWithHost(
          <ReviewHome
            reviews={[item]}
            onOpen={onOpen}
            onDismiss={onDismiss}
            onRestore={onRestore}
          />,
        ),
      );

    await render(review);
    expect(container.textContent).toContain("#320");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Dismiss Native review"]',
        )!
        .click(),
    );
    expect(onDismiss).toHaveBeenCalledWith(review);
    expect(onOpen).not.toHaveBeenCalled();

    const dismissed = {
      ...review,
      viewedAt: "2026-09-01T00:00:00Z",
      dismissedAt: "2026-09-02T00:00:00Z",
    };

    await render(dismissed);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Dismissed sessions"] > button',
        )!
        .click(),
    );
    await act(async () =>
      container
        .querySelectorAll("button")
        .values()
        .find((button) => button.textContent === "Undo")!
        .click(),
    );
    expect(onRestore).toHaveBeenCalledWith(dismissed);
    await render({ ...dismissed, dismissedAt: null });
    expect(
      container.querySelector("td:nth-child(2) > button")?.textContent,
    ).toContain("Native review");
  });

  it.each([
    { platform: "MacIntel", find: { metaKey: true }, other: { ctrlKey: true } },
    { platform: "Win32", find: { ctrlKey: true }, other: { metaKey: true } },
    {
      platform: "Linux x86_64",
      find: { ctrlKey: true },
      other: { metaKey: true },
    },
  ])(
    "focuses the search box on the $platform find shortcut",
    async ({ platform, find, other }) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await act(async () =>
        renderWithHost(<ReviewHome reviews={[summary()]} onOpen={() => {}} />),
      );

      const press = async (modifiers: KeyboardEventInit) => {
        const event = new KeyboardEvent("keydown", {
          key: "f",
          ...modifiers,
          bubbles: true,
          cancelable: true,
        });

        await act(async () => document.body.dispatchEvent(event));

        return event;
      };

      const search = container.querySelector('[aria-label="Search sessions"]');

      expect((await press(other)).defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(search);
      expect((await press(find)).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(search);
    },
  );

  it("puts a remote review's host in front of its repository name", async () => {
    const reviews = [
      remote("devbox", { reviewId: uuid(1), title: "Remote" }),
      summary({
        reviewId: uuid(2),
        title: "Laptop",
        createdAt: "2026-07-28T11:54:00.000Z",
        repositoryGroup: { key: "git:/repo/.git", label: "my-repo" },
      }),
    ];

    await act(async () =>
      renderWithHost(<ReviewHome reviews={reviews} onOpen={() => {}} />),
    );
    expect(repositories()).toEqual(["devbox: my-repo", "my-repo"]);
  });

  it("keeps two machines' repositories of one name in two groups", async () => {
    const reviews = [
      remote("devbox", { reviewId: uuid(1), title: "On devbox" }),
      remote("other", { reviewId: uuid(2), title: "On other" }),
    ];

    await act(async () =>
      renderWithHost(<ReviewHome reviews={reviews} onOpen={() => {}} />),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Filter by repository"]',
        )!
        .click(),
    );
    expect(host.menu.items.map((item) => item.label)).toEqual([
      "All repos",
      "devbox: my-repo",
      "other: my-repo",
    ]);
    await act(async () => host.select("other:git:/repo/.git"));
    expect(titles()).toEqual(["On other"]);
  });

  it.each([
    ["offline", "offline"],
    ["connecting", "connecting"],
    ["not-installed", "not installed"],
  ] as const)(
    "draws a %s host's review as unavailable, and opening it shows the host's detail",
    async (hostState, words) => {
      const review = remote("devbox", { hostState });
      const onOpen = vi.fn<(review: ReviewApiSummary) => void>();

      const hostStates = vi.fn<() => Promise<ReviewGatewayHostState[]>>(
        async () => [
          {
            alias: "devbox",
            state: hostState,
            detail: "devbox is offline: it did not answer within 3 seconds.",
          },
        ],
      );

      await act(async () =>
        renderWithHost(
          <ReviewHome
            reviews={[review]}
            onOpen={onOpen}
            hostStates={hostStates}
          />,
        ),
      );

      const row = container.querySelector("tbody tr")!;

      const open = container.querySelector<HTMLButtonElement>(
        "td:nth-child(2) > button",
      )!;

      expect(row.hasAttribute("data-unavailable")).toBe(true);
      expect(row.textContent).toContain(words);
      expect(open.getAttribute("aria-disabled")).toBe("true");
      expect(open.title).toBe(`devbox is ${words}`);
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>("td:nth-child(2) > button")!
          .click(),
      );
      expect(onOpen).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "devbox is offline: it did not answer within 3 seconds.",
      );
    },
  );

  it("says only the state while the host's detail loads or when it has none", async () => {
    const answer = Promise.withResolvers<ReviewGatewayHostState[]>();
    const review = remote("devbox", { hostState: "offline" });

    await act(async () =>
      renderWithHost(
        <ReviewHome
          reviews={[review]}
          onOpen={() => {}}
          hostStates={() => answer.promise}
        />,
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("td:nth-child(2) > button")!
        .click(),
    );
    expect(alert()).toBe("devbox is offline.");
    await act(async () =>
      answer.resolve([{ alias: "devbox", state: "offline" }]),
    );
    expect(alert()).toBe("devbox is offline.");
  });

  it("keeps the message of the last unavailable review opened, and drops it when the list changes", async () => {
    const answers = [
      Promise.withResolvers<ReviewGatewayHostState[]>(),
      Promise.withResolvers<ReviewGatewayHostState[]>(),
    ];

    let calls = 0;

    const hostStates = vi.fn<() => Promise<ReviewGatewayHostState[]>>(
      () => answers[calls++]!.promise,
    );

    const reviews = [
      remote("devbox", {
        reviewId: uuid(1),
        title: "One",
        hostState: "offline",
      }),
      remote("other", {
        reviewId: uuid(2),
        title: "Two",
        hostState: "offline",
      }),
    ];

    const states = [
      { alias: "devbox", state: "offline" as const, detail: "devbox detail" },
      { alias: "other", state: "offline" as const, detail: "other detail" },
    ];

    await act(async () =>
      renderWithHost(
        <ReviewHome
          reviews={reviews}
          onOpen={() => {}}
          hostStates={hostStates}
        />,
      ),
    );

    const open = (title: string) =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "td:nth-child(2) > button",
        ),
      ]
        .find((button) => button.textContent?.includes(title))!
        .click();

    await act(async () => open("One"));
    await act(async () => open("Two"));
    await act(async () => answers[1]!.resolve(states));
    await act(async () => answers[0]!.resolve(states));
    expect(alert()).toBe("other detail");
    await act(async () =>
      renderWithHost(
        <ReviewHome
          reviews={[{ ...reviews[1]!, hostState: "online" }]}
          onOpen={() => {}}
          hostStates={hostStates}
        />,
      ),
    );
    expect(alert()).toBeUndefined();
  });

  function alert() {
    return container.querySelector('[role="alert"]')?.textContent;
  }

  it("draws an online remote review as available", async () => {
    const onOpen = vi.fn<(review: ReviewApiSummary) => void>();
    const review = remote("devbox");

    await act(async () =>
      renderWithHost(<ReviewHome reviews={[review]} onOpen={onOpen} />),
    );
    expect(
      container.querySelector("tbody tr")!.hasAttribute("data-unavailable"),
    ).toBe(false);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("td:nth-child(2) > button")!
        .click(),
    );
    expect(onOpen).toHaveBeenCalledWith(review);
  });

  function titles() {
    return [
      ...container.querySelectorAll("tbody button > span:first-child"),
    ].map((element) => element.textContent);
  }

  function repositories() {
    return [
      ...container.querySelectorAll("tbody button > span:nth-child(2)"),
    ].map((element) => element.textContent);
  }
});

function remote(
  alias: string,
  overrides: Partial<ReviewApiSummary> = {},
): ReviewApiSummary {
  return summary({
    repositoryGroup: { key: `${alias}:git:/repo/.git`, label: "my-repo" },
    host: alias,
    hostState: "online",
    available: { sourceWindows: false, languageFeatures: false },
    ...overrides,
  });
}

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");

  it("uses compact home-page relative labels", () => {
    expect(formatRelativeTime("2026-07-29T11:54:00.000Z", now)).toBe(
      "6 min ago",
    );
    expect(formatRelativeTime("2026-07-28T12:00:00.000Z", now)).toBe(
      "1 day ago",
    );
    expect(formatRelativeTime(null, now)).toBe("unknown");
  });
});

function summary(overrides: Partial<ReviewApiSummary> = {}): ReviewApiSummary {
  return {
    reviewId: uuid(9),
    version: 0,
    title: "Progressive Review",
    repositoryPath: "/repo/dev",
    repositoryName: (overrides.repositoryPath ?? "/repo/dev")
      .split("/")
      .at(-1)!,
    pins: {
      repositoryId: overrides.repositoryPath ?? "/repo/dev",
      base: "base",
      head: "head",
    },
    origin: { branch: "feature/home" },
    diffStats: null,
    createdAt: "2026-07-29T11:54:00.000Z",
    viewedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

function uuid(suffix: number): string {
  return `11111111-1111-4111-8111-${String(suffix).padStart(12, "0")}`;
}
