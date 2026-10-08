; inherits: builtin:core/queries/elixir/folds.scm
((block "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#set! tag "context:body"))
((list "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold (#set! tag "context:body"))
((map "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
((tuple "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
([
  (anonymous_function)
  (call)
  (pair)
  (stab_clause)
  (string)
] @fold (#set! tag "context:scope"))

((do_block "do" @fold.open . (_) @fold.indent "end" @fold.close) @fold (#set! tag "context:body"))

; Only control-flow calls expose sibling clause heads.
((call target: (identifier) @_control) @fold (#match? @_control "^(case|cond|receive|try|if|unless)$") (#set! tag "context:branches"))
((anonymous_function) @fold (#set! tag "context:branches"))
((stab_clause) @fold (#set! tag "context:clause") (#set! tag "context:open-ended"))

((body . (_) @fold.indent) @fold (#set! tag "context:body"))
