((comment)+ @fold . (_))
(else "else" @fold.open . (_) @fold.indent) @fold
(block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
