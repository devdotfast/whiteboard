import { type ReactNode, act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { MarkdownContent } from "./agent-markdown";
import { type AskAnchor, askAnchor } from "./ask-anchor";
import { AskHistoryProvider, useAskHistory } from "./ask-history";
import { AskThreadMarks } from "./ask-marks";
import { documentStyles } from "./document-styles";
import { drawStyles } from "./draw-styles";
import { ReviewSessionProvider } from "./host/review-session";
import { documentMarker } from "./markers.stylex";
import { ReviewPanelProvider, useReviewPanel } from "./review-panel";
import { testReviewSession } from "./review-session-test-utils";
import { withClass } from "./stylex-props";

import "./styles.css";

const saved = (
  id: string,
  quote: string,
  anchor: AskAnchor | undefined,
  agent = "claude",
) => ({
  id,
  agent,
  title: `Question ${id}`,
  selection: { title: quote, target: { kind: "text", quote, anchor } },
  version: 1,
  head: "7fd03b8e2",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
});

let view: unknown;

let outdated: ReadonlySet<string> | undefined;

function Probe() {
  view = useReviewPanel(({ ask }) => ask?.view ?? null);
  outdated = useAskHistory()?.outdated;

  return null;
}

interface Block {
  id: string;
  text: string;
}

/** A Markdown block, as the canvas renders one: it carries its id. */
function MarkdownBlock({ id, source }: { id: string; source: string }) {
  return (
    <div
      {...withClass(
        "api-document-node api-document-node--prose",
        drawStyles.blockChild,
      )}
      data-review-node-id={id}
    >
      <MarkdownContent source={source} />
    </div>
  );
}

/** A review document as the canvas renders one: each block carries its id. */
function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((block) => (
    <MarkdownBlock key={block.id} id={block.id} source={block.text} />
  ));
}

function Document({
  revision,
  children,
}: {
  revision: string;
  children: ReactNode;
}) {
  const articleRef = useRef<HTMLElement>(null);

  return (
    <>
      <article
        ref={articleRef}
        {...withClass(
          "review-document",
          documentStyles.article,
          documentMarker,
        )}
      >
        {children}
      </article>
      <AskThreadMarks articleRef={articleRef} revision={revision} />
    </>
  );
}

/** The `nth` occurrence of `words` in a text node under `container`. */
function rangeOf(container: Element, words: string, nth = 0): Range {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let seen = 0;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";

    for (
      let at = text.indexOf(words);
      at >= 0;
      at = text.indexOf(words, at + 1)
    )
      if (seen++ === nth) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + words.length);

        return range;
      }
  }

  throw new Error(`No "${words}" #${nth}`);
}

/** What asking saves for each selection, from the document as rendered. */
async function anchorsIn(
  document_: ReactNode,
  selections: { words: string; nth?: number }[],
): Promise<AskAnchor[]> {
  const scratch = document.createElement("div");
  document.body.append(scratch);
  const root = createRoot(scratch);

  await act(async () => root.render(document_));

  const anchors = selections.map(
    ({ words, nth }) => askAnchor(rangeOf(scratch, words, nth))!,
  );

  await act(async () => root.unmount());
  scratch.remove();

  return anchors;
}

const frame = () => act(() => new Promise(requestAnimationFrame));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  outdated = undefined;
});

