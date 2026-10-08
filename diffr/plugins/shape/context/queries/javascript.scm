; inherits: builtin:core/queries/javascript/folds.scm
; The scopes whose first and last line stay visible above and below a change
; inside them. A scope is the whole construct, not its body: its first line is
; the line its signature starts on, however many lines that signature runs to,
; and its last is the line that closes it. The body fold the core query
; gives the construct covers only the body, so it nests inside the scope and
; starts a line later.
; An exported declaration is matched on its export, below, so the scope
; starts on the line with `export`, not the line after it.
(program
  [(function_declaration) (generator_function_declaration) (class_declaration)] @fold
  (#set! tag "context:scope"))
(statement_block
  [(function_declaration) (generator_function_declaration) (class_declaration)] @fold
  (#set! tag "context:scope"))
((method_definition) @fold
  (#set! tag "context:scope"))
((for_statement) @fold
  (#set! tag "context:scope"))
((switch_statement) @fold
  (#set! tag "context:scope"))
((return_statement) @fold
  (#set! tag "context:scope"))

; Export prefixes belong to the declaration header. Without the wrapper,
; whole-line projection starts the function scope on its first parameter.
((export_statement declaration: [
  (function_declaration)
  (generator_function_declaration)
  (class_declaration)
]) @fold (#set! tag "context:scope"))

; Blocks with a closing line of their own: a change inside keeps it.
((if_statement) @fold
  (#set! tag "context:scope"))
((while_statement) @fold
  (#set! tag "context:scope"))
((do_statement) @fold
  (#set! tag "context:scope"))
((try_statement) @fold
  (#set! tag "context:scope"))
((for_in_statement) @fold
  (#set! tag "context:scope"))

([
  (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (class_body "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (switch_body "{" @fold.open . (_) @fold.indent "}" @fold.close)] @fold (#set! tag "context:body"))
([
  (object "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (array "[" @fold.open . (_) @fold.indent "]" @fold.close)] @fold (#set! tag "context:body"))

((arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
  (#match? @fold "\\n") (#set! tag "context:body"))

([(export_statement)
  (new_expression) (function_expression) (throw_statement)] @fold
 (#set! tag "context:scope"))
([(if_statement) (try_statement) (switch_statement)] @fold (#set! tag "context:branches"))
([(catch_clause) (finally_clause) (else_clause) (switch_case) (switch_default)] @fold
 (#set! tag "context:scope") (#set! tag "context:clause"))

((parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#match? @fold "\\n") (#set! tag "context:body"))

((named_imports "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
((import_statement) @fold (#set! tag "context:scope"))

([(switch_case) (switch_default)] @fold (#set! tag "context:open-ended"))
(switch_case ":" @fold . (_) @fold @fold.indent (_)* @fold (#set! tag "context:body"))
(switch_default ":" @fold . (_) @fold @fold.indent (_)* @fold (#set! tag "context:body"))
(else_clause (if_statement) @fold (#set! tag "context:clause"))

((expression_statement) @fold (#set! tag "context:scope"))

(program [(lexical_declaration) (variable_declaration)] @fold (#set! tag "context:scope"))
(statement_block [(lexical_declaration) (variable_declaration)] @fold (#set! tag "context:scope"))

