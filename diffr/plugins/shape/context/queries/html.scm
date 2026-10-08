; inherits: builtin:core/queries/html/folds.scm
([
  (script_element)
  (self_closing_tag)
  (style_element)
] @fold (#set! tag "context:scope"))

((element (start_tag) @fold @fold.open . (_) @fold.indent (end_tag) @fold @fold.close) (#set! tag "context:body"))
((element) @fold (#set! tag "context:scope"))
