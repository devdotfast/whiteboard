(list "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold
(tuple "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
(clause_body . (_) @fold.indent) @fold
