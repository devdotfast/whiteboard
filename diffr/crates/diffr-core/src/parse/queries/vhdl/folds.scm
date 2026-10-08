((block_comment)+ @fold . (_))
((comment_content)+ @fold . (_))
((line_comment)+ @fold . (_))
(sequential_block . (_) @fold.indent) @fold
(concurrent_block . (_) @fold.indent) @fold
