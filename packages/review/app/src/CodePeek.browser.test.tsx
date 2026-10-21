import type {
  ReviewInlineEditorSpec,
  ReviewVerbRequest,
} from "@dev.fast/review-protocol";
import { selectSource, sourceAnchors } from "@review/lens-selection";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CodePeek,
  CodePeekCard,
  CodePeekGroup,
  SourceCodePeek,
} from "./CodePeek";
import {
  type ReviewSession,
  ReviewSessionProvider,
} from "./host/review-session";
import type { ReviewLensView } from "./review-lenses";
import { testReviewSession } from "./review-session-test-utils";
import { tourStyles } from "./side-panel-styles";

const testLenses: ReviewLensView = {
  progress: null,
  error: null,
  resolve: (selections) => selections.flatMap(sourceAnchors),
};

let root: ReturnType<typeof createRoot> | undefined;

let posted: ReviewVerbRequest[] = [];

let created: ReviewInlineEditorSpec[] = [];

let disposed: ReviewInlineEditorSpec[] = [];

let session: ReviewSession;

beforeEach(() => {
  posted = [];
  created = [];
  disposed = [];
  session = createTestSession();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CodePeek native editor", () => {
  it("renders one native editor per authored file in a grouped side peek", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      renderWithSession(
        <CodePeekGroup
          lenses={testLenses}
          peeks={[
            {
              file: "src/current.ts",
              fromLine: 20,
              toLine: 24,
              side: "head",
            },
            {
              file: "src/current.ts",
              fromLine: 22,
              toLine: 23,
              side: "head",
            },
            {
              file: "src/current.ts",
              fromLine: 80,
              toLine: 82,
              side: "head",
            },
            {
              file: "src/current.ts",
              fromLine: 50,
              toLine: 50,
              side: "base",
            },
            {
              file: "src/other.ts",
              fromLine: 4,
              toLine: 4,
              side: "head",
            },
          ]}
        />,
      );
    });

    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(created).toMatchObject([
      {
        path: "src/current.ts",
        side: "head",
        countRanges: [
          { startLine: 20, endLine: 24, side: "head" },
          { startLine: 22, endLine: 23, side: "head" },
          { startLine: 80, endLine: 82, side: "head" },
          { startLine: 50, endLine: 50, side: "base" },
        ],
        ranges: [
          { startLine: 20, endLine: 24 },
          { startLine: 80, endLine: 82 },
          { startLine: 50, endLine: 50, side: "base" },
        ],
        heightMode: "content",
      },
      {
        path: "src/other.ts",
        ranges: [{ startLine: 4, endLine: 4 }],
        heightMode: "content",
      },
    ]);
  });

  it("lets the software-map sidebar scroll one content-height diff feed", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      renderWithSession(
        <CodePeek
          file="src/current.ts"
          fromLine={20}
          toLine={24}
          graph="head"
          lenses={testLenses}
        />,
      );
    });

    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      path: "src/current.ts",
      ranges: [{ startLine: 20, endLine: 24 }],
      heightMode: "content",
    });
  });

  it("mounts each editor without a React header and opens from the native action", async () => {
    const input = {
      side: "base",
      file: "src/previous.ts",
      fromLine: 7,
      toLine: 9,
    } as const;

    const secondInput = {
      side: "head",
      file: "src/current.ts",
      fromLine: 20,
      toLine: 20,
    } as const;

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      renderWithSession(
        <>
          <CodePeekCard source={selectSource(input)} lenses={testLenses} />
          <CodePeekCard
            source={selectSource(secondInput)}
            lenses={testLenses}
          />
        </>,
      ),
    );
    await vi.waitFor(() => {
      expect(created).toMatchObject([
        {
          path: "src/previous.ts",
          side: "base",
          title: "src/previous.ts:7-9",
          heightMode: "capped",
        },
        {
          path: "src/current.ts",
          side: "head",
          title: "src/current.ts:20",
          heightMode: "capped",
        },
      ]);
    });
    expect(
      [...container.querySelectorAll("[data-review-inline-editor]")].every(
        (placeholder) =>
          placeholder.querySelector(".fixture-inline-editor") !== null,
      ),
    ).toBe(true);

    expect(container.querySelector(".code-peek-card")).toBeNull();
    expect(created[0]?.onDidOpen).toBeTypeOf("function");

    await act(async () => {
      created[0]?.onDidOpen?.();
    });

    expect(posted.at(-1)).toEqual({
      name: "reveal",
      args: {
        path: "src/previous.ts",
        startLine: 7,
        endLine: 9,
        side: "base",
        highlight: true,
        preserveFocus: false,
      },
    });
  });

  it("shows each of a step's ranges as its own card, in order, clipped to its lines", async () => {
    const range = (file: string, fromLine: number, toLine: number) =>
      selectSource({ side: "head", file, fromLine, toLine });

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      renderWithSession(
        <SourceCodePeek
          sources={[
            range("src/store.ts", 412, 413),
            range("src/store.ts", 380, 391),
            range("src/config.ts", 41, 44),
          ]}
          lenses={testLenses}
        />,
      ),
    );

    await vi.waitFor(() => {
      expect(created).toMatchObject([
        { path: "src/store.ts", ranges: [{ startLine: 412, endLine: 413 }] },
        { path: "src/store.ts", ranges: [{ startLine: 380, endLine: 391 }] },
        { path: "src/config.ts", ranges: [{ startLine: 41, endLine: 44 }] },
      ]);
    });
    // Plain cards: the editor draws each header, so no header row of ours.
    expect(container.querySelector("button")).toBeNull();
  });

  it("spaces a tour step's cards apart and leaves a lone peek's cards flush", async () => {
    const range = (file: string, fromLine: number, toLine: number) =>
      selectSource({ side: "head", file, fromLine, toLine });

    const sources = [
      range("src/store.ts", 412, 413),
      range("src/config.ts", 41, 44),
    ];

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      renderWithSession(
        <>
          <div data-host="tour" {...stylex.props(tourStyles.content)}>
            <SourceCodePeek sources={sources} lenses={testLenses} />
          </div>
          <div data-host="tour-single" {...stylex.props(tourStyles.content)}>
            <SourceCodePeek sources={sources.slice(0, 1)} lenses={testLenses} />
          </div>
          <div data-host="peek">
            <SourceCodePeek sources={sources} lenses={testLenses} />
          </div>
        </>,
      ),
    );

    const cards = (host: string) => [
      ...container.querySelectorAll<HTMLElement>(
        `[data-host="${host}"] .code-peek`,
      ),
    ];

    const gapBetween = ([first, second]: HTMLElement[]) =>
      second!.getBoundingClientRect().top -
      first!.getBoundingClientRect().bottom;

    expect(gapBetween(cards("tour"))).toBe(12);
    expect(gapBetween(cards("peek"))).toBe(0);

    const [single] = cards("tour-single");
    expect(single!.getBoundingClientRect().bottom).toBe(
      single!.parentElement!.getBoundingClientRect().bottom,
    );
  });

  it("disposes every prior editor while rapidly retargeting one inline surface", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    for (let index = 0; index < 50; index += 1) {
      const input = {
        side: "head",
        file: `src/target-${index}.ts`,
        fromLine: index + 1,
        toLine: index + 1,
      } as const;

      await act(async () =>
        renderWithSession(
          <CodePeekCard source={selectSource(input)} lenses={testLenses} />,
        ),
      );
      await vi.waitFor(() => expect(created).toHaveLength(index + 1));
    }

    expect(created).toHaveLength(50);
    expect(disposed).toHaveLength(49);
    expect(
      container.querySelectorAll(
        "[data-review-inline-editor] > .fixture-inline-editor",
      ),
    ).toHaveLength(1);

    await act(async () => root!.unmount());
    root = undefined;
    expect(disposed).toHaveLength(50);
  });

  it("recreates a native editor when the Review session changes", async () => {
    const input = {
      side: "head",
      file: "src/current.ts",
      fromLine: 20,
      toLine: 20,
    } as const;

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      renderWithSession(
        <CodePeekCard source={selectSource(input)} lenses={testLenses} />,
      ),
    );
    await vi.waitFor(() => expect(created).toHaveLength(1));

    session = createTestSession("next-session");
    await act(async () =>
      renderWithSession(
        <CodePeekCard source={selectSource(input)} lenses={testLenses} />,
      ),
    );

    await vi.waitFor(() => {
      expect(disposed).toHaveLength(1);
      expect(created).toHaveLength(2);
    });
  });
});

