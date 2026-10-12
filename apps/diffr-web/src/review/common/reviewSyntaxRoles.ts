/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// diffr's highlight captures, named by the Whiteboard theme's roles (extensions/review-themes).
export type SyntaxRole =
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
const RULES: readonly (readonly [string, SyntaxRole])[] = [
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

export function syntaxRole(capture: string): SyntaxRole | undefined {
  for (const [prefix, role] of RULES) {
    if (capture === prefix || capture.startsWith(prefix + ".")) return role;
  }
  return undefined;
}

/** The theme scope whose colour paints each role. */
export const SYNTAX_SCOPES: Record<SyntaxRole, string> = {
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
