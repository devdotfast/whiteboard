; Structure every Python view shares: blocks, collections, imports, comments
; and strings are folds whichever plugin imports this file. These patterns
; set no tags; the plugins that import them tag what they need.
;
; A block folds from the `:` that opens it, so its fold starts on the
; header line, as a Rust body folds from its `{`. A plugin that tags a block
; must capture the same `:` or its fold range conflicts with this one.
[
  (function_definition ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (class_definition ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (if_statement ":" @fold.open consequence: (block . (_) @fold.indent) @fold)
  (elif_clause ":" @fold.open consequence: (block . (_) @fold.indent) @fold)
  (else_clause ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (for_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (while_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (with_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (try_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (except_clause ":" @fold.open (block . (_) @fold.indent) @fold)
  (finally_clause ":" @fold.open (block . (_) @fold.indent) @fold)
  (match_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (case_clause ":" @fold.open consequence: (block . (_) @fold.indent) @fold)
]
[
  (list "[" @fold.open . (_) @fold.indent "]" @fold.close)
  (dictionary "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (set "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (tuple . "(" @fold.open . (_) @fold.indent ")" @fold.close)
] @fold
((tuple) @fold (#not-match? @fold "^\\("))
[
  (import_statement)
  (import_from_statement)
] @fold
; A comment run above code is one fold.
((comment)+ @fold
  .
  (_))
(string) @fold

((argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
  (#match? @fold "\\n"))

((parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#match? @fold "\\n"))

(import_from_statement module_name: (_) @fold "(" @fold.open . (_) @fold.indent ")" @fold @fold.close)
