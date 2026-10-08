; inherits: builtin:core/queries/rust/folds.scm
; The scopes whose first and last line stay visible above and below a change
; inside them. A scope is the whole construct, not its body: its first line is
; the line its signature starts on, however many lines that signature runs to,
; and its last is the line that closes it. The body fold the core query
; gives the construct covers only the body, so it nests inside the scope and
; starts a line later.
((function_item) @fold
  (#set! tag "context:scope"))
((impl_item) @fold
  (#set! tag "context:scope"))
((mod_item) @fold
  (#set! tag "context:scope"))
((struct_item) @fold
  (#set! tag "context:scope"))
((for_expression) @fold
  (#set! tag "context:scope"))
((loop_expression) @fold
  (#set! tag "context:scope"))
((match_expression) @fold
  (#set! tag "context:scope"))
((return_expression) @fold
  (#set! tag "context:scope"))
; Blocks with a closing line of their own: a change inside keeps it.
((if_expression) @fold
  (#set! tag "context:scope"))
((while_expression) @fold
  (#set! tag "context:scope"))

([
  (block "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (field_declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (match_block "{" @fold.open . (_) @fold.indent "}" @fold.close)] @fold (#set! tag "context:body"))
([
  (array_expression "[" @fold.open . (_) @fold.indent "]" @fold.close)
  (field_initializer_list "{" @fold.open . (_) @fold.indent "}" @fold.close)] @fold (#set! tag "context:body"))

((arguments "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold
  (#match? @fold "\\n") (#set! tag "context:body"))

([(let_declaration) (const_item) (static_item)
  (unsafe_block)
  (macro_definition) (macro_rule) (macro_invocation)] @fold
 (#set! tag "context:scope"))
([(if_expression) (match_expression)] @fold (#set! tag "context:branches"))
([(else_clause) (match_arm)] @fold (#set! tag "context:scope") (#set! tag "context:clause"))

((parenthesized_expression "(" @fold.open . (_) @fold.indent ")" @fold.close) @fold (#match? @fold "\\n") (#set! tag "context:body"))

((use_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "context:body"))
((use_declaration) @fold (#set! tag "context:scope"))

([
 (token_tree "(" @fold.open . (_) @fold.indent ")" @fold.close)
 (token_tree "{" @fold.open . (_) @fold.indent "}" @fold.close)
 (token_tree "[" @fold.open . (_) @fold.indent "]" @fold.close)
] @fold (#set! tag "context:body"))

((expression_statement) @fold (#set! tag "context:scope"))

([(enum_item) (trait_item) (closure_expression) (assignment_expression)
  (macro_definition_v2) (macro_invocation_item) (macro_rule_v2) (macro_rules_v2)] @fold (#set! tag "context:scope"))
([(enum_variant_list "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (ordered_field_declaration_list "(" @fold.open . (_) @fold.indent ")" @fold.close)] @fold (#set! tag "context:body"))

((enum_variant_list (enum_variant) @fold . ","? @fold) (#set! tag "context:scope"))
