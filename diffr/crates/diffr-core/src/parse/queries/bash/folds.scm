(array "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(do_group "do" @fold.open . (_) @fold.indent "done" @fold.close) @fold
((comment)+ @fold . (_))
(else_clause "else" @fold.open . (_) @fold.indent) @fold
