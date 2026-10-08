(array "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(do_group "do" @fold.open . (_) @fold.indent "done" @fold.close) @fold
((comment)+ @fold . (_))
(else_clause "else" . (_) @fold @fold.indent (_)* @fold)
