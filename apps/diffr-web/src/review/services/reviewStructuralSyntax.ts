/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// Review Desktop colours code with its TextMate grammars. The page has none:
// diffr already parsed each side, so its highlight captures paint the text,
// in the Whiteboard theme's roles (extensions/review-themes).
import type { Event } from "vs/base/common/event.js";
import { Disposable } from "vs/base/common/lifecycle.js";
import type { ICodeEditor } from "vs/editor/browser/editorBrowser.js";
import { Range } from "vs/editor/common/core/range.js";
import type { IModelDeltaDecoration } from "vs/editor/common/model.js";

import {
  utf16Column,
  type StructuralSyntaxSpan,
} from "../common/reviewStructuralDiff.js";
import type { StructuralDiffSession } from "./reviewStructuralDiffSession.js";

type Role =
  | "comment"
  | "keyword"
  | "type"
  | "function"
  | "variable"
  | "string"
  | "number"
  | "constant"
  | "operator"
  | "heading";

/** Most specific first: a capture takes the first rule its dotted name starts with. */
const RULES: readonly (readonly [string, Role])[] = [
  ["comment", "comment"],
  ["string.special.symbol", "constant"],
  ["string", "string"],
  ["character", "string"],
  ["escape", "number"],
  ["number", "number"],
  ["float", "number"],
  ["boolean", "constant"],
  ["constant.builtin", "constant"],
  ["constant", "constant"],
  ["keyword.operator", "operator"],
  ["keyword", "keyword"],
  ["conditional", "keyword"],
  ["repeat", "keyword"],
  ["include", "keyword"],
  ["exception", "keyword"],
  ["storageclass", "keyword"],
  ["preproc", "keyword"],
  ["define", "keyword"],
  ["operator", "operator"],
  ["punctuation", "operator"],
  ["variable.builtin", "keyword"],
  ["variable", "variable"],
  ["property", "variable"],
  ["field", "variable"],
  ["label", "variable"],
  ["function", "function"],
  ["method", "function"],
  ["attribute", "function"],
  ["constructor", "type"],
  ["type", "type"],
  ["module", "type"],
  ["namespace", "type"],
  ["tag", "type"],
  ["markup.heading", "heading"],
  ["text.title", "heading"],
];

function role(capture: string): Role | undefined {
  for (const [prefix, role] of RULES) {
    if (capture === prefix || capture.startsWith(prefix + ".")) return role;
  }
  return undefined;
}

/** Paints one side of a structural diff editor with diffr's highlight captures. */
export class StructuralSyntax extends Disposable {
  private readonly decorations = this.editor.createDecorationsCollection();
  private painted: readonly StructuralSyntaxSpan[] | undefined;

  constructor(
    private readonly editor: ICodeEditor,
    private readonly side: "lhs" | "rhs",
    private readonly path: () => string | undefined,
    private readonly session: StructuralDiffSession,
    /** The diff editor's model is set after its sides', and only it names the file. */
    onDidChangePath: Event<unknown>,
  ) {
    super();
    this._register({ dispose: () => this.decorations.clear() });
    this._register(editor.onDidChangeModel(() => this.render()));
    this._register(onDidChangePath(() => this.render()));
    this._register(
      session.onDidChange((change) => {
        const path = this.path();
        if (path && change.files.has(path)) this.render();
      }),
    );
    this.render();
  }

  private render(): void {
    const model = this.editor.getModel();
    const path = this.path();
    const source = path
      ? this.session.getTextDiff(path)?.[this.side]
      : undefined;
    const spans = source?.syntax;
    if (!model || !spans) {
      this.painted = undefined;
      this.decorations.clear();
      return;
    }
    if (spans === this.painted) return;
    this.painted = spans;
    const lines = model.getLinesContent();
    const decorations: IModelDeltaDecoration[] = [];
    for (const span of spans) {
      const kind = role(span.capture);
      const text = lines[span.line];
      if (!kind || text === undefined) continue;
      decorations.push({
        range: new Range(
          span.line + 1,
          utf16Column(text, span.start_column),
          span.line + 1,
          utf16Column(text, span.end_column),
        ),
        options: {
          description: "diffr-syntax",
          inlineClassName: `diffr-syntax-${kind}`,
        },
      });
    }
    this.decorations.set(decorations);
  }
}
