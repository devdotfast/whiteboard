(arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(list "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold
(tuple "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
((comment)+ @fold . (_))
((module_comment)+ @fold . (_))
((statement_comment)+ @fold . (_))
