import type { AgentSelection } from "@review/agent-selection";

/** Authored document text participates; native code editors report their own selections. */
export function observeAgentTextSelection(
  article: HTMLElement,
  select: (
    value:
      | (Omit<AgentSelection, "revision"> & {
          anchor: { x: number; y: number };
          anchorElement: Element;
          range: Range;
        })
      | null,
  ) => void,
): () => void {
  const document = article.ownerDocument;
  let hadSelection = false;
  let dragging = false;
  let pending = false;

  const update = () => {
    const selection = document.getSelection();

    if (dragging && selection && !selection.isCollapsed) {
      pending = true;

      return;
    }

    pending = false;

    const quote = selection?.toString() ?? "";

    const eligible = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;

      return (
        element &&
        article.contains(element) &&
        element.closest("[data-review-copy-prose]") &&
        (!element.closest("pre") ||
          element.closest("code[data-review-copy-prose]")) &&
        !element.closest(
          ".monaco-editor, button, select, input, textarea, [data-review-copy-ignore]",
        )
      );
    };

    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !quote ||
      !eligible(selection.anchorNode) ||
      !eligible(selection.focusNode)
    ) {
      if (hadSelection) {
        hadSelection = false;
        select(null);
      }

      return;
    }

    const range = selection.getRangeAt(0);

    // Endpoints alone are insufficient: a drag can cross a diagram between paragraphs.
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
    );

    let node: Node | null = range.commonAncestorContainer;

    while (node) {
      if (
        node.nodeType === Node.TEXT_NODE &&
        node.textContent?.trim() &&
        range.intersectsNode(node) &&
        !eligible(node)
      ) {
        if (hadSelection) select(null);
        hadSelection = false;

        return;
      }

      node = walker.nextNode();
    }

    const dragStart = document.createRange();

    dragStart.setStart(selection.anchorNode!, selection.anchorOffset);

    const backward =
      dragStart.comparePoint(selection.focusNode!, selection.focusOffset) < 0;

    const rects = range.getClientRects();

    const rect =
      (backward ? rects[0] : rects[rects.length - 1]) ??
      range.getBoundingClientRect();

    // The toolbar is drawn 36px above the anchor.
    const view = (
      article.closest(".review-view-region") ?? article
    ).getBoundingClientRect();

    const below = backward
      ? rect.top - 36 < view.top
      : rect.bottom + 36 <= view.bottom;

    const anchorElement =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement!;

    hadSelection = true;
    select({
      target: { kind: "text", quote },
      title: quote.slice(0, 100),
      anchor: {
        x: backward ? rect.left : rect.right,
        y: below ? rect.bottom + 2 + 36 : rect.top,
      },
      anchorElement,
      range: range.cloneRange(),
    });
  };

  const release = () => {
    dragging = false;

    if (pending) update();
  };

  const listening = new AbortController();
  const { signal } = listening;
  const capture = { capture: true, signal };
  document.addEventListener("selectionchange", update, { signal });
  document.addEventListener(
    "pointerdown",
    (event) => {
      dragging = event.button === 0;
    },
    capture,
  );
  document.addEventListener("pointerup", release, capture);
  document.addEventListener("pointercancel", release, capture);

  return () => listening.abort();
}
