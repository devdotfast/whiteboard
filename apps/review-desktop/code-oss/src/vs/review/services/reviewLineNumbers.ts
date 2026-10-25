/*---------------------------------------------------------------------------------------------
 * Copyright (c) dev.fast. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from "../../base/common/event.js";
import { Disposable } from "../../base/common/lifecycle.js";
import type { ICodeEditor } from "../../editor/browser/editorBrowser.js";
import { Range } from "../../editor/common/core/range.js";
import { InjectedTextCursorStops } from "../../editor/common/model.js";
import {
  ConfigurationTarget,
  IConfigurationService,
} from "../../platform/configuration/common/configuration.js";
import { REVIEW_INLINE_LINE_NUMBERS_SETTING } from "../common/reviewConfigurationDefaults.js";

/** One user preference shared by document diffs and peeks, excluding the Diff view. */
export class ReviewLineNumbersSetting extends Disposable {
  private readonly changed = this._register(new Emitter<boolean>());
  readonly onDidChange = this.changed.event;
  constructor(
    @IConfigurationService
    private readonly configuration: IConfigurationService,
  ) {
    super();
    this._register(
      configuration.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(REVIEW_INLINE_LINE_NUMBERS_SETTING))
          this.changed.fire(this.get());
      }),
    );
  }
  get(): boolean {
    return (
      this.configuration.getValue<boolean>(
        REVIEW_INLINE_LINE_NUMBERS_SETTING,
      ) === true
    );
  }
  set(show: boolean): Promise<void> {
    return this.configuration.updateValue(
      REVIEW_INLINE_LINE_NUMBERS_SETTING,
      show,
      ConfigurationTarget.USER,
    );
  }
}

/** Source-model coordinates, including Monaco's end-exclusive whole-line selections. */
export function selectedSourceLines(
  range: Range | null,
): { first: number; last: number; label: string } | undefined {
  if (!range || range.isEmpty()) return undefined;
  const first = range.startLineNumber;
  const last =
    range.endLineNumber > first && range.endColumn === 1
      ? range.endLineNumber - 1
      : range.endLineNumber;
  return {
    first,
    last,
    label:
      first === last
        ? `selected · line ${first}`
        : `selected · lines ${first}–${last}`,
  };
}

/** A selection annotation owned by the editor, never copied into the source text. */
export class InlineLineNumbers extends Disposable {
  private static readonly controllers = new WeakMap<
    ICodeEditor,
    InlineLineNumbers
  >();
  static hasSelectionHint(editor: ICodeEditor): boolean {
    const owner = this.controllers.get(editor);
    return (
      owner !== undefined &&
      !owner.setting.get() &&
      editor.getSelections()?.length === 1 &&
      !editor.getSelection()?.isEmpty()
    );
  }
  private readonly decorations = this.editor.createDecorationsCollection();
  constructor(
    private readonly editor: ICodeEditor,
    private readonly setting: ReviewLineNumbersSetting,
  ) {
    super();
    InlineLineNumbers.controllers.set(editor, this);
    const apply = () => {
      editor.updateOptions({ lineNumbers: setting.get() ? "on" : "off" });
      this.render();
    };
    this._register(setting.onDidChange(apply));
    this._register(editor.onDidChangeCursorSelection(() => this.render()));
    this._register(editor.onDidChangeModel(() => this.render()));
    this._register(editor.onDidChangeModelContent(() => this.render()));
    this._register({
      dispose: () => {
        this.decorations.clear();
        if (InlineLineNumbers.controllers.get(editor) === this)
          InlineLineNumbers.controllers.delete(editor);
      },
    });
    apply();
  }
  private render(): void {
    const model = this.editor.getModel();
    const selections = this.editor.getSelections();
    // A single range has unambiguous coordinates. Multiple cursors keep their
    // normal selections without presenting a misleading enclosing range.
    const selected =
      selections?.length === 1 ? selectedSourceLines(selections[0]) : undefined;
    if (
      !model ||
      this.setting.get() ||
      !selected ||
      selected.last > model.getLineCount()
    ) {
      this.decorations.clear();
      return;
    }
    const end = model.getLineMaxColumn(selected.first);
    this.decorations.set([
      {
        range: new Range(selected.first, end, selected.first, end),
        options: {
          description: "review-selection-hint",
          showIfCollapsed: true,
          after: {
            content: selected.label,
            inlineClassName: "review-selection-hint",
            cursorStops: InjectedTextCursorStops.None,
          },
        },
      },
    ]);
  }
}
