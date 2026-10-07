(array "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold
(begin_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(end_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(hash "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
(body_statement . (_) @fold.indent) @fold
(then . (_) @fold.indent) @fold
(do . (_) @fold.indent) @fold
(else "else" @fold.open . (_) @fold.indent) @fold
(elsif "elsif" @fold.open . (_) @fold.indent) @fold