it("marks each asked-about passage beside it and reopens its conversation", async () => {
  const session = testReviewSession();

  const blocks = [
    {
      id: "block-1",
      text: "Stripe redelivers a webhook whenever our handler times out.",
    },
    {
      id: "block-2",
      text: "The unique index on charges.event_id is created concurrently, so the migration is safe to run.",
    },
  ];

  const [stripe, concurrently] = await anchorsIn(<Blocks blocks={blocks} />, [
    { words: "Stripe redelivers a webhook" },
    { words: "created concurrently, so the migration" },
  ]);

  vi.spyOn(session, "fetch").mockImplementation(async () =>
    Response.json({
      threads: [
        saved(
          "newest",
          "created concurrently, so the migration",
          concurrently,
          "codex",
        ),
        saved("single", "Stripe redelivers a webhook", stripe),
        saved("older", "created concurrently, so the migration", concurrently),
        // A block this version no longer has.
        saved("gone", "A passage", { ...stripe!, blockId: "block-9" }),
      ],
    }),
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () =>
    root.render(
      <ReviewSessionProvider session={session}>
        <ReviewPanelProvider>
          <AskHistoryProvider>
            <Document revision="1">
              <Blocks blocks={blocks} />
            </Document>
            <Probe />
          </AskHistoryProvider>
        </ReviewPanelProvider>
      </ReviewSessionProvider>,
    ),
  );

  const pins = () => [
    ...container.querySelectorAll<HTMLButtonElement>(".ask-mark-pin"),
  ];

  // Marks are placed on a frame after the list arrives and layout settles.
  await vi.waitFor(async () => {
    await frame();
    expect(pins()).toHaveLength(2);
  });

  const [first, second] = pins();

  const [firstParagraph, secondParagraph] = [
    ...container.querySelectorAll("p"),
  ].map((paragraph) => paragraph.getBoundingClientRect());

  // Each pin sits in the margin, level with its passage.
  // A count only once there is more than one conversation.
  expect(first!.textContent).toBe("");
  expect(second!.textContent).toBe("2");
  expect(first!.getBoundingClientRect().left).toBeGreaterThan(
    firstParagraph!.right,
  );
  expect(
    Math.abs(second!.getBoundingClientRect().top - secondParagraph!.top),
  ).toBeLessThan(secondParagraph!.height);

  // The document's own text is unchanged; the wash is a CSS highlight.
  expect(CSS.highlights.get("ask-thread")?.size).toBe(2);
  expect(outdated).toEqual(new Set(["gone"]));

  await act(async () => first!.click());
  expect(view).toMatchObject({ type: "saved", threadId: "single" });

  await act(async () => second!.click());
  // Only the conversations about its passage.
  expect(view).toEqual({
    type: "history",
    passage: {
      quote: "created concurrently, so the migration",
      threadIds: ["newest", "older"],
    },
  });

  await act(async () => root.unmount());
  expect(CSS.highlights.has("ask-thread")).toBe(false);
});

it("follows the words asked about through later versions, and calls them outdated once an edit touches them", async () => {
  const session = testReviewSession();

  const asked = [
    {
      id: "block-1",
      text: "One file tree, diffr diffs, and a Diff / Head / Base switch.",
    },
    {
      id: "block-2",
      text: "The diffs come from diffr, so they match the Diff tab.",
    },
  ];

  // The second "diffr": the same word is in the block before it.
  const [diffr, tab] = await anchorsIn(<Blocks blocks={asked} />, [
    { words: "diffr", nth: 1 },
    { words: "Diff tab" },
  ]);

  vi.spyOn(session, "fetch").mockImplementation(async () =>
    Response.json({
      threads: [saved("diffr", "diffr", diffr), saved("tab", "Diff tab", tab)],
    }),
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const show = (revision: string, blocks: Block[]) =>
    act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewPanelProvider>
            <AskHistoryProvider>
              <Document revision={revision}>
                <Blocks blocks={blocks} />
              </Document>
              <Probe />
            </AskHistoryProvider>
          </ReviewPanelProvider>
        </ReviewSessionProvider>,
      ),
    );

  const washed = () =>
    [...(CSS.highlights.get("ask-thread") ?? [])].map((range) => [
      range.toString(),
      range.startContainer.parentElement?.closest<HTMLElement>(
        "[data-review-node-id]",
      )?.dataset.reviewNodeId,
    ]);

  // Edits elsewhere, and text added before the words, move the marks along.
  await show("2", [
    { id: "block-1", text: "Two file trees, diffr diffs everywhere." },
    {
      id: "block-2",
      text: "Now the diffs come from diffr, so they match the Diff tab.",
    },
  ]);
  await vi.waitFor(async () => {
    await frame();
    expect(washed()).toEqual([
      ["diffr", "block-2"],
      ["Diff tab", "block-2"],
    ]);
  });
  expect(outdated).toEqual(new Set());

  // An edit inside the words: that conversation is outdated, the other not.
  await show("3", [
    {
      id: "block-2",
      text: "Now the diffs come from diffr, so they match the Diff view.",
    },
  ]);
  await vi.waitFor(async () => {
    await frame();
    expect(outdated).toEqual(new Set(["tab"]));
  });
  expect(washed()).toEqual([["diffr", "block-2"]]);

  // Their block is gone.
  await show("4", [{ id: "block-1", text: "Two file trees." }]);
  await vi.waitFor(async () => {
    await frame();
    expect(outdated).toEqual(new Set(["diffr", "tab"]));
  });
  expect(container.querySelector(".ask-mark-pin")).toBeNull();

  await act(async () => root.unmount());
});

