; Structure every JavaScript and TypeScript view shares: blocks, collections,
; imports and strings are folds whichever plugin imports this file.
; Comments are left to docstrings.scm, which folds a run of them as
; one region. These patterns set no tags; the plugins that import them tag
; what they need.
[
  (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (class_body "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (switch_body "{" @fold.open . (_) @fold.indent "}" @fold.close)
] @fold
[
  (object "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (array "[" @fold.open . (_) @fold.indent "]" @fold.close)
] @fold
(import_statement) @fold
[
  (string)
  (template_string)
] @fold

((arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
  (#match? @fold "\\n"))

((parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#match? @fold "\\n"))

(named_imports "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold

; Case labels remain outside the statement run; the colon anchors its fold.
(switch_case ":" @fold . (_) @fold @fold.indent (_)* @fold)
(switch_default ":" @fold . (_) @fold @fold.indent (_)* @fold)
