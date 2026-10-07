; inherits: builtin:core/queries/make/folds.scm
([
  (conditional)
  (function_call)
  (list)
  (rule)
  (string)
  (targets)
  (variable_assignment)
] @fold (#set! tag "context:scope"))

((rule) @fold (#set! tag "context:open-ended"))
