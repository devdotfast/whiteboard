; inherits: javascript.scm, builtin:core/queries/typescript/folds.scm
; Type declarations are scopes too: a change inside keeps their first and
; last line. An exported one is matched on its export, so the scope starts
; on the line with `export`, not the line after it.
(program
  [
    (interface_declaration)
    (enum_declaration)
  ] @fold
  (#set! tag "context:scope"))
(statement_block
  [
    (interface_declaration)
    (enum_declaration)
  ] @fold
  (#set! tag "context:scope"))
((export_statement declaration: [
  (interface_declaration)
  (enum_declaration)
]) @fold (#set! tag "context:scope"))

((type_alias_declaration) @fold (#set! tag "context:scope"))

([
  (interface_body "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (object_type "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close)
] @fold (#set! tag "context:body"))

((union_type) @fold (#set! tag "context:scope"))
((intersection_type) @fold (#set! tag "context:scope"))
