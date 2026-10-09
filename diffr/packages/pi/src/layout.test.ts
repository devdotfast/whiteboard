import { expect, test } from "vitest";
import { mountPane } from "./layout";
import { host } from "../test/host";

const component = () => ({ render: () => ["DIFF"], invalidate() {} });

test("dock open, resize, and close preserve native editor and expanded paste contents", async () => {
  const h = host();
  const patch = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  h.ui.pasteToEditor(patch);
  const before = h.ui.getEditorText();
  expect(h.editor.getText()).toContain("[paste #");
  const editor = h.editor;
  const pane = mountPane(h.ui, component, false, false);
  expect(h.ui.getEditorText()).toBe(before);
  await pane.toggle();
  pane.focusChat();
  h.input(" still typing");
  expect(h.ui.getEditorText()).toContain(" still typing");
  const after = h.ui.getEditorText();
  pane.dispose();
  expect(h.editor).toBe(editor);
  expect(h.widget).toBeUndefined();
  expect(h.ui.getEditorText()).toBe(after);
  expect(h.submitted).toBe(0);
});

test("review keys and picker cancellation stay out of the native draft", () => {
  const h = host();
  const keys: string[] = [];
  const pane = mountPane(h.ui, () => ({ ...component(), handleInput(data) { keys.push(data); } }), false, false);
  h.input("hello");
  pane.focus();
  h.input("j"); h.input("\x10"); h.input("\x03");
  expect(keys).toEqual(["j", "\x10", "\x03"]);
  expect(h.ui.getEditorText()).toContain("hello");
  h.input("\x1b"); h.input(" after review");
  expect(h.ui.getEditorText()).toContain("hello after review");
  expect(h.submitted).toBe(0);
  pane.dispose();
});

test("another extension's overlay receives input without Diffr interception", () => {
  const h = host();
  const keys: string[] = [];
  const pane = mountPane(h.ui, () => ({ ...component(), handleInput(data) { keys.push(data); } }), false, true);
  h.overlay = true;
  h.input("q");
  expect(keys).toEqual([]);
  h.overlay = false;
  h.input("z");
  expect(keys).toEqual([]);
  pane.dispose();
});
