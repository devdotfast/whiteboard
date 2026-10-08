; inherits: builtin:core/queries/nix/folds.scm
((attrset_expression "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
((rec_attrset_expression "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
([
  (binding)
  (function_expression)
  (if_expression)
  (indented_string_expression)
  (let_expression)
  (list_expression)
  (string_expression)
  (with_expression)
] @fold (#set! tag "context:scope"))
((if_expression) @fold (#set! tag "context:branches"))

