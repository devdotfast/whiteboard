(class_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(deprecated_operator_declaration_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(enum_class_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(function_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(protocol_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(value_arguments "[" @fold.open . (_) @fold.indent "]" @fold.close) @fold
(willset_didset_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
((multiline_comment)+ @fold . (_))
(statements . (_) @fold.indent) @fold
