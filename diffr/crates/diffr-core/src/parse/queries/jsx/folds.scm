; inherits: ../javascript/folds.scm
(jsx_element
 open_tag: (jsx_opening_element) @fold @fold.open
 . (_) @fold.indent
 close_tag: (jsx_closing_element) @fold @fold.close)
(jsx_element) @fold
(jsx_self_closing_element) @fold
