(constraint_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(cross_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(generate_block "begin" @fold.open . (_) @fold.indent "end" @fold.close) @fold
(seq_block "begin" @fold.open . (_) @fold.indent "end" @fold.close) @fold
((comment)+ @fold . (_))
