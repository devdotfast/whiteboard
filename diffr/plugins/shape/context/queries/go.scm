; inherits: builtin:core/queries/go/folds.scm
; The scopes whose first and last line stay visible above and below a change
; inside them. A scope is the whole construct, not its body: its first line is
; the line its signature starts on, however many lines that signature runs to,
; and its last is the line that closes it. The body fold the core query
; gives the construct covers only the body, so it nests inside the scope and
; starts a line later.
((function_declaration) @fold
  (#set! tag "context:scope"))
((method_declaration) @fold
  (#set! tag "context:scope"))
((for_statement) @fold
  (#set! tag "context:scope"))
((expression_switch_statement) @fold
  (#set! tag "context:scope"))
((return_statement) @fold
  (#set! tag "context:scope"))

; Blocks with a closing line of their own: a change inside keeps it.
((if_statement) @fold
  (#set! tag "context:scope"))
((type_switch_statement) @fold
  (#set! tag "context:scope"))
((select_statement) @fold
  (#set! tag "context:scope"))

((block "{" @fold.open (statement_list . (labeled_statement (label_name) . (_) @fold.indent) @_first) "}" @fold.close) @fold
  (#match? @_first "^[A-Za-z_][A-Za-z0-9_]*:\\s*\n")
 (#set! tag "context:body"))
((block "{" @fold.open (statement_list . (_) @fold.indent) "}" @fold.close) @fold
  (#not-match? @fold.indent "^[A-Za-z_][A-Za-z0-9_]*:\\s*\n")
 (#set! tag "context:body"))
((field_declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
((literal_value "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))

((argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
  (#match? @fold "\\n") (#set! tag "context:body"))

([(var_declaration) (const_declaration) (type_declaration) (short_var_declaration)
  (go_statement) (send_statement)] @fold
 (#set! tag "context:scope"))
((package_clause) @fold (#set! tag "context:keep"))
([(if_statement) (select_statement) (expression_switch_statement) (type_switch_statement)] @fold
 (#set! tag "context:branches"))
([(communication_case) (expression_case) (type_case) (default_case)] @fold
 (#set! tag "context:scope") (#set! tag "context:clause"))

((parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#match? @fold "\\n") (#set! tag "context:body"))

((import_spec_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#set! tag "context:body"))
((import_declaration) @fold (#set! tag "context:scope"))

((statement_list . (_) @fold.indent) @fold (#set! tag "context:body"))
([(communication_case) (expression_case) (type_case) (default_case)] @fold
 (#set! tag "context:open-ended"))

((function_declaration body: (block (statement_list (defer_statement) @fold))) (#set! tag "context:relevant"))
((method_declaration body: (block (statement_list (defer_statement) @fold))) (#set! tag "context:relevant"))

((expression_statement) @fold (#set! tag "context:scope"))

(if_statement alternative: (if_statement) @fold (#set! tag "context:clause"))

((assignment_statement) @fold (#set! tag "context:scope"))
((interface_type "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
((method_elem) @fold (#set! tag "context:scope"))
((method_elem parameters: (parameter_list) @fold) (#set! tag "context:relevant"))
