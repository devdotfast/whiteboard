; inherits: builtin:core/queries/r/folds.scm
([
  (call)
  (for_statement)
  (function_definition)
  (if_statement)
  (repeat_statement)
  (string)
  (while_statement)
] @fold (#set! tag "context:scope"))
((if_statement) @fold (#set! tag "context:branches"))

((braced_expression "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))

