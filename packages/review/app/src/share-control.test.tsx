import { ReviewApiClient } from "@review/review-api/client";
// @vitest-environment jsdom
import { act, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { TestCanvasQuery } from "./canvas-query-test-utils";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";
import { ShareControl, SharingContext } from "./share-control";

let dispose: (() => void) | undefined;

const shareId = "6f1c2b0e-8e0a-4b8e-9a51-0d6f1e2c3b4a";

const revision5 = "0b8d6c3e-3a9f-4c1e-8f2a-5d7e9b1c4a60";

const revision4 = "1c9e7d4f-4b0a-4d2f-9a3b-6e8f0c2d5b71";

const u5 = `https://app.dev.fast/s/capability?rev=${revision5}`;

const u4 = `https://app.dev.fast/s/capability?rev=${revision4}`;

afterEach(async () => {
  await act(async () => dispose?.());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Harness = ReturnType<typeof mount>;

function mount(options: {
  signedIn: boolean;
  publishFails?: boolean;
  publishExpired?: boolean;
  holdPublish?: Promise<void>;
  holdVersion?: { version: number; until: Promise<void> };
  sender?: string;
  confirm?: () => Promise<boolean>;
  historyStatus?: number;
}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const state = { ...options };
  const posts: Array<{ path: string; body: unknown }> = [];
  const telemetry: string[] = [];
  let accountReads = 0;
  let historyReads = 0;

  const session = testReviewSession(
    {},
    {
      request: async (url, init) => {
        if (url.includes("/telemetry/event"))
          telemetry.push(JSON.parse(String(init?.body)).name);

        return Response.json({ ok: true });
      },
      confirm: options.confirm,
    },
  );

  const client = new ReviewApiClient(
    { serverUrl: "http://localhost", token: "local" },
    async (url, init) => {
      const path = new URL(url).pathname;

      if (init?.method === "POST")
        posts.push({ path, body: JSON.parse(String(init.body)) });

      if (path.endsWith("/account")) {
        accountReads += 1;

        return Response.json({
          account: state.signedIn
            ? { login: "author", origin: "https://app.dev.fast" }
            : null,
          pending: false,
        });
      }

      if (path.endsWith("/login")) {
        state.signedIn = true;

        return Response.json({
          pending: true,
          url: "https://github.com/login/device",
        });
      }

      if (path.includes("/history/")) {
        historyReads += 1;

        if (state.historyStatus === 401) state.signedIn = false;

        if (state.historyStatus)
          return Response.json(
            { error: "History is unavailable." },
            { status: state.historyStatus },
          );

        return Response.json({
          latest: revision5,
          items: [
            {
              id: revision5,
              version: 5,
              size: 2048,
              createdAt: Date.now(),
              url: u5,
            },
            {
              id: revision4,
              version: 4,
              size: 1024,
              createdAt: Date.now() - 2 * 3_600_000,
              url: u4,
            },
          ],
        });
      }

      if (path.endsWith("/open")) return Response.json({ opened: true });

      if (path.endsWith("/revoke"))
        return Response.json({ shareId, revoked: true });

      if (state.holdPublish) await state.holdPublish;

      if (
        path.endsWith("/publish") &&
        state.holdVersion &&
        JSON.parse(String(init!.body)).version === state.holdVersion.version
      )
        await state.holdVersion.until;

      if (path.endsWith("/publish") && state.publishExpired) {
        state.signedIn = false;
        state.publishExpired = false;

        return Response.json(
          { error: "Your sign-in has expired. Sign in again to share." },
          { status: 401 },
        );
      }

      if (path.endsWith("/publish") && state.publishFails)
        return Response.json(
          { error: "Review exceeds the sharing limit." },
          { status: 400 },
        );

      return Response.json({
        shareId,
        url: "https://app.dev.fast/s/capability",
        version: JSON.parse(String(init!.body)).version,
      });
    },
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  dispose = () => root.unmount();

  function Fixture({ version }: { version: number }) {
    const value = useMemo(
      () => ({
        client,
        reviewId: "authoring-review",
        version,
        sender: options.sender,
      }),
      [version],
    );

    return (
      <TestCanvasQuery>
        <ReviewSessionProvider session={session}>
          <SharingContext.Provider value={value}>
            <ShareControl />
          </SharingContext.Provider>
        </ReviewSessionProvider>
      </TestCanvasQuery>
    );
  }

  const render = (version: number) =>
    act(async () => root.render(<Fixture version={version} />));

  const click = (text: string) =>
    act(async () =>
      [...container.querySelectorAll("button")]
        .find(
          (button) =>
            button.textContent === text ||
            button.getAttribute("aria-label") === text,
        )!
        .click(),
    );

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

  return {
    container,
    posts,
    telemetry,
    state,
    render,
    click,
    settle,
    accountReads: () => accountReads,
    historyReads: () => historyReads,
  };
}

const publishes = (harness: Harness) =>
  harness.posts.filter((post) => post.path.endsWith("/publish"));

it("asks a signed-out user to sign in, then uploads the version chosen before login", async () => {
  const harness = mount({ signedIn: false });
  const { container } = harness;

  await harness.render(4);
  await harness.click("Share review");
  await harness.settle();
  expect(
    [...container.querySelectorAll("[role=dialog] button")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Sign in to share"]);
  expect(publishes(harness)).toHaveLength(0);
  await harness.click("Sign in to share");
  await harness.settle();
  expect(container.textContent).toContain("Waiting for sign-in…");
  expect(container.querySelector("[role=dialog] a")).toBeNull();
  await harness.render(5);
  await vi.waitFor(
    async () => {
      await harness.settle();
      expect(container.querySelector("input")?.value).toContain(
        "/s/capability",
      );
    },
    { timeout: 4000 },
  );
  expect(publishes(harness).map((post) => post.body)).toEqual([
    expect.objectContaining({ reviewId: "authoring-review", version: 4 }),
  ]);
  expect(container.textContent).not.toContain("Sign in");
});

it("names who shared a copy and shares it again like any review", async () => {
  const harness = mount({ signedIn: true, sender: "ada" });

  await harness.render(2);
  await harness.click("Share review");
  await harness.settle();
  expect(harness.container.textContent).toContain("Shared by ada");
  expect(publishes(harness).map((post) => post.body)).toEqual([
    expect.objectContaining({ reviewId: "authoring-review", version: 2 }),
  ]);
  expect(harness.container.querySelector("input")?.value).toContain(
    "/s/capability",
  );
});

it("uploads on open for a signed-in user, retries after a failure, and copies the link", async () => {
  const harness = mount({ signedIn: true, publishFails: true });
  const { container } = harness;

  await harness.render(4);
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(1);
  expect(container.textContent).toContain("Review exceeds the sharing limit.");
  expect(container.textContent).not.toContain("Create share link");
  harness.state.publishFails = false;
  await harness.click("Retry");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(2);
  expect(container.querySelector("input")?.value).toContain("/s/capability");
  expect(container.textContent).not.toContain("Uploading");
  let copied = "";
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => {
      copied = document.querySelector("textarea")!.value;

      return true;
    },
  });
  expect(harness.telemetry).not.toContain("review_shared");
  await harness.click("Copy link");
  expect(copied).toBe(container.querySelector("input")?.value);
  expect(container.textContent).toContain("Copied");
  expect(harness.telemetry).toContain("review_shared");
  delete (document as Partial<Document>).execCommand;
});

it("knows the sign-in state before the popover opens and refreshes it on focus", async () => {
  const harness = mount({ signedIn: true });
  const { container } = harness;

  await harness.render(1);
  await harness.settle();
  expect(harness.accountReads()).toBe(1);
  await harness.click("Share review");
  expect(publishes(harness)).toHaveLength(1);
  await harness.settle();
  await harness.click("Share review");
  await harness.click("Share review");
  await harness.settle();
  expect(container.querySelector("input")?.value).toContain("/s/capability");
  const reads = harness.accountReads();
  await act(async () => window.dispatchEvent(new Event("focus")));
  await harness.settle();
  expect(harness.accountReads()).toBe(reads + 1);
});

it("falls back to sign-in when the stored login has expired, then uploads after re-login", async () => {
  const harness = mount({ signedIn: true, publishExpired: true });
  const { container } = harness;

  await harness.render(4);
  await harness.settle();
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(1);
  expect(container.textContent).toContain("Your sign-in has expired.");
  expect(
    [...container.querySelectorAll("[role=dialog] button")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Sign in to share"]);
  await harness.click("Sign in to share");
  await vi.waitFor(
    async () => {
      await harness.settle();
      expect(container.querySelector("input")?.value).toContain(
        "/s/capability",
      );
    },
    { timeout: 4000 },
  );
  expect(publishes(harness)).toHaveLength(2);
  expect(container.textContent).not.toContain("expired");
});

it("keeps one link per board: reuses it while the version holds and uploads a new version behind it", async () => {
  const harness = mount({ signedIn: true });
  const { container } = harness;

  await harness.render(4);
  await harness.settle();
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(1);
  expect(container.querySelector("input")?.value).toContain("/s/capability");
  expect(container.textContent).toContain(
    "This link always opens the latest share of this board.",
  );
  await harness.click("Share review");
  await harness.click("Share review");
  expect(container.textContent).not.toContain("Uploading");
  expect(container.querySelector("input")?.value).toContain("/s/capability");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(1);
  await harness.click("Share review");
  await harness.render(5);
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness).map((post) => post.body)).toEqual([
    expect.objectContaining({ version: 4 }),
    expect.objectContaining({ version: 5 }),
  ]);
  expect(container.querySelector("input")?.value).toBe(
    "https://app.dev.fast/s/capability",
  );
  await harness.click("Share review");
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(2);
});

it("keeps one upload when the popover is reopened while it is in flight", async () => {
  let release: (() => void) | undefined;

  const harness = mount({
    signedIn: true,
    holdPublish: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });

  await harness.render(3);
  await harness.click("Share review");
  await harness.settle();
  await harness.click("Share review");
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(1);
  expect(harness.container.textContent).toContain("Uploading…");
  release?.();
  await harness.settle();
  expect(harness.container.querySelector("input")?.value).toContain(
    "/s/capability",
  );
  expect(publishes(harness)).toHaveLength(1);
});

it("keeps a newer version's link when an older upload lands after it", async () => {
  let release: (() => void) | undefined;

  const harness = mount({
    signedIn: true,
    holdVersion: {
      version: 4,
      until: new Promise<void>((resolve) => {
        release = resolve;
      }),
    },
  });

  const { container } = harness;

  await harness.render(4);
  await harness.click("Share review");
  await harness.settle();
  await harness.click("Share review");
  await harness.render(5);
  await harness.click("Share review");
  await harness.settle();
  expect(container.querySelector("input")?.value).toContain("/s/capability");
  release?.();
  await harness.settle();
  expect(publishes(harness).map((post) => post.body)).toEqual([
    expect.objectContaining({ version: 4 }),
    expect.objectContaining({ version: 5 }),
  ]);
  expect(container.textContent).not.toContain("Uploading");
  expect(container.querySelector("input")?.value).toContain("/s/capability");
});

it("shows a newer version's link when the popover opens on an older version", async () => {
  const harness = mount({ signedIn: true });
  const { container } = harness;

  await harness.render(5);
  await harness.click("Share review");
  await harness.settle();
  await harness.click("Share review");
  await harness.render(4);
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(1);
  expect(container.textContent).not.toContain("Uploading");
  expect(container.querySelector("input")?.value).toContain("/s/capability");
});

it("lists the link's revisions newest first, marks the latest and opens one in the browser", async () => {
  const harness = mount({ signedIn: true });
  const { container } = harness;

  await harness.render(5);
  await harness.click("Share review");
  await harness.settle();
  expect(
    [...container.querySelectorAll("[role=dialog] [data-share-revision]")].map(
      (row) => row.textContent,
    ),
  ).toEqual(["just now · v5 · 2 KB · Latest", "2 hours ago · v4 · 1 KB"]);
  await harness.click("2 hours ago · v4 · 1 KB");
  expect(harness.posts.at(-1)).toEqual({
    path: "/reviews-api/sharing/open",
    body: { url: u4 },
  });
  expect(container.textContent).not.toContain("Revoke link");
  await harness.click("Share review");
  await harness.render(6);
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(2);
  expect(harness.historyReads()).toBe(2);
});

it("revokes the link after the host confirms, and the next opening shares a new one", async () => {
  let answer = false;
  const confirm = vi.fn<() => Promise<boolean>>(async () => answer);
  const harness = mount({ signedIn: true, confirm });
  const { container } = harness;

  const posts = (suffix: string) =>
    harness.posts.filter((post) => post.path.endsWith(suffix));

  await harness.render(5);
  await harness.click("Share review");
  await harness.settle();
  await harness.click("Revoke link");
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(posts("/revoke")).toHaveLength(0);
  answer = true;
  await harness.click("Revoke link");
  await harness.settle();
  expect(posts("/revoke").map((post) => post.body)).toEqual([{ shareId }]);
  expect(container.textContent).toContain(
    "Link revoked. Sharing this board again creates a new link.",
  );
  expect(container.querySelector("input")).toBeNull();
  expect(publishes(harness)).toHaveLength(1);
  await harness.click("Share review");
  await harness.click("Share review");
  await harness.settle();
  expect(publishes(harness)).toHaveLength(2);
  expect(container.querySelector("input")?.value).toContain("/s/capability");
  expect(container.textContent).not.toContain("Link revoked");
});

it("shows a history failure under the link and keeps it usable", async () => {
  const harness = mount({ signedIn: true, historyStatus: 500 });
  const { container } = harness;

  await harness.render(5);
  await harness.click("Share review");
  await vi.waitFor(async () => {
    await harness.settle();
    expect(container.textContent).toContain("Could not load share history.");
  });
  expect(container.querySelector("[role=alert]")).toBeNull();
  expect(container.querySelector("input")?.value).toContain("/s/capability");
  const dialog = container.querySelector("[role=dialog]")!;
  expect(
    [...dialog.children].findIndex((child) =>
      child.textContent?.includes("Could not load share history."),
    ),
  ).toBeGreaterThan(
    [...dialog.children].findIndex((child) => child.tagName === "INPUT"),
  );
  expect(
    [...dialog.querySelectorAll("button")].map((button) => button.textContent),
  ).toContain("Copy link");
});

it("shows sign-in when the history read finds the login expired", async () => {
  const harness = mount({ signedIn: true, historyStatus: 401 });
  const { container } = harness;

  await harness.render(5);
  await harness.settle();
  const reads = harness.accountReads();
  await harness.click("Share review");
  await vi.waitFor(async () => {
    await harness.settle();
    expect(harness.historyReads()).toBe(1);
    expect(harness.accountReads()).toBeGreaterThan(reads);
    expect(
      [...container.querySelectorAll("[role=dialog] button")].map(
        (button) => button.textContent,
      ),
    ).toContain("Sign in to share");
  });
});

it("opens one confirmation while the first is unanswered", async () => {
  let answer: (confirmed: boolean) => void = () => {};

  const confirm = vi.fn<() => Promise<boolean>>(
    () => new Promise((resolve) => (answer = resolve)),
  );

  const harness = mount({ signedIn: true, confirm });

  await harness.render(5);
  await harness.click("Share review");
  await harness.settle();
  await harness.click("Revoke link");
  await harness.click("Revoke link");
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => answer(false));
  await harness.click("Revoke link");
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("shares again from the revoked state without closing", async () => {
  const harness = mount({ signedIn: true, confirm: async () => true });
  const { container } = harness;

  await harness.render(5);
  await harness.click("Share review");
  await harness.settle();
  await harness.click("Revoke link");
  await harness.settle();
  expect(container.textContent).toContain("Link revoked");
  await harness.click("Share again");
  await harness.settle();

  const [first, second] = publishes(harness).map(
    (post) => (post.body as { requestId: string }).requestId,
  );

  expect(second).toBeDefined();
  expect(second).not.toBe(first);
  expect(container.querySelector("input")?.value).toContain("/s/capability");
  expect(container.textContent).not.toContain("Link revoked");
});

it("polls only while sign-in is pending and stops when the control unmounts", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const harness = mount({ signedIn: false });
  const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  await harness.render(1);
  await wait(5000);
  expect(harness.accountReads()).toBe(1);
  await harness.click("Share review");
  await harness.click("Sign in to share");
  await wait(10);
  expect(harness.container.textContent).toContain("Waiting for sign-in…");
  const reads = harness.accountReads();
  await act(async () => dispose?.());
  dispose = undefined;
  await wait(5000);
  expect(harness.accountReads()).toBe(reads);
});
