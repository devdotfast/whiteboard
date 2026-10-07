(block "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(list "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold
(map "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(tuple "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))

(body . (_) @fold.indent) @fold
