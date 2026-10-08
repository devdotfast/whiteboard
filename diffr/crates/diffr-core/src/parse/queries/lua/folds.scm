(arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
((comment)+ @fold . (_))
((comment_content)+ @fold . (_))
(block . (_) @fold.indent) @fold
