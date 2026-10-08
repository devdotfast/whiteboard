; inherits: builtin:core/queries/proto/folds.scm
((enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
((message_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
([
  (enum)
  (message)
  (oneof)
  (rpc)
  (service)
  (string)
] @fold (#set! tag "context:scope"))

