(array "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold
(list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
((comment)+ @fold . (_))
((comment_statement)+ @fold . (_))
(select_expression . (_) @fold.indent) @fold

(function_body (keyword_begin) @fold.open . (_) @fold.indent (keyword_end) @fold.close) @fold
(function_body (keyword_as) (dollar_quote) @fold.open . [(statement) (keyword_return)] @fold.indent (dollar_quote) @fold.close) @fold
