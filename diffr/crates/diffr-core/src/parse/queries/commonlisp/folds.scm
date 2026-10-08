((block_comment)+ @fold . (_))
((comment)+ @fold . (_))
(list_lit . (sym_lit) @fold @fold.open . (_) @fold.indent ")" @fold @fold.close)
