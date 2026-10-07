; inherits: builtin:core/queries/janet/folds.scm
([
  (quote_lit)
  (sqr_tup_lit)
  (str_lit)
] @fold (#set! tag "context:scope"))

((par_tup_lit . (sym_lit) @_head . (sqr_tup_lit) @fold (#match? @_head "^(let|let\\*|letrec|with-open|defn|defun|define|lambda)$")) (#set! tag "context:relevant"))
((par_tup_lit . (sym_lit) @_head . (sqr_tup_lit (par_tup_lit) @fold) (#match? @_head "^(let|let\\*|letrec|with-open)$")) (#set! tag "context:relevant"))
((par_tup_lit . (sym_lit) @fold @fold.open . (_) @fold.indent ")" @fold @fold.close) (#set! tag "context:body"))
