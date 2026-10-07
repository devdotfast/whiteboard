(argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(switch_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
