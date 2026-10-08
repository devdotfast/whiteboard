; inherits: builtin:core/queries/css/folds.scm
((block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
([
  (call_expression)
  (declaration)
  (keyframe_block)
  (keyframes_statement)
  (media_statement)
  (rule_set)
  (scope_statement)
  (supports_statement)
] @fold (#set! tag "context:scope"))

