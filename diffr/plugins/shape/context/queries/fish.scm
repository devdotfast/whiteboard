; inherits: builtin:core/queries/fish/folds.scm
([
  (case_clause)
  (else_if_clause)
  (for_statement)
  (function_definition)
  (switch_statement)
  (while_statement)
] @fold (#set! tag "context:scope"))
([
  (else_if_clause)
  (if_statement)
  (switch_statement)
] @fold (#set! tag "context:branches"))
([
  (case_clause)
  (else_if_clause)
] @fold (#set! tag "context:clause"))

((else_clause "else" @fold.open . (_) @fold.indent) @fold (#set! tag "context:body"))
((if_statement . (command) @fold @fold.open . (_) @fold.indent "end" @fold @fold.close) (#set! tag "context:body"))
((if_statement . (command) @fold @fold.open . (_) @fold.indent "end" @fold @fold.close) (#set! tag "context:branches"))
