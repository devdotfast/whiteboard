; inherits: builtin:core/queries/scheme/folds.scm
([
  (quasiquote)
  (quote)
  (string)
] @fold (#set! tag "context:scope"))

((list . (symbol) @_head . (list) @fold (#match? @_head "^(let|let\\*|letrec|with-open|defn|defun|define|lambda)$")) (#set! tag "context:relevant"))
((list . (symbol) @_head . (list (list) @fold) (#match? @_head "^(let|let\\*|letrec|with-open)$")) (#set! tag "context:relevant"))
((list . (symbol) @fold @fold.open . (_) @fold.indent ")" @fold @fold.close) (#set! tag "context:body"))
((list) @fold (#set! tag "context:scope"))
