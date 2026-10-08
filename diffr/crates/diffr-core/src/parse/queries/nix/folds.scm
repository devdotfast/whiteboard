(attrset_expression "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(rec_attrset_expression "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
