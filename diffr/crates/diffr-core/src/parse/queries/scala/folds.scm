(arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(case_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(template_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(with_template_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((block_comment)+ @fold . (_))
((comment)+ @fold . (_))
((xml_comment)+ @fold . (_))
