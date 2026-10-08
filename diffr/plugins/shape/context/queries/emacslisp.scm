; inherits: builtin:core/queries/emacslisp/folds.scm
([
  (function_definition)
  (function_quote)
  (macro_definition)
  (quote)
  (special_form)
  (string)
] @fold (#set! tag "context:scope"))

((list . (symbol) @_head . (list) @fold (#match? @_head "^(let|let\\*|letrec|with-open|defn|defun|define|lambda)$")) (#set! tag "context:relevant"))
((list . (symbol) @_head . (list (list) @fold) (#match? @_head "^(let|let\\*|letrec|with-open)$")) (#set! tag "context:relevant"))
((function_definition) @fold (#set! tag "context:open-ended"))
((special_form) @fold (#set! tag "context:open-ended"))
((list . (symbol) @fold @fold.open . (_) @fold.indent ")" @fold @fold.close) (#set! tag "context:body"))
((special_form "let" . (list) @fold) (#set! tag "context:relevant"))
((special_form "let" . (list (list) @fold)) (#set! tag "context:relevant"))
