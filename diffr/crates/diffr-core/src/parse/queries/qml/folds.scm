(arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(array "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold
(class_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(object "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(switch_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
((html_comment)+ @fold . (_))
