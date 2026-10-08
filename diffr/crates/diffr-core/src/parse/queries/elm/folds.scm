((block_comment)+ @fold . (_))
((line_comment)+ @fold . (_))
(list_expr "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold

(case_of_branch (arrow) @fold expr: (_) @fold @fold.indent)
