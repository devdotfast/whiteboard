; inherits: builtin:core/queries/elm/folds.scm
([
  (case_of_expr)
  (function_call_expr)
  (if_else_expr)
  (import_clause)
  (let_in_expr)
  (module)
  (module_declaration)
  (record_expr)
  (tuple_expr)
  (type_declaration)
  (value_declaration)
] @fold (#set! tag "context:scope"))

((let_in_expr valueDeclaration: (value_declaration) @fold) (#set! tag "context:relevant"))
((list_expr "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold (#set! tag "context:body"))

([(case_of_expr) (if_else_expr)] @fold (#set! tag "context:branches"))
((case_of_branch) @fold (#set! tag "context:scope") (#set! tag "context:clause") (#set! tag "context:open-ended"))

((case_of_branch (arrow) @fold expr: (_) @fold @fold.indent) (#set! tag "context:body"))
