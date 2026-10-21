import assert from "node:assert/strict";
import { test } from "node:test";

import { Emitter } from "../../base/common/event.js";
import { Range } from "../../editor/common/core/range.js";
import { Selection } from "../../editor/common/core/selection.js";
import {
  InlineLineNumbers,
  ReviewLineNumbersSetting,
  selectedSourceLines,
} from "./reviewLineNumbers.js";

test("selection coordinates exclude the trailing unselected line and normalize backwards ranges", () => {
  assert.equal(selectedSourceLines(new Range(9, 1, 9, 1)), undefined);
  assert.equal(
    selectedSourceLines(new Range(98, 2, 101, 1))?.label,
    "selected · lines 98–100",
  );
  assert.equal(
    selectedSourceLines(new Selection(100, 5, 98, 2))?.label,
    "selected · lines 98–100",
  );
  assert.equal(
    selectedSourceLines(new Range(98, 1, 99, 1))?.label,
    "selected · line 98",
  );
});

test("inline preference updates all editors, clears annotations, and unsubscribes on disposal", async () => {
  let value = false;
  const configurationChanged = new Emitter<{
    affectsConfiguration(key: string): boolean;
  }>();
  const setting = new ReviewLineNumbersSetting({
    getValue: () => value,
    onDidChangeConfiguration: configurationChanged.event,
    updateValue: async (_key: string, next: boolean) => {
      value = next;
      configurationChanged.fire({ affectsConfiguration: () => true });
    },
  } as never);
  const selectionChanged = new Emitter<void>();
  const modelChanged = new Emitter<void>();
  let selection = new Selection(98, 2, 100, 7);
  let model: {
    getLineMaxColumn(line: number): number;
    getLineCount(): number;
  } | null = { getLineMaxColumn: () => 20, getLineCount: () => 200 };
  const rendered: unknown[][] = [];
  const options: string[] = [];
  const editor = {
    createDecorationsCollection: () => ({
      set: (items: unknown[]) => rendered.push(items),
      clear: () => rendered.push([]),
    }),
    updateOptions: (next: { lineNumbers: string }) =>
      options.push(next.lineNumbers),
    onDidChangeCursorSelection: selectionChanged.event,
    onDidChangeModel: modelChanged.event,
    onDidChangeModelContent: new Emitter<void>().event,
    getModel: () => model,
    getSelections: () => [selection],
    getSelection: () => selection,
  };
  const first = new InlineLineNumbers(editor as never, setting);
  const second = new InlineLineNumbers({ ...editor } as never, setting);
  assert.equal(InlineLineNumbers.hasSelectionHint(editor as never), true);
  assert.equal(options.at(-1), "off");
  assert.match(JSON.stringify(rendered.at(-1)), /selected · lines 98–100/);
  await setting.set(true);
  assert.deepEqual(options.slice(-2), ["on", "on"]);
  assert.deepEqual(rendered.at(-1), []);
  assert.equal(InlineLineNumbers.hasSelectionHint(editor as never), false);
  await setting.set(false);
  selection = new Selection(98, 1, 98, 1);
  selectionChanged.fire();
  assert.deepEqual(rendered.at(-1), []);
  selection = new Selection(300, 1, 301, 1);
  selectionChanged.fire();
  assert.deepEqual(rendered.at(-1), []);
  model = null;
  modelChanged.fire();
  first.dispose();
  second.dispose();
  const count = options.length;
  await setting.set(true);
  assert.equal(options.length, count);
  setting.dispose();
  configurationChanged.dispose();
  selectionChanged.dispose();
  modelChanged.dispose();
});
