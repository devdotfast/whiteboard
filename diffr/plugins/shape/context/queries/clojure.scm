; inherits: builtin:core/queries/clojure/folds.scm
([
  (map_lit)
  (quoting_lit)
  (set_lit)
  (vec_lit)
] @fold (#set! tag "context:scope"))

((list_lit . (sym_lit) @_head . (vec_lit) @fold (#match? @_head "^(let|let\\*|letrec|with-open|defn|defun|define|lambda)$")) (#set! tag "context:relevant"))
((list_lit . (sym_lit) @_head . (vec_lit (list_lit) @fold) (#match? @_head "^(let|let\\*|letrec|with-open)$")) (#set! tag "context:relevant"))
((list_lit . (sym_lit) @fold @fold.open . (_) @fold.indent ")" @fold @fold.close) (#set! tag "context:body"))
((list_lit) @fold (#set! tag "context:scope"))
