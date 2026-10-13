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
import { MetadataConsts } from "vs/editor/common/encodedTokenAttributes.js";
import type { ITextModel } from "vs/editor/common/model.js";
import { SparseMultilineTokens } from "vs/editor/common/tokens/sparseMultilineTokens.js";

import { StandaloneServices } from "../../standalone/browser/standaloneServices.js";
import { IStandaloneThemeService } from "../../standalone/common/standaloneTheme.js";
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
  ["attribute", "type"],
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

const SCOPES: Record<Role, string> = {
  comment: "comment",
  keyword: "keyword",
  type: "entity.name.type",
  function: "entity.name.function",
  variable: "variable.other",
  string: "string",
  number: "constant.numeric",
  constant: "constant.language",
  operator: "keyword.operator",
  heading: "markup.heading",
};

/** Model tokens also reach unified mode's removed-code view zones and copied HTML. */
export class StructuralSyntax extends Disposable {
  private readonly themes = StandaloneServices.get(IStandaloneThemeService);
  private painted: readonly StructuralSyntaxSpan[] | undefined;
  private model: ITextModel | undefined;

  constructor(
    private readonly editor: ICodeEditor,
    private readonly side: "lhs" | "rhs",
    private readonly path: () => string | undefined,
    private readonly session: StructuralDiffSession,
    onDidChangePath: Event<unknown>,
  ) {
    super();
    this._register({ dispose: () => this.clear() });
    this._register(editor.onDidChangeModel(() => this.render()));
    this._register(onDidChangePath(() => this.render()));
    this._register(
      this.themes.onDidColorThemeChange(() => {
        this.painted = undefined;
        this.render();
      }),
    );
    this._register(
      session.onDidChange((change) => {
        const path = this.path();
        if (path && change.files.has(path)) this.render();
      }),
    );
    this.render();
  }

  private clear(): void {
    if (this.model && !this.model.isDisposed())
      this.model.tokenization.setSemanticTokens(null, false);
    this.model = undefined;
    this.painted = undefined;
  }

  private render(): void {
    const model = this.editor.getModel();
    const path = this.path();
    const spans = path
      ? this.session.getTextDiff(path)?.[this.side]?.syntax
      : undefined;
    if (model !== this.model) this.clear();
    if (!model || !spans) {
      this.clear();
      return;
    }
    if (spans === this.painted) return;
    this.model = model;
    this.painted = spans;
    const theme = this.themes.getColorTheme().tokenTheme;
    const tokens: number[] = [];
    // The protocol supplies sorted, non-overlapping spans, with inner captures taking precedence.
    for (const span of spans) {
      const kind = role(span.capture);
      if (!kind || span.line >= model.getLineCount()) continue;
      const text = model.getLineContent(span.line + 1);
      const metadata = theme.match(0, SCOPES[kind]);
      tokens.push(
        span.line,
        utf16Column(text, span.start_column) - 1,
        utf16Column(text, span.end_column) - 1,
        (metadata &
          (MetadataConsts.FOREGROUND_MASK | MetadataConsts.FONT_STYLE_MASK)) |
          MetadataConsts.SEMANTIC_USE_FOREGROUND |
          MetadataConsts.SEMANTIC_USE_ITALIC |
          MetadataConsts.SEMANTIC_USE_BOLD |
          MetadataConsts.SEMANTIC_USE_UNDERLINE |
          MetadataConsts.SEMANTIC_USE_STRIKETHROUGH,
      );
    }
    model.tokenization.setSemanticTokens(
      tokens.length
        ? [SparseMultilineTokens.create(1, new Uint32Array(tokens))]
        : [],
      true,
    );
  }
}
