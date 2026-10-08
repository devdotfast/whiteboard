(argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(compound_statement "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(field_declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(initializer_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
