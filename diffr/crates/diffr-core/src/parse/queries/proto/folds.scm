(enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
(message_body "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold
((comment)+ @fold . (_))
