(arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(compound_statement "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(match_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(switch_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
