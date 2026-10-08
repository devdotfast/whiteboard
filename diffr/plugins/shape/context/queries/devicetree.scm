; inherits: builtin:core/queries/devicetree/folds.scm
((argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#set! tag "context:body"))
([
  (call_expression)
  (conditional_expression)
  (node)
  (preproc_function_def)
  (property)
  (string_literal)
] @fold (#set! tag "context:scope"))

((property) @fold (#set! tag "context:open-ended"))
