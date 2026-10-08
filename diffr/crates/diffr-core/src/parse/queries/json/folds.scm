(array "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold
(object "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
