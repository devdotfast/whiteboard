; Structure every Go view shares: blocks, literals, imports and strings are
; folds whichever plugin imports this file. Comments are left to
; docstrings.scm, which folds a run of them as one region. These patterns
; set no tags; the plugins that import them tag what they need.
; gofmt outdents labels, so a labelled statement gives the indent.
((block "{" @fold.open (statement_list . [
    (labeled_statement (label_name) . (_) @fold.indent)
    (_) @fold.indent
  ]) "}" @fold.close) @fold
  (#not-match? @fold.indent "^[A-Za-z_][A-Za-z0-9_]*:\\s*\n"))
(field_declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(literal_value "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(import_declaration) @fold
[
  (raw_string_literal)
  (interpreted_string_literal)
] @fold

((argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
  (#match? @fold "\\n"))

((parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#match? @fold "\\n"))

(import_spec_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold

(interface_type "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
