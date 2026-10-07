(annotation_type_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(class_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(constructor_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(interface_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(module_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(record_pattern_body "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
(switch_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((block_comment)+ @fold . (_))
((line_comment)+ @fold . (_))
