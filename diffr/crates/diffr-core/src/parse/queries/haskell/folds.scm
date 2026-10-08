((comment)+ @fold . (_))
(list "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold

(match "->" @fold.open expression: (_) @fold.indent) @fold
