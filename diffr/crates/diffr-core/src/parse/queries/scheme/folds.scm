((block_comment)+ @fold . (_))
((comment)+ @fold . (_))
(list . (symbol) @fold @fold.open . (_) @fold.indent ")" @fold @fold.close)
