; inherits: builtin:core/queries/cmake/folds.scm
([
  (block)
  (block_command)
  (block_def)
  (endblock)
  (endblock_command)
  (foreach_loop)
  (function)
  (function_def)
  (if)
  (if_condition)
  (macro_def)
  (normal_command)
  (while)
  (while_loop)
] @fold (#set! tag "context:scope"))
((if) @fold (#set! tag "context:branches"))