it("pins every passage in one lane, side by side on a shared line, and pairs a pin with its words", async () => {
  const session = testReviewSession();

  const document_ = (
    <>
      <MarkdownBlock
        id="block-1"
        source="A paragraph passage, and a second one."
      />
      <MarkdownBlock id="block-2" source="## A heading passage" />
      <MarkdownBlock
        id="block-3"
        source={
          "- A list passage, then more.\n  - A nested passage, then more."
        }
      />
      <MarkdownBlock id="block-4" source="> A quoted passage, then more." />
      <MarkdownBlock
        id="block-5"
        source={"| Before | A cell passage |\n| --- | --- |"}
      />
    </>
  );

  const quotes = [
    "A paragraph passage",
    // On the same line as the one above.
    "a second one",
    "A heading passage",
    "A list passage",
    "A nested passage",
    "A quoted passage",
    "A cell passage",
  ];

  const anchors = await anchorsIn(
    document_,
    quotes.map((words) => ({ words })),
  );

  vi.spyOn(session, "fetch").mockImplementation(async () =>
    Response.json({
      threads: quotes.map((quote, index) =>
        saved(quote, quote, anchors[index]),
      ),
    }),
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () =>
    root.render(
      <ReviewSessionProvider session={session}>
        <ReviewPanelProvider>
          <AskHistoryProvider>
            <Document revision="1">{document_}</Document>
          </AskHistoryProvider>
        </ReviewPanelProvider>
      </ReviewSessionProvider>,
    ),
  );

  const pins = () => [
    ...container.querySelectorAll<HTMLButtonElement>(".ask-mark-pin"),
  ];

  await vi.waitFor(async () => {
    await frame();
    expect(pins()).toHaveLength(quotes.length);
  });

  const boxes = pins().map((pin) => pin.getBoundingClientRect());

  const [paragraph, sameLine, ...others] = boxes;

  // One lane on the right, beside the narrow table too.
  expect(
    new Set([paragraph, ...others].map((box) => Math.round(box!.left))).size,
  ).toBe(1);

  // Two passages on one line: their pins sit level on it, in reading order.
  expect(sameLine!.top).toBe(paragraph!.top);
  expect(sameLine!.left).toBeGreaterThan(paragraph!.right);

  // No two pins overlap.
  const overlapping = boxes.filter((box, index) =>
    boxes.some(
      (other, at) =>
        at < index &&
        box.top < other.bottom &&
        other.top < box.bottom &&
        box.left < other.right &&
        other.left < box.right,
    ),
  );

  expect(overlapping).toEqual([]);

  const active = () => pins().filter((pin) => pin.hasAttribute("data-active"));

  // The pointer on a pin deepens its passage's wash and outlines it.
  await userEvent.hover(pins()[2]!);
  await frame();
  expect(active()).toEqual([pins()[2]]);
  expect(CSS.highlights.get("ask-thread-active")?.size).toBe(1);

  // And on a passage's words, its pin.
  const article = container.querySelector("article")!;
  const words = [...article.querySelectorAll("li")][1]!.getBoundingClientRect();

  await act(async () => {
    article.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: words.left + 8,
        clientY: words.top + words.height / 2,
      }),
    );
  });
  await frame();
  expect(active()[0]?.getAttribute("aria-label")).toContain("A nested passage");

  await act(async () => {
    article.dispatchEvent(new PointerEvent("pointerleave"));
  });
  expect(active()).toEqual([]);
  expect(CSS.highlights.has("ask-thread-active")).toBe(false);

  await act(async () => root.unmount());
});
