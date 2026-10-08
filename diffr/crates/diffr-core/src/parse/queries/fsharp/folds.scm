((block_comment)+ @fold . (_))
((block_comment_content)+ @fold . (_))
((line_comment)+ @fold . (_))
(sequential_expression . (_) @fold.indent) @fold

(rule "->" @fold.open block: [(application_expression) (long_identifier_or_op)] @fold @fold.indent)
