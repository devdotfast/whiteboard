; inherits: builtin:core/queries/hcl/folds.scm
([
  (attribute)
  (block)
  (block_end)
  (block_start)
  (conditional)
  (function_call)
  (heredoc_template)
  (literal_value)
] @fold (#set! tag "context:scope"))

((tuple (tuple_start) @fold.open . (_) @fold.indent (tuple_end) @fold.close) @fold (#set! tag "context:body"))
((object (object_start) @fold.open . (_) @fold.indent (object_end) @fold.close) @fold (#set! tag "context:body"))
