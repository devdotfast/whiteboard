(argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
((comment)+ @fold . (_))
((inline_preproc_comment)+ @fold . (_))
((multiline_preproc_comment)+ @fold . (_))
(else_clause "else" @fold.open . (_) @fold.indent) @fold
(if_statement (parenthesized_expression) @fold "then" @fold.open . (_) @fold.indent (end_if_statement) @fold @fold.close)
