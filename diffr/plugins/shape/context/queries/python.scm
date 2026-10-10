; inherits: builtin:core/queries/python/folds.scm
; The scopes whose first and last line stay visible above and below a change
; inside them. A scope is the whole construct, not its body: its first line is
; the line its signature starts on, however many lines that signature runs to,
; and its last is the line that closes it. The body fold the core query
; gives the construct covers only the body, so it nests inside the scope and
; starts a line later.
((return_statement) @fold
  (#set! tag "context:scope"))

([
  (function_definition ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (class_definition ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (if_statement ":" @fold.open consequence: (block . (_) @fold.indent) @fold)
  (elif_clause ":" @fold.open consequence: (block . (_) @fold.indent) @fold)
  (else_clause ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (for_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (while_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (with_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (try_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (except_clause ":" @fold.open (block . (_) @fold.indent) @fold)
  (finally_clause ":" @fold.open (block . (_) @fold.indent) @fold)
  (match_statement ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (case_clause ":" @fold.open consequence: (block . (_) @fold.indent) @fold)
] (#set! tag "context:body"))
([
  (list "[" @fold.open . (_) @fold.indent "]" @fold.close)
  (dictionary "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (set "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (tuple . "(" @fold.open . (_) @fold.indent ")" @fold.close)
] @fold (#set! tag "context:body"))

((argument_list "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
  (#match? @fold "\\n") (#set! tag "context:body"))

([(assignment)
  (assert_statement) (raise_statement) (yield) (await)
  (list_comprehension) (set_comprehension) (dictionary_comprehension) (generator_expression)] @fold
 (#set! tag "context:scope"))
([(function_definition) (class_definition) (for_statement) (while_statement)
  (if_statement) (try_statement) (match_statement) (with_statement)
  (elif_clause) (else_clause) (except_clause) (finally_clause) (case_clause)
  (decorated_definition)] @fold
 (#set! tag "context:scope") (#set! tag "context:open-ended"))
([(if_statement) (try_statement) (match_statement)] @fold (#set! tag "context:branches"))
([(elif_clause) (else_clause) (except_clause) (finally_clause) (case_clause)] @fold
 (#set! tag "context:clause"))
((for_in_clause) @fold (#set! tag "context:keep"))
((if_clause) @fold (#set! tag "context:keep"))

((parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#match? @fold "\\n") (#set! tag "context:body"))

((import_from_statement module_name: (_) @fold "(" @fold.open . (_) @fold.indent ")" @fold @fold.close) (#set! tag "context:body"))
((import_from_statement) @fold (#set! tag "context:scope"))

((expression_statement) @fold (#set! tag "context:scope"))

((function_definition body: (block . (expression_statement (string) @fold))) (#set! tag "context:relevant"))

(assignment type: (type (parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold) (#set! tag "context:keep"))

([(lambda) (conditional_expression)  (pair) (union_type) (import_statement)] @fold (#set! tag "context:scope"))
(expression_statement (call) @fold (#set! tag "context:scope"))
((conditional_expression "if" @fold . (_) @fold "else" @fold) (#set! tag "context:relevant"))
