((comment)+ @fold . (_))
(else_clause "else" @fold.open . (_) @fold.indent) @fold
(if_statement . (command) @fold @fold.open . (_) @fold.indent "end" @fold @fold.close)
