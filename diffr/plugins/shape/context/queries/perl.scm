; inherits: builtin:core/queries/perl/folds.scm
([
  (assignment_expression)
  (conditional_expression)
  (for_statement)
  (function)
  (loop_statement)
  (return_expression)
  (string_literal)
  (subroutine_declaration_statement)
  (try_statement)
  (variable_declaration)
] @fold (#set! tag "context:scope"))
((try_statement) @fold (#set! tag "context:branches"))

((conditional_statement) @fold (#set! tag "context:branches"))
((conditional_statement) @fold (#set! tag "context:scope"))

((else "else" @fold.open . (_) @fold.indent) @fold (#set! tag "context:body"))
((block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
