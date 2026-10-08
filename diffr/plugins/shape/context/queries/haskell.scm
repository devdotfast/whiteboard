; inherits: builtin:core/queries/haskell/folds.scm
([
  (alternative)
  (bind)
  (case)
  (conditional)
  (function)
  (guards)
  (import)
  (lambda)
  (let_in)
  (list_comprehension)
  (local_binds)
  (module)
  (string)
  (tuple)
] @fold (#set! tag "context:scope"))

((let_in binds: (local_binds) @fold) (#set! tag "context:relevant"))
((let_in binds: (local_binds (bind) @fold)) (#set! tag "context:relevant"))
((list_comprehension (qualifiers) @fold) (#set! tag "context:relevant"))
((list "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold (#set! tag "context:body"))

([(case) (conditional)] @fold (#set! tag "context:branches"))
((alternative) @fold (#set! tag "context:clause") (#set! tag "context:open-ended"))

((match "->" @fold.open expression: (_) @fold.indent) @fold (#set! tag "context:body"))
((match "=" @fold.open expression: (apply) @fold @fold.indent) (#set! tag "context:body"))
