; inherits: builtin:core/queries/bash/folds.scm
((array "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#set! tag "context:body"))
((do_group "do" @fold.open . (_) @fold.indent "done" @fold.close) @fold (#set! tag "context:body"))
([
  (case_item)
  (case_statement)
  (elif_clause)
  (file_redirect)
  (for_statement)
  (function_definition)
  (heredoc_body)
  (if_statement)
  (list)
  (pipeline)
  (process_substitution)
  (redirected_statement)
  (string)
  (while_statement)
] @fold (#set! tag "context:scope"))
([
  (case_statement)
  (elif_clause)
  (if_statement)
] @fold (#set! tag "context:branches"))
([
  (case_item)
  (case_statement)
  (elif_clause)
  (else_clause)
] @fold (#set! tag "context:clause"))

((else_clause "else" . (_) @fold @fold.indent (_)* @fold) (#set! tag "context:body"))

((else_clause) @fold (#set! tag "context:scope"))
