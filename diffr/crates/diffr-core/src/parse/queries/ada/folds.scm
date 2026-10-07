((comment)+ @fold . (_))
(if_statement statements: (_) @fold @fold.indent statements: (_)* @fold)
(if_statement else_statements: (_) @fold @fold.indent else_statements: (_)* @fold)
(handled_sequence_of_statements . (_) @fold.indent) @fold
