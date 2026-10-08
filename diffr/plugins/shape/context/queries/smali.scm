; inherits: builtin:core/queries/smali/folds.scm
((list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
([
  (class_definition)
  (method_definition)
  (string)
] @fold (#set! tag "context:scope"))

