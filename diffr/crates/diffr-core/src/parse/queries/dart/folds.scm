(arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(class_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(extension_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(switch_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
((documentation_comment)+ @fold . (_))
