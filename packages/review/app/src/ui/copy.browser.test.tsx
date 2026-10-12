import { afterEach, expect, it, vi } from "vitest";

import { copyText } from "./copy";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("copies without moving the page or the selection, as Copy ref does in an editor", async () => {
  // A board scrolled deep, the person's selection in a paragraph there, and
  // the editor focused.
  const scroller = document.createElement("div");
  scroller.style.cssText =
    "position: relative; height: 400px; overflow-y: auto;";
  const editor = document.createElement("div");
  editor.contentEditable = "true";

  for (let index = 1; index <= 60; index++) {
    const paragraph = document.createElement("p");
    paragraph.textContent = `Paragraph ${index} has some words to select.`;
    editor.append(paragraph);
  }

  scroller.append(editor);
  document.body.append(scroller);
  const paragraph = editor.children[44]!;
  scroller.scrollTop = (paragraph as HTMLElement).offsetTop - 150;
  const top = scroller.scrollTop;

  expect(top).toBeGreaterThan(200);
  editor.focus({ preventScroll: true });
  const range = document.createRange();
  const words = paragraph.firstChild!;
  range.setStart(words, "Paragraph 45 has ".length);
  range.setEnd(words, "Paragraph 45 has some words".length);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);

  // Desktop's workbench denies the Clipboard API, so the copy falls back.
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("denied"),
  );

  await copyText("> some words");

  expect(Math.abs(scroller.scrollTop - top)).toBeLessThanOrEqual(1);
  expect(document.activeElement).toBe(editor);
  expect(document.getSelection()!.toString()).toBe("some words");
});
