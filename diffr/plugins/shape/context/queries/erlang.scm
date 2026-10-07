; inherits: builtin:core/queries/erlang/folds.scm
((list "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold (#set! tag "context:body"))
((tuple "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
([
  (call)
  (case_expr)
  (fun_decl)
  (function_clause)
  (guard)
  (if_expr)
  (list_comprehension)
  (module)
  (receive_expr)
  (string)
  (try_expr)
] @fold (#set! tag "context:scope"))

((clause_body . (_) @fold.indent) @fold (#set! tag "context:body"))
((function_clause) @fold (#set! tag "context:open-ended"))
((fun_decl) @fold (#set! tag "context:open-ended"))
((list_comprehension (lc_exprs) @fold) (#set! tag "context:relevant"))

([(case_expr) (if_expr) (receive_expr) (try_expr)] @fold (#set! tag "context:branches"))
([(cr_clause) (if_clause) (catch_clause) (fun_clause)] @fold
 (#set! tag "context:scope") (#set! tag "context:clause") (#set! tag "context:open-ended"))
