; inherits: builtin:core/queries/toml/folds.scm
((array "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold (#set! tag "context:body"))
([
  (inline_table)
  (pair)
  (string)
  (table)
  (table_array_element)
] @fold (#set! tag "context:scope"))

