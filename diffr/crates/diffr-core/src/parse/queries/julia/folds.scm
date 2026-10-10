(argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(compound_statement "begin" @fold.open . (_) @fold.indent "end" @fold.close) @fold
((block_comment)+ @fold . (_))
((line_comment)+ @fold . (_))
(else_clause "else" @fold.open . (_) @fold.indent) @fold
(elseif_clause "elseif" @fold.open . (_) @fold.indent) @fold
(if_statement "if" @fold condition: (_) @fold.open . (_) @fold.indent "end" @fold @fold.close)
