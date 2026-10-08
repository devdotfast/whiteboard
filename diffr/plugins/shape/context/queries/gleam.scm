; inherits: builtin:core/queries/gleam/folds.scm
((arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#set! tag "context:body"))
((block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
((list "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold (#set! tag "context:body"))
((tuple "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#set! tag "context:body"))
([
  (anonymous_function)
  (assert)
  (case)
  (case_clause)
  (function)
  (function_call)
  (let_assert)
  (module)
  (string)
] @fold (#set! tag "context:scope"))
((case_clause) @fold (#set! tag "context:clause"))

