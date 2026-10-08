(contract_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(function_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(struct_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(yul_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
