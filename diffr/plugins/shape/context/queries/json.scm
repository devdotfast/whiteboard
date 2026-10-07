; inherits: builtin:core/queries/json/folds.scm
((array "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold (#set! tag "context:body"))
((object "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
([
  (pair)
  (string)
] @fold (#set! tag "context:scope"))

