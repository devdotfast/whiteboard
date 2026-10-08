; inherits: builtin:core/queries/fsharp/folds.scm
([
  (array_expression)
  (field_initializer)
  (for_expression)
  (function_expression)
  (function_or_value_defn)
  (if_expression)
  (match_expression)
  (rule)
  (string)
  (try_expression)
  (tuple_expression)
  (type_declaration)
  (while_expression)
] @fold (#set! tag "context:scope"))
([
  (if_expression)
  (match_expression)
  (try_expression)
] @fold (#set! tag "context:branches"))

((sequential_expression . (_) @fold.indent) @fold (#set! tag "context:body"))

((rule) @fold (#set! tag "context:clause") (#set! tag "context:open-ended"))

((rule "->" @fold.open block: [(application_expression) (long_identifier_or_op)] @fold @fold.indent) (#set! tag "context:body"))
([(match_expression) (function_or_value_defn)] @fold (#set! tag "context:open-ended"))
