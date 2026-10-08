; Structure every Rust view shares: bodies, collections, imports, block
; comments and strings are folds whichever plugin imports this file. These
; patterns set no tags; the plugins that import them tag what they need.
[
  (block "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (field_declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (match_block "{" @fold.open . (_) @fold.indent "}" @fold.close)
] @fold
[
  (array_expression "[" @fold.open . (_) @fold.indent "]" @fold.close)
  (field_initializer_list "{" @fold.open . (_) @fold.indent "}" @fold.close)
] @fold
(use_declaration) @fold
; A comment run above code is one fold.
([(line_comment) (block_comment)]+ @fold
  .
  (_))
[
  (string_literal)
  (raw_string_literal)
] @fold

((arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
  (#match? @fold "\\n"))

((parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#match? @fold "\\n"))

(use_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold

[
 (token_tree "(" @fold.open . (_) @fold.indent ")" @fold.close)
 (token_tree "{" @fold.open . (_) @fold.indent "}" @fold.close)
 (token_tree "[" @fold.open . (_) @fold.indent "]" @fold.close)
] @fold

(enum_variant_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(ordered_field_declaration_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
