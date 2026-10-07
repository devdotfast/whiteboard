; inherits: javascript.scm, builtin:core/queries/jsx/folds.scm
((jsx_element
 open_tag: (jsx_opening_element) @fold @fold.open
 . (_) @fold.indent
 close_tag: (jsx_closing_element) @fold @fold.close) (#set! tag "context:body"))
([(jsx_element) (jsx_self_closing_element) (jsx_attribute)] @fold (#set! tag "context:scope"))

(jsx_element (jsx_expression) @fold (#set! tag "context:scope"))
(jsx_self_closing_element (jsx_expression) @fold (#set! tag "context:scope"))

((ternary_expression) @fold (#set! tag "context:branches"))
(ternary_expression consequence: (parenthesized_expression (jsx_element) @fold) (#set! tag "context:clause"))
(ternary_expression alternative: (parenthesized_expression (jsx_element) @fold) (#set! tag "context:clause"))