function renderWithSession(node: ReactNode) {
  root!.render(
    <ReviewSessionProvider session={session}>{node}</ReviewSessionProvider>,
  );
}

function createTestSession(reviewId = "test"): ReviewSession {
  return testReviewSession(
    { reviewId, token: "" },
    {
      diffView: {
        files: async () => [],
        create: () => {
          throw new Error("unused test diff view");
        },
      },
      inlineEditors: {
        async find() {
          return { matchCount: 0 };
        },
        create: (spec) => {
          created.push(spec);
          const editor = document.createElement("div");
          editor.className = "fixture-inline-editor";
          spec.container.appendChild(editor);

          return {
            height: 180,
            setActive() {},
            setCollapsed() {},
            async setFindQuery() {
              return { matchCount: 0 };
            },
            revealFindMatch() {},
            clearActiveFindMatch() {},
            clearFind() {},
            onDidChangeHeight: () => ({ dispose() {} }),
            onDidError: () => ({ dispose() {} }),
            dispose: () => {
              disposed.push(spec);
              editor.remove();
            },
          };
        },
      },
      post: async (request) => {
        posted.push(request);

        return { ok: true };
      },
      subscribe: () => ({ dispose() {} }),
      currentTheme: () => "dark",
      onDidChangeTheme: () => ({ dispose() {} }),
      currentInlineLineNumbers: () => false,
      setInlineLineNumbers: async () => {},
      onDidChangeInlineLineNumbers: () => ({ dispose() {} }),
      currentDiffLayout: () => "split",
      async setDiffLayout() {},
      onDidChangeDiffLayout: () => ({ dispose() {} }),
      ready() {},
    },
  );
}
