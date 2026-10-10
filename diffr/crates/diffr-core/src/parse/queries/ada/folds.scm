((comment)+ @fold . (_))
; A statement may fold itself, so the token before a body owns its fold.
(if_statement "then" @fold . statements: (_) @fold.indent statements: (_)* @fold)
(if_statement "else" @fold @fold.open . (_) @fold.indent "end" @fold @fold.close)
(handled_sequence_of_statements . (_) @fold.indent) @fold
